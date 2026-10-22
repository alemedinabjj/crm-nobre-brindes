import { describe, expect, it } from 'vitest';
import { assessAttention, type AttentionInput } from './attention.js';
import {
  addBusinessDays,
  formatCalendarDate,
  parseCalendarDate,
} from './calendar-date.js';
import { planFollowUps, type FollowUpCandidate } from './follow-up-planner.js';
import type { Stage } from './stage.js';

const TODAY = parseCalendarDate('2026-10-15'); // quinta-feira
const date = (iso: string | null) =>
  iso === null ? null : parseCalendarDate(iso);

const candidate = (
  id: string,
  stage: Stage,
  lastContact: string | null,
  validUntil: string | null,
  event: string | null,
  overrides: Partial<FollowUpCandidate> = {},
): FollowUpCandidate => {
  const input: AttentionInput = {
    stage,
    lastContactAt: date(lastContact),
    proposalValidUntil: date(validUntil),
    clientEventDate: date(event),
  };
  return {
    opportunityId: id,
    companyName: `Empresa ${id}`,
    sellerName: 'Ana',
    stage,
    attention: assessAttention(input, TODAY),
    ...overrides,
  };
};

/** As 7 oportunidades do case em 15/10/2026. */
const CASE_DATA = [
  candidate('2001', 'PRIMEIRO_CONTATO', '2026-10-14', null, '2026-11-30'),
  candidate(
    '2002',
    'APRESENTACAO_ORCAMENTO',
    '2026-10-06',
    '2026-10-13',
    '2026-10-25',
    { sellerName: 'Bruno' },
  ),
  candidate('2003', 'FOLLOW_UP', '2026-10-13', '2026-10-20', '2026-10-18'),
  candidate('2004', 'FOLLOW_UP', '2026-10-02', '2026-10-10', '2026-11-05', {
    sellerName: 'Carla',
  }),
  candidate('2005', 'FORECAST', '2026-10-15', '2026-10-22', '2026-12-12', {
    sellerName: 'Bruno',
  }),
  candidate('2006', 'FECHAMENTO', '2026-10-09', '2026-10-16', '2026-10-17', {
    sellerName: 'Carla',
  }),
  candidate('2007', 'PERDIDA', '2026-10-01', '2026-10-08', '2026-10-20'),
];

describe('planFollowUps', () => {
  it('cria um retorno para cada negociação em risco do case, com o vendedor dono', () => {
    const plan = planFollowUps(CASE_DATA, [], TODAY);
    expect(
      plan.toCreate.map((task) => [task.opportunityId, task.sellerName]),
    ).toEqual([
      ['2002', 'Bruno'],
      ['2003', 'Ana'],
      ['2004', 'Carla'],
    ]);
    expect(plan.toCancel).toEqual([]);
  });

  it('escreve a tarefa como ação, guiada pelo sinal mais grave', () => {
    const plan = planFollowUps(CASE_DATA, [], TODAY);
    const titles = Object.fromEntries(
      plan.toCreate.map((task) => [task.opportunityId, task.title]),
    );
    expect(titles['2002']).toBe('Retomar o contato com Empresa 2002');
    expect(titles['2003']).toBe(
      'Garantir o prazo de produção para o evento de Empresa 2003',
    );
    expect(titles['2004']).toBe('Retomar o contato com Empresa 2004');
  });

  it('junta todos os motivos no detalhe da tarefa', () => {
    const [task] = planFollowUps([CASE_DATA[1]!], [], TODAY).toCreate;
    expect(task?.details).toContain('Sem contato há 9 dias');
    expect(task?.details).toContain('Proposta vencida há 2 dias');
    expect(task?.details).toContain('Evento do cliente em 10 dias');
  });

  it('é idempotente: não duplica retorno de negociação que já tem tarefa aberta', () => {
    const open = [{ taskId: 't1', opportunityId: '2002' }];
    const plan = planFollowUps(CASE_DATA, open, TODAY);
    expect(plan.toCreate.map((task) => task.opportunityId)).toEqual([
      '2003',
      '2004',
    ]);
  });

  it('rodar de novo sobre o próprio resultado não cria nada', () => {
    const first = planFollowUps(CASE_DATA, [], TODAY);
    const open = first.toCreate.map((task, index) => ({
      taskId: `t${index}`,
      opportunityId: task.opportunityId,
    }));
    expect(planFollowUps(CASE_DATA, open, TODAY)).toEqual({
      toCreate: [],
      toCancel: [],
    });
  });

  it('urgente vence hoje; alerta vence no próximo dia útil', () => {
    const warning = candidate(
      'w',
      'FORECAST',
      '2026-10-15',
      '2026-10-17',
      null,
    );
    expect(warning.attention.level).toBe('warning');
    const plan = planFollowUps([CASE_DATA[2]!, warning], [], TODAY);
    expect(
      plan.toCreate.map((task) => [
        task.priority,
        formatCalendarDate(task.dueDate),
      ]),
    ).toEqual([
      ['HIGH', '2026-10-15'],
      ['NORMAL', '2026-10-16'],
    ]);
  });

  it('alerta numa sexta vence na segunda', () => {
    const friday = parseCalendarDate('2026-10-16');
    const warning = candidate(
      'w',
      'FORECAST',
      '2026-10-16',
      '2026-10-18',
      null,
    );
    const [task] = planFollowUps(
      [
        {
          ...warning,
          attention: assessAttention(
            {
              stage: 'FORECAST',
              lastContactAt: friday,
              proposalValidUntil: date('2026-10-18'),
              clientEventDate: null,
            },
            friday,
          ),
        },
      ],
      [],
      friday,
    ).toCreate;
    expect(formatCalendarDate(task!.dueDate)).toBe('2026-10-19');
  });

  it('nunca cria retorno para negociação encerrada, mesmo com sinais antigos', () => {
    const closed = candidate('x', 'FECHAMENTO', null, null, '2026-10-01');
    expect(planFollowUps([closed], [], TODAY).toCreate).toEqual([]);
  });

  it('cancela tarefa aberta de negociação que foi encerrada ou removida', () => {
    const open = [
      { taskId: 'closed', opportunityId: '2006' },
      { taskId: 'gone', opportunityId: 'nao-existe' },
      { taskId: 'alive', opportunityId: '2003' },
    ];
    const plan = planFollowUps(CASE_DATA, open, TODAY);
    expect(plan.toCancel.map((item) => item.taskId)).toEqual([
      'closed',
      'gone',
    ]);
  });

  it('mantém a tarefa aberta mesmo se o alerta sumiu: só o vendedor ou o contato encerra', () => {
    const open = [{ taskId: 't', opportunityId: '2005' }];
    expect(planFollowUps(CASE_DATA, open, TODAY).toCancel).toEqual([]);
  });
});

describe('addBusinessDays', () => {
  it.each([
    ['2026-10-15', 1, '2026-10-16'], // qui → sex
    ['2026-10-16', 1, '2026-10-19'], // sex → seg
    ['2026-10-17', 1, '2026-10-19'], // sáb → seg
    ['2026-10-15', 3, '2026-10-20'], // qui → ter
  ])('%s + %i dia(s) útil(eis) = %s', (from, days, expected) => {
    expect(
      formatCalendarDate(addBusinessDays(parseCalendarDate(from), days)),
    ).toBe(expected);
  });
});
