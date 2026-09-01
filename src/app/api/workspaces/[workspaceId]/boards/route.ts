import { NextResponse, type NextRequest } from "next/server";
import { noStore } from "@/lib/http/no-store";

import { listBoards } from "@/features/boards/data";
import { getUser } from "@/lib/auth/dal";
import { uuidSchema } from "@/lib/validation/schemas";

/**
 * Boards in a workspace, for TanStack Query refetches.
 *
 * Reads are a GET route handler rather than a server action because server
 * actions are POST-only and run sequentially — fine for mutations, wasteful
 * for a list that refetches on invalidation.
 *
 * `workspaceId` is a path segment supplied by the client, so it is parsed as a
 * uuid before use. Authorization is not performed here: `listBoards` queries
 * as the user and RLS returns only what they may see. A caller passing
 * somebody else's workspace id gets an empty array, not an error — which is
 * also the correct answer, since revealing "this exists but you cannot see it"
 * would leak the workspace's existence.
 */
export async function GET(
  _request: NextRequest,
  // Next 16 made route params async.
  context: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore() });
  }

  const { workspaceId } = await context.params;
  const parsed = uuidSchema.safeParse(workspaceId);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid workspace id" },
      { status: 400, headers: noStore() },
    );
  }

  const boards = await listBoards(parsed.data);

  return NextResponse.json(
    { boards },
    // Per-user data: must never be stored by a shared cache.
    { headers: noStore() },
  );
}
