import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

/**
 * The durable shape of a board's canvas.
 *
 * Deliberately narrower than Excalidraw's own `ExcalidrawInitialDataState`: a
 * saved board is the drawing plus the one piece of appearance that belongs to
 * the board rather than to the person looking at it. Scroll position, zoom,
 * selection and the active tool are all per-viewer and must never be restored
 * from somebody else's session.
 *
 * Stored as opaque `jsonb`, so nothing in Postgres depends on this shape.
 */
export type BoardScene = {
  elements: OrderedExcalidrawElement[];
  appState?: {
    viewBackgroundColor?: string;
  };
  /**
   * Pasted and dropped images, inlined as data URLs.
   *
   * They ride along in the snapshot because an image element without its file
   * renders as a broken placeholder, so splitting them would mean a board that
   * reloads visibly incomplete. The action's 5MB cap applies to the whole
   * scene, which makes an image-heavy board the realistic way to hit it —
   * moving files to Supabase Storage is the fix when that becomes a problem.
   */
  files?: BinaryFiles;
};

/** Looks like an Excalidraw element: enough to reject anything else. */
function isElementLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const element = value as Record<string, unknown>;
  return typeof element.id === "string" && typeof element.type === "string";
}

/**
 * Reads a stored snapshot back into a scene, or null if it is not one.
 *
 * Returns null rather than throwing for anything unrecognised, and an empty
 * board is the correct fallback for a snapshot we cannot read: refusing to
 * render at all would turn one bad row into a broken page.
 *
 * The case that matters in practice is a snapshot written by the previous
 * canvas library, which stored `{ store, schema }` rather than elements. Those
 * cannot be migrated — the two libraries have no shared document model — so
 * they are treated as unreadable rather than silently rendering blank and
 * being overwritten without anyone noticing.
 */
export function parseScene(value: unknown): BoardScene | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.elements)) return null;

  const elements = candidate.elements.filter(isElementLike) as OrderedExcalidrawElement[];

  const appState =
    typeof candidate.appState === "object" && candidate.appState !== null
      ? (candidate.appState as Record<string, unknown>)
      : undefined;

  const viewBackgroundColor = appState?.viewBackgroundColor;

  const files =
    typeof candidate.files === "object" &&
    candidate.files !== null &&
    !Array.isArray(candidate.files)
      ? (candidate.files as BinaryFiles)
      : undefined;

  return {
    elements,
    ...(typeof viewBackgroundColor === "string" ? { appState: { viewBackgroundColor } } : {}),
    ...(files ? { files } : {}),
  };
}

/** True for a snapshot written by the pre-Excalidraw canvas. */
export function isLegacyTldrawSnapshot(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return "store" in candidate && "schema" in candidate;
}
