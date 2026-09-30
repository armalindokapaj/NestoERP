"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, WifiOff } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { SYNC_ERROR_TYPES } from "@/lib/core/sync/protocol";
import type { SyncDiagnostics } from "@/lib/offline/diagnostics";
import { discard, retry, type QueueItem } from "@/lib/offline/queue";
import { offlineRuntime } from "@/lib/offline/runtime";
import { cn } from "@/lib/utils/cn";

import { useOffline, useTimeLabel } from "../use-offline";
import { routeUrl } from "./use-offline-route";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
export { formatBytes };

/**
 * The Sync Center (MOB-09 §26-§28, §68, §88, §118).
 *
 * What is waiting, what needs a person, and when it last worked. A failure never
 * disappears: it stays here, with the reason and the way to resolve it, until
 * it is retried, reviewed or discarded. While the workspace is locked only
 * counts are shown — the labels are business content.
 */
export function SyncCenter({ locked }: { locked: boolean }) {
  const t = useTranslations("offline");
  const state = useOffline();
  const time = useTimeLabel();
  const [syncing, setSyncing] = React.useState(false);
  const [discarding, setDiscarding] = React.useState<QueueItem | null>(null);
  const [conflict, setConflict] = React.useState<QueueItem | null>(null);
  const [diagnostics, setDiagnostics] = React.useState<SyncDiagnostics | null>(null);

  const { queue, unsynced } = state;
  const attention = queue.failed + queue.needsReview;
  const waiting = unsynced - attention;
  const storageTotal = (state.storage?.usage ?? 0) + 0;

  const syncNow = async () => {
    setSyncing(true);
    try {
      await offlineRuntime().syncNow("manual", { manual: true });
    } finally {
      setSyncing(false);
    }
  };

  const loadDiagnostics = async () => setDiagnostics(await offlineRuntime().diagnostics());

  // Until the database has been read, "nothing is waiting" would be a guess.
  if (!state.ready) return <Loader2 className="mx-auto size-5 animate-spin text-fg-muted" aria-label={t("sync.syncing")} data-testid="sync-loading" />;

  const headline = unsynced === 0 ? t("sync.allSynced") : attention > 0 ? t("sync.attention", { count: attention }) : t("sync.waiting", { count: waiting });

  return (
    <div className="space-y-4" data-testid="sync-center">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {unsynced === 0 ? <CheckCircle2 className="size-5 text-success-strong" aria-hidden /> : attention > 0 ? <AlertTriangle className="size-5 text-warning-strong" aria-hidden /> : <Clock className="size-5 text-info-strong" aria-hidden />}
            <h2 className="text-h3 font-semibold" data-testid="sync-headline">
              {headline}
            </h2>
          </div>
          <Button onClick={syncNow} loading={syncing || state.engine === "syncing"} disabled={!state.online} data-testid="sync-now">
            <RefreshCw aria-hidden /> {syncing ? t("sync.syncing") : t("sync.syncNow")}
          </Button>
        </div>
        {!state.online ? (
          <p className="flex items-center gap-2 text-body text-fg-muted">
            <WifiOff className="size-4" aria-hidden /> {t("sync.offlineNow")}
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-3 text-body sm:grid-cols-4">
          <Stat label={t("sync.lastSync")} value={state.lastSyncAt ? time(state.lastSyncAt) : t("sync.never")} />
          <Stat label={t("sync.offlineProjects")} value={String(state.projects.filter((p) => !p.revoked).length)} />
          <Stat label={t("sync.deviceStorage")} value={formatBytes(storageTotal)} />
          <Stat label={t("sync.pending")} value={String(unsynced)} testId="sync-pending-count" />
        </dl>
      </Card>

      {unsynced === 0 ? <p className="px-1 text-body text-fg-muted">{t("sync.empty")}</p> : null}

      {!locked && queue.items.length > 0 ? (
        <ul className="space-y-2" data-testid="sync-items">
          {queue.items.map((item) => (
            <li key={item.id}>
              <SyncItem item={item} online={state.online} onRetry={async () => { await offlineRuntime().run((db) => retry(db, item.id)); void offlineRuntime().syncNow("retry", { manual: true }); }} onDiscard={() => setDiscarding(item)} onReview={() => setConflict(item)} />
            </li>
          ))}
        </ul>
      ) : null}

      <details className="px-1" onToggle={(event) => event.currentTarget.open && void loadDiagnostics()}>
        <summary className="cursor-pointer text-body text-fg-muted">{t("sync.diagnostics")}</summary>
        {diagnostics ? (
          <dl className="mt-2 grid grid-cols-1 gap-1 text-micro text-fg-muted sm:grid-cols-2" data-testid="sync-diagnostics">
            <Stat label={t("sync.diag.lastSuccessfulSync")} value={diagnostics.lastSuccessfulSyncAt ? time(diagnostics.lastSuccessfulSyncAt) : t("sync.never")} small />
            <Stat label={t("sync.diag.pending")} value={String(diagnostics.pendingOperations)} small />
            <Stat label={t("sync.diag.failed")} value={String(diagnostics.failedOperations)} small />
            <Stat label={t("sync.diag.needsReview")} value={String(diagnostics.needsReviewOperations)} small />
            <Stat label={t("sync.diag.database")} value={String(diagnostics.databaseVersion)} small />
            <Stat label={t("sync.diag.app")} value={diagnostics.appVersion ?? "—"} small />
            <Stat label={t("sync.diag.engine")} value={diagnostics.syncEngineVersion} small />
            <Stat label={t("sync.diag.protocol")} value={String(diagnostics.syncProtocolVersion)} small />
            <Stat label={t("sync.diag.platform")} value={diagnostics.platform} small />
          </dl>
        ) : null}
      </details>

      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => !open && setDiscarding(null)}
        title={t("sync.discardTitle")}
        description={t("sync.discardBody")}
        confirmLabel={t("sync.discardConfirm")}
        onConfirm={async () => {
          const target = discarding;
          setDiscarding(null);
          if (target) await offlineRuntime().run((db) => discard(db, target.id)).catch(() => undefined);
        }}
      />

      <ConflictDialog item={conflict} online={state.online} onClose={() => setConflict(null)} />
    </div>
  );
}

function Stat({ label, value, small, testId }: { label: string; value: string; small?: boolean; testId?: string }) {
  return (
    <div className={cn(small && "flex justify-between gap-2")}>
      <dt className={cn("text-fg-muted", small ? "" : "text-micro")}>{label}</dt>
      <dd className={cn("font-medium", small ? "" : "text-h3")} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function SyncItem({ item, online, onRetry, onDiscard, onReview }: { item: QueueItem; online: boolean; onRetry: () => void; onDiscard: () => void; onReview: () => void }) {
  const t = useTranslations("offline");
  const tone = item.state === "FAILED" || item.state === "NEEDS_REVIEW" ? "warning" : item.state === "SYNCING" ? "info" : "default";
  const errorLabel = item.errorType && (SYNC_ERROR_TYPES as readonly string[]).includes(item.errorType) ? t(`sync.errorType.${item.errorType}` as never) : null;
  return (
    <Card compact status={item.state === "FAILED" || item.state === "NEEDS_REVIEW" ? "warning" : undefined} data-testid="sync-item" data-state={item.state}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium">{item.label}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>
              {item.state === "SYNCING" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              {item.progress !== undefined && item.state === "SYNCING" ? t("sync.uploading", { progress: item.progress }) : t(`sync.state.${item.state}` as never)}
            </Badge>
            {errorLabel ? <span className="text-micro text-fg-muted">{errorLabel}</span> : null}
          </div>
          {item.message ? <p className="text-body text-fg-muted">{item.message}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {item.state === "NEEDS_REVIEW" ? (
            <Button size="sm" variant="secondary" onClick={onReview} data-testid="sync-review">
              {t("sync.review")}
            </Button>
          ) : null}
          {item.state === "FAILED" && item.errorType !== "VALIDATION" ? (
            <Button size="sm" variant="secondary" onClick={onRetry} disabled={!online} data-testid="sync-retry">
              {t("sync.retry")}
            </Button>
          ) : null}
          {item.state !== "SYNCING" ? (
            <Button size="sm" variant="ghost" onClick={onDiscard} data-testid="sync-discard">
              {t("sync.discard")}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * A change that could not safely apply (§76, §77). There is no "overwrite the
 * server": the choices are to drop the pending action or to go and look at the
 * record as it stands.
 */
function ConflictDialog({ item, online, onClose }: { item: QueueItem | null; online: boolean; onClose: () => void }) {
  const t = useTranslations("offline");
  const reviewHref = item ? (item.type === "TASK_ALLOWED_UPDATE" || item.type === "TASK_COMMENT_CREATE" ? `/tasks/${item.targetId}` : item.projectId ? `/projects/${item.projectId}/daily-logs` : "/dashboard") : "#";
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" presentation="sheet-phone" data-testid="conflict-dialog">
        <DialogTitle>{t("sync.conflictTitle")}</DialogTitle>
        <DialogDescription>{item ? t("sync.conflictBody", { label: item.label }) : ""}</DialogDescription>
        {item ? (
          <ul className="space-y-1 text-body">
            {item.current?.status ? <li>{t("sync.conflictServer", { status: item.current.status })}</li> : null}
            {item.current?.version !== undefined ? <li>{t("sync.conflictVersion", { version: item.current.version })}</li> : null}
            <li>{t("sync.conflictYours", { label: item.label })}</li>
            {item.message ? <li className="text-fg-muted">{item.message}</li> : null}
          </ul>
        ) : null}
        {!online ? <p className="text-body text-fg-muted">{t("sync.conflictOnline")}</p> : null}
        <DialogFooter>
          <Button
            variant="secondary"
            data-testid="conflict-discard"
            onClick={async () => {
              const target = item;
              onClose();
              if (target) await offlineRuntime().run((db) => discard(db, target.id)).catch(() => undefined);
            }}
          >
            {t("sync.conflictDiscard")}
          </Button>
          <Button asChild disabled={!online}>
            <a href={online ? reviewHref : routeUrl({ view: "sync" })} aria-disabled={!online}>
              {t("sync.conflictReview")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
