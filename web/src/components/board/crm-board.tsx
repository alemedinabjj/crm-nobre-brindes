"use client";

import { useBoardFilters } from "@/hooks/use-board-filters";
import { useMeta, useOpportunities } from "@/hooks/use-opportunities";
import { AppHeader } from "../layout/app-header";
import { FilterBar } from "../filters/filter-bar";
import { OpportunityDrawer } from "../detail/opportunity-drawer";
import { useStageMove } from "../stage-move/use-stage-move";
import { AttentionPanel } from "./attention-panel";
import { BoardEmpty, BoardError, BoardSkeleton } from "./board-states";
import { KanbanBoard } from "./kanban-board";

export const CrmBoard = () => {
  const board = useBoardFilters();
  const meta = useMeta();
  const opportunities = useOpportunities(board.filters);
  const { requestMove, dialog, isMoving } = useStageMove({ onOpenDetail: board.openOpportunity });

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
      <AppHeader today={meta.data?.today} />
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
      {dialog}
    </div>
  );
};
