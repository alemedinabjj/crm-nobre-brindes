"use client";

import { useDroppable } from "@dnd-kit/core";
import { Ban } from "lucide-react";
import type { Opportunity, Stage } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format";
import { STAGE_SHORT_HINT } from "@/lib/stages";
import { OpportunityCard } from "./opportunity-card";

type DropState = "idle" | "allowed" | "blocked" | "origin";

type ColumnProps = {
  stage: Stage;
  label: string;
  opportunities: Opportunity[];
  today: string;
  dropState: DropState;
  onOpen: (id: string) => void;
};

const totalValue = (opportunities: Opportunity[]) =>
  opportunities.reduce((sum, opportunity) => sum + (opportunity.estimatedValue ?? 0), 0);

export const KanbanColumn = ({ stage, label, opportunities, today, dropState, onOpen }: ColumnProps) => {
  // A coluna proibida continua recebendo o "soltar" para a tela explicar o motivo.
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const urgent = opportunities.filter((opportunity) => opportunity.attention.level === "critical").length;
  const isTerminal = stage === "FECHAMENTO" || stage === "PERDIDA";

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}: ${opportunities.length} oportunidades`}
      className={cn(
        "flex w-[17.5rem] shrink-0 snap-start flex-col rounded-2xl border transition-colors 2xl:w-auto 2xl:min-w-[15rem] 2xl:flex-1",
        dropState === "allowed"
          ? isOver
            ? "border-forest bg-moss ring-2 ring-forest/30"
            : "border-dashed border-forest/60 bg-moss/50"
          : isTerminal
            ? "border-line bg-paper-shade/70"
            : "border-line bg-white/60",
        dropState === "blocked" && "opacity-45",
      )}
    >
      <header className="sticky top-0 z-10 rounded-t-2xl px-3 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">{label}</h2>
          <span className="tabular rounded-full bg-forest-deep px-2 py-0.5 text-xs font-semibold text-white">
            {opportunities.length}
          </span>
        </div>
        <p className="mt-0.5 flex items-center justify-between gap-2 text-xs text-ink-soft">
          <span>{STAGE_SHORT_HINT[stage]}</span>
          <span className="tabular font-medium">{formatCurrency(totalValue(opportunities))}</span>
        </p>
        {urgent > 0 && (
          <p className="mt-1 text-xs font-semibold text-critical">
            {urgent} {urgent === 1 ? "urgente" : "urgentes"}
          </p>
        )}
      </header>

      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-3">
        {dropState === "blocked" && (
          <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-ink-soft/40 px-3 py-2 text-xs text-ink-soft">
            <Ban className="size-3.5" aria-hidden /> Movimento não permitido
          </p>
        )}
        {opportunities.map((opportunity) => (
          <OpportunityCard key={opportunity.id} opportunity={opportunity} today={today} onOpen={onOpen} />
        ))}
        {opportunities.length === 0 && dropState !== "blocked" && (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-ink-soft">
            {dropState === "allowed" ? "Solte aqui" : "Nenhuma oportunidade"}
          </p>
        )}
      </div>
    </section>
  );
};
