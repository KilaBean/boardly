"use client";

import { useRoom } from "@liveblocks/react";
import { getYjsProviderForRoom } from "@liveblocks/yjs";
import { atom, react } from "@tldraw/state";
import { createPresenceStateDerivation, InstancePresenceRecordType } from "@tldraw/tlschema";
import { useEffect } from "react";
import type { Editor, TLInstancePresence } from "tldraw";
import type { JsonObject } from "@liveblocks/client";
import type { TLUser, TLUserId } from "@tldraw/tlschema";

import type { CurrentUser } from "@/lib/auth/dal";
import { colorForUser } from "@/lib/liveblocks/colors";

/**
 * Live cursors, selections and viewports.
 *
 * Presence travels over Yjs **awareness**, not the shared document. Awareness
 * is ephemeral and is dropped when a client disconnects, which is exactly
 * right for cursor positions: they are worthless a second later, and writing
 * them into the document would grow it without bound and — worse — put pointer
 * movement on the path to Postgres, which the architecture forbids outright.
 *
 * Incoming presence is written into the store as session-scoped
 * `InstancePresence` records, which is how tldraw renders other people's
 * cursors and selection outlines natively rather than us drawing them.
 */
export function usePresence({
  editor,
  user,
  enabled,
}: {
  editor: Editor | null;
  user: CurrentUser | null;
  enabled: boolean;
}) {
  const room = useRoom();

  useEffect(() => {
    if (!editor || !user || !enabled) return;

    const provider = getYjsProviderForRoom(room);
    const { awareness } = provider;

    // tldraw derives presence (cursor, selection, camera) from the store, so
    // we describe the user once and let it compute the rest.
    const $user = atom<TLUser>("presence-user", {
      id: `user:${user.id}` as TLUserId,
      typeName: "user",
      name: user.displayName,
      // Colour is decorative only; name is always shown alongside it, so
      // collaborators are never distinguished by colour alone.
      color: colorForUser(user.id),
      imageUrl: user.avatarUrl ?? "",
      meta: {},
    });

    const derivePresence = createPresenceStateDerivation($user)(editor.store);

    // Publish our own presence whenever it changes.
    const stopPublishing = react("publish-presence", () => {
      const presence = derivePresence.get();
      // TLInstancePresence is JSON-serializable at runtime, but its nested
      // BoxModel types lack index signatures so TypeScript cannot prove it
      // satisfies JsonObject. This cast is the acknowledged boundary.
      awareness.setLocalStateField(
        "presence",
        presence ? ({ ...presence } as unknown as JsonObject) : null,
      );
    });

    // Apply everyone else's.
    const applyOthers = () => {
      const states = awareness.getStates();
      const incoming: TLInstancePresence[] = [];
      const seen = new Set<string>();

      for (const [clientId, state] of states) {
        if (clientId === awareness.doc.clientID) continue;

        const presence = (state as { presence?: TLInstancePresence } | null)?.presence;
        if (!presence || presence.userId === user.id) continue;

        incoming.push(presence);
        seen.add(presence.id);
      }

      // Anyone previously present but absent now has left; drop their cursor
      // rather than leaving a ghost on the canvas.
      const stale = editor.store
        .allRecords()
        .filter(
          (record): record is TLInstancePresence =>
            record.typeName === InstancePresenceRecordType.typeName && !seen.has(record.id),
        )
        .map((record) => record.id);

      if (incoming.length === 0 && stale.length === 0) return;

      editor.store.mergeRemoteChanges(() => {
        if (stale.length > 0) editor.store.remove(stale);
        if (incoming.length > 0) editor.store.put(incoming);
      });
    };

    awareness.on("change", applyOthers);
    applyOthers();

    return () => {
      stopPublishing();
      awareness.off("change", applyOthers);
      // Clear our own presence so collaborators do not see a stale cursor.
      awareness.setLocalStateField("presence", null);
    };
  }, [editor, user, enabled, room]);
}
