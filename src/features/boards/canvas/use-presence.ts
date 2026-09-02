"use client";

import type { Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";
import { useRoom } from "@liveblocks/react";
import { getYjsProviderForRoom } from "@liveblocks/yjs";
import { useCallback, useEffect, useRef } from "react";

import type { CurrentUser } from "@/lib/auth/dal";
import { colorForUser } from "@/lib/liveblocks/colors";

/** What one client publishes about itself. Plain JSON — it crosses the wire. */
type PresenceState = {
  userId: string;
  name: string;
  color: string;
  avatarUrl: string | null;
  pointer: { x: number; y: number; tool: "pointer" | "laser" } | null;
  button: "up" | "down";
  selectedElementIds: Record<string, true>;
};

export type PointerPayload = {
  pointer: { x: number; y: number; tool: "pointer" | "laser" };
  button: "down" | "up";
};

/**
 * Live cursors and selections.
 *
 * Presence travels over Yjs **awareness**, not the shared document. Awareness
 * is ephemeral and is dropped when a client disconnects, which is exactly
 * right for cursor positions: they are worthless a second later, and writing
 * them into the document would grow it without bound and — worse — put pointer
 * movement on the path to Postgres, which the architecture forbids outright.
 *
 * Incoming presence is handed to Excalidraw as `collaborators`, so it renders
 * other people's cursors and selection highlights natively rather than us
 * drawing them.
 */
export function usePresence({
  api,
  user,
  enabled,
}: {
  api: ExcalidrawImperativeAPI | null;
  user: CurrentUser | null;
  enabled: boolean;
}) {
  const room = useRoom();
  const publishRef = useRef<((payload: PointerPayload) => void) | null>(null);

  useEffect(() => {
    if (!api || !user || !enabled) return;

    const provider = getYjsProviderForRoom(room);
    const { awareness } = provider;

    const publish = (payload: PointerPayload | null) => {
      const state: PresenceState = {
        userId: user.id,
        name: user.displayName,
        // Colour is decorative only; the name is always shown alongside it, so
        // collaborators are never distinguished by colour alone.
        color: colorForUser(user.id),
        avatarUrl: user.avatarUrl,
        pointer: payload?.pointer ?? null,
        button: payload?.button === "down" ? "down" : "up",
        // Read at publish time rather than tracked separately: selection
        // changes are always accompanied by pointer activity.
        selectedElementIds: api.getAppState().selectedElementIds as Record<string, true>,
      };

      awareness.setLocalStateField("presence", state);
    };

    publishRef.current = publish;
    // Announce ourselves immediately so collaborators see the join, not just
    // the first mouse move.
    publish(null);

    const applyOthers = () => {
      const collaborators = new Map<SocketId, Collaborator>();

      for (const [clientId, raw] of awareness.getStates()) {
        if (clientId === awareness.doc.clientID) continue;

        const presence = (raw as { presence?: PresenceState } | null)?.presence;
        if (!presence || presence.userId === user.id) continue;

        collaborators.set(String(clientId) as SocketId, {
          id: presence.userId,
          username: presence.name,
          avatarUrl: presence.avatarUrl ?? undefined,
          color: { background: presence.color, stroke: presence.color },
          button: presence.button,
          selectedElementIds: presence.selectedElementIds,
          ...(presence.pointer ? { pointer: presence.pointer } : {}),
        });
      }

      // Excalidraw replaces the whole map, so anyone who has left simply is
      // not in it — no separate cleanup, and no ghost cursors left behind.
      api.updateScene({ collaborators });
    };

    awareness.on("change", applyOthers);
    applyOthers();

    return () => {
      publishRef.current = null;
      awareness.off("change", applyOthers);
      // Clear our own presence so collaborators do not see a stale cursor.
      awareness.setLocalStateField("presence", null);
    };
  }, [api, user, enabled, room]);

  /**
   * Wired to Excalidraw's `onPointerUpdate`. Stable across renders so passing
   * it as a prop does not churn the editor.
   */
  const onPointerUpdate = useCallback((payload: PointerPayload) => {
    publishRef.current?.(payload);
  }, []);

  return { onPointerUpdate };
}
