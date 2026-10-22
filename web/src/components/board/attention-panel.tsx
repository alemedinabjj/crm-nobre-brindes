"use client";

import { ArrowRight, CircleCheck } from "lucide-react";
import type { Opportunity, StageMeta } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { stageLabel } from "@/lib/stages";
import { AttentionBadge } from "../ui/attention-badge";

type AttentionPanelProps = {
  opportunities: Opportunity[];
  stages: StageMeta[];
  onOpen: (id: string) => void;
};

/**
 * Resposta direta para "o que eu trabalho hoje?": a fila já vem ordenada por
 * urgência pela API, então o primeiro item é sempre o mais importante.
 */
export const AttentionPanel = ({ opportunities, stages, onOpen }: AttentionPanelProps) => {
  const queue = opportunities.filter((opportunity) => opportunity.attention.level !== "ok");

  if (queue.length === 0) {
    return (
      <div className="mx-4 flex items-center gap-2 rounded-xl border border-forest/20 bg-moss/60 px-4 py-3 text-sm text-forest-deep sm:mx-6">
        <CircleCheck className="size-4 text-forest" aria-hidden />
        Nenhuma negociação precisando de atenção nesta visão. Bom trabalho.
      </div>
    );
  }

  return (
    <section aria-labelledby="attention-title" className="mx-4 rounded-2xl border border-line bg-white sm:mx-6">
      <h2 id="attention-title" className="flex items-center gap-2 px-4 pt-3 font-display text-sm font-bold uppercase tracking-wide">
        Para trabalhar hoje
        <span className="tabular rounded-full bg-critical px-2 py-0.5 text-xs text-white">{queue.length}</span>
      </h2>
      <ol className="board-scroll flex gap-2 overflow-x-auto px-4 pb-3 pt-2">
        {queue.map((opportunity, index) => (
          <li key={opportunity.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onOpen(opportunity.id)}
              className={cn(
                "group flex w-72 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-paper-shade focus-visible:outline-2 focus-visible:outline-forest",
                opportunity.attention.level === "critical" ? "border-critical/30" : "border-warning-line",
              )}
            >
              <span className="tabular mt-0.5 font-display text-lg font-extrabold text-ink-soft/50">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold leading-snug">{opportunity.companyName}</span>
                  <AttentionBadge level={opportunity.attention.level} />
                </span>
                <span className="block text-xs text-ink-soft">
                  {opportunity.code} · {stageLabel(stages, opportunity.stage)} · {opportunity.sellerName}
                </span>
                <span className="mt-1 block text-xs leading-snug text-ink">
                  {opportunity.attention.signals[0]?.message}
                </span>
              </span>
              <ArrowRight
                className="mt-1 size-4 shrink-0 text-ink-soft transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
};
