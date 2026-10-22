/**
 * As datas do CRM (último contato, validade, evento) são datas de calendário,
 * sem hora. Trabalhamos sempre com meia-noite UTC para que a contagem de dias
 * não dependa do fuso do servidor.
 */
const MS_PER_DAY = 86_400_000;

export const toCalendarDate = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

export const parseCalendarDate = (isoDate: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Data inválida (esperado AAAA-MM-DD): ${isoDate}`);
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
};

export const formatCalendarDate = (value: Date): string => toCalendarDate(value).toISOString().slice(0, 10);

/** Dias de `from` até `to` (positivo se `to` é depois). */
export const daysBetween = (from: Date, to: Date): number =>
  Math.round((toCalendarDate(to).getTime() - toCalendarDate(from).getTime()) / MS_PER_DAY);

/** "Hoje" no fuso da operação, como data de calendário. */
export const todayIn = (timeZone: string, now: Date = new Date()): Date => {
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseCalendarDate(isoDate);
};
