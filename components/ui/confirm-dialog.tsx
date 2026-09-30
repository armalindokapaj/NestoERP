"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "@/components/i18n/i18n-provider";

/**
 * Confirmation dialog (design spec §69).
 *
 * No destructive action may fire from a single click. Anything that cannot be
 * undone routes through here and states, plainly, that it cannot be undone.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel: confirmLabelProp,
  cancelLabel: cancelLabelProp,
  destructive = true,
  pending = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  /** What the action touches, shown between the description and the buttons. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("ui");
  const confirmLabel = confirmLabelProp ?? t("delete");
  const cancelLabel = cancelLabelProp ?? t("cancel");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" presentation="sheet-phone">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            variant={destructive ? "danger" : "primary"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? t("working") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
