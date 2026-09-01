import { NextResponse, type NextRequest } from "next/server";

import { listActivity } from "@/features/activity/data";
import { getUser } from "@/lib/auth/dal";
import { uuidSchema } from "@/lib/validation/schemas";

/**
 * A page of workspace activity.
 *
 * `activity_logs_select` restricts rows to workspaces the caller belongs to,
 * and further to boards they can view — so a private board's history never
 * appears in a colleague's feed.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await context.params;
  const parsed = uuidSchema.safeParse(workspaceId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workspace id" }, { status: 400 });
  }

  const before = request.nextUrl.searchParams.get("before") ?? undefined;
  const boardParam = request.nextUrl.searchParams.get("boardId");
  const boardId = boardParam && uuidSchema.safeParse(boardParam).success ? boardParam : undefined;

  const page = await listActivity(parsed.data, { before, boardId });

  return NextResponse.json(page, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
