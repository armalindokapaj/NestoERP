"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        // 44px tall under touch (AUD-04 §3, MW-19).
        "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-control bg-surface px-3 text-body text-fg touch:h-11",
        // The outline was removed with only a 1px border change left; a solid 2px ring now (AUD-11 AV-04).
        "transition-colors hover:bg-hover focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 text-fg-subtle" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={4}
        className={cn(
          // z-65: above dialogs and sheets it can be opened from (AUD-04 §6; ladder in globals.css).
          // Never taller than the space Radix measured, so a long list scrolls on a short screen.
          "z-[65] max-h-[min(18rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-lg shadow-black/5",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-md py-2 pl-2.5 pr-8 text-body text-fg outline-none touch:min-h-11",
        // Keyboard focus also draws the ring inside the row; a pointer highlight stays the quiet tint (AUD-11 AV-04).
        "focus:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2.5 flex items-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-accent" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}
