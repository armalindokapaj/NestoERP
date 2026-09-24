"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils/cn";

/**
 * Popover: a small dialog anchored to the control that opened it.
 *
 * Radix places it beside its anchor and moves it back inside the viewport when
 * it would overflow. Escape and a click outside close it, and focus returns to
 * the trigger. Its first use is the workspace popup at the top of the sidebar
 * (OW §21, §56).
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-[55] rounded-xl border border-line bg-surface shadow-lg shadow-black/10 outline-none",
          "data-[state=open]:animate-[nesto-fade-in_120ms_var(--nesto-ease)]",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
