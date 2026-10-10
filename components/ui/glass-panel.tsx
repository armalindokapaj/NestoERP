"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { restoreFocusAfterClose } from "@/lib/a11y/overlay-focus";
import { cn } from "@/lib/utils/cn";

/**
 * The shell's glass panel (search, workspace switcher): the page behind turns to
 * frosted glass, and the panel grows out of the control that opened it and
 * travels back into it on close. It sits on the breadcrumb row, from that row's
 * left edge, and runs down the screen, so there is room for a long list. A phone
 * gets the whole screen.
 */

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function measure(maxWidth: number): React.CSSProperties {
  if (typeof window === "undefined") return {};
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < 640) return { left: 0, top: 0, width: vw, height: vh, borderRadius: 0, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" };
  const bar = document.querySelector<HTMLElement>("[data-shell-breadcrumb]");
  if (bar && bar.getClientRects().length > 0) {
    const rect = bar.getBoundingClientRect();
    const style = getComputedStyle(bar);
    const left = rect.left + parseFloat(style.paddingLeft);
    const width = Math.min(rect.right - parseFloat(style.paddingRight) - left, maxWidth);
    return { left, top: rect.top, width, maxHeight: vh - rect.top - 24, minHeight: Math.min(448, vh - rect.top - 24) };
  }
  const width = Math.min(Math.min(maxWidth, 720), vw - 32);
  return { left: (vw - width) / 2, top: 72, width, maxHeight: vh - 96, minHeight: Math.min(448, vh - 96) };
}

export type GlassPanelControl = { close: () => void };

export function GlassPanel({
  open,
  onOpenChange,
  triggerRef,
  title,
  header,
  children,
  maxWidth = 1100,
  controlRef,
  testId,
}: {
  open: boolean;
  /** `false` arrives once the panel has travelled back into its trigger. */
  onOpenChange: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  /** The dialog's accessible name. */
  title: string;
  /** The fixed top row (a search field, a heading); `children` is the body beneath it. */
  header: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number;
  /** Lets the owner close with the animation (a keyboard shortcut, a chosen row). */
  controlRef?: React.MutableRefObject<GlassPanelControl | null>;
  testId?: string;
}) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const closing = React.useRef(false);

  const close = React.useCallback(() => {
    const panel = panelRef.current;
    if (closing.current) return;
    if (!panel) return onOpenChange(false);
    closing.current = true;
    const finish = () => {
      closing.current = false;
      onOpenChange(false);
    };
    const icon = triggerRef.current?.getBoundingClientRect();
    overlayRef.current?.animate({ opacity: [1, 0] }, { duration: 220, easing: "ease-out", fill: "forwards" });
    if (reducedMotion() || !icon) {
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

  const attach = React.useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (!node) return;
      const icon = triggerRef.current?.getBoundingClientRect();
      overlayRef.current?.animate({ opacity: [0, 1] }, { duration: 360, easing: "ease-out" });
      if (reducedMotion() || !icon) {
        node.animate({ opacity: [0, 1] }, { duration: 120 });
        return;
      }
      const to = node.getBoundingClientRect();
      node.animate(
        [
          { transform: `translate(${icon.left - to.left}px, ${icon.top - to.top}px) scale(${icon.width / to.width}, ${icon.height / to.height})`, opacity: 0 },
          { opacity: 1, offset: 0.35 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 520, easing: EASE },
      );
      bodyRef.current?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: 520, easing: "ease-out" });
    },
    [triggerRef],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay ref={overlayRef} className="fixed inset-0 z-[60] bg-canvas/10 backdrop-blur-xl backdrop-saturate-150" />
        <DialogPrimitive.Content
          ref={attach}
          aria-describedby={undefined}
          data-testid={testId}
          style={open && typeof window !== "undefined" ? measure(maxWidth) : undefined}
          onOpenAutoFocus={(event) => {
            // The panel's own first control takes focus (the search field, the list).
            const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-autofocus]");
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          onCloseAutoFocus={(event) => restoreFocusAfterClose(event)}
          className={cn("fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-white/60 bg-surface/75 shadow-dialog outline-none backdrop-blur-2xl backdrop-saturate-150 will-change-transform")}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {header}
          <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
