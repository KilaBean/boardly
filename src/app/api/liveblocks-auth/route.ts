import { Liveblocks } from "@liveblocks/node";
import { noStore } from "@/lib/http/no-store";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";
import { serverEnv } from "@/lib/env/server";
import { colorForUser } from "@/lib/liveblocks/colors";
import { parseBoardRoomId } from "@/lib/liveblocks/rooms";
import { createClient } from "@/lib/supabase/server";
import type { BoardRole } from "@/types/database";

/**
 * Liveblocks room authorization.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS ENDPOINT IS THE CRITICAL INVARIANT.
 *
 * `ARCHITECTURE.md`: "A board's real-time room is authorized from the same
 * membership/permission model used by application APIs."
 *
 * It is honoured literally here — access is decided by calling
 * `public.board_access_role()`, the *same SQL function* the RLS policies use.
 * Not a reimplementation of the rules, not a cached copy: the same function.
 * If the policy changes, room access changes with it, automatically.
 *
 * A Liveblocks access token bypasses Postgres entirely once issued. Whatever
 * this endpoint grants is what the user can actually do in the room, so it is
 * the last place the question is asked.
 * ─────────────────────────────────────────────────────────────────────────
 */

const liveblocks = new Liveblocks({ secret: serverEnv.LIVEBLOCKS_SECRET_KEY });

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401, headers: noStore() });
  }

  let room: unknown;
  try {
    const body = (await request.json()) as { room?: unknown };
    room = body.room;
  } catch {
    return new NextResponse("Bad request", { status: 400, headers: noStore() });
  }

  // The room name is client-supplied. Parse it; never trust it as a board id.
  const boardId = parseBoardRoomId(room);
  if (!boardId || typeof room !== "string") {
    return new NextResponse("Forbidden", { status: 403, headers: noStore() });
  }

  const supabase = await createClient();

  // The same function the policies call. `can_edit_board` additionally
  // returns false for archived boards, which is how an archived board becomes
  // read-only in the room as well as in the database.
  const [{ data: accessRole }, { data: canEdit }] = await Promise.all([
    supabase.rpc("board_access_role", { p_board_id: boardId }),
    supabase.rpc("can_edit_board", { p_board_id: boardId }),
  ]);

  const role = (accessRole as BoardRole | null) ?? null;

  // No access, or a board that does not exist — indistinguishable on purpose,
  // so the response cannot be used to discover which boards exist.
  if (role === null) {
    return new NextResponse("Forbidden", { status: 403, headers: noStore() });
  }

  const session = liveblocks.prepareSession(user.id, {
    userInfo: {
      name: user.displayName,
      avatar: user.avatarUrl ?? undefined,
      color: colorForUser(user.id),
    },
  });

  // Viewers and archived boards get read-only. `FULL_ACCESS`/`READ_ACCESS` are
  // deprecated in favour of these scope literals.
  session.allow(room, canEdit === true ? ["*:write"] : ["*:read"]);

  const { status, body } = await session.authorize();
  // Carries a room access token: must never be cached anywhere.
  return new NextResponse(body, { status, headers: noStore() });
}
