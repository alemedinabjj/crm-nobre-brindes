import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AutomationSecretGuard } from './automation-secret.guard.js';
import {
  listFollowUpsQuerySchema,
  listRunsQuerySchema,
  resolveFollowUpSchema,
  type ListFollowUpsQuery,
  type ListRunsQuery,
  type ResolveFollowUpInput,
} from './follow-up.schemas.js';
import { FollowUpsService } from './follow-ups.service.js';

@Controller()
export class FollowUpsController {
  constructor(
    @Inject(FollowUpsService) private readonly service: FollowUpsService,
  ) {}

  @Get('follow-up-tasks')
  list(
    @Query(new ZodValidationPipe(listFollowUpsQuerySchema))
    query: ListFollowUpsQuery,
  ) {
    return this.service.listTasks(query);
  }

  @Patch('follow-up-tasks/:id')
  @HttpCode(204)
  async resolve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(resolveFollowUpSchema))
    body: ResolveFollowUpInput,
  ): Promise<void> {
    await this.service.resolveTask(id, body);
  }

  @Post('automations/follow-ups/run')
  @HttpCode(200)
  @UseGuards(AutomationSecretGuard)
  run() {
    return this.service.run('manual');
  }

  /** Disparo do Cron da Vercel; separado para o registro mostrar a origem. */
  @Post('automations/follow-ups/cron')
  @HttpCode(200)
  @UseGuards(AutomationSecretGuard)
  runFromCron() {
    return this.service.run('cron');
  }

  @Get('automations/follow-ups/runs')
  runs(
    @Query(new ZodValidationPipe(listRunsQuerySchema)) query: ListRunsQuery,
  ) {
    return this.service.listRuns(query.limit);
  }
}
