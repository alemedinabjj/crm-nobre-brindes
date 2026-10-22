import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { STAGES } from '../domain/stage.js';

export const stageEnum = pgEnum('stage', STAGES);

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
    estimatedValue: numeric('estimated_value', { precision: 12, scale: 2, mode: 'number' }),
    // Datas de calendário (sem hora); nulas quando ainda não existem no processo.
    lastContactAt: date('last_contact_at', { mode: 'string' }),
    proposalValidUntil: date('proposal_valid_until', { mode: 'string' }),
    clientEventDate: date('client_event_date', { mode: 'string' }),
    stage: stageEnum('stage').notNull().default('PRIMEIRO_CONTATO'),
    lossReason: text('loss_reason'),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('opportunities_stage_idx').on(table.stage),
    index('opportunities_seller_idx').on(table.sellerName),
    check('opportunities_estimated_value_positive', sql`${table.estimatedValue} IS NULL OR ${table.estimatedValue} > 0`),
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
    changedAt: timestamp('changed_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [index('stage_changes_opportunity_idx').on(table.opportunityId, table.changedAt)],
);

export type OpportunityRow = typeof opportunities.$inferSelect;
export type OpportunityItemRow = typeof opportunityItems.$inferSelect;
export type StageChangeRow = typeof stageChanges.$inferSelect;
