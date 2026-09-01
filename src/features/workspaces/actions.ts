"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/dal";
import { logActivity } from "@/lib/activity/log";
import { fail, ok, UNIQUE_VIOLATION, type ActionResult } from "@/lib/forms/action-result";
import { createClient } from "@/lib/supabase/server";
import { slugify, withSuffix } from "@/lib/workspaces/slug";
import { createWorkspaceSchema, updateWorkspaceSchema } from "@/lib/validation/schemas";

/** How many slug variants to try before giving up. */
const MAX_SLUG_ATTEMPTS = 5;

export type CreatedWorkspace = { id: string; slug: string };

/**
 * Creates a workspace owned by the signed-in user.
 *
 * The `workspace_members` owner row is created by the `on_workspace_created`
 * trigger, not here, so the invariant holds no matter which code path inserts
 * a workspace.
 *
 * Slugs are globally unique. Rather than "check then insert" — which races
 * against a concurrent create and would need a transaction to fix — this
 * inserts optimistically and retries on the unique violation. The database
 * remains the single arbiter of uniqueness.
 */
export async function createWorkspaceAction(raw: unknown): Promise<ActionResult<CreatedWorkspace>> {
  const user = await requireUser();

  const parsed = createWorkspaceSchema.partial({ slug: true }).safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }

  const supabase = await createClient();
  const desired = parsed.data.slug ?? slugify(parsed.data.name);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = attempt === 0 ? desired : withSuffix(desired, attempt + 1);

    const { data, error } = await supabase
      .from("workspaces")
      .insert({ name: parsed.data.name, slug, owner_id: user.id })
      .select("id, slug")
      .single();

    if (!error && data) {
      await logActivity(supabase, {
        workspaceId: data.id,
        actorId: user.id,
        eventType: "member.joined",
        metadata: { role: "owner" },
      });

      revalidatePath("/", "layout");
      return ok({ id: data.id, slug: data.slug });
    }

    if (error?.code !== UNIQUE_VIOLATION) {
      return fail("Could not create the workspace. Please try again.");
    }
    // Slug taken — fall through and try the next variant.
  }

  return fail("That workspace name is taken. Please choose another.");
}

/** Renames a workspace. Admin-only, enforced by RLS. */
export async function updateWorkspaceAction(raw: unknown): Promise<ActionResult<void>> {
  await requireUser();

  const parsed = updateWorkspaceSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }

  const { workspaceId, ...changes } = parsed.data;
  if (changes.name === undefined && changes.slug === undefined) {
    return ok();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .update({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.slug !== undefined ? { slug: changes.slug } : {}),
    })
    .eq("id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error?.code === UNIQUE_VIOLATION) {
    return fail("That workspace address is already taken.");
  }
  if (error) {
    return fail("Could not update the workspace. Please try again.");
  }
  // RLS filtered the row out: the user is a member but not an admin, or the
  // workspace does not exist. Both are "you cannot do this" from here.
  if (!data) {
    return fail("You do not have permission to change this workspace.");
  }

  revalidatePath("/", "layout");
  return ok();
}
