"use client";

import * as React from "react";
import { Download, FileText, Loader2 } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listOfflineDocuments, makeDocumentAvailableOffline, openOfflineDocument, updateOfflineDocument, type OfflineDocumentView } from "@/lib/offline/documents";
import { offlineRuntime } from "@/lib/offline/runtime";
import type { DocumentOfflineStatus } from "@/lib/modules/documents/versions/offline.service";

import { useOffline, useTimeLabel } from "../use-offline";
import { formatBytes } from "./sync-center";
import { useOfflineQuery } from "./use-offline-data";

/**
 * A project's documents on the device (MOB-09 §13-§18, §125).
 *
 * The file is always labelled as an offline copy with when it was last
 * confirmed, and a drawing the server has since replaced says SUPERSEDED — it is
 * never left looking like the current one (§17, §18).
 */
export function DocumentsPanel({ projectId, companyId, locked }: { projectId: string; companyId: string; locked: boolean }) {
  const t = useTranslations("offline");
  const state = useOffline();
  const time = useTimeLabel();
  const [opened, setOpened] = React.useState<{ doc: OfflineDocumentView; url: string; mime: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const data = useOfflineQuery(
    async (db) => {
      const manifest = await db.listCache<DocumentOfflineStatus>(projectId, "documents");
      const downloaded = (await listOfflineDocuments(db)).filter((doc) => doc.projectId === projectId);
      return { manifest: manifest.map((entry) => entry.data), downloaded };
    },
    [projectId],
  );

  React.useEffect(() => () => void (opened && URL.revokeObjectURL(opened.url)), [opened]);

  if (locked) return null;
  if (!data) return <Loader2 className="mx-auto size-5 animate-spin text-fg-muted" aria-label={t("sync.syncing")} />;

  const have = new Map(data.downloaded.map((doc) => [doc.documentId, doc]));
  const notDownloaded = data.manifest.filter((doc) => !have.has(doc.documentId) && doc.downloadable);

  const open = async (doc: OfflineDocumentView) => {
    const db = offlineRuntime().database;
    const file = db ? await openOfflineDocument(db, projectId, doc.documentId) : null;
    if (file) setOpened({ doc, url: file.url, mime: file.mime });
  };

  const download = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const db = offlineRuntime().database;
      if (db) await makeDocumentAvailableOffline(db, { projectId, companyId, documentId: id });
      offlineRuntime().notifyChanged();
    } catch {
      setError(t("documents.failed"));
    } finally {
      setBusy(null);
    }
  };

  if (opened) {
    const stale = opened.doc.state === "UPDATE_AVAILABLE";
    return (
      <div className="space-y-3" data-testid="document-viewer">
        <Button variant="ghost" onClick={() => setOpened(null)}>{t("app.back")}</Button>
        <Card className="space-y-1" data-state={opened.doc.state}>
          <p className="flex items-center gap-2 font-semibold">
            <FileText className="size-4" aria-hidden /> {opened.doc.name}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" data-testid="offline-copy-badge">{t("documents.offlineCopy")}</Badge>
            {stale ? <Badge tone="warning" data-testid="superseded-badge">{t("documents.superseded")}</Badge> : null}
            <span className="text-body text-fg-muted">{t("documents.lastUpdated", { time: time(opened.doc.lastUpdated) })}</span>
          </div>
          {stale ? <p className="text-body text-warning-strong">{t("documents.newVersion")} · {t("documents.downloadedVersion", { version: opened.doc.downloadedVersion })} · {t("documents.currentVersion", { version: opened.doc.currentVersion ?? "" })}</p> : <p className="text-micro text-fg-muted">{t("documents.stale")}</p>}
        </Card>
        {opened.mime.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={opened.url} alt={opened.doc.name} className="max-h-[70dvh] w-full rounded-md border border-line object-contain" />
        ) : opened.mime === "application/pdf" ? (
          <iframe src={opened.url} title={opened.doc.name} className="h-[70dvh] w-full rounded-md border border-line" />
        ) : (
          <p className="text-body text-fg-muted">{t("documents.noPreview")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="documents-panel">
      {error ? <p role="alert" className="text-body text-danger-strong">{error}</p> : null}
      {data.downloaded.length === 0 && notDownloaded.length === 0 ? <p className="text-body text-fg-muted">{t("project.noDocuments")}</p> : null}
      {data.downloaded.map((doc) => {
        const stale = doc.state === "UPDATE_AVAILABLE";
        return (
          <Card key={doc.documentId} compact data-testid="offline-document" data-state={doc.state}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-medium"><FileText className="size-4 shrink-0" aria-hidden /> <span className="truncate">{doc.name}</span></p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge>{t("documents.availableOffline")}</Badge>
                  {stale ? <Badge tone="warning">{t("documents.superseded")}</Badge> : null}
                  {doc.state === "UNAVAILABLE" ? <Badge tone="danger">{t("documents.unavailable")}</Badge> : null}
                  <span className="text-micro text-fg-muted">{t("documents.downloadedVersion", { version: doc.downloadedVersion })}{stale ? ` · ${t("documents.currentVersion", { version: doc.currentVersion ?? "" })}` : ""} · {formatBytes(doc.size)}</span>
                </div>
              </div>
              <div className="flex gap-2">
                {stale ? (
                  <Button size="sm" variant="secondary" disabled={!state.online} loading={busy === doc.documentId} onClick={async () => {
                    setBusy(doc.documentId);
                    try { const db = offlineRuntime().database; if (db) await updateOfflineDocument(db, projectId, companyId, doc.documentId); offlineRuntime().notifyChanged(); } catch { setError(t("documents.failed")); } finally { setBusy(null); }
                  }}>{t("documents.update")}</Button>
                ) : null}
                <Button size="sm" onClick={() => void open(doc)} data-testid="document-open">{t("documents.open")}</Button>
              </div>
            </div>
          </Card>
        );
      })}
      {notDownloaded.map((doc) => (
        <Card key={doc.documentId} compact data-testid="document-not-downloaded">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 truncate"><FileText className="size-4 shrink-0" aria-hidden /> <span className="truncate">{doc.name}</span> <span className="text-micro text-fg-muted">{formatBytes(Number(doc.sizeBytes ?? 0))}</span></p>
            <Button size="sm" variant="secondary" disabled={!state.online} loading={busy === doc.documentId} onClick={() => void download(doc.documentId)} data-testid="document-make-offline">
              <Download aria-hidden /> {t("documents.makeOffline")}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
