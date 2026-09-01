"use client";

import { LiveblocksProvider, RoomProvider } from "@liveblocks/react";
import type { ReactNode } from "react";

import { boardRoomId } from "@/lib/liveblocks/rooms";

/**
 * Liveblocks room for a single board.
 *
 * `authEndpoint` is what makes the architecture's invariant hold: the browser
 * never sees a Liveblocks key. It asks our server for a token, and the server
 * decides what the token may do by calling the same SQL function the RLS
 * policies use. The public Liveblocks key is not used for room access at all.
 *
 * One room per board, per the PRD.
 */
export function BoardRoom({ boardId, children }: { boardId: string; children: ReactNode }) {
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id={boardRoomId(boardId)}
        // Cursor position and selection travel through Yjs awareness (see
        // use-presence.ts), so Liveblocks presence itself stays empty.
        initialPresence={{}}
      >
        {children}
      </RoomProvider>
    </LiveblocksProvider>
  );
}
