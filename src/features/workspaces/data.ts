import "server-only";

import { cache } from "react";

import { getUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceRole } from "@/types/database";

/**
 * Server-side workspace reads.
 *
 * Every query runs through the user's own Supabase client, so Row Level
 * Security decides what comes back. There is deliberately no "and check the
 * user is a member" clause in application code — adding one would imply the
 * database needs help, and the day someone forgets it would become a leak.
 * A user who is not a member simply receives zero rows.
 */

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  boardCount: number;
};

/** Workspaces the signed-in user belongs to, most recently joined first. */
export const listWorkspaces = cache(async (): Promise<WorkspaceSummary[]> => {
  const user = await getUser();
  if (!user) return [];

  const supabase = await createClient();

  // One round trip: membership rows carry the role, embedded workspace carries
  // the rest. `boards(count)` is an aggregate, so board rows are never shipped.
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, joined_at, workspaces!inner(id, name, slug, boards(count))")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  if (error || !data) return [];

  return data.flatMap((row) => {
    const workspace = row.workspaces as unknown as {
      id: string;
      name: string;
      slug: string;
      boards: { count: number }[] | null;
    } | null;
    if (!workspace) return [];

    return [
      {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role: row.role,
        boardCount: workspace.boards?.[0]?.count ?? 0,
      },
    ];
  });
});

/** A single workspace by slug, or null when it does not exist or is not visible. */
export const getWorkspaceBySlug = cache(async (slug: string) => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, slug, owner_id, created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (error) return null;
  return data;
});

/** The signed-in user's role in a workspace, or null when not a member. */
export const getWorkspaceRole = cache(
  async (workspaceId: string): Promise<WorkspaceRole | null> => {
    const user = await getUser();
    if (!user) return null;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) return null;
    return data.role;
  },
);
