"use client";

import { useEditor } from "@tldraw/editor";
import { useValue } from "@tldraw/state-react";
import { Check, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Pins anchored to points on the canvas.
 *
 * Rendered through tldraw's `InFrontOfTheCanvas` slot so they sit above shapes
 * but below the toolbar. Positions are stored in *page* space (the board's own
 * coordinate system) and converted to screen space on every camera change —
 * storing screen coordinates would strand every pin the moment somebody
 * zoomed.
 *
 * Deliberately takes plain data rather than comment records: the canvas folder
 * stays free of feature imports, so comments could be replaced without
 * touching tldraw integration code.
 */

export type CanvasPin = {
  id: string;
  x: number;
  y: number;
  resolved: boolean;
  /** Accessible label — pins are not distinguishable by position alone. */
  label: string;
};

export function CanvasPins({
  pins,
  activePinId,
  onSelect,
}: {
  pins: CanvasPin[];
  activePinId?: string | null;
  onSelect?: (pinId: string) => void;
}) {
  const editor = useEditor();

  // Re-runs whenever the camera moves, which is what keeps pins glued to the
  // board rather than to the viewport.
  const positioned = useValue(
    "pin-screen-positions",
    () => {
      // Reading the camera registers the dependency.
      editor.getCamera();
      return pins.map((pin) => {
        const point = editor.pageToScreen({ x: pin.x, y: pin.y });
        return { pin, left: point.x, top: point.y };
      });
    },
    [editor, pins],
  );

  if (positioned.length === 0) return null;

  return (
    <>
      {positioned.map(({ pin, left, top }) => (
        <button
          key={pin.id}
          type="button"
          onClick={() => onSelect?.(pin.id)}
          aria-label={`Comment: ${pin.label}`}
          aria-pressed={activePinId === pin.id}
          style={{ left, top }}
          className={cn(
            "pointer-events-auto absolute z-[250] flex size-6 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none border shadow-sm transition-transform",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            pin.resolved ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
            activePinId === pin.id && "scale-110 ring-2 ring-offset-1",
          )}
        >
          {pin.resolved ? (
            <Check className="size-3" aria-hidden="true" />
          ) : (
            <MessageSquare className="size-3" aria-hidden="true" />
          )}
        </button>
      ))}
    </>
  );
}
