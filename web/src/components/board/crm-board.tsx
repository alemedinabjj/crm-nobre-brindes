"use client";

import { BellRing } from "lucide-react";
import { useState } from "react";
import { useBoardFilters } from "@/hooks/use-board-filters";
import { useFollowUps } from "@/hooks/use-follow-ups";
import { useMeta, useOpportunities } from "@/hooks/use-opportunities";
import { AppHeader } from "../layout/app-header";
import { FilterBar } from "../filters/filter-bar";
import { OpportunityDrawer } from "../detail/opportunity-drawer";
import { FollowUpsDrawer } from "../follow-ups/follow-ups-drawer";
import { useStageMove } from "../stage-move/use-stage-move";
import { AttentionPanel } from "./attention-panel";
import { BoardEmpty, BoardError, BoardSkeleton } from "./board-states";
import { KanbanBoard } from "./kanban-board";

export const CrmBoard = () => {
  const board = useBoardFilters();
  const meta = useMeta();
  const opportunities = useOpportunities(board.filters);
  const { requestMove, dialog, isMoving } = useStageMove({ onOpenDetail: board.openOpportunity });
  const [panel, setPanel] = useState<"follow-ups" | null>(null);
  const followUps = useFollowUps(board.filters.seller);
  const pendingFollowUps = followUps.data?.length ?? 0;

  const stages = meta.data?.stages ?? [];
  const today = meta.data?.today ?? new Date().toISOString().slice(0, 10);
  const error = meta.error ?? opportunities.error;

  const content = () => {
    if (error) {
      return (
        <BoardError
          message={error.message}
          onRetry={() => {
            void meta.refetch();
            void opportunities.refetch();
          }}
        />
      );
    }
    const list = opportunities.data;
    if (meta.isPending || !list) return <BoardSkeleton />;
    if (list.length === 0) {
      return <BoardEmpty hasFilters={board.hasActiveFilters} onClear={board.clearFilters} />;
    }
    return (
      <>
        <AttentionPanel opportunities={list} stages={stages} onOpen={board.openOpportunity} />
        <div className="mt-4" aria-busy={opportunities.isFetching}>
          <KanbanBoard
            opportunities={list}
            stages={stages}
            today={today}
            onOpen={board.openOpportunity}
            onMove={requestMove}
          />
        </div>
      </>
    );
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        today={meta.data?.today}
        actions={
          <button
            type="button"
            onClick={() => setPanel("follow-ups")}
            className="inline-flex items-center gap-1.5 rounded-full bg-forest-deep px-3 py-1.5 text-xs font-semibold text-white hover:bg-forest"
          >
            <BellRing className="size-3.5" aria-hidden />
            Retornos
            {pendingFollowUps > 0 && (
              <span className="tabular rounded-full bg-lime px-1.5 text-[11px] text-forest-deep">{pendingFollowUps}</span>
            )}
          </button>
        }
      />
      <div className="border-b border-line bg-white">
        <FilterBar
          filters={board.filters}
          sellers={meta.data?.sellers ?? []}
          hasActiveFilters={board.hasActiveFilters}
          onSearch={board.setSearch}
          onSeller={board.setSeller}
          onAttention={board.setAttention}
          onClear={board.clearFilters}
        />
      </div>
      <main className="flex-1 pt-4">{content()}</main>

      <OpportunityDrawer
        id={board.selectedId}
        stages={stages}
        today={today}
        onClose={board.closeOpportunity}
        onMove={requestMove}
        isMoving={isMoving}
      />
      <FollowUpsDrawer
        open={panel === "follow-ups"}
        seller={board.filters.seller}
        onClose={() => setPanel(null)}
        onOpenOpportunity={(id) => {
          setPanel(null);
          board.openOpportunity(id);
        }}
      />
      {dialog}
    </div>
  );
};
