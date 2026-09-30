"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * PdfViewer (MOB-07 §16-§20). pdf.js, loaded only when a PDF is opened.
 *
 * - Pages are placeholders until they scroll near the viewport; only those
 *   pages hold a canvas, and a page far away drops its canvas again, so a
 *   300-page drawing set costs a handful of bitmaps, not 300 (§19).
 * - The document is fetched with range requests where the server allows it, so
 *   page 1 appears before the file has finished (progressive loading).
 * - Fit-width is the default; zoom is +/- or a two-finger pinch, and a zoomed
 *   page pans by scrolling (touch-action leaves the pinch to us, not the browser).
 * - The URL is the short-lived grant NESTO issued; nothing here knows where the
 *   bytes live (§20, §71).
 */

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

const MAX_ZOOM = 4;
const MIN_ZOOM = 1;
/** Pages kept rendered either side of the viewport (as a multiple of its height). */
const RENDER_MARGIN = "150% 0px";

export type PdfViewerLabels = {
  loading: string;
  error: string;
  page: (current: number, total: number) => string;
  previous: string;
  next: string;
  zoomIn: string;
  zoomOut: string;
  fitWidth: string;
  pageLabel: (n: number) => string;
};

export function PdfViewer({
  url,
  labels,
  onFailed,
  className,
}: {
  url: string;
  labels: PdfViewerLabels;
  onFailed?: (error: unknown) => void;
  className?: string;
}) {
  const [pdf, setPdf] = React.useState<PdfDoc | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [current, setCurrent] = React.useState(1);
  const [zoom, setZoom] = React.useState(1);
  const [width, setWidth] = React.useState(0);
  const [ratio, setRatio] = React.useState(1.414);
  const scroller = React.useRef<HTMLDivElement>(null);
  const onFailedRef = React.useRef(onFailed);
  onFailedRef.current = onFailed;

  React.useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    let task: { destroy: () => Promise<void> } | null = null;
    setPdf(null);
    setFailed(false);
    setCurrent(1);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const loading = pdfjs.getDocument({ url, disableAutoFetch: true });
        task = loading;
        loaded = await loading.promise;
        if (cancelled) return;
        const first = await loaded.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setRatio(viewport.height / viewport.width);
        setPdf(loaded);
      } catch (error) {
        if (cancelled) return;
        setFailed(true);
        onFailedRef.current?.(error);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => undefined);
    };
  }, [url]);

  React.useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    setWidth(node.clientWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pdf]);

  // Pinch: two pointers change the zoom; one pointer is an ordinary pan.
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = React.useRef<{ distance: number; zoom: number } | null>(null);
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));

  if (failed) {
    return (
      <p role="alert" className="m-4 rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted" data-testid="pdf-viewer-error">
        {labels.error}
      </p>
    );
  }

  if (!pdf) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-table text-fg-muted" role="status" data-testid="pdf-viewer-loading">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {labels.loading}
      </div>
    );
  }

  const pageWidth = Math.max(0, width - 16) * zoom;
  const go = (page: number) => {
    const target = Math.min(pdf.numPages, Math.max(1, page));
    scroller.current?.querySelector<HTMLElement>(`[data-page="${target}"]`)?.scrollIntoView({ block: "start" });
    setCurrent(target);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} data-testid="pdf-viewer">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto bg-surface-muted"
        style={{ touchAction: "pan-x pan-y" }}
        onPointerDown={(event) => {
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2) pinchStart.current = { distance: distance(), zoom };
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2 && pinchStart.current && pinchStart.current.distance > 0) {
            setZoom(clamp(pinchStart.current.zoom * (distance() / pinchStart.current.distance)));
          }
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          pinchStart.current = null;
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          pinchStart.current = null;
        }}
      >
        <div className="mx-auto flex flex-col items-center gap-2 py-2" style={{ width: pageWidth + 16 }}>
          {Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index + 1}
              pdf={pdf}
              number={index + 1}
              width={pageWidth}
              ratio={ratio}
              label={labels.pageLabel(index + 1)}
              root={scroller}
              onVisible={setCurrent}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line bg-surface px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label={labels.previous} disabled={current <= 1} onClick={() => go(current - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="min-w-[4.5rem] text-center text-table tabular-nums text-fg" aria-live="polite" data-testid="pdf-page-indicator">
            {labels.page(current, pdf.numPages)}
          </p>
          <Button type="button" variant="ghost" size="icon" aria-label={labels.next} disabled={current >= pdf.numPages} onClick={() => go(current + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label={labels.zoomOut} disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => clamp(z - 0.5))}>
            <Minus aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={labels.fitWidth} disabled={zoom === 1} onClick={() => setZoom(1)}>
            <ScanLine aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={labels.zoomIn} disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((z) => clamp(z + 0.5))}>
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One page: a sized placeholder that holds a canvas only while it is near the viewport. */
function PdfPage({
  pdf,
  number,
  width,
  ratio,
  label,
  root,
  onVisible,
}: {
  pdf: PdfDoc;
  number: number;
  width: number;
  ratio: number;
  label: string;
  root: React.RefObject<HTMLDivElement | null>;
  onVisible: (page: number) => void;
}) {
  const holder = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [near, setNear] = React.useState(false);
  const [height, setHeight] = React.useState(Math.round(width * ratio));

  React.useEffect(() => setHeight(Math.round(width * ratio)), [width, ratio]);

  React.useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => setNear(entries.some((entry) => entry.isIntersecting)), {
      root: root.current,
      rootMargin: RENDER_MARGIN,
    });
    observer.observe(node);
    // The page that crosses the middle of the viewport is "the current page".
    const middle = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisible(number);
      },
      { root: root.current, rootMargin: "-50% 0px -50% 0px" },
    );
    middle.observe(node);
    return () => {
      observer.disconnect();
      middle.disconnect();
    };
  }, [root, number, onVisible]);

  React.useEffect(() => {
    if (!near || width <= 0) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const element = canvas.current;
    void (async () => {
      try {
        const page = await pdf.getPage(number);
        if (cancelled || !canvas.current) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });
        const target = canvas.current;
        target.width = Math.floor(viewport.width);
        target.height = Math.floor(viewport.height);
        target.style.width = `${Math.floor(viewport.width / dpr)}px`;
        target.style.height = `${Math.floor(viewport.height / dpr)}px`;
        setHeight(Math.floor(viewport.height / dpr));
        const context = target.getContext("2d");
        if (!context) return;
        renderTask = page.render({ canvas: target, canvasContext: context, viewport });
        await renderTask.promise;
      } catch {
        // A cancelled render (the page scrolled away) is expected; a failed one leaves the placeholder.
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      const target = element;
      if (target) {
        // Release the bitmap of a page that is no longer near.
        target.width = 0;
        target.height = 0;
      }
    };
  }, [near, pdf, number, width]);

  return (
    <div
      ref={holder}
      data-page={number}
      role="img"
      aria-label={label}
      className="relative overflow-hidden bg-white shadow-sm"
      style={{ width, height }}
    >
      {near ? <canvas ref={canvas} className="block" /> : null}
    </div>
  );
}
