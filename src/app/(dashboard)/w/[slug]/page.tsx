import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActivityFeed } from "@/features/activity/components/activity-feed";
import { listActivity } from "@/features/activity/data";
import { BoardGrid } from "@/features/boards/components/board-grid";
import { CreateBoardDialog } from "@/features/boards/components/create-board-dialog";
import { listBoards } from "@/features/boards/data";
import { getWorkspaceBySlug } from "@/features/workspaces/data";
import { requireUser } from "@/lib/auth/dal";

export async function generateMetadata({ params }: PageProps<"/w/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const workspace = await getWorkspaceBySlug(slug);
  return { title: workspace?.name ?? "Workspace" };
}

export default async function WorkspacePage({ params }: PageProps<"/w/[slug]">) {
  const user = await requireUser();
  const { slug } = await params;

  const workspace = await getWorkspaceBySlug(slug);

  // RLS returns nothing for a workspace the user cannot see, so "not a member"
  // and "does not exist" are indistinguishable here — which is the correct
  // response. Rendering "you lack permission" would confirm the workspace
  // exists to someone who should not know that.
  if (!workspace) {
    notFound();
  }

  // Fetched on the server so the first paint has real content; the client
  // components take over for optimistic updates and pagination.
  const [boards, activity] = await Promise.all([
    listBoards(workspace.id),
    listActivity(workspace.id, { limit: 8 }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
          <p className="text-muted-foreground text-sm">
            {boards.length === 0
              ? "No boards yet"
              : `${boards.length} ${boards.length === 1 ? "board" : "boards"}`}
          </p>
        </div>

        {boards.length > 0 ? <CreateBoardDialog workspaceId={workspace.id} /> : null}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <BoardGrid workspaceId={workspace.id} initialBoards={boards} currentUserId={user.id} />

        <section aria-labelledby="activity-heading" className="space-y-4">
          <h2 id="activity-heading" className="text-sm font-medium">
            Recent activity
          </h2>
          <ActivityFeed workspaceId={workspace.id} initialPage={activity} />
        </section>
      </div>
    </div>
  );
}
