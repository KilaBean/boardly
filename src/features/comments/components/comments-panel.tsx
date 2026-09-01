"use client";

import { Check, Loader2, MapPin, MessageSquare, Trash2, Undo2, X } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/layout/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/features/activity/format";
import type { CommentEntry, CommentPage } from "@/features/comments/data";
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useResolveComment,
} from "@/features/comments/queries";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

function CommentRow({
  comment,
  boardId,
  currentUserId,
  canModerate,
  onFocusPin,
}: {
  comment: CommentEntry;
  boardId: string;
  currentUserId: string | null;
  /** Board editors may resolve anyone's comment; only authors may delete theirs. */
  canModerate: boolean;
  onFocusPin?: (comment: CommentEntry) => void;
}) {
  const resolve = useResolveComment(boardId);
  const remove = useDeleteComment(boardId);

  const isAuthor = comment.authorId === currentUserId;
  const isResolved = comment.resolvedAt !== null;
  const isAnchored = comment.positionX !== null && comment.positionY !== null;

  return (
    <li className={cn("rounded-md border p-3", isResolved && "opacity-60")}>
      <div className="flex items-start gap-2.5">
        <Avatar className="mt-0.5 size-6 shrink-0">
          {comment.authorAvatarUrl ? <AvatarImage src={comment.authorAvatarUrl} alt="" /> : null}
          <AvatarFallback className="text-[10px]">{initials(comment.authorName)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="truncate font-medium">{comment.authorName}</span>
            <span className="text-muted-foreground">{relativeTime(comment.createdAt)}</span>
            {isResolved ? (
              <span className="text-muted-foreground inline-flex items-center gap-0.5">
                <Check className="size-3" aria-hidden="true" />
                Resolved
              </span>
            ) : null}
          </div>

          {/* Rendered as text, never as markup: comment bodies are user input. */}
          <p className="text-sm break-words whitespace-pre-wrap">{comment.body}</p>

          <div className="flex flex-wrap items-center gap-1 pt-1">
            {isAnchored && onFocusPin ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onFocusPin(comment)}
              >
                <MapPin className="size-3" aria-hidden="true" />
                Show on board
              </Button>
            ) : null}

            {canModerate || isAuthor ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ commentId: comment.id, resolved: !isResolved })}
              >
                {isResolved ? (
                  <>
                    <Undo2 className="size-3" aria-hidden="true" />
                    Reopen
                  </>
                ) : (
                  <>
                    <Check className="size-3" aria-hidden="true" />
                    Resolve
                  </>
                )}
              </Button>
            ) : null}

            {isAuthor ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive h-7 px-2 text-xs"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ commentId: comment.id })}
              >
                <Trash2 className="size-3" aria-hidden="true" />
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function CommentsPanel({
  boardId,
  initialPage,
  currentUserId,
  canModerate,
  canComment,
  pendingPin,
  onClearPin,
  onFocusPin,
  onClose,
}: {
  boardId: string;
  initialPage: CommentPage;
  currentUserId: string | null;
  canModerate: boolean;
  /** Viewers may comment; only people with no board access at all may not. */
  canComment: boolean;
  /** Canvas coordinates captured by the "pin a comment" tool, if any. */
  pendingPin: { x: number; y: number } | null;
  onClearPin: () => void;
  onFocusPin?: (comment: CommentEntry) => void;
  onClose: () => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [body, setBody] = useState("");

  const query = useComments(boardId, !showResolved, initialPage);
  const create = useCreateComment(boardId);

  const comments = query.data?.pages.flatMap((page) => page.comments) ?? [];

  async function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;

    await create.mutateAsync({
      body: trimmed,
      positionX: pendingPin?.x,
      positionY: pendingPin?.y,
    });

    setBody("");
    onClearPin();
  }

  return (
    <aside
      aria-label="Comments"
      className="bg-background flex h-full w-full flex-col border-l sm:w-80"
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <MessageSquare className="size-4" aria-hidden="true" />
          Comments
        </h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-pressed={showResolved}
            onClick={() => setShowResolved((value) => !value)}
          >
            {showResolved ? "Hide resolved" : "Show resolved"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Close comments"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {query.isError ? (
          <p role="alert" className="text-destructive text-sm">
            Could not load comments. Try reopening this panel.
          </p>
        ) : comments.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No comments yet"
            description="Leave feedback for your collaborators, or pin a note to a spot on the board."
          />
        ) : (
          <>
            <ul className="space-y-2">
              {comments.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  boardId={boardId}
                  currentUserId={currentUserId}
                  canModerate={canModerate}
                  onFocusPin={onFocusPin}
                />
              ))}
            </ul>

            {query.hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                Load older comments
              </Button>
            ) : null}
          </>
        )}
      </div>

      {canComment ? (
        <div className="space-y-2 border-t p-3">
          {pendingPin ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <MapPin className="size-3" aria-hidden="true" />
              Pinned to a spot on the board
              <button
                type="button"
                onClick={onClearPin}
                className="text-foreground underline underline-offset-2"
              >
                Remove pin
              </button>
            </p>
          ) : null}

          <label htmlFor="comment-body" className="sr-only">
            Write a comment
          </label>
          <textarea
            id="comment-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline. Matches every chat app,
              // and the button remains for anyone who expects one.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={3}
            maxLength={4000}
            placeholder="Write a comment…"
            className="border-input bg-background focus-visible:ring-ring w-full resize-none rounded-md border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />

          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={create.isPending || body.trim().length === 0}
            onClick={() => void submit()}
          >
            {create.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            Comment
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
