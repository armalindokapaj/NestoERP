"use client";

import * as React from "react";
import { CheckCircle2, CloudDownload } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { makeDocumentAvailableOffline } from "@/lib/offline/documents";
import { offlineRuntime } from "@/lib/offline/runtime";

import { useOffline } from "./use-offline";
import { useOfflineQuery } from "./workspace/use-offline-data";

/**
 * "Make Available Offline" on one document (MOB-09 §14). Stored inside NESTO's
 * own encrypted database — not exported to the device's files (§126).
 */
export function DocumentOfflineAction({ documentId, projectId, companyId, downloadable }: { documentId: string; projectId: string | null; companyId: string; downloadable: boolean }) {
  const t = useTranslations("offline");
  const state = useOffline();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const key = projectId ?? "company";
  const stored = useOfflineQuery(async (db) => Boolean(await db.getDocument(key, documentId)), [documentId, key]);

  if (!state.ready || state.unsupported || !downloadable) return null;
  if (stored) {
    return (
      <span className="inline-flex items-center gap-1 text-table text-success-strong" data-testid="document-available-offline">
        <CheckCircle2 className="size-4" aria-hidden /> {t("documents.availableOffline")}
      </span>
    );
  }
  return (
    <>
      <Button
        variant="secondary"
        loading={busy}
        disabled={!state.online}
        data-testid="document-make-offline"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await offlineRuntime().run((db) => makeDocumentAvailableOffline(db, { projectId: key, companyId, documentId }));
          } catch {
            setError(t("documents.failed"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <CloudDownload aria-hidden /> {busy ? t("documents.download") : t("documents.makeOffline")}
      </Button>
      {error ? <span role="alert" className="text-micro text-danger-strong">{error}</span> : null}
    </>
  );
}
