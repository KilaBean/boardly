/**
 * Liveblocks room naming.
 *
 * One room per board, per the PRD. The room name is the only thing the client
 * sends to the auth endpoint, so parsing it is a trust boundary: the endpoint
 * must never take "the board id" from an arbitrary string without validating
 * it, or a crafted room name could point authorization at the wrong board.
 *
 * Kept free of server imports so both the auth route and the client can use it.
 */

export const BOARD_ROOM_PREFIX = "board:";

/** RFC 4122 uuid, matching the strictness of `z.uuid()` used elsewhere. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The room name for a board. */
export function boardRoomId(boardId: string): string {
  return `${BOARD_ROOM_PREFIX}${boardId}`;
}

/**
 * Extracts the board id from a room name, or null if it is not a well-formed
 * board room.
 *
 * Returning null rather than throwing keeps the auth endpoint's failure path
 * uniform: an unparseable room and an unauthorized room both end in 403, so
 * the response cannot be used to probe which rooms exist.
 */
export function parseBoardRoomId(roomId: unknown): string | null {
  if (typeof roomId !== "string") return null;
  if (!roomId.startsWith(BOARD_ROOM_PREFIX)) return null;

  const candidate = roomId.slice(BOARD_ROOM_PREFIX.length);
  if (!UUID_PATTERN.test(candidate)) return null;

  // Normalize so two spellings of the same uuid cannot become two rooms.
  return candidate.toLowerCase();
}
