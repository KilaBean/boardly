import { Eye, PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BoardCanvasLoader } from "@/features/boards/canvas/board-canvas-loader";
import { parseScene } from "@/features/boards/canvas/scene";
import { JoinSharedBoard } from "@/features/sharing/components/join-shared-board";
import { resolveShareToken } from "@/features/sharing/share-links";
import { getUser } from "@/lib/auth/dal";
import { siteConfig } from "@/config/site";

export async function generateMetadata({ params }: PageProps<"/share/[token]">): Promise<Metadata> {
  const { token } = await params;
  const board = await resolveShareToken(token);

  return {
    title: board ? `${board.name} (shared)` : "Shared board",
    // A share link is a bearer credential. Letting it into a search index
    // would turn "anyone with the link" into "anyone at all".
    robots: { index: false, follow: false },
  };
}

/**
 * Public, read-only view of a shared board.
 *
 * The only route in the app reachable without a session. It never joins a
 * Liveblocks room and never writes: the visitor sees the most recent snapshot
 * and nothing else — no workspace, no owner, no member list.
 *
 * An invalid, revoked, disabled or archived link is a 404, identical to a
 * token that never existed.
 */
export default async function SharePage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;

  const board = await resolveShareToken(token);
  if (!board) {
    notFound();
  }

  /*
    An edit link never hands write access to an anonymous visitor. It is
    redeemed by a signed-in user and becomes ordinary board membership, so
    every edit is attributable and one person can be removed without revoking
    the link for everybody. Until then this page stays exactly as read-only as
    a view link.
  */
  const canOffer = board.role === "editor";
  const user = canOffer ? await getUser() : null;

  return (
    <div className="flex h-svh flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
            <PenLine className="size-5" aria-hidden="true" />
            <span className="hidden sm:inline">{siteConfig.name}</span>
          </Link>
          <span className="text-muted-foreground/40 select-none" aria-hidden="true">
            /
          </span>
          <h1 className="truncate text-sm font-medium">{board.name}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary" className="gap-1 text-xs font-normal">
            <Eye className="size-3" aria-hidden="true" />
            View only
          </Badge>

          {canOffer ? (
            user ? (
              <JoinSharedBoard token={token} />
            ) : (
              <Button asChild size="sm">
                <Link href={`/sign-in?next=${encodeURIComponent(`/share/${token}`)}`}>
                  Sign in to edit
                </Link>
              </Button>
            )
          ) : null}

          <ThemeToggle />
        </div>
      </header>

      <BoardCanvasLoader
        boardId={board.id}
        // Same boundary as the board route: opaque jsonb, validated here.
        initialScene={parseScene(board.document)}
        canEdit={false}
        user={null}
        collaborative={false}
      />
    </div>
  );
}
