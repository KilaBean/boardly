"use client";

import { Archive, Lock, MoreHorizontal, PenLine, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardSummary } from "@/features/boards/data";
import { relativeTime } from "@/lib/time";

import { useArchiveBoard } from "@/features/boards/queries";

import { DeleteBoardDialog } from "./delete-board-dialog";
import { RenameBoardDialog } from "./rename-board-dialog";

export function BoardCard({
  board,
  workspaceId,
  canManage,
}: {
  board: BoardSummary;
  workspaceId: string;
  canManage: boolean;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Controlled so opening a dialog can close the menu. `preventDefault` on a
  // menu item keeps the menu mounted, and a menu left open renders a modal
  // overlay that hides the rest of the page from assistive technology.
  const [menuOpen, setMenuOpen] = useState(false);
  const archiveBoard = useArchiveBoard(workspaceId);

  return (
    <div className="group focus-within:ring-ring hover:border-foreground/20 relative flex flex-col rounded-lg border transition-colors focus-within:ring-2">
      {/* The whole card is the link target via ::after, so the menu button
          below can still be clicked without nesting interactive elements. */}
      <Link
        href={`/board/${board.id}`}
        className="flex flex-1 flex-col gap-3 rounded-lg p-4 after:absolute after:inset-0 after:content-[''] focus:outline-none"
      >
        <div className="bg-muted/60 h-24 rounded-md" aria-hidden="true" />
        <div className="space-y-1">
          <h3 className="truncate text-sm font-medium">{board.name}</h3>
          <p className="text-muted-foreground text-xs">Edited {relativeTime(board.updatedAt)}</p>
        </div>
      </Link>

      <div className="flex items-center justify-between px-4 pb-3">
        <Badge variant="secondary" className="gap-1 text-xs font-normal">
          {board.visibility === "private" ? (
            <>
              <Lock className="size-3" aria-hidden="true" />
              Private
            </>
          ) : (
            <>
              <Users className="size-3" aria-hidden="true" />
              Workspace
            </>
          )}
        </Badge>

        {canManage ? (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                // relative + z-10 lifts it above the link's ::after overlay.
                className="relative z-10 size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Board options for ${board.name}`}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setMenuOpen(false);
                  setRenameOpen(true);
                }}
              >
                <PenLine className="size-4" aria-hidden="true" />
                Rename
              </DropdownMenuItem>

              {/* Archiving is reversible, so it acts immediately rather than
                  asking for confirmation. Only deletion gets a dialog. */}
              <DropdownMenuItem
                disabled={archiveBoard.isPending}
                onSelect={() => archiveBoard.mutate({ boardId: board.id, archived: true })}
              >
                <Archive className="size-4" aria-hidden="true" />
                Archive
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                variant="destructive"
                onSelect={(event) => {
                  event.preventDefault();
                  setMenuOpen(false);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <RenameBoardDialog
        board={board}
        workspaceId={workspaceId}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteBoardDialog
        board={board}
        workspaceId={workspaceId}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  );
}
