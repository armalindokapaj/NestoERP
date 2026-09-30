"use client";

import * as React from "react";
import { FileText, RefreshCw, Trash2 } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { listOfflineDocuments, removeOfflineDocument, updateOfflineDocument, type OfflineDocumentView } from "@/lib/offline/documents";
import { refreshOfflineProjects, removeProjectDownload, UnsyncedWorkError } from "@/lib/offline/projects";
import { offlineRuntime, type OfflineProjectView } from "@/lib/offline/runtime";

import { useOffline, useTimeLabel } from "../use-offline";
import { formatBytes } from "./sync-center";
import { useOfflineQuery } from "./use-offline-data";

/** Settings → Offline & Storage (MOB-09 §91-§96, §141). */
export function StorageView({ locked }: { locked: boolean }) {
  const t = useTranslations("offline");
  const state = useOffline();
  const time = useTimeLabel();
  const [removing, setRemoving] = React.useState<OfflineProjectView | null>(null);
  const [blocked, setBlocked] = React.useState<{ name: string; count: number } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const usage = useOfflineQuery((db) => db.usage(), []);
  const documents = useOfflineQuery((db) => listOfflineDocuments(db), []);

  const projectsTotal = state.projects.reduce((sum, project) => sum + project.sizeBytes, 0);
  const pending = usage?.pendingFiles ?? 0;
  const cache = usage?.cache ?? 0;
  const total = projectsTotal + pending + cache;
  const low = state.storage && state.storage.quota > 0 && state.storage.quota - state.storage.usage < 100 * 1024 * 1024;

  const update = async (project: OfflineProjectView) => {
    setBusy(project.projectId);
    try {
      await offlineRuntime().run((db) => refreshOfflineProjects(db, fetch.bind(globalThis), Date.now, project.projectId));
    } catch {
      // Still offline or the server is busy: the project keeps what it has.
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const target = removing;
    setRemoving(null);
    if (!target) return;
    try {
      await offlineRuntime().run((db) => removeProjectDownload(db, target.projectId));
    } catch (error) {
      if (error instanceof UnsyncedWorkError) setBlocked({ name: target.name, count: error.count });
    }
  };

  return (
    <div className="space-y-4" data-testid="storage-view">
      <Card className="space-y-2">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Row label={t("storage.offlineProjects")} value={formatBytes(projectsTotal)} />
          <Row label={t("storage.pendingUploads")} value={formatBytes(pending)} testId="storage-pending" />
          <Row label={t("storage.temporaryCache")} value={formatBytes(cache)} />
          <Row label={t("storage.total")} value={formatBytes(total)} strong />
        </dl>
        {low ? (
          <p role="status" className="text-body text-warning-strong">
            {t("storage.low")}
          </p>
        ) : null}
      </Card>

      <section className="space-y-2">
        <h2 className="px-1 text-h3 font-semibold">{t("storage.projects")}</h2>
        {state.projects.length === 0 ? <p className="px-1 text-body text-fg-muted">{t("storage.noProjects")}</p> : null}
        {blocked ? (
          <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-body text-warning-strong" data-testid="remove-blocked">
            {blocked.name}: {t("storage.removeBlocked", { count: blocked.count })}
          </p>
        ) : null}
        {state.projects.map((project) => (
          <Card key={project.projectId} compact data-testid="storage-project">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{locked ? project.code : project.name}</p>
                <p className="text-micro text-fg-muted">
                  {formatBytes(project.sizeBytes)} · {t(`storage.status.${project.status}` as never)}
                  {project.lastSyncedAt ? ` · ${t("app.lastSynced", { time: time(project.lastSyncedAt) })}` : ""}
                </p>
                {project.revoked ? <p className="text-micro text-warning-strong">{t("app.revoked")}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => update(project)} loading={busy === project.projectId} disabled={!state.online || project.revoked} data-testid="project-update">
                  <RefreshCw aria-hidden /> {t("storage.update")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(project)} data-testid="project-remove">
                  <Trash2 aria-hidden /> {t("storage.remove")}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-h3 font-semibold">{t("storage.documents")}</h2>
        {documents && documents.length === 0 ? <p className="px-1 text-body text-fg-muted">{t("storage.noDocuments")}</p> : null}
        {!locked && documents?.map((doc) => <DocumentRow key={`${doc.projectId}:${doc.documentId}`} doc={doc} online={state.online} />)}
      </section>

      <Card className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{t("storage.autoSync")}</p>
          <p className="text-body text-fg-muted">{t("storage.autoSyncHint")}</p>
        </div>
        <Switch checked={state.autoSync} onCheckedChange={(checked) => offlineRuntime().setAutoSync(checked)} aria-label={t("storage.autoSync")} data-testid="auto-sync-switch" />
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("storage.removeTitle", { name: removing?.name ?? "" })}
        description={t("storage.removeBody")}
        confirmLabel={t("storage.remove")}
        onConfirm={remove}
      />
    </div>
  );
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div>
      <dt className="text-micro text-fg-muted">{label}</dt>
      <dd className={strong ? "text-h3 font-semibold" : "text-h3"} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function DocumentRow({ doc, online }: { doc: OfflineDocumentView; online: boolean }) {
  const t = useTranslations("offline");
  const time = useTimeLabel();
  const [busy, setBusy] = React.useState(false);
  const stale = doc.state === "UPDATE_AVAILABLE";
  return (
    <Card compact data-testid="offline-document" data-state={doc.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate font-medium">
            <FileText className="size-4 shrink-0" aria-hidden /> <span className="truncate">{doc.name}</span>
          </p>
          <p className="text-micro text-fg-muted">
            {t("documents.downloadedVersion", { version: doc.downloadedVersion })}
            {doc.currentVersion !== null && stale ? ` · ${t("documents.currentVersion", { version: doc.currentVersion })}` : ""} · {formatBytes(doc.size)}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {stale ? <Badge tone="warning">{t("documents.superseded")}</Badge> : null}
            {doc.state === "UNAVAILABLE" ? <Badge tone="danger">{t("documents.unavailable")}</Badge> : null}
            {doc.state === "UNCHECKED" ? <Badge>{t("documents.unchecked")}</Badge> : null}
          </div>
          <p className="text-micro text-fg-muted">{t("documents.lastUpdated", { time: time(doc.lastUpdated) })}</p>
        </div>
        <div className="flex gap-2">
          {stale ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={!online}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const db = offlineRuntime().database;
                  const project = offlineRuntime().getState().projects.find((p) => p.projectId === doc.projectId);
                  if (db) await updateOfflineDocument(db, doc.projectId, project?.companyId ?? "", doc.documentId);
                  offlineRuntime().notifyChanged();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("documents.update")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await offlineRuntime().run((db) => removeOfflineDocument(db, doc.projectId, doc.documentId));
            }}
          >
            {t("documents.remove")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
