"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { guardNavigation } from "@/components/navigation/guarded-router";

/**
 * What a top-bar panel shows before its body arrives, or when it cannot
 * (NAV-03 PANEL-02, PANEL-03): a named loading state, and failures in plain
 * words with Close.
 *
 * - Data that failed offers Try again: a new request can succeed.
 * - Code that failed offers Reload page at once. The production bundler
 *   (Turbopack) keeps a chunk's failed load for the life of the document, so
 *   importing it again rejects without a request and an in-page retry can
 *   never succeed. Reload asks about unsaved changes first and is never
 *   automatic. A repeated failure adds that a newer version may be available.
 */

export function PanelLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2 p-3" data-testid="panel-loading">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((index) => (
        <div key={index} aria-hidden="true" className="h-10 rounded-md bg-surface-muted motion-safe:animate-pulse" />
      ))}
    </div>
  );
}

export function PanelFailure({
  kind,
  reloadAdvised = false,
  onRetry,
  onClose,
}: {
  kind: "code" | "data";
  reloadAdvised?: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("shell");
  const message = kind === "code" ? (reloadAdvised ? t("panelNewerVersion") : t("panelCodeFailed")) : t("panelDataFailed");
  return (
    <div className="px-3 py-4" data-testid="panel-failure" data-kind={kind}>
      <p role="alert" className="text-table text-fg-muted">
        {message}
      </p>
      <div className="mt-2 flex gap-3">
        {kind === "code" ? (
          <button type="button" onClick={() => guardNavigation({ kind: "reload" }, () => window.location.reload())} className="text-table font-medium text-accent-strong hover:underline" data-testid="panel-reload">
            {t("panelReload")}
          </button>
        ) : (
          <button type="button" onClick={onRetry} className="text-table font-medium text-accent-strong hover:underline" data-testid="panel-retry">
            {t("panelTryAgain")}
          </button>
        )}
        <button type="button" onClick={onClose} className="text-table font-medium text-fg-muted hover:text-fg">
          {t("panelClose")}
        </button>
      </div>
    </div>
  );
}
