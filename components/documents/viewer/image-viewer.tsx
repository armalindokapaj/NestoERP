"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * ImageViewer (MOB-07 §23). Pinch or +/- to zoom, drag to pan, and optional
 * previous/next for a set of evidence photos. The image is whatever URL the
 * caller resolved through `resolveAccess`; nothing here reads storage.
 */

const MIN = 1;
const MAX = 5;

export type ImageViewerLabels = {
  zoomIn: string;
  zoomOut: string;
  previous: string;
  next: string;
  position: (index: number, total: number) => string;
  failed: string;
};

export function ImageViewer({
  src,
  alt,
  labels,
  position,
  onPrevious,
  onNext,
  className,
}: {
  src: string;
  alt: string;
  labels: ImageViewerLabels;
  position?: { index: number; total: number };
  onPrevious?: () => void;
  onNext?: () => void;
  className?: string;
}) {
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [failed, setFailed] = React.useState(false);
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<{ distance: number; zoom: number } | null>(null);
  const drag = React.useRef<{ x: number; y: number; origin: { x: number; y: number } } | null>(null);

  React.useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setFailed(false);
  }, [src]);

  const clamp = (value: number) => Math.min(MAX, Math.max(MIN, Math.round(value * 100) / 100));
  const setZoomSafe = (next: number) => {
    const value = clamp(next);
    setZoom(value);
    if (value === 1) setOffset({ x: 0, y: 0 });
  };
  const span = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col bg-black", className)} data-testid="image-viewer">
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2) gesture.current = { distance: span(), zoom };
          else drag.current = { x: event.clientX, y: event.clientY, origin: offset };
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2 && gesture.current && gesture.current.distance > 0) {
            setZoomSafe(gesture.current.zoom * (span() / gesture.current.distance));
          } else if (pointers.current.size === 1 && drag.current && zoom > 1) {
            setOffset({ x: drag.current.origin.x + event.clientX - drag.current.x, y: drag.current.origin.y + event.clientY - drag.current.y });
          }
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          gesture.current = null;
          drag.current = null;
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          gesture.current = null;
          drag.current = null;
        }}
      >
        {failed ? (
          <p role="alert" className="absolute inset-0 flex items-center justify-center px-6 text-center text-table text-white/80">
            {labels.failed}
          </p>
        ) : (
          // A short-lived grant URL: next/image would cache and re-request it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            draggable={false}
            onError={() => setFailed(true)}
            className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: "center" }}
            data-testid="image-viewer-image"
          />
        )}
        {onPrevious ? (
          <Button type="button" variant="secondary" size="icon" className="absolute left-2 top-1/2 -translate-y-1/2" aria-label={labels.previous} onClick={onPrevious}>
            <ChevronLeft aria-hidden="true" />
          </Button>
        ) : null}
        {onNext ? (
          <Button type="button" variant="secondary" size="icon" className="absolute right-2 top-1/2 -translate-y-1/2" aria-label={labels.next} onClick={onNext}>
            <ChevronRight aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 bg-surface px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <p className="px-2 text-table tabular-nums text-fg" aria-live="polite">
          {position ? labels.position(position.index + 1, position.total) : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label={labels.zoomOut} disabled={zoom <= MIN} onClick={() => setZoomSafe(zoom - 0.5)}>
            <Minus aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={labels.zoomIn} disabled={zoom >= MAX} onClick={() => setZoomSafe(zoom + 0.5)}>
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
