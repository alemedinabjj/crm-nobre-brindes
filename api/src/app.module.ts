import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiKeyGuard } from './common/api-key.guard.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { FollowUpsController } from './follow-ups/follow-ups.controller.js';
import { FollowUpsScheduler } from './follow-ups/follow-ups.scheduler.js';
import { FollowUpsService } from './follow-ups/follow-ups.service.js';
import { HealthController } from './health/health.controller.js';
import { MetaController } from './meta/meta.controller.js';
import { OpportunitiesController } from './opportunities/opportunities.controller.js';
import { OpportunitiesService } from './opportunities/opportunities.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule, ScheduleModule.forRoot()],
  controllers: [
    OpportunitiesController,
    FollowUpsController,
    MetaController,
    HealthController,
  ],
  providers: [
    OpportunitiesService,
    FollowUpsService,
    FollowUpsScheduler,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
