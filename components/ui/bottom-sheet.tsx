"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { GuardedRoot, useDialogClose } from "@/components/unsaved/guarded-root";
import { restoreFocusAfterClose, safeInitialFocus } from "@/lib/a11y/overlay-focus";
import { cn } from "@/lib/utils/cn";

/**
 * BottomSheet (MOB-01 §21): a modal panel from the bottom edge for short
 * mobile interactions — filters, a selector, contextual actions, sort.
 * Not a replacement for every dialog; a long task belongs on a page.
 *
 * Built on the same guarded Radix dialog as Dialog and Drawer, so focus is
 * trapped and restored, Escape and the backdrop close it, the page behind is
 * inert, and unsaved input inside it is protected (AUD-03). On top it adds a
 * title (required: it names the dialog), a grab handle you can drag down to
 * close, a 44px close button, a scrolling body that never chains into the page,
 * a footer slot and safe-area padding. Height follows the dynamic viewport,
 * so an open keyboard does not push it off screen.
 *
 *   <BottomSheet open={open} onOpenChange={setOpen} title="Filters" footer={<Button>Apply</Button>}>…</BottomSheet>
 */
export const BottomSheetTrigger = DialogPrimitive.Trigger;
export const BottomSheetClose = DialogPrimitive.Close;

/** Past this share of the sheet's height (or this speed) a release closes it. */
const CLOSE_FRACTION = 0.3;
const CLOSE_VELOCITY = 0.6; // px per ms

export type BottomSheetProps = Omit<React.ComponentProps<typeof GuardedRoot>, "children"> & {
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Draws only the title for screen readers; use when the content is self-explanatory. */
  hideTitle?: boolean;
  className?: string;
  /** Runs when focus is about to return; call `event.preventDefault()` to place it yourself (a sheet opened by a plain button, not a Trigger). */
  onCloseAutoFocus?: (event: Event) => void;
};

export function BottomSheet({ title, description, children, footer, hideTitle = false, className, onCloseAutoFocus, ...root }: BottomSheetProps) {
  return (
    <GuardedRoot {...root}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[55] bg-black/40",
            "data-[state=open]:animate-[nesto-fade-in_180ms_var(--nesto-ease)]",
            "data-[state=closed]:animate-[nesto-fade-out_150ms_var(--nesto-ease)]",
          )}
        />
        <SheetPanel title={title} description={description} footer={footer} hideTitle={hideTitle} className={className} onCloseAutoFocus={onCloseAutoFocus}>
          {children}
        </SheetPanel>
      </DialogPrimitive.Portal>
    </GuardedRoot>
  );
}

function SheetPanel({ title, description, footer, hideTitle, className, children, onCloseAutoFocus }: Omit<BottomSheetProps, "hideTitle"> & { hideTitle: boolean }) {
  const t = useTranslations("ui");
  const close = useDialogClose();
  const panel = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ startY: number; startT: number; height: number } | null>(null);

  function setOffset(px: number) {
    const node = panel.current;
    if (!node) return;
    node.style.transform = px > 0 ? `translateY(${px}px)` : "";
    node.style.transition = "none";
  }

  function onPointerDown(event: React.PointerEvent) {
    const node = panel.current;
    if (!node) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startT: event.timeStamp, height: node.offsetHeight };
  }
  function onPointerMove(event: React.PointerEvent) {
    if (drag.current) setOffset(Math.max(0, event.clientY - drag.current.startY));
  }
  function onPointerUp(event: React.PointerEvent) {
    const start = drag.current;
    drag.current = null;
    const node = panel.current;
    if (!start || !node) return;
    const distance = event.clientY - start.startY;
    const velocity = distance / Math.max(1, event.timeStamp - start.startT);
    node.style.transition = "";
    node.style.transform = "";
    if (distance > start.height * CLOSE_FRACTION || velocity > CLOSE_VELOCITY) close();
  }

  return (
    <DialogPrimitive.Content
      ref={panel}
      {...(description ? {} : { "aria-describedby": undefined })}
      onOpenAutoFocus={safeInitialFocus}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        restoreFocusAfterClose(event);
      }}
      className={cn(
        "fixed inset-x-0 bottom-0 z-[55] mx-auto flex w-full max-w-xl flex-col bg-surface outline-none",
        "max-h-[min(85dvh,calc(100dvh-var(--nesto-safe-top)-1rem))] rounded-t-[var(--nesto-radius-sheet)] border border-b-0 border-line shadow-dialog",
        "transition-transform duration-200",
        "data-[state=open]:animate-[nesto-slide-in-bottom_180ms_var(--nesto-ease)]",
        "data-[state=closed]:animate-[nesto-slide-out-bottom_180ms_var(--nesto-ease)]",
        className,
      )}
    >
      {/* The handle is the drag target. It is decoration for keyboard and screen-reader users, who have the close button. */}
      <div
        aria-hidden="true"
        className="flex shrink-0 cursor-grab touch-none justify-center pt-2 pb-1 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="h-1 w-10 rounded-full bg-line-strong" />
      </div>

      <div className={cn("flex shrink-0 items-start justify-between gap-3 px-4 pb-2", hideTitle && "sr-only")}>
        <div className="min-w-0">
          <DialogPrimitive.Title className="text-card font-semibold text-fg [overflow-wrap:anywhere]">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-0.5 text-table text-fg-muted">{description}</DialogPrimitive.Description>
          ) : null}
        </div>
        <DialogPrimitive.Close
          aria-label={t("close")}
          className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
        >
          <X aria-hidden="true" className="size-4" />
        </DialogPrimitive.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>

      {footer ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 pt-3 pb-[calc(0.75rem+var(--nesto-safe-bottom))]">{footer}</div>
      ) : (
        <div aria-hidden="true" className="shrink-0 pb-[var(--nesto-safe-bottom)]" />
      )}
    </DialogPrimitive.Content>
  );
}
