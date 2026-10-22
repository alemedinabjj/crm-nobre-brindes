import { Controller, Get, Inject } from '@nestjs/common';
import { Clock } from '../clock/clock.js';
import { DEFAULT_ATTENTION_POLICY } from '../domain/attention.js';
import { formatCalendarDate } from '../domain/calendar-date.js';
import { ALLOWED_TRANSITIONS } from '../domain/stage-transition.js';
import { FINAL_STAGES, STAGE_LABELS, STAGES } from '../domain/stage.js';
import { OpportunitiesService } from '../opportunities/opportunities.service.js';

/** O que a tela precisa saber das regras sem duplicá-las. */
@Controller('meta')
export class MetaController {
  constructor(
    @Inject(Clock) private readonly clock: Clock,
    @Inject(OpportunitiesService)
    private readonly opportunities: OpportunitiesService,
  ) {}

  @Get()
  async describe() {
    return {
      today: formatCalendarDate(this.clock.today()),
      stages: STAGES.map((stage) => ({
        id: stage,
        label: STAGE_LABELS[stage],
        isFinal: (FINAL_STAGES as readonly string[]).includes(stage),
        allowedTransitions: ALLOWED_TRANSITIONS[stage],
      })),
      attentionPolicy: DEFAULT_ATTENTION_POLICY,
      sellers: await this.opportunities.listSellers(),
    };
  }
}
