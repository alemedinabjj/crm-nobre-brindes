import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './common/api-key.guard.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { MetaController } from './meta/meta.controller.js';
import { OpportunitiesController } from './opportunities/opportunities.controller.js';
import { OpportunitiesService } from './opportunities/opportunities.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [OpportunitiesController, MetaController, HealthController],
  providers: [
    OpportunitiesService,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
