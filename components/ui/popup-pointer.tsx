"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * The pointer of a popup on touch layouts: the small tail that says which
 * control the popup came from. On a phone or a tablet every popup — a menu, a
 * popover, a select's list, a panel opened from the bottom bar — is a slab of
 * the platform's glass with this tail aimed at what was pressed; with a mouse
 * the popups keep their plain form and the tail is not drawn. The looks are in
 * `styles/globals.css` (`.nesto-popup-glass`, `.nesto-popup-pointer`,
 * `.nesto-popup-shell`).
 *
 * Two ways in:
 *
 * - `PopupPointer` is what the Radix primitives render as their arrow
 *   (`<Popover.Arrow asChild>`): Radix places and turns it.
 * - `PanelPointer` is for a panel this app places itself (Create, the Activity
 *   Center): it sits on the edge facing the control, at `--nesto-pointer-x`,
 *   which `aimPointer` measures.
 */

/** Radix hands its arrow the size and box of an `<svg>`; a span has no use for them. */
type ArrowProps = React.HTMLAttributes<HTMLSpanElement> & { width?: number | string; height?: number | string; viewBox?: string; preserveAspectRatio?: string };

export const PopupPointer = React.forwardRef<HTMLSpanElement, ArrowProps>(function PopupPointer({ width, height, viewBox, preserveAspectRatio, className, style, ...props }, ref) {
  void width;
  void height;
  void viewBox;
  void preserveAspectRatio;
  // Radix forces its arrow to `display: block` inline. Whether the pointer is drawn is the stylesheet's call
  // (touch layouts only): left inline it would be drawn for a mouse too, and Radix, measuring it, would
  // push every popup a pointer's height away from its control.
  const { display, ...rest } = style ?? {};
  void display;
  return <span ref={ref} aria-hidden="true" className={cn("nesto-popup-pointer", className)} style={rest} {...props} />;
});

/** `below`: the panel sits above its control and the tail hangs under it; `above`: the other way up. */
export function PanelPointer({ side, className }: { side: "below" | "above"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-side={side}
      className={cn("nesto-popup-pointer nesto-panel-pointer absolute left-[var(--nesto-pointer-x,50%)] -translate-x-1/2", side === "below" ? "top-full" : "bottom-full rotate-180", className)}
    />
  );
}

/** Points a panel's tail at the control that opened it: the control's middle, measured from the panel's left edge. */
export function aimPointer(panel: HTMLElement | null, control: Element | null) {
  if (!panel || !control) return;
  const from = control.getBoundingClientRect();
  if (from.width === 0) return;
  const box = panel.getBoundingClientRect();
  // Kept clear of the panel's rounded corners.
  const x = Math.min(Math.max(from.left + from.width / 2 - box.left, 28), box.width - 28);
  panel.style.setProperty("--nesto-pointer-x", `${x}px`);
}
