"use client";

import { LayoutGrid } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { BoardSummary } from "@/features/boards/data";
import { useBoards } from "@/features/boards/queries";

import { BoardCard } from "./board-card";
import { CreateBoardDialog } from "./create-board-dialog";

export function BoardGrid({
  workspaceId,
  initialBoards,
  currentUserId,
}: {
  workspaceId: string;
  initialBoards: BoardSummary[];
  /** Board management is owner-only; RLS enforces it, this just hides the menu. */
  currentUserId: string;
}) {
  const { data: boards, isError, isFetching } = useBoards(workspaceId, initialBoards);

  if (isError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Could not load boards. Refresh the page to try again.</AlertDescription>
      </Alert>
    );
  }

  if (boards.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="No boards yet"
        description="Boards are infinite canvases for sketching, planning and thinking together."
        action={<CreateBoardDialog workspaceId={workspaceId} />}
      />
    );
  }

  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      // Refetches happen in the background after a mutation; dimming signals
      // staleness without collapsing the list back to skeletons.
      data-fetching={isFetching || undefined}
    >
      {boards.map((board) => (
        <BoardCard
          key={board.id}
          board={board}
          workspaceId={workspaceId}
          canManage={board.ownerId === currentUserId}
        />
      ))}
    </div>
  );
}

/** Matches the grid's shape so the layout does not jump when data arrives. */
export function BoardGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="space-y-3 rounded-lg border p-4">
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
