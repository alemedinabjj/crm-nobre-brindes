import { randomUUID } from 'node:crypto';
import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import {
  LlmUnavailableError,
  type AgentMessage,
  type EmbeddingPurpose,
  type GenerateRequest,
  type GenerateResponse,
  type LlmProvider,
  type ToolCall,
} from './llm-provider.js';
import {
  errorStatus,
  withModelFallback,
  type Attempt,
  type RetryPolicy,
} from './resilience.js';

export type GeminiOptions = {
  apiKey: string;
  chatModel: string;
  /** Modelos reserva, tentados em ordem quando o principal está sobrecarregado. */
  fallbackChatModels?: string[];
  embeddingModel: string;
  embeddingDimensions: number;
  timeoutMs: number;
  retryPolicy?: RetryPolicy;
  onRetry?: (attempt: Attempt) => void;
};

/** Valor documentado pelo Gemini para chamadas que não vieram do próprio modelo. */
export const FOREIGN_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

/** Conteúdo cru guardado junto do modelo que o produziu. */
type ProviderContent = { model: string; content: Content };

const isProviderContent = (value: unknown): value is ProviderContent =>
  typeof value === 'object' &&
  value !== null &&
  'model' in value &&
  'content' in value &&
  typeof (value as { content: unknown }).content === 'object';

const EMBED_BATCH_SIZE = 50;

/**
 * Converte o histórico neutro do agente para o formato do Gemini.
 *
 * A resposta crua (com as thought signatures) só é reenviada ao mesmo modelo
 * que a gerou: assinaturas não valem entre modelos. Se o turno anterior veio
 * de outro modelo (houve fallback), as chamadas são reconstruídas sem elas.
 */
export const toContents = (
  messages: AgentMessage[],
  model: string,
): Content[] =>
  messages.map((message): Content => {
    if (message.role === 'user') {
      return { role: 'user', parts: [{ text: message.text }] };
    }
    if (message.role === 'assistant') {
      const raw = message.providerContent;
      if (isProviderContent(raw) && raw.model === model) return raw.content;
      const parts: Part[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.toolCalls) {
        parts.push({
          functionCall: { id: call.id, name: call.name, args: call.args },
          // Chamada vinda de outro modelo (fallback): não há assinatura válida
          // para este. O Gemini documenta este valor para esse caso.
          thoughtSignature: FOREIGN_THOUGHT_SIGNATURE,
        });
      }
      return { role: 'model', parts };
    }
    return {
      role: 'user',
      parts: message.results.map((result) => ({
        functionResponse: {
          id: result.callId,
          name: result.name,
          response: { output: result.output },
        },
      })),
    };
  });

const readToolCalls = (response: GenerateContentResponse): ToolCall[] =>
  (response.functionCalls ?? []).map((call) => ({
    id: call.id ?? randomUUID(),
    name: call.name ?? '',
    args: (call.args as Record<string, unknown> | undefined) ?? {},
  }));

const readText = (response: GenerateContentResponse): string => {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim();
};

const stickyModel = (messages: AgentMessage[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role === 'assistant' &&
      isProviderContent(message.providerContent)
    )
      return message.providerContent.model;
  }
  return undefined;
};

const providerContentOf = (
  model: string,
  response: GenerateContentResponse,
): ProviderContent | undefined => {
  const content = response.candidates?.[0]?.content;
  return content ? { model, content } : undefined;
};

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(private readonly options: GeminiOptions) {
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: { timeout: options.timeoutMs },
    });
  }

  get chatModel(): string {
    return this.options.chatModel;
  }

  get embeddingModel(): string {
    return this.options.embeddingModel;
  }

  get embeddingDimensions(): number {
    return this.options.embeddingDimensions;
  }

  get chatModels(): string[] {
    return [
      this.options.chatModel,
      ...(this.options.fallbackChatModels ?? []).filter(
        (model) => model !== this.options.chatModel,
      ),
    ];
  }

  /**
   * Ordem de tentativa para esta chamada: se um turno anterior desta pergunta
   * já foi respondido por um modelo, ele vem primeiro. Assim a conversa com
   * ferramentas segue no mesmo modelo e as assinaturas continuam válidas.
   */
  modelOrderFor(messages: AgentMessage[]): string[] {
    const models = this.chatModels;
    const sticky = stickyModel(messages);
    return sticky && models.includes(sticky)
      ? [sticky, ...models.filter((model) => model !== sticky)]
      : models;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    return withModelFallback(
      this.modelOrderFor(request.messages),
      (model) => this.generateWith(model, request),
      {
        policy: this.options.retryPolicy,
        onRetry: this.options.onRetry,
        exhausted: (attempts) => {
          const last = attempts.at(-1);
          const status = errorStatus(last?.error);
          return new LlmUnavailableError(
            `Gemini indisponível após ${attempts.length} tentativa(s)` +
              (status ? ` (último status ${status})` : '') +
              ` nos modelos ${this.chatModels.join(', ')}.`,
            last?.error,
          );
        },
      },
    );
  }

  private async generateWith(
    model: string,
    request: GenerateRequest,
  ): Promise<GenerateResponse> {
    const response = await this.client.models.generateContent({
      model,
      contents: toContents(request.messages, model),
      config: {
        systemInstruction: request.system,
        temperature: request.temperature ?? 0.2,
        tools:
          request.tools.length > 0
            ? [
                {
                  functionDeclarations: request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parametersJsonSchema: tool.parameters,
                  })),
                },
              ]
            : undefined,
      },
    });

    return {
      text: readText(response),
      toolCalls: readToolCalls(response),
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      providerContent: providerContentOf(model, response),
      model,
    };
  }

  async embed(texts: string[], purpose: EmbeddingPurpose): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
      const response = await this.client.models.embedContent({
        model: this.options.embeddingModel,
        contents: batch,
        config: {
          taskType:
            purpose === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY',
          outputDimensionality: this.options.embeddingDimensions,
        },
      });
      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        throw new Error(
          `Embedding retornou ${embeddings.length} vetores para ${batch.length} textos.`,
        );
      }
      for (const embedding of embeddings)
        vectors.push(normalize(embedding.values ?? []));
    }
    return vectors;
  }
}

/**
 * Vetores com dimensão reduzida (768) não vêm normalizados; normalizar deixa
 * a distância de cosseno estável e comparável entre consultas.
 */
export const normalize = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
};
