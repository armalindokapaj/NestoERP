"use client";

import * as React from "react";
import { CloudDownload, Loader2 } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { downloadProject, prepareProject, removeProjectDownload, UnsyncedWorkError, type DownloadProgress, type PreparedProject } from "@/lib/offline/projects";
import { offlineRuntime } from "@/lib/offline/runtime";

import { formatBytes } from "./workspace/sync-center";
import { useOffline } from "./use-offline";

type Phase = "idle" | "preparing" | "confirm" | "downloading" | "removing";

/**
 * "Available Offline" on a project (MOB-09 §7-§14). Turning it on works out
 * what it would take and asks before anything large moves: the project's data,
 * and which documents to keep. Turning it off removes the download, and refuses
 * while the person still has unsynced work on the project (§94).
 */
export function AvailableOffline({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useTranslations("offline");
  const state = useOffline();
  const project = state.projects.find((entry) => entry.projectId === projectId);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [prepared, setPrepared] = React.useState<PreparedProject | null>(null);
  const [mode, setMode] = React.useState<"selected" | "all" | "none">("selected");
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [progress, setProgress] = React.useState<DownloadProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [blocked, setBlocked] = React.useState<number | null>(null);
  const [freeBytes, setFreeBytes] = React.useState<number | null>(null);

  if (!state.ready && !state.unsupported) return null;
  if (state.unsupported) return <p className="text-micro text-fg-muted" data-testid="available-offline-unavailable">{t("available.unavailableBrowser")}</p>;

  const on = Boolean(project) && !project?.revoked && project?.status !== "FAILED";
  const working = phase === "preparing" || phase === "downloading" || project?.status === "DOWNLOADING" || project?.status === "PREPARING";

  const begin = async () => {
    setError(null);
    setPhase("preparing");
    try {
      const next = await prepareProject(projectId);
      setPrepared(next);
      try {
        const estimate = await navigator.storage?.estimate?.();
        setFreeBytes(estimate?.quota !== undefined && estimate.usage !== undefined ? Math.max(0, estimate.quota - estimate.usage) : null);
      } catch { setFreeBytes(null); }
      setChosen(new Set());
      setMode(next.estimate.documents.length > 0 ? "selected" : "none");
      setPhase("confirm");
    } catch {
      setError(t("available.failed"));
      setPhase("idle");
    }
  };

  const confirm = async () => {
    if (!prepared) return;
    const ids = mode === "all" ? prepared.estimate.documents.filter((doc) => doc.available).map((doc) => doc.documentId) : mode === "selected" ? [...chosen] : [];
    setPhase("downloading");
    try {
      await offlineRuntime().run((db) => downloadProject(db, prepared, ids, { onProgress: setProgress }));
      await offlineRuntime().syncNow("project-downloaded");
    } catch {
      setError(t("available.failed"));
    } finally {
      setPhase("idle");
      setPrepared(null);
      setProgress(null);
    }
  };

  const turnOff = async () => {
    setPhase("idle");
    try {
      await offlineRuntime().run((db) => removeProjectDownload(db, projectId));
    } catch (failure) {
      if (failure instanceof UnsyncedWorkError) setBlocked(failure.count);
    }
  };

  const selectedBytes = prepared
    ? (mode === "all" ? prepared.estimate.documents.filter((doc) => doc.available) : mode === "selected" ? prepared.estimate.documents.filter((doc) => chosen.has(doc.documentId)) : []).reduce((sum, doc) => sum + doc.sizeBytes, 0)
    : 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3" data-testid="available-offline">
      <div className="flex min-w-0 items-start gap-3">
        <CloudDownload className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium" id={`available-offline-${projectId}`}>{t("available.label")}</p>
          <p className="text-micro text-fg-muted" data-testid="available-offline-status">
            {project ? t(`storage.status.${project.status}` as never) : t("available.hint")}
            {phase === "downloading" && progress?.phase === "documents" ? ` · ${t("available.downloadingDocs", { done: progress.done, total: progress.total })}` : ""}
          </p>
          {error ? <p role="alert" className="text-micro text-danger-strong">{error}</p> : null}
          {blocked !== null ? <p role="alert" className="text-micro text-warning-strong" data-testid="available-offline-blocked">{t("available.turnOffBlocked", { count: blocked })}</p> : null}
        </div>
      </div>
      {working ? (
        <Loader2 className="size-5 animate-spin text-fg-muted" aria-label={t("available.downloading")} />
      ) : (
        <Switch
          checked={on}
          aria-labelledby={`available-offline-${projectId}`}
          data-testid="available-offline-switch"
          onCheckedChange={(checked) => {
            setBlocked(null);
            if (checked) void begin();
            else setPhase("removing");
          }}
        />
      )}

      <Dialog open={phase === "confirm"} onOpenChange={(open) => !open && setPhase("idle")}>
        <DialogContent className="max-w-md" presentation="sheet-phone" data-testid="available-offline-dialog">
          <DialogTitle>{t("available.confirmTitle", { name: projectName })}</DialogTitle>
          <DialogDescription>{t("available.hint")}</DialogDescription>
          {prepared ? (
            <div className="space-y-3">
              <dl className="space-y-1 text-body">
                <div className="flex justify-between"><dt>{t("available.projectData")}</dt><dd>{formatBytes(prepared.estimate.dataBytes)}</dd></div>
                <div className="flex justify-between"><dt>{t("available.documents")}</dt><dd data-testid="estimate-documents">{formatBytes(selectedBytes)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>{t("available.total")}</dt><dd data-testid="estimate-total">{formatBytes(prepared.estimate.dataBytes + selectedBytes)}</dd></div>
              </dl>
              {freeBytes !== null && prepared.estimate.dataBytes + selectedBytes > freeBytes * 0.8 ? (
                <p role="alert" className="text-body text-warning-strong" data-testid="low-storage-warning">{t("available.lowStorage", { free: formatBytes(freeBytes) })}</p>
              ) : null}
              {prepared.estimate.documents.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-body font-medium">{t("available.chooseDocuments")}</legend>
                  <div className="flex flex-wrap gap-2 text-body">
                    {(["none", "selected", "all"] as const).map((value) => (
                      <label key={value} className="flex items-center gap-1">
                        <input type="radio" name="doc-mode" checked={mode === value} onChange={() => setMode(value)} data-testid={`doc-mode-${value}`} />
                        {value === "none" ? t("available.noneDocuments") : value === "selected" ? t("available.selectedDocuments") : t("available.allDocuments", { count: prepared.estimate.documents.filter((doc) => doc.available).length })}
                      </label>
                    ))}
                  </div>
                  {mode === "selected" ? (
                    <ul className="max-h-48 space-y-1 overflow-auto">
                      {prepared.estimate.documents.filter((doc) => doc.available).map((doc) => (
                        <li key={doc.documentId} className="flex items-center gap-2 text-body">
                          <Checkbox checked={chosen.has(doc.documentId)} onCheckedChange={(checked) => setChosen((current) => { const next = new Set(current); if (checked) next.add(doc.documentId); else next.delete(doc.documentId); return next; })} aria-label={doc.name} />
                          <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                          <span className="text-micro text-fg-muted">{formatBytes(doc.sizeBytes)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </fieldset>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPhase("idle")}>{t("available.cancel")}</Button>
            <Button onClick={() => void confirm()} data-testid="available-offline-download">{t("available.download")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={phase === "removing"} onOpenChange={(open) => !open && setPhase("idle")} title={t("available.turnOffTitle")} description={t("available.turnOffBody")} confirmLabel={t("available.remove")} onConfirm={() => void turnOff()} />
    </div>
  );
}
