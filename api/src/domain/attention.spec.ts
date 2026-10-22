import { describe, expect, it } from 'vitest';
import { assessAttention, type AttentionInput } from './attention.js';
import { parseCalendarDate, todayIn } from './calendar-date.js';
import type { Stage } from './stage.js';

const REFERENCE_DATE = parseCalendarDate('2026-10-15');
const date = (iso: string | null) => (iso === null ? null : parseCalendarDate(iso));

const input = (
  stage: Stage,
  lastContact: string | null,
  validUntil: string | null,
  event: string | null,
): AttentionInput => ({
  stage,
  lastContactAt: date(lastContact),
  proposalValidUntil: date(validUntil),
  clientEventDate: date(event),
});

const codes = (subject: AttentionInput) =>
  assessAttention(subject, REFERENCE_DATE).signals.map((signal) => signal.code);

describe('assessAttention', () => {
  describe('dados do case em 15/10/2026', () => {
    it.each([
      ['OPP-2001', input('PRIMEIRO_CONTATO', '2026-10-14', null, '2026-11-30'), 'ok'],
      ['OPP-2002', input('APRESENTACAO_ORCAMENTO', '2026-10-06', '2026-10-13', '2026-10-25'), 'critical'],
      ['OPP-2003', input('FOLLOW_UP', '2026-10-13', '2026-10-20', '2026-10-18'), 'critical'],
      ['OPP-2004', input('FOLLOW_UP', '2026-10-02', '2026-10-10', '2026-11-05'), 'critical'],
      ['OPP-2005', input('FORECAST', '2026-10-15', '2026-10-22', '2026-12-12'), 'ok'],
      ['OPP-2006', input('FECHAMENTO', '2026-10-09', '2026-10-16', '2026-10-17'), 'ok'],
      ['OPP-2007', input('PERDIDA', '2026-10-01', '2026-10-08', '2026-10-20'), 'ok'],
    ] as const)('%s → %s', (_code, subject, expectedLevel) => {
      expect(assessAttention(subject, REFERENCE_DATE).level).toBe(expectedLevel);
    });

    it('OPP-2002 acumula proposta vencida, contato parado e evento próximo', () => {
      expect(codes(input('APRESENTACAO_ORCAMENTO', '2026-10-06', '2026-10-13', '2026-10-25'))).toEqual([
        'CONTACT_OVERDUE',
        'PROPOSAL_EXPIRED',
        'EVENT_APPROACHING',
      ]);
    });

    it('OPP-2003 é crítica só pelo evento em 3 dias, mesmo com contato em dia', () => {
      expect(codes(input('FOLLOW_UP', '2026-10-13', '2026-10-20', '2026-10-18'))).toEqual(['EVENT_IMMINENT']);
    });

    it('ordena 2002 antes de 2004 antes de 2003 pelo score', () => {
      const score = (subject: AttentionInput) => assessAttention(subject, REFERENCE_DATE).score;
      const opp2002 = score(input('APRESENTACAO_ORCAMENTO', '2026-10-06', '2026-10-13', '2026-10-25'));
      const opp2003 = score(input('FOLLOW_UP', '2026-10-13', '2026-10-20', '2026-10-18'));
      const opp2004 = score(input('FOLLOW_UP', '2026-10-02', '2026-10-10', '2026-11-05'));
      expect(opp2002).toBeGreaterThan(opp2004);
      expect(opp2004).toBeGreaterThan(opp2003);
    });
  });

  describe('contato', () => {
    it('lead sem nenhum contato registrado é crítico', () => {
      expect(assessAttention(input('PRIMEIRO_CONTATO', null, null, null), REFERENCE_DATE).signals[0]).toMatchObject({
        code: 'NO_CONTACT_RECORDED',
        severity: 'critical',
      });
    });

    it('acima do SLA é alerta; acima do dobro é crítico', () => {
      const followUp = (lastContact: string) =>
        assessAttention(input('FOLLOW_UP', lastContact, null, null), REFERENCE_DATE).signals[0]?.severity;
      expect(followUp('2026-10-12')).toBeUndefined(); // 3 dias = no limite
      expect(followUp('2026-10-11')).toBe('warning'); // 4 dias
      expect(followUp('2026-10-09')).toBe('warning'); // 6 dias = dobro, ainda alerta
      expect(followUp('2026-10-08')).toBe('critical'); // 7 dias
    });
  });

  describe('proposta', () => {
    it('vence hoje é alerta, não crítico', () => {
      expect(assessAttention(input('FORECAST', '2026-10-15', '2026-10-15', null), REFERENCE_DATE).signals).toEqual([
        { code: 'PROPOSAL_EXPIRING', severity: 'warning', message: 'Proposta vence hoje.' },
      ]);
    });

    it('ignora validade em Primeiro Contato (ainda não há proposta)', () => {
      expect(codes(input('PRIMEIRO_CONTATO', '2026-10-15', '2026-10-01', null))).toEqual([]);
    });
  });

  describe('evento', () => {
    it('evento que já passou é crítico', () => {
      expect(codes(input('FORECAST', '2026-10-15', null, '2026-10-14'))).toEqual(['EVENT_PASSED']);
    });

    it('evento sem data não gera alerta', () => {
      expect(codes(input('FORECAST', '2026-10-15', null, null))).toEqual([]);
    });
  });
});

describe('todayIn', () => {
  it('usa o fuso da operação, não o UTC', () => {
    // 21/10 01:00 UTC ainda é 20/10 em São Paulo
    const now = new Date('2026-10-21T01:00:00Z');
    expect(todayIn('America/Sao_Paulo', now)).toEqual(parseCalendarDate('2026-10-20'));
  });
});
