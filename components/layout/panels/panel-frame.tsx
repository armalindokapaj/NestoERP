"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { confirmWorkspaceNavigation } from "@/lib/workspace/client";

/**
 * What a top-bar panel shows before its body arrives, or when it cannot
 * (NAV-03 PANEL-02, PANEL-03): a named loading state, and failures in plain
 * words with Try again and Close. After a second failure to load code the
 * build may have moved on, and Reload is offered; it asks about unsaved
 * changes first and is never automatic.
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
        {kind === "code" && reloadAdvised ? (
          <button type="button" onClick={() => confirmWorkspaceNavigation() && window.location.reload()} className="text-table font-medium text-accent-strong hover:underline" data-testid="panel-reload">
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
