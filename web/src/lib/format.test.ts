import { describe, expect, it } from "vitest";
import { daysBetween, formatCurrency, formatProposalDeadline, formatRelativeDays, formatShortDate } from "./format";

const today = "2026-10-15";

describe("formatação", () => {
  it("formata valores em reais sem centavos e trata valor ausente", () => {
    expect(formatCurrency(38000)).toMatch(/R\$\s?38\.000/);
    expect(formatCurrency(null)).toBe("Sem valor");
  });

  it("conta dias de calendário sem depender do fuso", () => {
    expect(daysBetween("2026-10-15", "2026-10-25")).toBe(10);
    expect(daysBetween("2026-10-15", "2026-10-06")).toBe(-9);
  });

  it.each([
    ["2026-10-15", "hoje"],
    ["2026-10-16", "amanhã"],
    ["2026-10-14", "ontem"],
    ["2026-10-18", "em 3d"],
    ["2026-10-06", "há 9d"],
  ])("data relativa de %s é %s", (date, expected) => {
    expect(formatRelativeDays(date, today)).toBe(expected);
  });

  it.each([
    ["2026-10-13", "venceu há 2d"],
    ["2026-10-15", "vence hoje"],
    ["2026-10-20", "vence em 5d"],
  ])("prazo da proposta %s é %s", (date, expected) => {
    expect(formatProposalDeadline(date, today)).toBe(expected);
  });

  it("mostra a data curta em pt-BR", () => {
    expect(formatShortDate("2026-10-25")).toBe("25 de out");
  });
});
