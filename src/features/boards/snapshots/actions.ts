"use server";

import { requireUser } from "@/lib/auth/dal";
import { fail, ok, UNIQUE_VIOLATION, type ActionResult } from "@/lib/forms/action-result";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/schemas";
import type { Json } from "@/types/database";

/**
 * Canvas snapshot persistence.
 *
 * A snapshot is an opaque tldraw document blob. We deliberately do NOT
 * validate its internal structure: tldraw owns that schema and migrates it
 * across versions, so a validator here would reject valid documents the day
 * tldraw ships a new record type.
 *
 * What we do enforce is the boundary: it must be a JSON object, and it must
 * not be enormous. Without a size cap this action is an unauthenticated-shaped
 * hole for writing arbitrarily large blobs into Postgres — the caller controls
 * the payload entirely.
 */

/** Roughly the size of a very busy board. Beyond this, something is wrong. */
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

/** Attempts to claim a version number before giving up. */
const MAX_VERSION_ATTEMPTS = 5;

export type SaveSnapshotResult = { version: number };

export async function saveBoardSnapshotAction(
  rawBoardId: unknown,
  document: unknown,
): Promise<ActionResult<SaveSnapshotResult>> {
  await requireUser();

  const parsedId = uuidSchema.safeParse(rawBoardId);
  if (!parsedId.success) return fail("That board could not be found.");

  // Matches the board_snapshots_snapshot_is_object CHECK.
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return fail("The canvas could not be saved because its data was malformed.");
  }

  let serializedBytes: number;
  try {
    serializedBytes = new TextEncoder().encode(JSON.stringify(document)).length;
  } catch {
    // Circular structures and BigInt both throw here.
    return fail("The canvas could not be saved because its data was malformed.");
  }

  if (serializedBytes > MAX_SNAPSHOT_BYTES) {
    return fail("This board is too large to save. Please remove some content.");
  }

  const supabase = await createClient();
  const boardId = parsedId.data;

  // Find the current head. RLS means a user without view access sees nothing,
  // and the insert below will then be rejected too.
  const { data: latest } = await supabase
    .from("board_snapshots")
    .select("version")
    .eq("board_id", boardId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextVersion = (latest?.version ?? 0) + 1;

  // Two collaborators can race for the same version. `unique (board_id,
  // version)` is the arbiter; we retry rather than locking, exactly as the
  // workspace slug insert does.
  for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase
      .from("board_snapshots")
      .insert({ board_id: boardId, version: nextVersion, snapshot: document as Json })
      .select("version")
      .maybeSingle();

    if (!error && data) {
      return ok({ version: data.version });
    }

    if (error?.code === UNIQUE_VIOLATION) {
      nextVersion += 1;
      continue;
    }

    // board_snapshots_insert requires can_edit_board(), which is false for
    // viewers and for archived boards.
    return fail("You do not have permission to edit this board.");
  }

  return fail("Could not save the canvas. Please try again.");
}
