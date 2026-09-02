"use client";

import { Excalidraw, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";

import "@excalidraw/excalidraw/index.css";

import type { CurrentUser } from "@/lib/auth/dal";

import { BoardRoom } from "./board-room";
import { CanvasPins, type CanvasPin } from "./canvas-pins";
import { Collaborators, ConnectionStatus } from "./connection-status";
import { SaveIndicator } from "./save-indicator";
import type { BoardScene } from "./scene";
import { useBoardPersistence } from "./use-board-persistence";
import { useCanvasTransform, type CanvasTransform } from "./use-canvas-transform";
import { usePresence, type PointerPayload } from "./use-presence";
import { useYjsBinding } from "./use-yjs-binding";

export type BoardCanvasProps = {
  boardId: string;
  /** Last saved scene, or null for a fresh board. */
  initialScene: BoardScene | null;
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
  /** While true, the next canvas click reports a scene-space point instead. */
  pinMode?: boolean;
  onPlacePin?: (point: { x: number; y: number }) => void;
  /** Scene-space point to bring into view, e.g. from "Show on board". */
  focusPoint?: { x: number; y: number } | null;
};

/**
 * The Excalidraw canvas, isolated behind one component.
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

/**
 * `initialData` is read once, when Excalidraw mounts.
 *
 * Only the board's own appearance is restored. Scroll, zoom, selection and the
 * active tool are per-viewer; `scrollToContent` then frames whatever is on the
 * board so a returning visitor lands on the drawing rather than on empty space
 * wherever the last person happened to be.
 */
function useInitialData(scene: BoardScene | null) {
  return useMemo(
    () => ({
      elements: scene?.elements ?? [],
      appState: {
        ...(scene?.appState?.viewBackgroundColor
          ? { viewBackgroundColor: scene.appState.viewBackgroundColor }
          : {}),
      },
      ...(scene?.files ? { files: scene.files } : {}),
      scrollToContent: true,
    }),
    [scene],
  );
}

/**
 * Pin placement and camera focus.
 *
 * Placement listens on the wrapper in the capture phase so the click is
 * intercepted before Excalidraw's own tools act on it — otherwise dropping a
 * pin would also draw a shape.
 */
function useCanvasPinInteractions({
  api,
  container,
  transform,
  pinMode,
  onPlacePin,
  focusPoint,
}: {
  api: ExcalidrawImperativeAPI | null;
  container: HTMLDivElement | null;
  transform: CanvasTransform;
  pinMode?: boolean;
  onPlacePin?: (point: { x: number; y: number }) => void;
  focusPoint?: { x: number; y: number } | null;
}) {
  useEffect(() => {
    if (!api || !container || !pinMode || !onPlacePin) return;

    const handlePointerDown = (event: PointerEvent) => {
      // Ignore clicks on Excalidraw's own UI (toolbar, panels, menus).
      if (
        (event.target as HTMLElement | null)?.closest(".excalidraw .App-menu, .excalidraw .Island")
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const state = api.getAppState();
      // Scene space, not viewport space: a pin must survive pan and zoom.
      const point = viewportCoordsToSceneCoords(
        { clientX: event.clientX, clientY: event.clientY },
        state,
      );
      onPlacePin({ x: point.x, y: point.y });
    };

    container.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    };
  }, [api, container, pinMode, onPlacePin]);

  useEffect(() => {
    if (!api || !focusPoint) return;

    const { zoom, width, height } = transform;
    if (width === 0 || height === 0) return;

    // Inverse of Excalidraw's `(scene + scroll) * zoom + offset`, solved for
    // the scroll that puts the point in the middle of the canvas.
    api.updateScene({
      appState: {
        scrollX: width / 2 / zoom - focusPoint.x,
        scrollY: height / 2 / zoom - focusPoint.y,
      },
    });
    // Intentionally not depending on `transform`: this must fire when a pin is
    // chosen, not every time the viewport moves, or the camera would be pinned
    // in place and panning would be impossible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, focusPoint]);
}

function CanvasSurface({
  onApi,
  initialData,
  readOnly,
  overlay,
  pins,
  transform,
  activePinId,
  onSelectPin,
  pinMode,
  onPointerUpdate,
  containerRef,
  isCollaborating,
}: {
  onApi: (api: ExcalidrawImperativeAPI) => void;
  initialData: ReturnType<typeof useInitialData>;
  readOnly: boolean;
  overlay?: React.ReactNode;
  pins?: CanvasPin[];
  transform: CanvasTransform;
  activePinId?: string | null;
  onSelectPin?: (pinId: string) => void;
  pinMode?: boolean;
  onPointerUpdate?: (payload: PointerPayload) => void;
  containerRef: (node: HTMLDivElement | null) => void;
  isCollaborating?: boolean;
}) {
  const { resolvedTheme } = useTheme();

  return (
    <div className="relative flex-1">
      {/* Excalidraw measures its container, so it needs one with real dimensions. */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        // A crosshair is the only affordance telling someone the next click
        // drops a pin rather than draws.
        style={pinMode ? { cursor: "crosshair" } : undefined}
      >
        <Excalidraw
          excalidrawAPI={onApi}
          initialData={initialData}
          viewModeEnabled={readOnly}
          isCollaborating={isCollaborating}
          onPointerUpdate={onPointerUpdate}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          // Excalidraw lays this out beside its own top-right controls. An
          // absolutely-positioned overlay of ours sat on top of the Library
          // button instead, which is the sort of thing that only shows up in a
          // screenshot.
          renderTopRightUI={overlay ? () => <>{overlay}</> : undefined}
          UIOptions={{
            canvasActions: {
              // The board lives in Postgres and the room, not in a local file:
              // "load from file" would silently replace everyone's canvas.
              loadScene: false,
              saveToActiveFile: false,
            },
          }}
        />

        <CanvasPins
          pins={pins ?? []}
          transform={transform}
          activePinId={activePinId}
          onSelect={onSelectPin}
        />
      </div>
    </div>
  );
}

function CollaborativeCanvas({
  boardId,
  initialScene,
  canEdit,
  user,
  pins,
  activePinId,
  onSelectPin,
  pinMode,
  onPlacePin,
  focusPoint,
}: Omit<BoardCanvasProps, "collaborative">) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const initialData = useInitialData(initialScene);

  const transform = useCanvasTransform(api);
  const { synced } = useYjsBinding({ api, enabled: true });
  const { onPointerUpdate } = usePresence({ api, user, enabled: true });
  useCanvasPinInteractions({ api, container, transform, pinMode, onPlacePin, focusPoint });

  // `synced` gates the write, not the listening: a snapshot taken before the
  // room arrives could be missing a collaborator's newer content, but changes
  // made while waiting still have to be remembered. See use-board-persistence.
  const { status } = useBoardPersistence({ api, boardId, enabled: canEdit, synced });

  return (
    <CanvasSurface
      onApi={setApi}
      containerRef={setContainer}
      initialData={initialData}
      readOnly={!canEdit}
      isCollaborating
      onPointerUpdate={onPointerUpdate}
      pins={pins}
      transform={transform}
      activePinId={activePinId}
      onSelectPin={onSelectPin}
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
function StaticCanvas({ initialScene }: Omit<BoardCanvasProps, "collaborative">) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const initialData = useInitialData(initialScene);
  const transform = useCanvasTransform(api);

  return (
    <CanvasSurface
      onApi={setApi}
      containerRef={() => {}}
      initialData={initialData}
      readOnly
      transform={transform}
    />
  );
}
