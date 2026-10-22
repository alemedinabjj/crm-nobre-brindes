import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { Clock } from '../clock/clock.js';
import { BusinessRuleException } from '../common/http-errors.js';
import { DATABASE, type Database } from '../database/database.module.js';
import {
  automationRuns,
  followUpTasks,
  opportunities,
  type AutomationRunRow,
} from '../database/schema.js';
import { assessAttention } from '../domain/attention.js';
import {
  daysBetween,
  formatCalendarDate,
  parseCalendarDate,
} from '../domain/calendar-date.js';
import { planFollowUps } from '../domain/follow-up-planner.js';
import { STAGE_LABELS, type Stage } from '../domain/stage.js';
import type {
  ListFollowUpsQuery,
  ResolveFollowUpInput,
} from './follow-up.schemas.js';

export const FOLLOW_UP_AUTOMATION = 'follow-up-reminders';
export type RunTrigger = 'schedule' | 'cron' | 'manual' | 'startup';

export type RunSummary = {
  id: string;
  trigger: string;
  referenceDate: string;
  createdCount: number;
  canceledCount: number;
  startedAt: string;
  finishedAt: string | null;
};

export type FollowUpTaskView = {
  id: string;
  opportunityId: string;
  opportunityCode: string;
  companyName: string;
  stage: Stage;
  stageLabel: string;
  sellerName: string;
  reasonCode: string;
  priority: 'HIGH' | 'NORMAL';
  title: string;
  details: string;
  dueDate: string;
  /** Dias de atraso em relação a hoje (0 = vence hoje, negativo = futuro). */
  daysOverdue: number;
  status: 'OPEN' | 'DONE' | 'CANCELED';
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

const toDate = (value: string | null): Date | null =>
  value === null ? null : parseCalendarDate(value);

const presentRun = (row: AutomationRunRow): RunSummary => ({
  id: row.id,
  trigger: row.trigger,
  referenceDate: row.referenceDate,
  createdCount: row.createdCount,
  canceledCount: row.canceledCount,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
});

@Injectable()
export class FollowUpsService {
  private readonly logger = new Logger(FollowUpsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * Roda o planejador sobre o funil inteiro e grava o resultado.
   *
   * Idempotente em três camadas: o planejador ignora negociação com tarefa
   * aberta; um advisory lock serializa execuções concorrentes (agendador da
   * API e Cron da Vercel podem disparar juntos); e o índice único parcial no
   * banco barra duplicata mesmo se as duas anteriores falharem.
   */
  async run(trigger: RunTrigger): Promise<RunSummary> {
    const today = this.clock.today();

    const summary = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${FOLLOW_UP_AUTOMATION}))`,
      );

      const rows = await tx
        .select({
          id: opportunities.id,
          companyName: opportunities.companyName,
          sellerName: opportunities.sellerName,
          stage: opportunities.stage,
          lastContactAt: opportunities.lastContactAt,
          proposalValidUntil: opportunities.proposalValidUntil,
          clientEventDate: opportunities.clientEventDate,
        })
        .from(opportunities);

      const openTasks = await tx
        .select({
          taskId: followUpTasks.id,
          opportunityId: followUpTasks.opportunityId,
        })
        .from(followUpTasks)
        .where(eq(followUpTasks.status, 'OPEN'));

      const plan = planFollowUps(
        rows.map((row) => ({
          opportunityId: row.id,
          companyName: row.companyName,
          sellerName: row.sellerName,
          stage: row.stage,
          attention: assessAttention(
            {
              stage: row.stage,
              lastContactAt: toDate(row.lastContactAt),
              proposalValidUntil: toDate(row.proposalValidUntil),
              clientEventDate: toDate(row.clientEventDate),
            },
            today,
          ),
        })),
        openTasks,
        today,
      );

      const [run] = await tx
        .insert(automationRuns)
        .values({
          automation: FOLLOW_UP_AUTOMATION,
          trigger,
          referenceDate: formatCalendarDate(today),
          createdCount: 0,
          canceledCount: 0,
        })
        .returning();
      if (!run) throw new Error('Falha ao registrar a execução da automação');

      const created =
        plan.toCreate.length === 0
          ? []
          : await tx
              .insert(followUpTasks)
              .values(
                plan.toCreate.map((task) => ({
                  opportunityId: task.opportunityId,
                  sellerName: task.sellerName,
                  reasonCode: task.reasonCode,
                  priority: task.priority,
                  title: task.title,
                  details: task.details,
                  dueDate: formatCalendarDate(task.dueDate),
                  createdByRunId: run.id,
                })),
              )
              .onConflictDoNothing()
              .returning({ id: followUpTasks.id });

      for (const cancellation of plan.toCancel) {
        await tx
          .update(followUpTasks)
          .set({
            status: 'CANCELED',
            resolution: cancellation.resolution,
            resolvedAt: new Date(),
          })
          .where(
            and(
              eq(followUpTasks.id, cancellation.taskId),
              eq(followUpTasks.status, 'OPEN'),
            ),
          );
      }

      const [finished] = await tx
        .update(automationRuns)
        .set({
          createdCount: created.length,
          canceledCount: plan.toCancel.length,
          finishedAt: new Date(),
        })
        .where(eq(automationRuns.id, run.id))
        .returning();
      return presentRun(finished ?? run);
    });

    this.logger.log(
      `Follow-up (${trigger}) em ${summary.referenceDate}: ${summary.createdCount} criada(s), ${summary.canceledCount} cancelada(s).`,
    );
    return summary;
  }

  /**
   * Execução de recuperação: se a API estava fora do ar (ou hibernando) no
   * horário agendado, roda ao subir. Só em dia útil e só se ainda não houve
   * execução para a data de hoje.
   */
  async runIfMissed(): Promise<RunSummary | null> {
    const today = this.clock.today();
    const weekday = today.getUTCDay();
    if (weekday === 0 || weekday === 6) return null;

    const [existing] = await this.db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automation, FOLLOW_UP_AUTOMATION),
          eq(automationRuns.referenceDate, formatCalendarDate(today)),
        ),
      )
      .limit(1);
    return existing ? null : this.run('startup');
  }

  async listRuns(limit = 10): Promise<RunSummary[]> {
    const rows = await this.db
      .select()
      .from(automationRuns)
      .orderBy(desc(automationRuns.startedAt))
      .limit(limit);
    return rows.map(presentRun);
  }

  async listTasks(query: ListFollowUpsQuery): Promise<FollowUpTaskView[]> {
    const conditions: SQL[] = [eq(followUpTasks.status, query.status)];
    if (query.seller)
      conditions.push(eq(followUpTasks.sellerName, query.seller));

    const rows = await this.db
      .select({
        task: followUpTasks,
        code: opportunities.code,
        companyName: opportunities.companyName,
        stage: opportunities.stage,
      })
      .from(followUpTasks)
      .innerJoin(
        opportunities,
        eq(opportunities.id, followUpTasks.opportunityId),
      )
      .where(and(...conditions))
      .orderBy(
        asc(followUpTasks.dueDate),
        asc(followUpTasks.priority),
        asc(followUpTasks.createdAt),
      );

    const today = this.clock.today();
    return rows.map(({ task, code, companyName, stage }) => ({
      id: task.id,
      opportunityId: task.opportunityId,
      opportunityCode: code,
      companyName,
      stage,
      stageLabel: STAGE_LABELS[stage],
      sellerName: task.sellerName,
      reasonCode: task.reasonCode,
      priority: task.priority,
      title: task.title,
      details: task.details,
      dueDate: task.dueDate,
      daysOverdue: daysBetween(parseCalendarDate(task.dueDate), today),
      status: task.status,
      resolution: task.resolution,
      createdAt: task.createdAt.toISOString(),
      resolvedAt: task.resolvedAt?.toISOString() ?? null,
    }));
  }

  async resolveTask(id: string, input: ResolveFollowUpInput): Promise<void> {
    const [task] = await this.db
      .select({ status: followUpTasks.status })
      .from(followUpTasks)
      .where(eq(followUpTasks.id, id));
    if (!task) {
      throw new HttpException(
        { error: 'NOT_FOUND', message: `Tarefa ${id} não encontrada.` },
        HttpStatus.NOT_FOUND,
      );
    }
    if (task.status !== 'OPEN') {
      throw new BusinessRuleException([
        {
          code: 'FINAL_STAGE_READ_ONLY',
          message: 'Esta tarefa já foi encerrada.',
        },
      ]);
    }

    await this.db
      .update(followUpTasks)
      .set({
        status: input.status,
        resolution:
          input.resolution?.trim() ||
          (input.status === 'DONE'
            ? 'Concluída pelo vendedor.'
            : 'Dispensada pelo vendedor.'),
        resolvedAt: new Date(),
      })
      .where(and(eq(followUpTasks.id, id), eq(followUpTasks.status, 'OPEN')));
  }
}
