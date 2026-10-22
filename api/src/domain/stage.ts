export const STAGES = [
  'PRIMEIRO_CONTATO',
  'APRESENTACAO_ORCAMENTO',
  'FOLLOW_UP',
  'FORECAST',
  'FECHAMENTO',
  'PERDIDA',
] as const;

export type Stage = (typeof STAGES)[number];

export const FUNNEL_ORDER = [
  'PRIMEIRO_CONTATO',
  'APRESENTACAO_ORCAMENTO',
  'FOLLOW_UP',
  'FORECAST',
  'FECHAMENTO',
] as const satisfies readonly Stage[];

export const FINAL_STAGES = ['FECHAMENTO', 'PERDIDA'] as const satisfies readonly Stage[];

export const STAGE_LABELS: Record<Stage, string> = {
  PRIMEIRO_CONTATO: 'Primeiro Contato',
  APRESENTACAO_ORCAMENTO: 'Apresentação de Orçamento',
  FOLLOW_UP: 'Follow-up',
  FORECAST: 'Forecast',
  FECHAMENTO: 'Fechamento',
  PERDIDA: 'Perdida',
};

export const isStage = (value: unknown): value is Stage =>
  typeof value === 'string' && (STAGES as readonly string[]).includes(value);

export const isFinalStage = (stage: Stage): boolean =>
  (FINAL_STAGES as readonly Stage[]).includes(stage);

/** Posição no funil; PERDIDA fica fora do funil e retorna -1. */
export const funnelPosition = (stage: Stage): number =>
  (FUNNEL_ORDER as readonly Stage[]).indexOf(stage);
