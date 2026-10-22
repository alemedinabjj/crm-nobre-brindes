import type { Stage, StageMeta } from "./api/types";

export const FUNNEL_ORDER: readonly Stage[] = [
  "PRIMEIRO_CONTATO",
  "APRESENTACAO_ORCAMENTO",
  "FOLLOW_UP",
  "FORECAST",
  "FECHAMENTO",
];

/** Etapas que o vendedor trabalha no dia a dia; Fechamento e Perdida ficam no fim. */
export const BOARD_ORDER: readonly Stage[] = [...FUNNEL_ORDER, "PERDIDA"];

export const STAGE_SHORT_HINT: Record<Stage, string> = {
  PRIMEIRO_CONTATO: "Qualificar o lead",
  APRESENTACAO_ORCAMENTO: "Montar e enviar proposta",
  FOLLOW_UP: "Cobrar retorno do cliente",
  FORECAST: "Negociação final",
  FECHAMENTO: "Venda ganha",
  PERDIDA: "Venda perdida",
};

export type MoveKind = "forward" | "backward" | "loss";

/**
 * Classifica o movimento só para decidir a interação (pedir motivo ou não).
 * A validação de verdade é sempre do backend.
 */
export const classifyMove = (from: Stage, to: Stage): MoveKind => {
  if (to === "PERDIDA") return "loss";
  return FUNNEL_ORDER.indexOf(to) > FUNNEL_ORDER.indexOf(from) ? "forward" : "backward";
};

export const needsReason = (from: Stage, to: Stage): boolean => classifyMove(from, to) !== "forward";

export const stageLabel = (stages: StageMeta[] | undefined, stage: Stage): string =>
  stages?.find((meta) => meta.id === stage)?.label ?? stage;
