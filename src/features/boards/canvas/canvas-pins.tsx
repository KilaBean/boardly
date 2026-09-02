"use client";

import { Check, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";

import type { CanvasTransform } from "./use-canvas-transform";

/**
 * Pins anchored to points on the canvas.
 *
 * Rendered as an overlay above the canvas rather than through an editor slot —
 * Excalidraw draws to a `<canvas>` and has no equivalent hook, so the pins are
 * real DOM positioned by the same transform the canvas uses.
 *
 * Positions are stored in *scene* space (the board's own coordinate system)
 * and converted on every pan and zoom — storing viewport coordinates would
 * strand every pin the moment somebody scrolled.
 *
 * Deliberately takes plain data rather than comment records: the canvas folder
 * stays free of feature imports, so comments could be replaced without
 * touching canvas integration code.
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
  transform,
  activePinId,
  onSelect,
}: {
  pins: CanvasPin[];
  transform: CanvasTransform;
  activePinId?: string | null;
  onSelect?: (pinId: string) => void;
}) {
  if (pins.length === 0) return null;

  const { scrollX, scrollY, zoom } = transform;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pins.map((pin) => {
        // Excalidraw's own transform is `(scene + scroll) * zoom + offset`.
        // The offset places it in the browser viewport; this overlay shares the
        // canvas's box, so it cancels out and is left off.
        const left = (pin.x + scrollX) * zoom;
        const top = (pin.y + scrollY) * zoom;

        return (
          <button
            key={pin.id}
            type="button"
            onClick={() => onSelect?.(pin.id)}
            aria-label={`Comment: ${pin.label}`}
            aria-pressed={activePinId === pin.id}
            style={{ left, top }}
            className={cn(
              "pointer-events-auto absolute z-[5] flex size-6 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none border shadow-sm transition-transform",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              pin.resolved
                ? "bg-muted text-muted-foreground"
                : "bg-primary text-primary-foreground",
              activePinId === pin.id && "scale-110 ring-2 ring-offset-1",
            )}
          >
            {pin.resolved ? (
              <Check className="size-3" aria-hidden="true" />
            ) : (
              <MessageSquare className="size-3" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
