import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActivityEventType, Database, Json } from "@/types/database";

type Client = SupabaseClient<Database>;

export type ActivityInput = {
  workspaceId: string;
  boardId?: string | null;
  actorId: string;
  eventType: ActivityEventType;
  metadata?: Record<string, Json>;
};

/**
 * Records an activity entry.
 *
 * **Never throws.** Activity is a secondary record: if writing it fails, the
 * user's actual operation has already succeeded and rolling it back — or
 * surfacing a scary error — would be worse than a gap in the feed.
 *
 * The insert runs as the user, not the service role, so RLS still applies:
 * `actor_id` must equal `auth.uid()` and the caller must be a workspace
 * member. That means this helper cannot be used to forge history even if it
 * were called with the wrong arguments.
 */
export async function logActivity(client: Client, input: ActivityInput): Promise<void> {
  const { error } = await client.from("activity_logs").insert({
    workspace_id: input.workspaceId,
    board_id: input.boardId ?? null,
    actor_id: input.actorId,
    event_type: input.eventType,
    metadata: (input.metadata ?? {}) as Json,
  });

  if (error && process.env.NODE_ENV !== "production") {
    // Deliberately not logged in production: the metadata can contain board
    // names, which are user content and do not belong in server logs.
    console.warn(`[activity] failed to record ${input.eventType}: ${error.message}`);
  }
}
