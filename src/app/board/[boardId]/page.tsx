import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { parseScene } from "@/features/boards/canvas/scene";
import { BoardWorkspace } from "@/features/boards/components/board-workspace";
import { getBoard } from "@/features/boards/data";
import { getLatestSnapshot } from "@/features/boards/snapshots/data";
import { countUnresolvedComments, listComments } from "@/features/comments/data";
import {
  getShareLinkState,
  listBoardMembers,
  listPendingInvitations,
} from "@/features/sharing/data";
import { getCurrentUser, requireUser } from "@/lib/auth/dal";
import { uuidSchema } from "@/lib/validation/schemas";

export async function generateMetadata({
  params,
}: PageProps<"/board/[boardId]">): Promise<Metadata> {
  const { boardId } = await params;
  if (!uuidSchema.safeParse(boardId).success) return { title: "Board" };

  const board = await getBoard(boardId);
  return { title: board?.name ?? "Board" };
}

export default async function BoardPage({ params }: PageProps<"/board/[boardId]">) {
  await requireUser();

  const { boardId } = await params;

  // A malformed id is a 404, not a database error.
  if (!uuidSchema.safeParse(boardId).success) {
    notFound();
  }

  const board = await getBoard(boardId);

  // RLS returns nothing for a board the user cannot open, so "missing" and
  // "forbidden" are the same answer — and should be, since a 403 would confirm
  // the board exists to someone with no right to know.
  if (!board) {
    notFound();
  }

  const canEdit = board.role === "editor" && board.archivedAt === null;

  const [snapshot, user, members, invitations, shareState, comments, unresolvedCount] =
    await Promise.all([
      getLatestSnapshot(boardId),
      getCurrentUser(),
      listBoardMembers(boardId),
      listPendingInvitations(board.workspaceId, boardId),
      getShareLinkState(boardId),
      // Unresolved only: these seed both the panel and the canvas pins.
      listComments(boardId, { unresolvedOnly: true }),
      countUnresolvedComments(boardId),
    ]);

  return (
    <BoardWorkspace
      board={board}
      user={user}
      canEdit={canEdit}
      isOwner={user?.id === board.ownerId}
      members={members}
      invitations={invitations}
      shareLinkEnabled={shareState.enabled}
      shareLinkRole={shareState.role}
      initialComments={comments}
      unresolvedCount={unresolvedCount}
      /*
        Snapshots are opaque jsonb — nothing in Postgres knows the canvas
        format — so the shape is checked here rather than trusted. An
        unreadable one renders an empty board instead of breaking the page.
      */
      initialScene={parseScene(snapshot?.document)}
    />
  );
}
