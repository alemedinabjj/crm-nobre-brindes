import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from './calendar-date.js';
import { allowedTargets, evaluateTransition, type TransitionSubject } from './stage-transition.js';
import { STAGES, type Stage } from './stage.js';

const complete = (stage: Stage): TransitionSubject => ({
  stage,
  estimatedValue: 4500,
  itemCount: 1,
  proposalValidUntil: parseCalendarDate('2026-11-30'),
});

const codesOf = (result: ReturnType<typeof evaluateTransition>) =>
  result.ok ? [] : result.violations.map((violation) => violation.code);

describe('evaluateTransition', () => {
  describe('regras dadas pelo case', () => {
    it('só avança para Orçamento com valor estimado e ao menos um item', () => {
      const subject = { ...complete('PRIMEIRO_CONTATO'), estimatedValue: null, itemCount: 0 };
      const result = evaluateTransition(subject, { to: 'APRESENTACAO_ORCAMENTO' });
      expect(codesOf(result)).toEqual(['MISSING_ESTIMATED_VALUE', 'MISSING_ITEMS']);
    });

    it('trata valor estimado zero como ausente', () => {
      const subject = { ...complete('PRIMEIRO_CONTATO'), estimatedValue: 0 };
      const result = evaluateTransition(subject, { to: 'APRESENTACAO_ORCAMENTO' });
      expect(codesOf(result)).toEqual(['MISSING_ESTIMATED_VALUE']);
    });

    it('avança para Orçamento quando os dados estão completos', () => {
      const result = evaluateTransition(complete('PRIMEIRO_CONTATO'), { to: 'APRESENTACAO_ORCAMENTO' });
      expect(result).toEqual({ ok: true, kind: 'FORWARD' });
    });

    it.each<Stage>(['PRIMEIRO_CONTATO', 'APRESENTACAO_ORCAMENTO', 'FOLLOW_UP'])(
      'não entra em Fechamento a partir de %s',
      (from) => {
        const result = evaluateTransition(complete(from), { to: 'FECHAMENTO' });
        expect(codesOf(result)).toEqual(['TRANSITION_NOT_ALLOWED']);
      },
    );

    it('entra em Fechamento a partir de Forecast', () => {
      expect(evaluateTransition(complete('FORECAST'), { to: 'FECHAMENTO' })).toEqual({ ok: true, kind: 'FORWARD' });
    });

    it.each<Stage>(['PRIMEIRO_CONTATO', 'APRESENTACAO_ORCAMENTO', 'FOLLOW_UP', 'FORECAST'])(
      'marca como Perdida a partir de %s com motivo',
      (from) => {
        const result = evaluateTransition(complete(from), { to: 'PERDIDA', reason: 'Cliente fechou com concorrente' });
        expect(result).toEqual({ ok: true, kind: 'LOSS' });
      },
    );

    it.each([undefined, null, '', '   '])('exige motivo de perda (motivo: %j)', (reason) => {
      const result = evaluateTransition(complete('FOLLOW_UP'), { to: 'PERDIDA', reason });
      expect(codesOf(result)).toEqual(['MISSING_LOSS_REASON']);
    });

    it('perder uma oportunidade não exige dados de proposta', () => {
      const subject: TransitionSubject = {
        stage: 'PRIMEIRO_CONTATO',
        estimatedValue: null,
        itemCount: 0,
        proposalValidUntil: null,
      };
      const result = evaluateTransition(subject, { to: 'PERDIDA', reason: 'Lead sem perfil' });
      expect(result.ok).toBe(true);
    });

    it.each<[Stage, Stage]>([
      ['FECHAMENTO', 'PERDIDA'],
      ['FECHAMENTO', 'FORECAST'],
      ['PERDIDA', 'PRIMEIRO_CONTATO'],
      ['PERDIDA', 'FOLLOW_UP'],
    ])('não sai do estado final %s para %s', (from, to) => {
      const result = evaluateTransition(complete(from), { to, reason: 'qualquer' });
      expect(codesOf(result)).toEqual(['FROM_FINAL_STAGE']);
    });
  });

  describe('decisões próprias', () => {
    it('não pula etapas ao avançar', () => {
      const result = evaluateTransition(complete('PRIMEIRO_CONTATO'), { to: 'FOLLOW_UP' });
      expect(codesOf(result)).toEqual(['TRANSITION_NOT_ALLOWED']);
    });

    it('exige validade da proposta para entrar em Follow-up', () => {
      const subject = { ...complete('APRESENTACAO_ORCAMENTO'), proposalValidUntil: null };
      const result = evaluateTransition(subject, { to: 'FOLLOW_UP' });
      expect(codesOf(result)).toEqual(['MISSING_PROPOSAL_VALIDITY']);
    });

    it.each<[Stage, Stage]>([
      ['FOLLOW_UP', 'APRESENTACAO_ORCAMENTO'],
      ['FORECAST', 'APRESENTACAO_ORCAMENTO'],
      ['FORECAST', 'FOLLOW_UP'],
    ])('permite retorno de %s para %s com justificativa', (from, to) => {
      const result = evaluateTransition(complete(from), { to, reason: 'Cliente pediu revisão de quantidade' });
      expect(result).toEqual({ ok: true, kind: 'BACKWARD' });
    });

    it('exige justificativa em retornos de etapa', () => {
      const result = evaluateTransition(complete('FOLLOW_UP'), { to: 'APRESENTACAO_ORCAMENTO' });
      expect(codesOf(result)).toEqual(['MISSING_BACKWARD_REASON']);
    });

    it.each<Stage>(['APRESENTACAO_ORCAMENTO', 'FOLLOW_UP', 'FORECAST'])(
      'nunca volta de %s para Primeiro Contato',
      (from) => {
        const result = evaluateTransition(complete(from), { to: 'PRIMEIRO_CONTATO', reason: 'recomeçar' });
        expect(codesOf(result)).toEqual(['TRANSITION_NOT_ALLOWED']);
      },
    );

    it('rejeita mover para a mesma etapa', () => {
      expect(codesOf(evaluateTransition(complete('FORECAST'), { to: 'FORECAST' }))).toEqual(['SAME_STAGE']);
    });

    it('retornar para Orçamento revalida os dados da proposta', () => {
      const subject = { ...complete('FOLLOW_UP'), itemCount: 0 };
      const result = evaluateTransition(subject, { to: 'APRESENTACAO_ORCAMENTO', reason: 'revisão' });
      expect(codesOf(result)).toEqual(['MISSING_ITEMS']);
    });
  });

  it('allowedTargets é coerente com evaluateTransition para todas as combinações', () => {
    for (const from of STAGES) {
      for (const to of STAGES) {
        const result = evaluateTransition(complete(from), { to, reason: 'motivo' });
        expect(result.ok, `${from} → ${to}`).toBe(allowedTargets(from).includes(to));
      }
    }
  });
});
