import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { count, isNotNull } from 'drizzle-orm';
import { Clock } from '../clock/clock.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { assistantInteractions, knowledgeChunks } from '../database/schema.js';
import { formatCalendarDate } from '../domain/calendar-date.js';
import { FollowUpsService } from '../follow-ups/follow-ups.service.js';
import { OpportunitiesService } from '../opportunities/opportunities.service.js';
import {
  runAssistant,
  type AssistantReply,
  type ChatTurn,
} from './agent/assistant-agent.js';
import {
  DEFAULT_SEARCH_OPTIONS,
  searchKnowledge,
  syncKnowledge,
  type SearchHit,
  type SyncReport,
} from './knowledge/knowledge.repository.js';
import {
  LLM_PROVIDER,
  LlmUnavailableError,
  type LlmProvider,
} from './llm/llm-provider.js';
import { SlidingWindowRateLimiter } from './rate-limiter.js';

export type AssistantStatus = {
  enabled: boolean;
  provider: string | null;
  chatModel: string | null;
  embeddingModel: string | null;
  knowledge: {
    chunks: number;
    withEmbedding: number;
    mode: 'hybrid' | 'keyword-only';
  };
};

const RATE_WINDOW_MS = 10 * 60_000;

@Injectable()
export class AssistantService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AssistantService.name);
  private readonly limiter: SlidingWindowRateLimiter;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider | null,
    @Inject(OpportunitiesService)
    private readonly opportunities: OpportunitiesService,
    @Inject(FollowUpsService) private readonly followUps: FollowUpsService,
  ) {
    this.limiter = new SlidingWindowRateLimiter(
      config.ASSISTANT_RATE_LIMIT,
      RATE_WINDOW_MS,
    );
  }

  /** Mantém a base em dia a cada deploy sem travar a subida da API. */
  onApplicationBootstrap(): void {
    if (!this.config.KNOWLEDGE_AUTO_SYNC) return;
    this.syncKnowledge()
      .then((report) =>
        this.logger.log(
          `Base de conhecimento sincronizada: ${JSON.stringify(report)}`,
        ),
      )
      .catch((error: unknown) =>
        this.logger.error(
          'Falha ao sincronizar a base de conhecimento',
          error instanceof Error ? error.stack : error,
        ),
      );
  }

  syncKnowledge(): Promise<SyncReport> {
    return syncKnowledge(this.db, this.provider);
  }

  async status(): Promise<AssistantStatus> {
    const [totals] = await this.db
      .select({ total: count() })
      .from(knowledgeChunks);
    const [embedded] = await this.db
      .select({ total: count() })
      .from(knowledgeChunks)
      .where(isNotNull(knowledgeChunks.embedding));
    const withEmbedding = embedded?.total ?? 0;
    return {
      enabled: this.provider !== null,
      provider: this.provider?.name ?? null,
      chatModel: this.provider?.chatModel ?? null,
      embeddingModel: this.provider?.embeddingModel ?? null,
      knowledge: {
        chunks: totals?.total ?? 0,
        withEmbedding,
        mode: this.provider && withEmbedding > 0 ? 'hybrid' : 'keyword-only',
      },
    };
  }

  /** Busca na base sem passar pelo modelo de chat (usada pelos evals de RAG). */
  async search(
    query: string,
    limit = DEFAULT_SEARCH_OPTIONS.limit,
  ): Promise<SearchHit[]> {
    const vector = await this.embedQuery(query);
    return searchKnowledge(this.db, query, vector, {
      ...DEFAULT_SEARCH_OPTIONS,
      limit,
    });
  }

  async chat(
    question: string,
    history: ChatTurn[],
    clientKey: string,
    sellerName?: string,
  ): Promise<AssistantReply> {
    if (!this.provider) {
      throw new HttpException(
        {
          error: 'ASSISTANT_DISABLED',
          message:
            'O assistente de IA não está configurado neste ambiente (defina GEMINI_API_KEY).',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!this.limiter.tryAcquire(clientKey)) {
      throw new HttpException(
        {
          error: 'RATE_LIMITED',
          message: 'Muitas perguntas em pouco tempo. Aguarde alguns minutos.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const reply = await runAssistant(question, history, {
      provider: this.provider,
      today: formatCalendarDate(this.clock.today()),
      sellerName,
      opportunities: this.opportunities,
      followUps: this.followUps,
      searchKnowledge: (query) => this.search(query),
    }).catch((error: unknown) => {
      if (!(error instanceof LlmUnavailableError)) throw error;
      // Sobrecarga/timeout do provedor já esgotou as novas tentativas.
      this.logger.warn(error.message);
      throw new HttpException(
        {
          error: 'ASSISTANT_UNAVAILABLE',
          message:
            'O provedor de IA está sobrecarregado agora. Tente de novo em alguns segundos; o restante do CRM segue funcionando.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    });

    await this.record(reply).catch((error: unknown) =>
      this.logger.warn(
        `Falha ao registrar interação: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return reply;
  }

  private async embedQuery(query: string): Promise<number[] | null> {
    if (!this.provider) return null;
    try {
      const [vector] = await this.provider.embed([query], 'query');
      return vector ?? null;
    } catch (error) {
      // Degrada para busca por palavra-chave em vez de falhar a resposta.
      this.logger.warn(
        `Embedding da consulta falhou, seguindo só com palavra-chave: ${String(error)}`,
      );
      return null;
    }
  }

  private async record(reply: AssistantReply): Promise<void> {
    await this.db.insert(assistantInteractions).values({
      question: reply.sanitizedQuestion,
      answer: reply.answer,
      outcome: reply.outcome,
      toolCalls: reply.toolCalls,
      citations: reply.citations.map(({ number, chunkId, cited }) => ({
        number,
        chunkId,
        cited,
      })),
      guardrailFlags: reply.guardrailFlags,
      model: reply.model,
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
      latencyMs: reply.latencyMs,
    });
  }
}
