const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat("pt-BR");

const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const MS_PER_DAY = 86_400_000;

export const formatCurrency = (value: number | null): string =>
  value === null ? "Sem valor" : currency.format(value);

export const formatQuantity = (value: number): string => integer.format(value);

/** "2026-10-25" → "25 de out." (datas de calendário, sem fuso). */
export const formatShortDate = (isoDate: string): string =>
  shortDate.format(new Date(`${isoDate}T00:00:00Z`)).replace(".", "");

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

export const daysBetween = (fromIso: string, toIso: string): number =>
  Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_PER_DAY,
  );

/** Distância relativa curta para chips: "hoje", "em 3d", "há 9d". */
export const formatRelativeDays = (isoDate: string, todayIso: string): string => {
  const days = daysBetween(todayIso, isoDate);
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days === -1) return "ontem";
  return days > 0 ? `em ${days}d` : `há ${-days}d`;
};

/** Chip da proposta: "vence em 5d", "vence hoje", "venceu há 2d". */
export const formatProposalDeadline = (validUntil: string, todayIso: string): string => {
  const days = daysBetween(todayIso, validUntil);
  if (days < 0) return `venceu há ${-days}d`;
  if (days === 0) return "vence hoje";
  return `vence em ${days}d`;
};
