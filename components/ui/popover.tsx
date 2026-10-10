"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { PopupPointer } from "@/components/ui/popup-pointer";
import { cn } from "@/lib/utils/cn";

/**
 * Popover: a small dialog anchored to the control that opened it.
 *
 * Radix places it beside its anchor and moves it back inside the viewport when
 * it would overflow. Escape and a click outside close it, and focus returns to
 * the trigger.
 *
 * On a touch layout it is a slab of the platform's glass with a pointer aimed
 * at the control it came from (components/ui/popup-pointer.tsx); with a mouse
 * it is the plain panel. `className` styles the box that is seen.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      {/* The placed shell carries the name, the test id and the focus handling; the box inside is what is seen,
          so the pointer — drawn only on touch layouts — is never clipped by the box's own scrolling. */}
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        // z-65: above dialogs and sheets (AUD-04 §6; ladder in globals.css).
        className="nesto-popup-shell z-[65] outline-none data-[state=open]:animate-[nesto-fade-in_120ms_var(--nesto-ease)]"
        {...props}
      >
        <div
          className={cn(
            "nesto-popup-glass max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface shadow-lg shadow-black/10",
            className,
          )}
        >
          {children}
        </div>
        <PopoverPrimitive.Arrow asChild>
          <PopupPointer />
        </PopoverPrimitive.Arrow>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
