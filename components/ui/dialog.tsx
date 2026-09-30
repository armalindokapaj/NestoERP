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
  presentation = "centered",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Placement of the close control, for a dialog drawn full screen under a notch. */
  closeClassName?: string;
  /**
   * How it looks below 640px (MOB-01 §20); from there up it is always the
   * centred dialog. `centered` (default) is unchanged. `fullscreen-phone` is
   * for a task — a form, a picker with search — that needs the whole screen;
   * `sheet-phone` docks it to the bottom edge for a short choice. For a sheet
   * with a drag handle and footer slot, use BottomSheet.
   */
  presentation?: "centered" | "fullscreen-phone" | "sheet-phone";
}) {
  const t = useTranslations("ui");
  const phone = presentation === "centered" ? null : presentation;
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
          phone === null && "data-[state=open]:animate-[nesto-zoom-in_180ms_var(--nesto-ease)] data-[state=closed]:animate-[nesto-zoom-out_150ms_var(--nesto-ease)]",
          phone && "sm:data-[state=open]:animate-[nesto-zoom-in_180ms_var(--nesto-ease)] sm:data-[state=closed]:animate-[nesto-zoom-out_150ms_var(--nesto-ease)]",
          phone === "fullscreen-phone" &&
            "max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 max-sm:pt-[max(1.5rem,var(--nesto-safe-top))] max-sm:pb-[max(1.5rem,var(--nesto-safe-bottom))] max-sm:data-[state=open]:animate-[nesto-fade-in_180ms_var(--nesto-ease)] max-sm:data-[state=closed]:animate-[nesto-fade-out_150ms_var(--nesto-ease)]",
          phone === "sheet-phone" &&
            "max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[var(--nesto-radius-sheet)] max-sm:pb-[max(1.5rem,var(--nesto-safe-bottom))] max-sm:data-[state=open]:animate-[nesto-slide-in-bottom_180ms_var(--nesto-ease)] max-sm:data-[state=closed]:animate-[nesto-slide-out-bottom_180ms_var(--nesto-ease)]",
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
            phone === "fullscreen-phone" && "max-sm:right-[max(0.375rem,var(--nesto-safe-right))] max-sm:top-[max(0.375rem,var(--nesto-safe-top))]",
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

/**
 * Dialog action row. Right-aligned, primary action last (§66).
 *
 * `stackOnPhone` (MOB-01 §15): below 640px the actions become full-width and
 * the DOM-last (primary) action shows on top, the thumb's reach. Opt-in, so
 * the many footers with their own layout are unchanged.
 */
export function DialogFooter({ className, stackOnPhone = false, ...props }: React.ComponentProps<"div"> & { stackOnPhone?: boolean }) {
  return (
    <div
      className={cn(
        "mt-6 flex flex-wrap items-center justify-end gap-2",
        stackOnPhone && "max-sm:flex-col-reverse max-sm:items-stretch max-sm:[&>*]:w-full",
        className,
      )}
      {...props}
    />
  );
}
