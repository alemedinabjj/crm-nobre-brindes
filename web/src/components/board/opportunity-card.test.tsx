import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Opportunity } from "@/lib/api/types";
import { useBoardSensors } from "./kanban-board";
import { OpportunityCard } from "./opportunity-card";

const base: Opportunity = {
  id: "c0a8012e-0000-4000-8000-000000000003",
  code: "OPP-2003",
  companyName: "Clínica Vida",
  sellerName: "Ana",
  estimatedValue: 7200,
  lastContactAt: "2026-10-13",
  proposalValidUntil: "2026-10-20",
  clientEventDate: "2026-10-18",
  stage: "FOLLOW_UP",
  lossReason: null,
  stageChangedAt: "2026-10-13T12:00:00.000Z",
  items: [{ id: "i1", productName: "Squeeze personalizado", quantity: 500 }],
  attention: {
    level: "critical",
    score: 10,
    signals: [
      { code: "EVENT_IMMINENT", severity: "critical", message: "Evento do cliente em 3 dias: prazo de produção em risco." },
    ],
  },
  allowedTransitions: ["FORECAST", "APRESENTACAO_ORCAMENTO", "PERDIDA"],
};

const BoardHarness = ({ children }: { children: React.ReactNode }) => (
  <DndContext sensors={useBoardSensors()}>{children}</DndContext>
);

const renderCard = (opportunity: Opportunity, onOpen = vi.fn()) => {
  render(
    <BoardHarness>
      <OpportunityCard opportunity={opportunity} today="2026-10-15" onOpen={onOpen} />
    </BoardHarness>,
  );
  return onOpen;
};

describe("OpportunityCard", () => {
  it("mostra o motivo da urgência com texto, não só com cor", () => {
    renderCard(base);
    expect(screen.getByText("Urgente")).toBeInTheDocument();
    expect(screen.getByText(/prazo de produção em risco/)).toBeInTheDocument();
  });

  it("resume item, valor, vendedor e prazos", () => {
    renderCard(base);
    expect(screen.getByText(/Squeeze personalizado/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s?7\.200/)).toBeInTheDocument();
    expect(screen.getByText("vence em 5d")).toBeInTheDocument();
    expect(screen.getByText("18 de out")).toBeInTheDocument();
  });

  it("abre o detalhe com clique simples, sem iniciar arraste", async () => {
    const onOpen = renderCard(base);
    await userEvent.click(screen.getByRole("button", { name: "Clínica Vida" }));
    expect(onOpen).toHaveBeenCalledWith(base.id);
  });

  it("abre o detalhe pelo teclado", async () => {
    const onOpen = renderCard(base);
    screen.getByRole("button", { name: "Clínica Vida" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(base.id);
  });

  it("deixa claro quando falta item de brinde", () => {
    renderCard({ ...base, items: [], attention: { level: "ok", score: 0, signals: [] } });
    expect(screen.getByText("Nenhum item informado")).toBeInTheDocument();
    expect(screen.queryByText("Urgente")).not.toBeInTheDocument();
  });

  it("mostra o motivo em oportunidades perdidas", () => {
    renderCard({
      ...base,
      stage: "PERDIDA",
      lossReason: "Fechou com concorrente",
      allowedTransitions: [],
      attention: { level: "ok", score: 0, signals: [] },
    });
    expect(screen.getByText("Motivo: Fechou com concorrente")).toBeInTheDocument();
  });
});
