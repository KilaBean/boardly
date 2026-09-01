import { redirect } from "next/navigation";

import { listWorkspaces } from "@/features/workspaces/data";

/**
 * `/dashboard` is a router, not a destination.
 *
 * Boards always live inside a workspace, so there is no useful workspace-less
 * dashboard to render. A user with no workspaces is sent to onboarding;
 * everyone else lands in their first workspace.
 */
export default async function DashboardPage() {
  const workspaces = await listWorkspaces();

  if (workspaces.length === 0) {
    redirect("/onboarding");
  }

  redirect(`/w/${workspaces[0]!.slug}`);
}
