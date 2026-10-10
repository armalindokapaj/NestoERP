"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { restoreFocusAfterClose } from "@/lib/a11y/overlay-focus";
import { topbarContentBox, topbarLine } from "@/lib/layout/topbar-line";
import { cn } from "@/lib/utils/cn";

/**
 * The shell's glass panel (search).
 *
 * A slab of liquid glass in the manner of Apple's: the page behind it stays
 * where it is and stays readable — nothing outside the panel is blurred or
 * blocked — while the slab itself frosts what is under its face and bends it
 * through its rim, so the corners carry a turned, compressed image of the page.
 * A bright edge catches the light, strongest at the top-left and bottom-right.
 *
 * It grows out of the control that opened it and travels back into it on close.
 * It starts on the breadcrumb bar's top line (lib/layout/topbar-line.ts), takes
 * a third of the page's width and sits in the middle of it. A phone gets the
 * whole screen.
 *
 * The bending is an SVG displacement filter used as a backdrop filter, which
 * only Chromium draws; every other browser gets the same slab, frosted, with
 * its edge light and no bend. The look is in `styles/globals.css`
 * (`.nesto-liquid-glass`).
 */

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** The slab's corner radius and the width of the rim that bends the page, in px. */
const RADIUS = 26;
const BEZEL = 18;
/** How far, at most, the rim reaches into the page for what it shows, in px. */
const BEND = 84;
/** Red, green and blue are bent a hair differently, which is what gives real glass its faint coloured fringe. */
const FRINGE = [1, 0.994, 0.988] as const;
/** The frost under the slab's face; the CSS fallback uses the same figure. */
const FROST = 18;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Chromium draws an SVG filter as a backdrop filter; WebKit and Gecko ignore it, and iOS browsers are all WebKit. */
function canRefract() {
  const data = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData;
  return Boolean(data?.brands?.some((entry) => entry.brand === "Chromium")) && !window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
}

/** Below this width the panel is the whole screen, placed by CSS (see `PHONE` below). */
const PHONE_MAX = 640;

function measure(trigger: Element | null, share: number, minWidth: number): React.CSSProperties | undefined {
  if (typeof window === "undefined") return undefined;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < PHONE_MAX) return undefined;
  const top = topbarLine(trigger) ?? 72;
  const box = topbarContentBox(trigger) ?? { left: 16, right: vw - 16 };
  const content = box.right - box.left;
  // A share of the page's width, in the middle of it; never narrower than its own field needs.
  const width = Math.min(content, Math.max(content * share, minWidth));
  return { left: box.left + (content - width) / 2, top, width, maxHeight: vh - top - 24 };
}

/**
 * A phone: the whole visible screen, clear of the notch and the home indicator.
 * "Visible" is the visual viewport — what is left above an open keyboard — which
 * the component writes as two custom properties, so the list of results always
 * ends where the keyboard begins, on iOS and Android alike.
 */
const PHONE =
  "max-sm:inset-x-0 max-sm:top-[var(--nesto-visual-top,0px)] max-sm:h-[var(--nesto-visual-height,100dvh)] max-sm:w-full max-sm:rounded-none max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]";

/** Keeps the two custom properties in step with the visual viewport while the panel is open; returns the undo. */
function followVisualViewport(node: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const apply = () => {
    node.style.setProperty("--nesto-visual-height", `${viewport.height}px`);
    node.style.setProperty("--nesto-visual-top", `${viewport.offsetTop}px`);
  };
  apply();
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);
  return () => {
    viewport.removeEventListener("resize", apply);
    viewport.removeEventListener("scroll", apply);
  };
}

const dataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/**
 * The two pictures the refraction filter reads, drawn for one size of slab.
 *
 * `map` says where each point of the rim looks: red is the reach to the right,
 * blue the reach downwards, mid-grey no reach at all. Both run across the whole
 * slab, so a point on the rim looks towards the middle of the slab — further
 * the nearer it is to a corner — and the grey face, feathered, switches the
 * reach off away from the rim. `rim` is white where the bent picture shows and
 * black where the frost does.
 */
function refractionImages(width: number, height: number) {
  const inner = Math.max(0, RADIUS - BEZEL);
  const face = (fill: string, feather: number) =>
    `<rect x="${BEZEL}" y="${BEZEL}" width="${Math.max(0, width - BEZEL * 2)}" height="${Math.max(0, height - BEZEL * 2)}" rx="${inner}" fill="${fill}" style="filter:blur(${feather}px)"/>`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  const map =
    `${open}<defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#000"/></linearGradient>` +
    `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00f"/><stop offset="1" stop-color="#000"/></linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#r)"/><rect width="${width}" height="${height}" fill="url(#b)" style="mix-blend-mode:screen"/>${face("#808080", 7)}</svg>`;
  const rim = `${open}<rect width="${width}" height="${height}" fill="#fff"/>${face("#000", 6)}</svg>`;
  return { map: dataUri(map), rim: dataUri(rim) };
}

export type GlassPanelControl = { close: () => void };

export function GlassPanel({
  open,
  onOpenChange,
  triggerRef,
  title,
  header,
  children,
  share = 1 / 3,
  minWidth = 352,
  controlRef,
  testId,
}: {
  open: boolean;
  /** `false` arrives once the panel has travelled back into its trigger. */
  onOpenChange: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  /** The dialog's accessible name. */
  title: string;
  /** The fixed top row (a search field); `children` is the body beneath it. */
  header: React.ReactNode;
  children: React.ReactNode;
  /** How much of the page's width the panel takes; it sits in the middle of it. */
  share?: number;
  /** The least it is ever given, so its field never loses its words. */
  minWidth?: number;
  /** Lets the owner close with the animation (a keyboard shortcut, a chosen row). */
  controlRef?: React.MutableRefObject<GlassPanelControl | null>;
  testId?: string;
}) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const closing = React.useRef(false);
  const unfollow = React.useRef<(() => void) | null>(null);
  const filterId = `nesto-liquid-${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  /** The slab's own size, for the refraction pictures; null until it is measured, and on a browser that cannot bend. */
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  /** The bend is switched on once the slab has landed, and off before it leaves: a filter is not dragged through a transform. */
  const [settled, setSettled] = React.useState(false);

  const close = React.useCallback(() => {
    const panel = panelRef.current;
    if (closing.current) return;
    if (!panel) return onOpenChange(false);
    closing.current = true;
    setSettled(false);
    const finish = () => {
      closing.current = false;
      onOpenChange(false);
    };
    const icon = triggerRef.current?.getBoundingClientRect();
    overlayRef.current?.animate({ opacity: [1, 0] }, { duration: 220, easing: "ease-out", fill: "forwards" });
    if (reducedMotion() || !icon || icon.width === 0) {
      panel.animate({ opacity: [1, 0] }, { duration: 120, fill: "forwards" }).finished.then(finish, finish);
      return;
    }
    const to = panel.getBoundingClientRect();
    bodyRef.current?.animate({ opacity: [1, 0] }, { duration: 120, fill: "forwards" });
    panel
      .animate(
        [
          { transform: "none", opacity: 1 },
          { transform: `translate(${icon.left - to.left}px, ${icon.top - to.top}px) scale(${icon.width / to.width}, ${icon.height / to.height})`, opacity: 0 },
        ],
        { duration: 300, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
      )
      .finished.then(finish, finish);
  }, [onOpenChange, triggerRef]);

  React.useEffect(() => {
    if (!controlRef) return;
    controlRef.current = { close };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef, close]);

  // Closed by its owner without the animation (a chosen row, a changed context): nothing is left switched on.
  React.useEffect(() => {
    if (!open) {
      setSettled(false);
      setSize(null);
      closing.current = false;
    }
  }, [open]);

  const attach = React.useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      unfollow.current?.();
      unfollow.current = null;
      if (!node) return;
      if (window.innerWidth < PHONE_MAX) unfollow.current = followVisualViewport(node);
      // Measured at once, so the refraction pictures are drawn and decoded while the slab is still arriving.
      if (canRefract() && window.innerWidth >= PHONE_MAX) setSize({ width: node.offsetWidth, height: node.offsetHeight });
      const land = () => setSettled(true);
      const icon = triggerRef.current?.getBoundingClientRect();
      overlayRef.current?.animate({ opacity: [0, 1] }, { duration: 320, easing: "ease-out" });
      if (reducedMotion() || !icon || icon.width === 0) {
        node.animate({ opacity: [0, 1] }, { duration: 120 }).finished.then(land, land);
        return;
      }
      const to = node.getBoundingClientRect();
      node
        .animate(
          [
            { transform: `translate(${icon.left - to.left}px, ${icon.top - to.top}px) scale(${icon.width / to.width}, ${icon.height / to.height})`, opacity: 0 },
            { opacity: 1, offset: 0.35 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 520, easing: EASE },
        )
        .finished.then(land, land);
      bodyRef.current?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: 520, easing: "ease-out" });
    },
    [triggerRef],
  );

  // The refraction pictures are drawn for the slab's size, and it changes as results arrive.
  React.useEffect(() => {
    const node = panelRef.current;
    if (!open || !node || !canRefract() || window.innerWidth < PHONE_MAX) return;
    const read = () => {
      // offset*, not the bounding box: the entrance scales the slab, and the pictures are for its real size.
      const next = { width: node.offsetWidth, height: node.offsetHeight };
      setSize((current) => (current && current.width === next.width && current.height === next.height ? current : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, settled]);

  const images = React.useMemo(() => (size ? refractionImages(size.width, size.height) : null), [size]);
  // A new id for every size: the browser never keeps the pictures of the last one.
  const sizedFilterId = size ? `${filterId}-${size.width}x${size.height}` : filterId;
  const refract = Boolean(settled && size && images);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        {/* The page stays in view behind the slab: a breath of shade, no blur. */}
        <DialogPrimitive.Overlay ref={overlayRef} className="nesto-liquid-glass-shade fixed inset-0 z-[60]" />
        {size && images ? (
          <svg aria-hidden="true" focusable="false" width="0" height="0" className="pointer-events-none fixed left-0 top-0">
            <defs>
              <filter id={sizedFilterId} x="0" y="0" width={size.width} height={size.height} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feImage href={images.map} x="0" y="0" width={size.width} height={size.height} preserveAspectRatio="none" result="map" />
                <feImage href={images.rim} x="0" y="0" width={size.width} height={size.height} preserveAspectRatio="none" result="rimPicture" />
                <feColorMatrix in="rimPicture" type="luminanceToAlpha" result="rim" />
                {/* Under the face: the page, frosted. */}
                <feGaussianBlur in="SourceGraphic" stdDeviation={FROST} edgeMode="duplicate" result="frost" />
                {/* Through the rim: the page, bent towards the middle of the slab and left sharp — once per colour, a little apart. */}
                <feDisplacementMap in="SourceGraphic" in2="map" scale={BEND * FRINGE[0]} xChannelSelector="R" yChannelSelector="B" result="bentRed" />
                <feColorMatrix in="bentRed" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
                <feDisplacementMap in="SourceGraphic" in2="map" scale={BEND * FRINGE[1]} xChannelSelector="R" yChannelSelector="B" result="bentGreen" />
                <feColorMatrix in="bentGreen" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
                <feDisplacementMap in="SourceGraphic" in2="map" scale={BEND * FRINGE[2]} xChannelSelector="R" yChannelSelector="B" result="bentBlue" />
                <feColorMatrix in="bentBlue" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
                <feBlend in="red" in2="green" mode="screen" result="redGreen" />
                <feBlend in="redGreen" in2="blue" mode="screen" result="bent" />
                <feGaussianBlur in="bent" stdDeviation="0.5" edgeMode="duplicate" result="bentSoft" />
                <feComposite in="bentSoft" in2="rim" operator="in" result="rimOnly" />
                <feComposite in="frost" in2="rim" operator="out" result="faceOnly" />
                <feComposite in="rimOnly" in2="faceOnly" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
              </filter>
            </defs>
          </svg>
        ) : null}
        <DialogPrimitive.Content
          ref={attach}
          aria-describedby={undefined}
          data-testid={testId}
          data-refract={refract ? "" : undefined}
          style={{
            ...(open ? measure(triggerRef.current, share, minWidth) : undefined),
            ...(refract ? ({ "--nesto-liquid-filter": `url(#${sizedFilterId})` } as React.CSSProperties) : undefined),
            ...({ "--nesto-liquid-radius": `${RADIUS}px`, "--nesto-liquid-bezel": `${BEZEL}px`, "--nesto-liquid-frost": `${FROST}px` } as React.CSSProperties),
          }}
          onOpenAutoFocus={(event) => {
            // The panel's own first control takes focus (the search field).
            const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-autofocus]");
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          onCloseAutoFocus={(event) => restoreFocusAfterClose(event)}
          className={cn("nesto-liquid-glass fixed z-[60] flex flex-col overflow-hidden outline-none will-change-transform", PHONE)}
        >
          {/* The tint that keeps words readable on the face; it thins out towards the rim, where the glass is clear. */}
          <span aria-hidden="true" className="nesto-liquid-glass-tint" />
          <div className="relative z-[1] flex min-h-0 flex-1 flex-col sm:p-2">
            <DialogTitle className="sr-only">{title}</DialogTitle>
            {header}
            <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
              {children}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
