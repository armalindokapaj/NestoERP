"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

const KEY_STEP = 16;

/**
 * A vertical splitter between an editor side panel and the viewport (3D
 * Editor PRD §57, §59). Dragging keeps the pointer captured on the handle so
 * the 3D canvas underneath never sees the drag; arrow keys resize too.
 *
 * `edge` is the panel's edge the handle sits on: a left panel grows as the
 * handle moves right, a right panel as it moves left.
 */
export function ResizeHandle({
  label,
  edge,
  width,
  min,
  max,
  onResize,
}: {
  label: string;
  edge: "right" | "left";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
}) {
  const drag = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const [active, setActive] = React.useState(false);
  const direction = edge === "right" ? 1 : -1;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width };
        setActive(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onResize(drag.current.startWidth + (event.clientX - drag.current.startX) * direction);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(width - KEY_STEP * direction);
        else if (event.key === "ArrowRight") onResize(width + KEY_STEP * direction);
        else return;
        event.preventDefault();
      }}
      className={cn(
        "relative z-10 w-1 shrink-0 cursor-col-resize touch-none bg-neutral-800 outline-none transition-colors",
        "hover:bg-indigo-500/60 focus-visible:bg-indigo-400",
        active && "bg-indigo-400",
      )}
    />
  );
}
