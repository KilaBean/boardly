import { NextResponse, type NextRequest } from "next/server";
import { noStore } from "@/lib/http/no-store";

import { listComments } from "@/features/comments/data";
import { getUser } from "@/lib/auth/dal";
import { uuidSchema } from "@/lib/validation/schemas";

/**
 * A page of comments for a board.
 *
 * Authorization is not repeated here: `listComments` queries as the user and
 * `comments_select` requires `can_view_board`, so a caller passing somebody
 * else's board id receives an empty page rather than an error. That is also
 * the correct answer — a 403 would confirm the board exists.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ boardId: string }> }) {
  const user = await getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore() });

  const { boardId } = await context.params;
  const parsed = uuidSchema.safeParse(boardId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid board id" }, { status: 400, headers: noStore() });
  }

  const before = request.nextUrl.searchParams.get("before") ?? undefined;
  const unresolvedOnly = request.nextUrl.searchParams.get("unresolved") === "1";

  const page = await listComments(parsed.data, { before, unresolvedOnly });

  return NextResponse.json(page, {
    headers: noStore(),
  });
}
