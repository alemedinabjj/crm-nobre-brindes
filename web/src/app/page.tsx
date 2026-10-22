import { Suspense } from "react";
import { BoardSkeleton } from "@/components/board/board-states";
import { CrmBoard } from "@/components/board/crm-board";

export default function Home() {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <CrmBoard />
    </Suspense>
  );
}
