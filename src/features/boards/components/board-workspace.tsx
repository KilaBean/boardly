"use client";

import { ArrowLeft, Eye, Lock, MapPin, MessageSquare, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { TLStoreSnapshot } from "tldraw";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BoardCanvasLoader } from "@/features/boards/canvas/board-canvas-loader";
import type { CanvasPin } from "@/features/boards/canvas/canvas-pins";
import type { BoardDetail } from "@/features/boards/data";
import { CommentsPanel } from "@/features/comments/components/comments-panel";
import type { CommentEntry, CommentPage } from "@/features/comments/data";
import { useComments } from "@/features/comments/queries";
import { ShareBoardDialog } from "@/features/sharing/components/share-board-dialog";
import type { BoardMemberEntry, PendingInvitation } from "@/features/sharing/data";
import type { CurrentUser } from "@/lib/auth/dal";

/**
 * The board screen.
 *
 * A client component because the canvas and the comments panel share state
 * that neither owns: which pin is selected, whether the next click drops a
 * pin, and where the camera should fly. Keeping that in one place avoids
 * threading callbacks through the server boundary.
 */
export function BoardWorkspace({
  board,
  user,
  canEdit,
  isOwner,
  members,
  invitations,
  shareLinkEnabled,
  initialComments,
  initialDocument,
  unresolvedCount,
}: {
  board: BoardDetail;
  user: CurrentUser | null;
  canEdit: boolean;
  isOwner: boolean;
  members: BoardMemberEntry[];
  invitations: PendingInvitation[];
  shareLinkEnabled: boolean;
  initialComments: CommentPage;
  initialDocument: TLStoreSnapshot | null;
  unresolvedCount: number;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);

  // Unresolved comments only: resolved pins would clutter the board, and the
  // panel is where history lives.
  const commentsQuery = useComments(board.id, true, initialComments);

  // Derived inside the memo: flattening outside it produces a new array on
  // every render, which would rebuild the pins (and remount tldraw's overlay)
  // continuously.
  const pins = useMemo<CanvasPin[]>(() => {
    const comments = commentsQuery.data?.pages.flatMap((page) => page.comments) ?? [];

    return comments
      .filter((comment) => comment.positionX !== null && comment.positionY !== null)
      .map((comment) => ({
        id: comment.id,
        x: comment.positionX!,
        y: comment.positionY!,
        resolved: comment.resolvedAt !== null,
        // Truncated so the accessible name stays usable when read aloud.
        label: `${comment.authorName}: ${comment.body.slice(0, 60)}`,
      }));
  }, [commentsQuery.data]);

  function focusComment(comment: CommentEntry) {
    if (comment.positionX === null || comment.positionY === null) return;
    setActivePinId(comment.id);
    // New object identity each time, so re-selecting the same pin refocuses.
    setFocusPoint({ x: comment.positionX, y: comment.positionY });
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to dashboard">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <h1 className="truncate text-sm font-medium">{board.name}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canEdit ? (
            <Button
              type="button"
              variant={pinMode ? "default" : "ghost"}
              size="sm"
              aria-pressed={pinMode}
              onClick={() => {
                const next = !pinMode;
                setPinMode(next);
                if (next) setPanelOpen(true);
              }}
            >
              <MapPin className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{pinMode ? "Click the board" : "Pin note"}</span>
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Comments</span>
            {unresolvedCount > 0 ? (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] tabular-nums">
                {unresolvedCount}
              </Badge>
            ) : null}
          </Button>

          <ShareBoardDialog
            boardId={board.id}
            workspaceId={board.workspaceId}
            isOwner={isOwner}
            members={members}
            invitations={invitations}
            shareLinkEnabled={shareLinkEnabled}
          />

          {board.archivedAt ? (
            <Badge variant="outline" className="text-xs font-normal">
              Archived
            </Badge>
          ) : null}

          {!canEdit ? (
            <Badge variant="secondary" className="gap-1 text-xs font-normal">
              <Eye className="size-3" aria-hidden="true" />
              View only
            </Badge>
          ) : null}

          <Badge variant="secondary" className="hidden gap-1 text-xs font-normal sm:inline-flex">
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
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <BoardCanvasLoader
          boardId={board.id}
          initialDocument={initialDocument}
          canEdit={canEdit}
          user={user}
          pins={pins}
          activePinId={activePinId}
          onSelectPin={(pinId) => {
            setActivePinId(pinId);
            setPanelOpen(true);
          }}
          pinMode={pinMode}
          onPlacePin={(point) => {
            setPendingPin(point);
            setPinMode(false);
            setPanelOpen(true);
          }}
          focusPoint={focusPoint}
        />

        {panelOpen ? (
          <CommentsPanel
            boardId={board.id}
            initialPage={initialComments}
            currentUserId={user?.id ?? null}
            canModerate={canEdit}
            // A viewer may still comment — a comment is discussion about the
            // board, not content on it. Only someone with no access at all is
            // excluded, and they cannot reach this page.
            canComment={board.role !== null}
            pendingPin={pendingPin}
            onClearPin={() => setPendingPin(null)}
            onFocusPin={focusComment}
            onClose={() => setPanelOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
