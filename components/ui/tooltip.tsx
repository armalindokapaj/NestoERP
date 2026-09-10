"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils/cn";

/**
 * Tooltip (design spec §88).
 *
 * Its main job in V0.1 is naming the icons in the collapsed sidebar (§14), so
 * a narrow rail never becomes a guessing game.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-[60] rounded-md bg-graphite px-2.5 py-1.5 text-micro font-medium text-graphite-fg shadow-menu",
          "data-[state=delayed-open]:animate-[nesto-fade-in_150ms_var(--nesto-ease)]",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
