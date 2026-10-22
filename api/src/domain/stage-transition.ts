import type { RuleViolation } from './rule-violation.js';
import {
  funnelPosition,
  isFinalStage,
  STAGE_LABELS,
  type Stage,
} from './stage.js';

export type { RuleViolation, ViolationCode } from './rule-violation.js';

/**
 * Mapa de transições permitidas. É a única fonte de verdade sobre "de onde
 * para onde" uma oportunidade pode ir. Decisões (detalhadas no README):
 *
 * - Avanço só para a etapa seguinte: pular etapas esconde trabalho comercial
 *   não feito (ex.: fechar sem ter passado por Forecast).
 * - Retornos permitidos apenas para revisar a proposta ou reavaliar a previsão:
 *   Follow-up → Orçamento, Forecast → Orçamento e Forecast → Follow-up.
 * - Nunca volta para Primeiro Contato: depois que houve proposta, o contato já
 *   aconteceu; reiniciar o funil apagaria a história da negociação.
 * - Estados finais não têm saída. Reabrir uma venda perdida é uma nova
 *   oportunidade, para não distorcer métricas de conversão.
 */
export const ALLOWED_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  PRIMEIRO_CONTATO: ['APRESENTACAO_ORCAMENTO', 'PERDIDA'],
  APRESENTACAO_ORCAMENTO: ['FOLLOW_UP', 'PERDIDA'],
  FOLLOW_UP: ['FORECAST', 'APRESENTACAO_ORCAMENTO', 'PERDIDA'],
  FORECAST: ['FECHAMENTO', 'FOLLOW_UP', 'APRESENTACAO_ORCAMENTO', 'PERDIDA'],
  FECHAMENTO: [],
  PERDIDA: [],
};

export type TransitionSubject = {
  stage: Stage;
  estimatedValue: number | null;
  itemCount: number;
  proposalValidUntil: Date | null;
};

export type TransitionRequest = {
  to: Stage;
  /** Motivo: obrigatório para Perdida e para retornos de etapa. */
  reason?: string | null;
};

export type TransitionKind = 'FORWARD' | 'BACKWARD' | 'LOSS';

export type TransitionResult =
  | { ok: true; kind: TransitionKind }
  | { ok: false; violations: RuleViolation[] };

export const allowedTargets = (from: Stage): readonly Stage[] =>
  ALLOWED_TRANSITIONS[from];

const hasText = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const classify = (from: Stage, to: Stage): TransitionKind => {
  if (to === 'PERDIDA') return 'LOSS';
  return funnelPosition(to) > funnelPosition(from) ? 'FORWARD' : 'BACKWARD';
};

/**
 * Invariantes de dados por etapa, cumulativas: estar em Follow-up exige tudo o
 * que Orçamento exige e mais a validade da proposta. Aplicadas na entrada da
 * etapa (qualquer direção) e na edição de uma oportunidade já na etapa.
 */
export const checkStageInvariants = (
  stage: Stage,
  data: Omit<TransitionSubject, 'stage'>,
): RuleViolation[] => {
  if (stage === 'PERDIDA') return [];

  const position = funnelPosition(stage);
  const violations: RuleViolation[] = [];

  if (position >= funnelPosition('APRESENTACAO_ORCAMENTO')) {
    if (data.estimatedValue === null || data.estimatedValue <= 0) {
      violations.push({
        code: 'MISSING_ESTIMATED_VALUE',
        message: 'Informe um valor estimado maior que zero.',
      });
    }
    if (data.itemCount < 1) {
      violations.push({
        code: 'MISSING_ITEMS',
        message: 'Informe pelo menos um item de brinde.',
      });
    }
  }

  if (
    position >= funnelPosition('FOLLOW_UP') &&
    data.proposalValidUntil === null
  ) {
    violations.push({
      code: 'MISSING_PROPOSAL_VALIDITY',
      message: 'Informe a validade da proposta enviada ao cliente.',
    });
  }

  return violations;
};

export const evaluateTransition = (
  subject: TransitionSubject,
  request: TransitionRequest,
): TransitionResult => {
  const { stage: from } = subject;
  const { to, reason } = request;

  if (from === to) {
    return {
      ok: false,
      violations: [
        {
          code: 'SAME_STAGE',
          message: `A oportunidade já está em ${STAGE_LABELS[to]}.`,
        },
      ],
    };
  }

  if (isFinalStage(from)) {
    return {
      ok: false,
      violations: [
        {
          code: 'FROM_FINAL_STAGE',
          message: `${STAGE_LABELS[from]} é um estado final. Para retomar a negociação, crie uma nova oportunidade.`,
        },
      ],
    };
  }

  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    const options = ALLOWED_TRANSITIONS[from]
      .map((stage) => STAGE_LABELS[stage])
      .join(', ');
    return {
      ok: false,
      violations: [
        {
          code: 'TRANSITION_NOT_ALLOWED',
          message: `Não é possível ir de ${STAGE_LABELS[from]} para ${STAGE_LABELS[to]}. Destinos possíveis: ${options}.`,
        },
      ],
    };
  }

  const kind = classify(from, to);
  const violations = checkStageInvariants(to, subject);

  if (kind === 'LOSS' && !hasText(reason)) {
    violations.push({
      code: 'MISSING_LOSS_REASON',
      message: 'Informe o motivo da perda.',
    });
  }
  if (kind === 'BACKWARD' && !hasText(reason)) {
    violations.push({
      code: 'MISSING_BACKWARD_REASON',
      message: 'Explique por que a oportunidade está voltando de etapa.',
    });
  }

  return violations.length > 0 ? { ok: false, violations } : { ok: true, kind };
};
