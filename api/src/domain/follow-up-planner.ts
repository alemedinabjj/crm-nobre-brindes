import type {
  AttentionAssessment,
  AttentionCode,
  AttentionSignal,
} from './attention.js';
import { addBusinessDays } from './calendar-date.js';
import { isFinalStage, type Stage } from './stage.js';

/**
 * Automação do problema 4: "com alto volume, é fácil esquecer de dar retorno".
 *
 * Todo dia o job olha o funil e transforma cada negociação em risco em uma
 * tarefa de retorno para o vendedor responsável, com prazo e o que fazer.
 * O planejamento é uma função pura (sem banco, sem relógio) para ser testado
 * em todos os cenários; quem grava e agenda é o serviço.
 */

export type FollowUpPriority = 'HIGH' | 'NORMAL';

export type FollowUpCandidate = {
  opportunityId: string;
  companyName: string;
  sellerName: string;
  stage: Stage;
  attention: AttentionAssessment;
};

export type OpenFollowUp = { taskId: string; opportunityId: string };

export type PlannedFollowUp = {
  opportunityId: string;
  sellerName: string;
  reasonCode: AttentionCode;
  priority: FollowUpPriority;
  title: string;
  details: string;
  dueDate: Date;
};

export type FollowUpCancellation = { taskId: string; resolution: string };

export type FollowUpPlan = {
  toCreate: PlannedFollowUp[];
  toCancel: FollowUpCancellation[];
};

const ACTION_BY_SIGNAL: Record<AttentionCode, (company: string) => string> = {
  NO_CONTACT_RECORDED: (company) => `Fazer o primeiro contato com ${company}`,
  CONTACT_OVERDUE: (company) => `Retomar o contato com ${company}`,
  PROPOSAL_EXPIRED: (company) => `Renovar a proposta vencida de ${company}`,
  PROPOSAL_EXPIRING: (company) =>
    `Confirmar a proposta de ${company} antes do vencimento`,
  EVENT_PASSED: (company) =>
    `Confirmar se a venda de ${company} ainda existe (o evento já passou)`,
  EVENT_IMMINENT: (company) =>
    `Garantir o prazo de produção para o evento de ${company}`,
  EVENT_APPROACHING: (company) =>
    `Avançar a negociação de ${company} antes do evento`,
};

/** O sinal mais grave define a ação; o primeiro da lista desempata. */
const leadingSignal = (
  signals: AttentionSignal[],
): AttentionSignal | undefined =>
  signals.find((signal) => signal.severity === 'critical') ?? signals[0];

/**
 * Prazo do retorno: urgente é para hoje; alerta vai para o próximo dia útil,
 * para não lotar o dia do vendedor com o que ainda pode esperar.
 */
const dueDateFor = (priority: FollowUpPriority, today: Date): Date =>
  priority === 'HIGH' ? today : addBusinessDays(today, 1);

export const planFollowUps = (
  candidates: FollowUpCandidate[],
  openTasks: OpenFollowUp[],
  today: Date,
): FollowUpPlan => {
  const byOpportunity = new Map(
    candidates.map((candidate) => [candidate.opportunityId, candidate]),
  );
  const withOpenTask = new Set(openTasks.map((task) => task.opportunityId));

  const toCreate: PlannedFollowUp[] = [];
  for (const candidate of candidates) {
    if (isFinalStage(candidate.stage)) continue;
    if (withOpenTask.has(candidate.opportunityId)) continue;

    const signal = leadingSignal(candidate.attention.signals);
    if (!signal) continue;

    const priority: FollowUpPriority =
      candidate.attention.level === 'critical' ? 'HIGH' : 'NORMAL';
    toCreate.push({
      opportunityId: candidate.opportunityId,
      sellerName: candidate.sellerName,
      reasonCode: signal.code,
      priority,
      title: ACTION_BY_SIGNAL[signal.code](candidate.companyName),
      details: candidate.attention.signals
        .map((item) => item.message)
        .join(' '),
      dueDate: dueDateFor(priority, today),
    });
  }

  // Tarefa aberta de negociação encerrada (ou removida) não tem mais o que cobrar.
  const toCancel: FollowUpCancellation[] = openTasks
    .filter((task) => {
      const candidate = byOpportunity.get(task.opportunityId);
      return candidate === undefined || isFinalStage(candidate.stage);
    })
    .map((task) => ({
      taskId: task.taskId,
      resolution: 'Cancelada pela automação: a negociação foi encerrada.',
    }));

  return { toCreate, toCancel };
};
