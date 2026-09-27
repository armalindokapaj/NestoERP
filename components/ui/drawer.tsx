"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { GuardedRoot } from "@/components/unsaved/guarded-root";
import { cn } from "@/lib/utils/cn";

/**
 * Drawer (design spec §39, §67).
 *
 * Used for mobile navigation, mobile filters, and any off-canvas panel a
 * module needs later. Dimensions and motion follow §39: 85–90% of the
 * viewport capped at 340px, dark backdrop, 180ms slide.
 */
/** Guarded: closing it asks about unsaved input inside it first (AUD-03 §5). */
export const Drawer = GuardedRoot;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;
export const DrawerTitle = DialogPrimitive.Title;
export const DrawerDescription = DialogPrimitive.Description;

type DrawerSide = "left" | "right" | "bottom";

/*
 * Each side pads itself by the safe-area insets it touches (AUD-04 §3, §6):
 * the notch and the home indicator never cover a drawer's first or last
 * control. A caller's own padding on that edge replaces it.
 */
const sideClasses: Record<DrawerSide, string> = {
  left: "inset-y-0 left-0 w-[88vw] max-w-[340px] border-r border-line pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] data-[state=open]:animate-[nesto-slide-in-left_180ms_var(--nesto-ease)] data-[state=closed]:animate-[nesto-slide-out-left_180ms_var(--nesto-ease)]",
  /* §67: desktop drawers stay between 420 and 520px. */
  right:
    "inset-y-0 right-0 w-[88vw] max-w-[340px] sm:max-w-[480px] border-l border-line pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] data-[state=open]:animate-[nesto-slide-in-right_180ms_var(--nesto-ease)] data-[state=closed]:animate-[nesto-slide-out-right_180ms_var(--nesto-ease)]",
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t border-line pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-[nesto-slide-in-bottom_180ms_var(--nesto-ease)] data-[state=closed]:animate-[nesto-slide-out-bottom_180ms_var(--nesto-ease)]",
};

export function DrawerContent({
  className,
  side = "left",
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: DrawerSide }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-[50] bg-black/40",
          "data-[state=open]:animate-[nesto-fade-in_180ms_var(--nesto-ease)]",
          "data-[state=closed]:animate-[nesto-fade-out_150ms_var(--nesto-ease)]",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          // Scrolls on its own, never chaining into the page behind (AUD-04 §4, MW-02).
          "fixed z-[50] flex flex-col overflow-y-auto overscroll-contain bg-sidebar shadow-dialog outline-none",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
