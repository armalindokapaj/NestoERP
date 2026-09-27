"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cn } from "@/lib/utils/cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          // z-65: above the dialogs and sheets a menu can be opened from (AUD-04 §6;
          // ladder in globals.css). A long menu scrolls inside the room Radix measured.
          "z-[65] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-56 max-w-[calc(100vw-1rem)] overflow-y-auto overflow-x-hidden rounded-lg border border-line bg-surface p-1 shadow-lg shadow-black/5",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  /** Destructive: red text and icon before any hover, a red-tinted highlight. */
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-variant={variant}
      className={cn(
        // 44px rows under touch (AUD-04 §3, MW-19); desktop rows unchanged.
        "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-body text-fg outline-none touch:min-h-11",
        "focus:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted",
        variant === "destructive" && "text-danger-strong focus:bg-danger-soft [&_svg]:text-danger-strong",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2.5 py-1.5 text-micro font-semibold uppercase tracking-wide text-fg-subtle", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-line", className)}
      {...props}
    />
  );
}
