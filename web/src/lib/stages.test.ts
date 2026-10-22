import { describe, expect, it } from "vitest";
import { classifyMove, needsReason } from "./stages";

describe("classifyMove", () => {
  it("identifica avanço, retorno e perda", () => {
    expect(classifyMove("FORECAST", "FECHAMENTO")).toBe("forward");
    expect(classifyMove("FOLLOW_UP", "APRESENTACAO_ORCAMENTO")).toBe("backward");
    expect(classifyMove("PRIMEIRO_CONTATO", "PERDIDA")).toBe("loss");
  });

  it("pede motivo só em retornos e perdas", () => {
    expect(needsReason("APRESENTACAO_ORCAMENTO", "FOLLOW_UP")).toBe(false);
    expect(needsReason("FORECAST", "FOLLOW_UP")).toBe(true);
    expect(needsReason("FOLLOW_UP", "PERDIDA")).toBe(true);
  });
});
