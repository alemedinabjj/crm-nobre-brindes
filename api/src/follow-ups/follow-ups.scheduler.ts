import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { FollowUpsService } from './follow-ups.service.js';

/**
 * Agendamento dentro da API: em dias úteis, antes do expediente, gera os
 * retornos do dia. Horário e liga/desliga vêm do ambiente; em hospedagem
 * que hiberna o processo, o Cron da Vercel cobre o disparo (ver README).
 */
@Injectable()
export class FollowUpsScheduler
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = new Logger(FollowUpsScheduler.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
    @Inject(FollowUpsService) private readonly followUps: FollowUpsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.FOLLOW_UP_CRON) {
      this.logger.log('Agendamento interno de follow-up desligado.');
      return;
    }

    const job = CronJob.from({
      cronTime: this.config.FOLLOW_UP_CRON,
      timeZone: this.config.TZ_OPERACAO,
      onTick: () => {
        this.followUps.run('schedule').catch((error: unknown) => {
          this.logger.error(
            'Falha na automação de follow-up',
            error instanceof Error ? error.stack : error,
          );
        });
      },
    });
    this.registry.addCronJob('follow-up-reminders', job);
    job.start();
    this.logger.log(
      `Follow-up agendado: "${this.config.FOLLOW_UP_CRON}" (${this.config.TZ_OPERACAO}).`,
    );
  }

  onApplicationBootstrap(): void {
    if (!this.config.FOLLOW_UP_CRON) return;
    this.followUps
      .runIfMissed()
      .then((run) => {
        if (run)
          this.logger.log(
            `Execução de recuperação feita: ${run.createdCount} retorno(s) criado(s).`,
          );
      })
      .catch((error: unknown) =>
        this.logger.error(
          'Falha na execução de recuperação',
          error instanceof Error ? error.stack : error,
        ),
      );
  }
}
