"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { PopupPointer } from "@/components/ui/popup-pointer";
import { cn } from "@/lib/utils/cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  // Never flush against the screen's edge, where a menu's rounded corner would be cut off.
  collisionPadding = 8,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      {/* The placed shell is the menu; the box inside is what is seen, so the pointer — drawn only on touch
          layouts (components/ui/popup-pointer.tsx) — is never clipped by the box's own scrolling. */}
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        // z-65: above the dialogs and sheets a menu can be opened from (AUD-04 §6; ladder in globals.css).
        className="nesto-popup-shell z-[65] outline-none data-[state=open]:animate-[nesto-fade-in_120ms_var(--nesto-ease)]"
        {...props}
      >
        <div
          className={cn(
            // A long menu scrolls inside the room Radix measured.
            "nesto-popup-glass max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-56 max-w-[calc(100vw-1rem)] overflow-y-auto overflow-x-hidden rounded-[18px] border border-line bg-surface p-1.5 shadow-menu",
            className,
          )}
        >
          {children}
        </div>
        <DropdownMenuPrimitive.Arrow asChild>
          <PopupPointer />
        </DropdownMenuPrimitive.Arrow>
      </DropdownMenuPrimitive.Content>
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
        "relative flex cursor-pointer select-none items-center gap-2 rounded-xl px-2.5 py-2 text-body text-fg outline-none touch:min-h-11",
        // Keyboard focus also draws the ring inside the row; a pointer highlight stays the quiet tint (AUD-11 AV-04).
        "focus:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-accent-strong",
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
      className={cn("-mx-1.5 my-1.5 h-px bg-accent/25", className)}
      {...props}
    />
  );
}
