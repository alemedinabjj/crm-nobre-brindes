import type {
  OpportunityItemRow,
  OpportunityRow,
  StageChangeRow,
} from '../database/schema.js';
import {
  assessAttention,
  type AttentionAssessment,
} from '../domain/attention.js';
import { parseCalendarDate } from '../domain/calendar-date.js';
import { allowedTargets } from '../domain/stage-transition.js';
import type { Stage } from '../domain/stage.js';

export type OpportunityView = {
  id: string;
  code: string;
  companyName: string;
  sellerName: string;
  estimatedValue: number | null;
  lastContactAt: string | null;
  proposalValidUntil: string | null;
  clientEventDate: string | null;
  stage: Stage;
  lossReason: string | null;
  stageChangedAt: string;
  items: { id: string; productName: string; quantity: number }[];
  attention: AttentionAssessment;
  /** Destinos válidos a partir da etapa atual, para a tela não oferecer movimentos impossíveis. */
  allowedTransitions: readonly Stage[];
};

export type StageChangeView = {
  id: string;
  fromStage: Stage | null;
  toStage: Stage;
  reason: string | null;
  changedBy: string | null;
  changedAt: string;
};

export type OpportunityDetailView = OpportunityView & {
  history: StageChangeView[];
};

const toDate = (value: string | null): Date | null =>
  value === null ? null : parseCalendarDate(value);

export const presentOpportunity = (
  row: OpportunityRow,
  items: OpportunityItemRow[],
  today: Date,
): OpportunityView => ({
  id: row.id,
  code: row.code,
  companyName: row.companyName,
  sellerName: row.sellerName,
  estimatedValue: row.estimatedValue,
  lastContactAt: row.lastContactAt,
  proposalValidUntil: row.proposalValidUntil,
  clientEventDate: row.clientEventDate,
  stage: row.stage,
  lossReason: row.lossReason,
  stageChangedAt: row.stageChangedAt.toISOString(),
  items: items.map(({ id, productName, quantity }) => ({
    id,
    productName,
    quantity,
  })),
  attention: assessAttention(
    {
      stage: row.stage,
      lastContactAt: toDate(row.lastContactAt),
      proposalValidUntil: toDate(row.proposalValidUntil),
      clientEventDate: toDate(row.clientEventDate),
    },
    today,
  ),
  allowedTransitions: allowedTargets(row.stage),
});

export const presentStageChange = (row: StageChangeRow): StageChangeView => ({
  id: row.id,
  fromStage: row.fromStage,
  toStage: row.toStage,
  reason: row.reason,
  changedBy: row.changedBy,
  changedAt: row.changedAt.toISOString(),
});
