"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils/cn";

export const Tabs = TabsPrimitive.Root;

/**
 * A strip wider than the screen scrolls sideways inside itself instead of
 * widening the page (AUD-04 §3, SP-09). The rule under the tabs is an inset
 * shadow rather than a border, so the active tab's underline can sit on it
 * without overflowing the scroll box.
 */
export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex max-w-full items-center gap-1 overflow-x-auto overscroll-x-contain shadow-[inset_0_-1px_0_var(--nesto-border)] [scrollbar-width:thin]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-table font-medium text-fg-muted transition-colors touch:min-h-11",
        "hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg",
        // Inside a scroll box an outside outline is clipped: the ring is drawn within (AUD-04 §3).
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("pt-4", className)} {...props} />;
}
