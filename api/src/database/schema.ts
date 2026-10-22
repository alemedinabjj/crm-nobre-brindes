import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { STAGES } from '../domain/stage.js';

export const stageEnum = pgEnum('stage', STAGES);

/** Numeração sequencial dos códigos OPP-XXXX, continuando após a carga do case. */
export const opportunityCodeSequence = pgSequence('opportunity_code_seq', {
  startWith: 2008,
});

/**
 * As regras de transição vivem no domínio (src/domain). O banco repete as
 * invariantes mais importantes como CHECK constraints: se algum caminho futuro
 * (script, migração, outro serviço) contornar a API, o dado inválido não entra.
 */
export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 20 }).notNull().unique(),
    companyName: varchar('company_name', { length: 160 }).notNull(),
    sellerName: varchar('seller_name', { length: 80 }).notNull(),
    // Nulo enquanto o lead não foi qualificado (Primeiro Contato).
    estimatedValue: numeric('estimated_value', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    // Datas de calendário (sem hora); nulas quando ainda não existem no processo.
    lastContactAt: date('last_contact_at', { mode: 'string' }),
    proposalValidUntil: date('proposal_valid_until', { mode: 'string' }),
    clientEventDate: date('client_event_date', { mode: 'string' }),
    stage: stageEnum('stage').notNull().default('PRIMEIRO_CONTATO'),
    lossReason: text('loss_reason'),
    stageChangedAt: timestamp('stage_changed_at', {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('opportunities_stage_idx').on(table.stage),
    index('opportunities_seller_idx').on(table.sellerName),
    check(
      'opportunities_estimated_value_positive',
      sql`${table.estimatedValue} IS NULL OR ${table.estimatedValue} > 0`,
    ),
    check(
      'opportunities_lost_requires_reason',
      sql`${table.stage} <> 'PERDIDA' OR length(trim(coalesce(${table.lossReason}, ''))) > 0`,
    ),
    check(
      'opportunities_quote_requires_value',
      sql`${table.stage} IN ('PRIMEIRO_CONTATO', 'PERDIDA') OR ${table.estimatedValue} IS NOT NULL`,
    ),
  ],
);

export const opportunityItems = pgTable(
  'opportunity_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    productName: varchar('product_name', { length: 160 }).notNull(),
    quantity: integer('quantity').notNull(),
  },
  (table) => [
    index('opportunity_items_opportunity_idx').on(table.opportunityId),
    check('opportunity_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
);

/** Histórico append-only: a aplicação só insere, nunca altera ou apaga. */
export const stageChanges = pgTable(
  'stage_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    // Nulo no registro de criação ou de carga inicial.
    fromStage: stageEnum('from_stage'),
    toStage: stageEnum('to_stage').notNull(),
    reason: text('reason'),
    changedBy: varchar('changed_by', { length: 80 }),
    changedAt: timestamp('changed_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('stage_changes_opportunity_idx').on(
      table.opportunityId,
      table.changedAt,
    ),
  ],
);

export const followUpStatusEnum = pgEnum('follow_up_status', [
  'OPEN',
  'DONE',
  'CANCELED',
]);
export const followUpPriorityEnum = pgEnum('follow_up_priority', [
  'HIGH',
  'NORMAL',
]);

/** Cada execução da automação fica registrada: quando, por quê e o que fez. */
export const automationRuns = pgTable('automation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  automation: varchar('automation', { length: 40 }).notNull(),
  trigger: varchar('trigger', { length: 20 }).notNull(),
  referenceDate: date('reference_date', { mode: 'string' }).notNull(),
  createdCount: integer('created_count').notNull(),
  canceledCount: integer('canceled_count').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, precision: 3 }),
});

export const followUpTasks = pgTable(
  'follow_up_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    sellerName: varchar('seller_name', { length: 80 }).notNull(),
    reasonCode: varchar('reason_code', { length: 40 }).notNull(),
    priority: followUpPriorityEnum('priority').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    details: text('details').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    status: followUpStatusEnum('status').notNull().default('OPEN'),
    resolution: text('resolution'),
    createdByRunId: uuid('created_by_run_id').references(
      () => automationRuns.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, precision: 3 }),
  },
  (table) => [
    // Garante no banco a idempotência: no máximo uma tarefa aberta por negociação.
    uniqueIndex('follow_up_tasks_one_open_per_opportunity')
      .on(table.opportunityId)
      .where(sql`${table.status} = 'OPEN'`),
    index('follow_up_tasks_seller_status_idx').on(
      table.sellerName,
      table.status,
      table.dueDate,
    ),
    check(
      'follow_up_tasks_resolved_consistency',
      sql`(${table.status} = 'OPEN') = (${table.resolvedAt} IS NULL)`,
    ),
  ],
);

export type OpportunityRow = typeof opportunities.$inferSelect;
export type OpportunityItemRow = typeof opportunityItems.$inferSelect;
export type StageChangeRow = typeof stageChanges.$inferSelect;
export type FollowUpTaskRow = typeof followUpTasks.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;
