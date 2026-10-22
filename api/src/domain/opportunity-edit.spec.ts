import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from './calendar-date.js';
import { checkContactDate, checkEditable } from './opportunity-edit.js';

const today = parseCalendarDate('2026-10-15');

describe('checkEditable', () => {
  it.each(['FECHAMENTO', 'PERDIDA'] as const)(
    'bloqueia edição em %s',
    (stage) => {
      expect(checkEditable(stage).map((violation) => violation.code)).toEqual([
        'FINAL_STAGE_READ_ONLY',
      ]);
    },
  );

  it('permite edição em etapas abertas', () => {
    expect(checkEditable('FOLLOW_UP')).toEqual([]);
  });
});

describe('checkContactDate', () => {
  it('aceita hoje e datas passadas', () => {
    expect(checkContactDate(today, today)).toEqual([]);
    expect(checkContactDate(parseCalendarDate('2026-10-01'), today)).toEqual(
      [],
    );
    expect(checkContactDate(null, today)).toEqual([]);
  });

  it('rejeita contato no futuro', () => {
    expect(
      checkContactDate(parseCalendarDate('2026-10-16'), today).map(
        (violation) => violation.code,
      ),
    ).toEqual(['CONTACT_IN_FUTURE']);
  });
});
