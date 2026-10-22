import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AssistantController } from './assistant/assistant.controller.js';
import { AssistantService } from './assistant/assistant.service.js';
import { GeminiProvider } from './assistant/llm/gemini.provider.js';
import {
  LLM_PROVIDER,
  type LlmProvider,
} from './assistant/llm/llm-provider.js';
import { ApiKeyGuard } from './common/api-key.guard.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { EMBEDDING_DIMENSIONS } from './database/schema.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { FollowUpsController } from './follow-ups/follow-ups.controller.js';
import { FollowUpsScheduler } from './follow-ups/follow-ups.scheduler.js';
import { FollowUpsService } from './follow-ups/follow-ups.service.js';
import { HealthController } from './health/health.controller.js';
import { MetaController } from './meta/meta.controller.js';
import { OpportunitiesController } from './opportunities/opportunities.controller.js';
import { OpportunitiesService } from './opportunities/opportunities.service.js';

const retryLogger = new Logger('GeminiProvider');

@Module({
  imports: [ConfigModule, DatabaseModule, ScheduleModule.forRoot()],
  controllers: [
    OpportunitiesController,
    FollowUpsController,
    AssistantController,
    MetaController,
    HealthController,
  ],
  providers: [
    OpportunitiesService,
    FollowUpsService,
    FollowUpsScheduler,
    AssistantService,
    {
      // Sem chave, o provedor é null: o assistente responde 503 e o CRM segue normal.
      provide: LLM_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): LlmProvider | null =>
        config.GEMINI_API_KEY
          ? new GeminiProvider({
              apiKey: config.GEMINI_API_KEY,
              chatModel: config.GEMINI_CHAT_MODEL,
              fallbackChatModels: config.GEMINI_FALLBACK_MODELS,
              embeddingModel: config.GEMINI_EMBEDDING_MODEL,
              embeddingDimensions: EMBEDDING_DIMENSIONS,
              timeoutMs: 25_000,
              onRetry: ({ model, error }) =>
                retryLogger.warn(
                  `Gemini falhou em ${model}, tentando de novo: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
                ),
            })
          : null,
    },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
