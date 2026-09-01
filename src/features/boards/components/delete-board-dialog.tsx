"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BoardSummary } from "@/features/boards/data";
import { useDeleteBoard } from "@/features/boards/queries";

/**
 * Confirmation for permanent deletion.
 *
 * Deleting cascades to the board's comments, snapshots and shared access, and
 * cannot be undone — so it names the board explicitly rather than asking a
 * generic "are you sure?", and offers archiving as the reversible alternative.
 */
export function DeleteBoardDialog({
  board,
  workspaceId,
  open,
  onOpenChange,
}: {
  board: BoardSummary;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteBoard = useDeleteBoard(workspaceId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{board.name}”?</DialogTitle>
          <DialogDescription>
            This permanently removes the board, its comments and its history. This cannot be undone
            — archive it instead if you might want it back.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteBoard.isPending}
            onClick={async () => {
              await deleteBoard.mutateAsync({ boardId: board.id });
              onOpenChange(false);
            }}
          >
            {deleteBoard.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Delete board
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
