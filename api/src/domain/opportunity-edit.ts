import { daysBetween } from './calendar-date.js';
import type { RuleViolation } from './rule-violation.js';
import { isFinalStage, STAGE_LABELS, type Stage } from './stage.js';

/**
 * Oportunidades em estado final são registro histórico: editar valor ou itens
 * de uma venda fechada distorce o relatório. Correções viram nova oportunidade.
 */
export const checkEditable = (stage: Stage): RuleViolation[] =>
  isFinalStage(stage)
    ? [
        {
          code: 'FINAL_STAGE_READ_ONLY',
          message: `Oportunidades em ${STAGE_LABELS[stage]} não podem ser editadas.`,
        },
      ]
    : [];

/** Contato registrado no futuro mascararia um lead esquecido. */
export const checkContactDate = (
  contactedOn: Date | null,
  today: Date,
): RuleViolation[] =>
  contactedOn !== null && daysBetween(today, contactedOn) > 0
    ? [
        {
          code: 'CONTACT_IN_FUTURE',
          message: 'A data do último contato não pode estar no futuro.',
        },
      ]
    : [];
