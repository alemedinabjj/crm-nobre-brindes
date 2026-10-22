"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import type { Opportunity, Stage, StageMeta } from "@/lib/api/types";
import { BOARD_ORDER } from "@/lib/stages";
import { KanbanColumn } from "./kanban-column";
import { OpportunityCard } from "./opportunity-card";

type BoardProps = {
  opportunities: Opportunity[];
  stages: StageMeta[];
  today: string;
  onOpen: (id: string) => void;
  onMove: (opportunity: Opportunity, to: Stage) => void;
};

/**
 * Distância mínima no mouse e toque longo no celular: um clique simples abre
 * o card e a rolagem da página continua funcionando, em vez de virar arraste.
 */
export const useBoardSensors = () =>
  useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

const groupByStage = (opportunities: Opportunity[]) => {
  const groups = new Map<Stage, Opportunity[]>(BOARD_ORDER.map((stage) => [stage, []]));
  for (const opportunity of opportunities) groups.get(opportunity.stage)?.push(opportunity);
  return groups;
};

export const KanbanBoard = ({ opportunities, stages, today, onOpen, onMove }: BoardProps) => {
  const [active, setActive] = useState<Opportunity | null>(null);

  const sensors = useBoardSensors();

  const grouped = useMemo(() => groupByStage(opportunities), [opportunities]);
  const labels = useMemo(() => new Map(stages.map((stage) => [stage.id, stage.label])), [stages]);

  const dropStateFor = (stage: Stage) => {
    if (!active) return "idle" as const;
    if (stage === active.stage) return "origin" as const;
    return active.allowedTransitions.includes(stage) ? ("allowed" as const) : ("blocked" as const);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActive(opportunities.find((opportunity) => opportunity.id === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragged = active;
    setActive(null);
    const target = event.over?.id;
    if (!dragged || typeof target !== "string") return;
    const stage = BOARD_ORDER.find((candidate) => candidate === target);
    if (stage && stage !== dragged.stage) onMove(dragged, stage);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActive(null)}>
      <div className="board-scroll flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-6 sm:snap-none sm:px-6">
        {BOARD_ORDER.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            label={labels.get(stage) ?? stage}
            opportunities={grouped.get(stage) ?? []}
            today={today}
            dropState={dropStateFor(stage)}
            onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active && <OpportunityCard opportunity={active} today={today} onOpen={onOpen} isOverlay />}
      </DragOverlay>
    </DndContext>
  );
};
