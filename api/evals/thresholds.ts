/**
 * Metas mínimas. Abaixo delas o comando de eval termina com erro: dá para
 * usar como portão de qualidade antes de trocar modelo, prompt ou chunking.
 */
export const THRESHOLDS = {
  retrieval: {
    hybrid: { hitAt1: 0.75, hitAtK: 0.9, mrr: 0.8 },
    keywordOnly: { hitAt1: 0.5, hitAtK: 0.65, mrr: 0.55 },
  },
  agent: {
    passRate: 0.85,
    security: 1,
    toolSelection: 0.85,
    citationRate: 0.9,
    groundedness: 4,
    p95LatencyMs: 20_000,
  },
};
