import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { Clock } from '../clock/clock.js';
import {
  BusinessRuleException,
  OpportunityNotFoundException,
} from '../common/http-errors.js';
import { DATABASE, type Database } from '../database/database.module.js';
import {
  opportunities,
  opportunityItems,
  stageChanges,
  type OpportunityItemRow,
  type OpportunityRow,
} from '../database/schema.js';
import {
  formatCalendarDate,
  parseCalendarDate,
} from '../domain/calendar-date.js';
import { checkContactDate, checkEditable } from '../domain/opportunity-edit.js';
import { STAGE_LABELS } from '../domain/stage.js';
import { resolveOpenFollowUp } from '../follow-ups/follow-up-tasks.repository.js';
import {
  checkStageInvariants,
  evaluateTransition,
  type RuleViolation,
} from '../domain/stage-transition.js';
import {
  presentOpportunity,
  presentStageChange,
  type OpportunityDetailView,
  type OpportunityView,
} from './opportunity.presenter.js';
import type {
  ChangeStageInput,
  CreateOpportunityInput,
  ListOpportunitiesQuery,
  RegisterContactInput,
  UpdateOpportunityInput,
} from './opportunity.schemas.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const escapeLike = (term: string): string =>
  term.replace(/[\\%_]/g, (char) => `\\${char}`);

const toDate = (value: string | null): Date | null =>
  value === null ? null : parseCalendarDate(value);

const byUrgency = (left: OpportunityView, right: OpportunityView): number =>
  right.attention.score - left.attention.score ||
  (left.clientEventDate ?? '9999-12-31').localeCompare(
    right.clientEventDate ?? '9999-12-31',
  ) ||
  left.code.localeCompare(right.code);

@Injectable()
export class OpportunitiesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async list(query: ListOpportunitiesQuery): Promise<OpportunityView[]> {
    const rows = await this.db
      .select()
      .from(opportunities)
      .where(and(...this.listConditions(query)));

    const itemsByOpportunity = await this.loadItems(
      this.db,
      rows.map((row) => row.id),
    );
    const today = this.clock.today();

    return rows
      .map((row) =>
        presentOpportunity(row, itemsByOpportunity.get(row.id) ?? [], today),
      )
      .filter((view) => this.matchesAttention(view, query.attention))
      .sort(byUrgency);
  }

  async findOne(id: string): Promise<OpportunityDetailView> {
    const row = await this.findRow(this.db, id);
    const [items, history] = await Promise.all([
      this.loadItems(this.db, [id]),
      this.db
        .select()
        .from(stageChanges)
        .where(eq(stageChanges.opportunityId, id))
        .orderBy(asc(stageChanges.changedAt)),
    ]);

    return {
      ...presentOpportunity(row, items.get(id) ?? [], this.clock.today()),
      history: history.map(presentStageChange),
    };
  }

  /** Busca pelo código de negócio (OPP-2003); null quando não existe. */
  async findByCode(code: string): Promise<OpportunityDetailView | null> {
    const [row] = await this.db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(eq(opportunities.code, code.trim().toUpperCase()));
    return row ? this.findOne(row.id) : null;
  }

  async create(input: CreateOpportunityInput): Promise<OpportunityDetailView> {
    this.assertNoViolations(
      checkContactDate(toDate(input.lastContactAt), this.clock.today()),
    );

    const id = await this.db.transaction(async (tx) => {
      const { items, ...data } = input;
      const [created] = await tx
        .insert(opportunities)
        .values({
          ...data,
          code: sql`'OPP-' || nextval('opportunity_code_seq')`,
          stage: 'PRIMEIRO_CONTATO',
        })
        .returning({ id: opportunities.id });
      if (!created) throw new Error('Falha ao criar oportunidade');

      if (items.length > 0) {
        await tx
          .insert(opportunityItems)
          .values(
            items.map((item) => ({ ...item, opportunityId: created.id })),
          );
      }
      await tx.insert(stageChanges).values({
        opportunityId: created.id,
        fromStage: null,
        toStage: 'PRIMEIRO_CONTATO',
        reason: 'Oportunidade criada',
      });
      return created.id;
    });

    return this.findOne(id);
  }

  async update(
    id: string,
    input: UpdateOpportunityInput,
  ): Promise<OpportunityDetailView> {
    await this.db.transaction(async (tx) => {
      const row = await this.findRow(tx, id, { lock: true });
      this.assertNoViolations(checkEditable(row.stage));

      const { items, ...data } = input;
      const merged = { ...row, ...data };
      const itemCount = items?.length ?? (await this.countItems(tx, id));

      this.assertNoViolations([
        ...checkContactDate(toDate(merged.lastContactAt), this.clock.today()),
        ...checkStageInvariants(row.stage, {
          estimatedValue: merged.estimatedValue,
          itemCount,
          proposalValidUntil: toDate(merged.proposalValidUntil),
        }),
      ]);

      if (Object.keys(data).length > 0) {
        await tx
          .update(opportunities)
          .set(data)
          .where(eq(opportunities.id, id));
      }
      if (items) {
        await tx
          .delete(opportunityItems)
          .where(eq(opportunityItems.opportunityId, id));
        if (items.length > 0) {
          await tx
            .insert(opportunityItems)
            .values(items.map((item) => ({ ...item, opportunityId: id })));
        }
      }
    });

    return this.findOne(id);
  }

  /**
   * Toda mudança de etapa passa por aqui: lock na linha (evita duas pessoas
   * movendo o mesmo card ao mesmo tempo), validação no domínio e histórico
   * gravado na mesma transação da mudança.
   */
  async changeStage(
    id: string,
    input: ChangeStageInput,
  ): Promise<OpportunityDetailView> {
    await this.db.transaction(async (tx) => {
      const row = await this.findRow(tx, id, { lock: true });
      const result = evaluateTransition(
        {
          stage: row.stage,
          estimatedValue: row.estimatedValue,
          itemCount: await this.countItems(tx, id),
          proposalValidUntil: toDate(row.proposalValidUntil),
        },
        { to: input.to, reason: input.reason },
      );
      if (!result.ok) throw new BusinessRuleException(result.violations);

      const reason = input.reason?.trim() || null;
      await tx
        .update(opportunities)
        .set({
          stage: input.to,
          stageChangedAt: new Date(),
          ...(result.kind === 'LOSS' ? { lossReason: reason } : {}),
        })
        .where(eq(opportunities.id, id));

      await tx.insert(stageChanges).values({
        opportunityId: id,
        fromStage: row.stage,
        toStage: input.to,
        reason,
        changedBy: input.changedBy?.trim() || null,
      });

      await resolveOpenFollowUp(
        tx,
        id,
        result.kind === 'LOSS' ? 'CANCELED' : 'DONE',
        `Etapa alterada para ${STAGE_LABELS[input.to]}.`,
      );
    });

    return this.findOne(id);
  }

  async registerContact(
    id: string,
    input: RegisterContactInput,
  ): Promise<OpportunityDetailView> {
    const today = this.clock.today();
    const contactedOn = input.contactedOn
      ? parseCalendarDate(input.contactedOn)
      : today;

    await this.db.transaction(async (tx) => {
      const row = await this.findRow(tx, id, { lock: true });
      this.assertNoViolations([
        ...checkEditable(row.stage),
        ...checkContactDate(contactedOn, today),
      ]);

      // Um contato antigo registrado depois não pode "voltar no tempo" o último contato.
      const current = toDate(row.lastContactAt);
      if (current === null || contactedOn > current) {
        await tx
          .update(opportunities)
          .set({ lastContactAt: formatCalendarDate(contactedOn) })
          .where(eq(opportunities.id, id));
      }

      await resolveOpenFollowUp(
        tx,
        id,
        'DONE',
        `Contato registrado em ${formatCalendarDate(contactedOn)}.`,
      );
    });

    return this.findOne(id);
  }

  async listSellers(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ sellerName: opportunities.sellerName })
      .from(opportunities)
      .orderBy(asc(opportunities.sellerName));
    return rows.map((row) => row.sellerName);
  }

  private listConditions(query: ListOpportunitiesQuery): SQL[] {
    const conditions: SQL[] = [];

    if (query.stage && query.stage.length > 0)
      conditions.push(inArray(opportunities.stage, query.stage));
    if (query.seller)
      conditions.push(
        ilike(opportunities.sellerName, escapeLike(query.seller)),
      );
    if (query.search) {
      const term = `%${escapeLike(query.search)}%`;
      const matchesItem = exists(
        this.db
          .select({ one: sql`1` })
          .from(opportunityItems)
          .where(
            and(
              eq(opportunityItems.opportunityId, opportunities.id),
              ilike(opportunityItems.productName, term),
            ),
          ),
      );
      const searchCondition = or(
        ilike(opportunities.code, term),
        ilike(opportunities.companyName, term),
        matchesItem,
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    return conditions;
  }

  private matchesAttention(
    view: OpportunityView,
    filter: ListOpportunitiesQuery['attention'],
  ): boolean {
    if (!filter) return true;
    if (filter === 'any') return view.attention.level !== 'ok';
    return view.attention.level === filter;
  }

  private async findRow(
    executor: Executor,
    id: string,
    options: { lock?: boolean } = {},
  ): Promise<OpportunityRow> {
    const query = executor
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, id));
    const [row] = options.lock ? await query.for('update') : await query;
    if (!row) throw new OpportunityNotFoundException(id);
    return row;
  }

  private async loadItems(
    executor: Executor,
    ids: string[],
  ): Promise<Map<string, OpportunityItemRow[]>> {
    const grouped = new Map<string, OpportunityItemRow[]>();
    if (ids.length === 0) return grouped;

    const rows = await executor
      .select()
      .from(opportunityItems)
      .where(inArray(opportunityItems.opportunityId, ids))
      .orderBy(asc(opportunityItems.productName));

    for (const row of rows) {
      grouped.set(row.opportunityId, [
        ...(grouped.get(row.opportunityId) ?? []),
        row,
      ]);
    }
    return grouped;
  }

  private async countItems(executor: Executor, id: string): Promise<number> {
    return executor.$count(
      opportunityItems,
      eq(opportunityItems.opportunityId, id),
    );
  }

  private assertNoViolations(violations: RuleViolation[]): void {
    if (violations.length > 0) throw new BusinessRuleException(violations);
  }
}
