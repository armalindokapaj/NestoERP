"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import type { EditorSave } from "@/components/unsaved/use-editor-save";
import { cn } from "@/lib/utils/cn";

/**
 * What a save answered, where it stays until the next attempt (AUD-03 §6): the
 * refusal in the action's words, then whether anything was saved — "not
 * saved, your entries are still here", or "we couldn't confirm". Not a toast
 * that disappears.
 */
export function SaveMessages({ save, className }: { save: Pick<EditorSave, "error" | "outcomeText" | "alertRef">; className?: string }) {
  if (!save.error && !save.outcomeText) return null;
  return (
    <div
      ref={save.alertRef}
      role="alert"
      tabIndex={-1}
      data-testid="record-form-error"
      className={cn("space-y-1 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong outline-none", className)}
    >
      {save.error ? <p>{save.error}</p> : null}
      {save.outcomeText ? <p data-testid="record-form-outcome">{save.outcomeText}</p> : null}
    </div>
  );
}

/**
 * A restrained "Unsaved changes" beside the editor's buttons (§8). A polite
 * live region that changes when dirtiness flips, never per keystroke; after a
 * committed save it says the page is opening, and if that takes too long it
 * offers the way on again — without saving again (UW-14).
 */
export function UnsavedIndicator({ save, className }: { save: Pick<EditorSave, "editor" | "pending" | "saved">; className?: string }) {
  const t = useTranslations("unsaved");
  const text = save.saved ? t("savedOpening") : save.pending ? t("indicatorSaving") : save.editor.dirty ? t("indicatorDirty") : "";
  return (
    <>
      <span aria-live="polite" className={cn("text-meta text-fg-subtle", className)} data-testid="unsaved-indicator">
        {text}
      </span>
      {save.saved?.slow ? (
        <Link href={save.saved.href} className="text-table font-medium text-accent-strong hover:underline" data-testid="record-form-retry-navigation">
          {t("retryNavigation")}
        </Link>
      ) : null}
    </>
  );
}
