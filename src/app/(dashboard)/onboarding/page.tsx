import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreateWorkspaceDialog } from "@/features/workspaces/components/create-workspace-dialog";
import { listWorkspaces } from "@/features/workspaces/data";

export const metadata: Metadata = { title: "Create your workspace" };

export default async function OnboardingPage() {
  // Nothing to onboard if they already have one; skip straight through.
  const workspaces = await listWorkspaces();
  if (workspaces.length > 0) {
    redirect(`/w/${workspaces[0]!.slug}`);
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-10">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Create your first workspace</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          A workspace holds your boards and the people you work with. You can create more later.
        </p>
      </div>

      <CreateWorkspaceDialog inline />
    </div>
  );
}
