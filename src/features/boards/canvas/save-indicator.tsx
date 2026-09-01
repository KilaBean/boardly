"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import type { SaveStatus } from "./use-board-persistence";

const LABELS: Record<Exclude<SaveStatus, "idle">, string> = {
  saving: "Saving…",
  saved: "All changes saved",
  error: "Could not save — retrying on your next change",
};

/**
 * Save state, announced rather than merely coloured.
 *
 * `aria-live="polite"` matters here: a silent failure indicator is worthless
 * to anyone not watching that corner of the screen, and losing work is the one
 * failure a canvas app cannot be quiet about.
 */
export function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "bg-background/90 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shadow-sm backdrop-blur transition-opacity",
        status === "idle" && "opacity-0",
        status === "error" && "border-destructive/40 text-destructive",
        status === "saved" && "text-muted-foreground",
      )}
    >
      {status === "saving" ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
      {status === "saved" ? <Check className="size-3" aria-hidden="true" /> : null}
      {status === "error" ? <AlertCircle className="size-3" aria-hidden="true" /> : null}
      <span>{status === "idle" ? "" : LABELS[status]}</span>
    </div>
  );
}
