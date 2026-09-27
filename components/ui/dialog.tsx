"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { GuardedRoot } from "@/components/unsaved/guarded-root";
import { restoreFocusAfterClose, safeInitialFocus } from "@/lib/a11y/overlay-focus";

export { useDialogClose } from "@/components/unsaved/guarded-root";
import { cn } from "@/lib/utils/cn";
import { useTranslations } from "@/components/i18n/i18n-provider";

/**
 * Dialog (design spec §66).
 *
 * Short actions only — create, rename, confirm. Full workflows belong on a
 * dedicated page or in a drawer.
 *
 * Fits any viewport (AUD-04 §6, MW-10): never taller than the dynamic viewport
 * less a 1rem margin and the safe-area insets, so a phone on its side (844×390)
 * or an open keyboard cannot push the footer out of reach. The dialog itself
 * is the one scroll region — title, fields and footer scroll together inside
 * it, and the page behind never scrolls with it. The close control is a 44px
 * target under touch (MW-19). A caller's own `max-h-*`/`overflow-*` still wins.
 */
/** Guarded: closing it asks about unsaved input inside it first (AUD-03 §5). */
export const Dialog = GuardedRoot;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  closeClassName,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Placement of the close control, for a dialog drawn full screen under a notch. */
  closeClassName?: string;
}) {
  const t = useTranslations("ui");
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
          "fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem-env(safe-area-inset-left)-env(safe-area-inset-right))] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain",
          "rounded-2xl border border-line bg-surface p-6 shadow-dialog outline-none",
          "data-[state=open]:animate-[nesto-zoom-in_180ms_var(--nesto-ease)]",
          "data-[state=closed]:animate-[nesto-zoom-out_150ms_var(--nesto-ease)]",
          className,
        )}
        /* Initial focus never on a destructive action; focus back to the invoker, or
           to the main region when the invoker is gone (AUD-11 §4, AV-05). */
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          safeInitialFocus(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          restoreFocusAfterClose(event);
        }}
        {...props}
      >
        {children}
        {/* 24px with a mouse; a 44px target under touch, pulled into the corner
            so the title keeps its width (AUD-04 §6, MW-10). */}
        <DialogPrimitive.Close
          className={cn(
            "absolute right-4 top-4 grid place-items-center rounded-md p-1 text-fg-subtle transition-colors hover:bg-hover hover:text-fg touch:right-1.5 touch:top-1.5 touch:size-11 touch:p-0",
            closeClassName,
          )}
          aria-label={t("close")}
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
