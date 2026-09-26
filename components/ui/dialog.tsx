"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { GuardedRoot } from "@/components/unsaved/guarded-root";

export { useDialogClose } from "@/components/unsaved/guarded-root";
import { cn } from "@/lib/utils/cn";

/**
 * Dialog (design spec §66).
 *
 * Short actions only — create, rename, confirm. Full workflows belong on a
 * dedicated page or in a drawer.
 */
/** Guarded: closing it asks about unsaved input inside it first (AUD-03 §5). */
export const Dialog = GuardedRoot;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-[60] bg-black/40 backdrop-blur-[1px]",
          "data-[state=open]:animate-[nesto-fade-in_180ms_var(--nesto-ease)]",
          "data-[state=closed]:animate-[nesto-fade-out_150ms_var(--nesto-ease)]",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "rounded-2xl border border-line bg-surface p-6 shadow-dialog outline-none",
          "data-[state=open]:animate-[nesto-zoom-in_180ms_var(--nesto-ease)]",
          "data-[state=closed]:animate-[nesto-zoom-out_150ms_var(--nesto-ease)]",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-md p-1 text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-card font-semibold text-fg", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("mt-1 text-body text-fg-muted", className)}
      {...props}
    />
  );
}

/** Dialog action row. Right-aligned, primary action last (§66). */
export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-6 flex flex-wrap items-center justify-end gap-2", className)}
      {...props}
    />
  );
}
