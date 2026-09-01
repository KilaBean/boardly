"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

import type { BoardCanvasProps } from "./board-canvas";

function CanvasSkeleton() {
  return (
    <div className="relative flex-1" aria-hidden="true">
      <div className="absolute inset-0 space-y-4 p-4">
        <Skeleton className="mx-auto h-10 w-72 rounded-full" />
        <Skeleton className="h-[calc(100%-4rem)] w-full rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Loads the canvas on the client only.
 *
 * tldraw is by far the largest dependency in the app and it measures DOM nodes
 * on mount, so server rendering it would cost a large payload on every page
 * that links to a board and still produce markup that is thrown away.
 * `ssr: false` keeps it out of the server bundle entirely; the dashboard
 * therefore never pays for it.
 */
const BoardCanvasClient = dynamic(
  () => import("./board-canvas").then((module) => module.BoardCanvas),
  { ssr: false, loading: () => <CanvasSkeleton /> },
);

/**
 * Props come from the canvas itself rather than being restated here — a
 * duplicated shape silently drops new props instead of failing to compile,
 * which is exactly what happened when comment pins were added.
 */
export function BoardCanvasLoader(props: BoardCanvasProps) {
  return <BoardCanvasClient {...props} />;
}
