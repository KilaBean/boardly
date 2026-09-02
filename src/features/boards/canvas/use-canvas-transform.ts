"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useState } from "react";

/**
 * The scene-to-viewport transform: everything needed to place an overlay on
 * top of the canvas and keep it glued to the drawing.
 */
export type CanvasTransform = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
};

const IDENTITY: CanvasTransform = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  offsetLeft: 0,
  offsetTop: 0,
  width: 0,
  height: 0,
};

function sameTransform(a: CanvasTransform, b: CanvasTransform): boolean {
  return (
    a.scrollX === b.scrollX &&
    a.scrollY === b.scrollY &&
    a.zoom === b.zoom &&
    a.offsetLeft === b.offsetLeft &&
    a.offsetTop === b.offsetTop &&
    a.width === b.width &&
    a.height === b.height
  );
}

/**
 * Tracks the canvas transform so anchored overlays follow pan and zoom.
 *
 * Excalidraw's `onChange` fires on every pointer move, so this compares the
 * seven numbers it cares about and only sets state when one actually differs —
 * otherwise every stroke would re-render the whole overlay.
 */
export function useCanvasTransform(api: ExcalidrawImperativeAPI | null): CanvasTransform {
  const [transform, setTransform] = useState<CanvasTransform>(IDENTITY);

  useEffect(() => {
    if (!api) return;

    const read = () => {
      const state = api.getAppState();
      const next: CanvasTransform = {
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        zoom: state.zoom.value,
        offsetLeft: state.offsetLeft,
        offsetTop: state.offsetTop,
        width: state.width,
        height: state.height,
      };
      setTransform((current) => (sameTransform(current, next) ? current : next));
    };

    read();

    // Both are needed: scrolling and zooming report through `onScrollChange`,
    // while a container resize only shows up in the wider change stream.
    const unsubscribeChange = api.onChange(read);
    const unsubscribeScroll = api.onScrollChange(read);

    return () => {
      unsubscribeChange();
      unsubscribeScroll();
    };
  }, [api]);

  return transform;
}
