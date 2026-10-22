import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { parseCalendarDate, todayIn } from '../domain/calendar-date.js';

/**
 * Fonte única de "hoje" para regras de prazo. Injetável para que testes e a
 * demonstração do case usem uma data fixa (REFERENCE_DATE).
 */
@Injectable()
export class Clock {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  today(): Date {
    const { REFERENCE_DATE, TZ_OPERACAO } = this.config;
    return REFERENCE_DATE
      ? parseCalendarDate(REFERENCE_DATE)
      : todayIn(TZ_OPERACAO);
  }
}
