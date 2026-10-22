import { daysBetween } from './calendar-date.js';
import { isFinalStage, type Stage } from './stage.js';

/**
 * "Precisa de atenção" responde à pergunta do vendedor: em qual negociação eu
 * mexo hoje? Três sinais independentes, cada um com severidade:
 *
 * 1. Contato parado: dias sem contato acima do SLA da etapa.
 * 2. Proposta: vencida (crítico) ou vencendo em breve (alerta).
 * 3. Evento do cliente: brinde personalizado tem prazo de produção; evento
 *    próximo sem fechamento é risco de perder a venda por prazo.
 */

export type Severity = 'critical' | 'warning';
export type AttentionLevel = Severity | 'ok';

export type AttentionCode =
  | 'NO_CONTACT_RECORDED'
  | 'CONTACT_OVERDUE'
  | 'PROPOSAL_EXPIRED'
  | 'PROPOSAL_EXPIRING'
  | 'EVENT_PASSED'
  | 'EVENT_IMMINENT'
  | 'EVENT_APPROACHING';

export type AttentionSignal = { code: AttentionCode; severity: Severity; message: string };

export type AttentionAssessment = {
  level: AttentionLevel;
  /** Maior = mais urgente. Usado para ordenar cards dentro da coluna. */
  score: number;
  signals: AttentionSignal[];
};

export type AttentionInput = {
  stage: Stage;
  lastContactAt: Date | null;
  proposalValidUntil: Date | null;
  clientEventDate: Date | null;
};

type OpenStage = Exclude<Stage, 'FECHAMENTO' | 'PERDIDA'>;

const isOpenStage = (stage: Stage): stage is OpenStage => !isFinalStage(stage);

export type AttentionPolicy = {
  /** Máximo de dias sem contato antes de alertar; o dobro vira crítico. */
  contactSlaDays: Record<OpenStage, number>;
  proposalExpiringWithinDays: number;
  /** Prazo mínimo típico de produção de brinde personalizado. */
  eventCriticalWithinDays: number;
  eventWarningWithinDays: number;
};

export const DEFAULT_ATTENTION_POLICY: AttentionPolicy = {
  contactSlaDays: {
    PRIMEIRO_CONTATO: 1,
    APRESENTACAO_ORCAMENTO: 3,
    FOLLOW_UP: 3,
    FORECAST: 2,
  },
  proposalExpiringWithinDays: 3,
  eventCriticalWithinDays: 7,
  eventWarningWithinDays: 14,
};

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 10, warning: 3 };

const PROPOSAL_STAGES: readonly Stage[] = ['APRESENTACAO_ORCAMENTO', 'FOLLOW_UP', 'FORECAST'];

const plural = (count: number, singular: string, pluralForm: string): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;

const contactSignal = (
  stage: OpenStage,
  lastContactAt: Date | null,
  today: Date,
  policy: AttentionPolicy,
): AttentionSignal | null => {
  if (lastContactAt === null) {
    return {
      code: 'NO_CONTACT_RECORDED',
      severity: 'critical',
      message: 'Nenhum contato registrado com o cliente.',
    };
  }

  const sla = policy.contactSlaDays[stage];
  const idleDays = daysBetween(lastContactAt, today);
  if (idleDays <= sla) return null;

  return {
    code: 'CONTACT_OVERDUE',
    severity: idleDays > sla * 2 ? 'critical' : 'warning',
    message: `Sem contato há ${plural(idleDays, 'dia', 'dias')} (limite da etapa: ${plural(sla, 'dia', 'dias')}).`,
  };
};

const proposalSignal = (
  stage: Stage,
  validUntil: Date | null,
  today: Date,
  policy: AttentionPolicy,
): AttentionSignal | null => {
  if (validUntil === null || !PROPOSAL_STAGES.includes(stage)) return null;

  const daysLeft = daysBetween(today, validUntil);
  if (daysLeft < 0) {
    return {
      code: 'PROPOSAL_EXPIRED',
      severity: 'critical',
      message: `Proposta vencida há ${plural(-daysLeft, 'dia', 'dias')}.`,
    };
  }
  if (daysLeft <= policy.proposalExpiringWithinDays) {
    return {
      code: 'PROPOSAL_EXPIRING',
      severity: 'warning',
      message: daysLeft === 0 ? 'Proposta vence hoje.' : `Proposta vence em ${plural(daysLeft, 'dia', 'dias')}.`,
    };
  }
  return null;
};

const eventSignal = (eventDate: Date | null, today: Date, policy: AttentionPolicy): AttentionSignal | null => {
  if (eventDate === null) return null;

  const daysLeft = daysBetween(today, eventDate);
  if (daysLeft < 0) {
    return {
      code: 'EVENT_PASSED',
      severity: 'critical',
      message: 'O evento do cliente já passou. Confirme se ainda há venda ou marque como perdida.',
    };
  }
  if (daysLeft <= policy.eventCriticalWithinDays) {
    return {
      code: 'EVENT_IMMINENT',
      severity: 'critical',
      message: `Evento do cliente em ${plural(daysLeft, 'dia', 'dias')}: prazo de produção em risco.`,
    };
  }
  if (daysLeft <= policy.eventWarningWithinDays) {
    return {
      code: 'EVENT_APPROACHING',
      severity: 'warning',
      message: `Evento do cliente em ${plural(daysLeft, 'dia', 'dias')}.`,
    };
  }
  return null;
};

export const assessAttention = (
  input: AttentionInput,
  today: Date,
  policy: AttentionPolicy = DEFAULT_ATTENTION_POLICY,
): AttentionAssessment => {
  const { stage } = input;
  if (!isOpenStage(stage)) return { level: 'ok', score: 0, signals: [] };

  const signals = [
    contactSignal(stage, input.lastContactAt, today, policy),
    proposalSignal(stage, input.proposalValidUntil, today, policy),
    eventSignal(input.clientEventDate, today, policy),
  ].filter((signal): signal is AttentionSignal => signal !== null);

  const score = signals.reduce((total, signal) => total + SEVERITY_WEIGHT[signal.severity], 0);
  const level: AttentionLevel = signals.some((signal) => signal.severity === 'critical')
    ? 'critical'
    : signals.length > 0
      ? 'warning'
      : 'ok';

  return { level, score, signals };
};
