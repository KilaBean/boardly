"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tldraw, type Editor, type TLComponents, type TLStoreSnapshot } from "tldraw";

import "tldraw/tldraw.css";

import type { CurrentUser } from "@/lib/auth/dal";

import { BoardRoom } from "./board-room";
import { CanvasPins, type CanvasPin } from "./canvas-pins";
import { Collaborators, ConnectionStatus } from "./connection-status";
import { SaveIndicator } from "./save-indicator";
import { useBoardPersistence } from "./use-board-persistence";
import { usePresence } from "./use-presence";
import { useYjsBinding } from "./use-yjs-binding";

export type BoardCanvasProps = {
  boardId: string;
  /** Last saved tldraw document, or null for a fresh board. */
  initialDocument: TLStoreSnapshot | null;
  canEdit: boolean;
  user: CurrentUser | null;
  /**
   * Join the board's Liveblocks room. False for the public share view, which
   * renders a snapshot for an anonymous visitor who has no room access at all.
   */
  collaborative?: boolean;
  /** Anchored comment markers. Plain data — the canvas knows nothing of comments. */
  pins?: CanvasPin[];
  activePinId?: string | null;
  onSelectPin?: (pinId: string) => void;
  /** While true, the next canvas click reports a page-space point instead. */
  pinMode?: boolean;
  onPlacePin?: (point: { x: number; y: number }) => void;
  /** Page-space point to bring into view, e.g. from "Show on board". */
  focusPoint?: { x: number; y: number } | null;
};

/**
 * The tldraw canvas, isolated behind one component.
 *
 * Two modes, split into separate components rather than branching inside one:
 * the collaborative mode uses hooks the static mode must not call, and hooks
 * cannot be called conditionally.
 *
 *   - **Collaborative** — Yjs document (live state), awareness (cursors), and
 *     Postgres snapshots (durable backup).
 *   - **Static** — a snapshot rendered read-only. No room, no presence, no
 *     writes.
 */
export function BoardCanvas({ collaborative = true, ...props }: BoardCanvasProps) {
  if (!collaborative) {
    return <StaticCanvas {...props} />;
  }

  return (
    <BoardRoom boardId={props.boardId}>
      <CollaborativeCanvas {...props} />
    </BoardRoom>
  );
}

/** Shared mount behaviour: seed the snapshot, apply read-only, expose editor. */
function useCanvasMount(initialDocument: TLStoreSnapshot | null, canEdit: boolean) {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleMount = useCallback(
    (mountedEditor: Editor) => {
      if (initialDocument) {
        mountedEditor.loadSnapshot({ document: initialDocument });
      }

      // tldraw enforces this internally — hiding the UI alone would leave
      // keyboard shortcuts and paste working for a viewer.
      if (!canEdit) {
        mountedEditor.updateInstanceState({ isReadonly: true });
      }

      setEditor(mountedEditor);
    },
    [initialDocument, canEdit],
  );

  return { editor, handleMount };
}

/**
 * Pin placement and camera focus.
 *
 * Placement listens on the container in the capture phase so the click is
 * intercepted before tldraw's own tools act on it — otherwise dropping a pin
 * would also draw a shape.
 */
function useCanvasPinInteractions({
  editor,
  pinMode,
  onPlacePin,
  focusPoint,
}: {
  editor: Editor | null;
  pinMode?: boolean;
  onPlacePin?: (point: { x: number; y: number }) => void;
  focusPoint?: { x: number; y: number } | null;
}) {
  useEffect(() => {
    if (!editor || !pinMode || !onPlacePin) return;

    const container = editor.getContainer();
    const handlePointerDown = (event: PointerEvent) => {
      // Ignore clicks on tldraw's own UI (toolbar, menus).
      if ((event.target as HTMLElement | null)?.closest(".tlui-layout__top")) return;

      event.preventDefault();
      event.stopPropagation();

      // Page space, not screen space: a pin must survive pan and zoom.
      const point = editor.inputs.currentPagePoint;
      onPlacePin({ x: point.x, y: point.y });
    };

    container.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    };
  }, [editor, pinMode, onPlacePin]);

  useEffect(() => {
    if (!editor || !focusPoint) return;
    editor.centerOnPoint(focusPoint, { animation: { duration: 200 } });
  }, [editor, focusPoint]);
}

function CanvasSurface({
  handleMount,
  overlay,
  components,
  pinMode,
}: {
  handleMount: (editor: Editor) => void;
  overlay?: React.ReactNode;
  components?: TLComponents;
  pinMode?: boolean;
}) {
  return (
    <div className="relative flex-1">
      {/* tldraw measures its container, so it needs one with real dimensions. */}
      <div
        className="absolute inset-0"
        // A crosshair is the only affordance telling someone the next click
        // drops a pin rather than draws.
        style={pinMode ? { cursor: "crosshair" } : undefined}
      >
        <Tldraw onMount={handleMount} components={components} />
      </div>

      {overlay ? (
        // z-index clears tldraw's own UI layers.
        <div className="pointer-events-none absolute top-2 right-2 z-[300] flex items-center gap-2">
          {overlay}
        </div>
      ) : null}
    </div>
  );
}

function CollaborativeCanvas({
  boardId,
  initialDocument,
  canEdit,
  user,
  pins,
  activePinId,
  onSelectPin,
  pinMode,
  onPlacePin,
  focusPoint,
}: Omit<BoardCanvasProps, "collaborative">) {
  const { editor, handleMount } = useCanvasMount(initialDocument, canEdit);

  const { synced, restoredFromRoom } = useYjsBinding({ editor, enabled: true });
  usePresence({ editor, user, enabled: true });
  useCanvasPinInteractions({ editor, pinMode, onPlacePin, focusPoint });

  // `synced` gates the write, not the listening: a snapshot taken before the
  // room arrives could be missing a collaborator's newer content, but changes
  // made while waiting still have to be remembered. See use-board-persistence.
  const { status } = useBoardPersistence({
    editor,
    boardId,
    enabled: canEdit,
    synced,
    // A board with no snapshot whose content came out of the room has never
    // been persisted. Bounded to that case on purpose: once the backfill save
    // lands there is a snapshot, so a later visit does not repeat it.
    backfill: initialDocument === null && restoredFromRoom,
  });

  // Memoized because tldraw remounts the slot whenever this object identity
  // changes, which would make pins flicker on every render.
  const components = useMemo<TLComponents>(
    () => ({
      InFrontOfTheCanvas: () => (
        <CanvasPins pins={pins ?? []} activePinId={activePinId} onSelect={onSelectPin} />
      ),
    }),
    [pins, activePinId, onSelectPin],
  );

  return (
    <CanvasSurface
      handleMount={handleMount}
      components={components}
      pinMode={pinMode}
      overlay={
        <>
          <Collaborators />
          <ConnectionStatus />
          {canEdit ? <SaveIndicator status={status} /> : null}
        </>
      }
    />
  );
}

/**
 * Read-only snapshot view for a public share link.
 *
 * Never joins a room and never writes. `canEdit` is ignored on purpose — a
 * share link is view-only regardless of what the visitor's account could do
 * elsewhere.
 */
function StaticCanvas({ initialDocument }: Omit<BoardCanvasProps, "collaborative">) {
  const { handleMount } = useCanvasMount(initialDocument, false);
  return <CanvasSurface handleMount={handleMount} />;
}
