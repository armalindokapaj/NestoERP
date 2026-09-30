"use client";

import * as React from "react";
import { ArrowLeft, ChevronRight, CloudOff, HardDrive, Lock, RefreshCw } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { OfflineProvider } from "../offline-provider";
import { OfflineStatus } from "../offline-status";
import { useOffline, useTimeLabel } from "../use-offline";
import { DiaryEditor } from "./diary-editor";
import { ProjectView } from "./project-view";
import { StorageView } from "./storage-view";
import { SyncCenter } from "./sync-center";
import { TaskView } from "./task-view";
import { useOfflineRoute } from "./use-offline-route";

/**
 * The offline workspace (MOB-09 §65, §66). One page, served from the device's
 * copy when there is no network, and just as usable online. It reads only the
 * local database; the same person's data, under the same window of trust the
 * server last gave (§62).
 */
export function OfflineApp() {
  const t = useTranslations("offline");
  const state = useOffline();
  const time = useTimeLabel();
  const { route, go, back } = useOfflineRoute();

  const locked = Boolean(state.authorization?.locked);
  const view = route?.view ?? "home";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-4 pb-16 pt-4" data-testid="offline-app">
      <OfflineProvider userId={null} />
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {view !== "home" ? (
              <Button variant="ghost" size="icon" aria-label={t("app.back")} onClick={back} data-testid="offline-back">
                <ArrowLeft aria-hidden />
              </Button>
            ) : (
              <CloudOff className="size-5 shrink-0 text-fg-muted" aria-hidden />
            )}
            <div className="min-w-0">
              <h1 className="truncate text-h2 font-semibold">{t("app.title")}</h1>
              <p className="truncate text-micro text-fg-muted">{t("app.subtitle")}</p>
            </div>
          </div>
          {state.online ? (
            <Button asChild variant="secondary" size="sm">
              <a href="/dashboard">{t("app.backOnline")}</a>
            </Button>
          ) : null}
        </div>
        <OfflineStatus inShell={false} />
      </header>

      {locked ? (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-body text-warning-strong" data-testid="offline-locked">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("status.locked")}
        </p>
      ) : null}
      {state.unsupported ? <p role="alert" className="text-body text-danger-strong">{t("status.storageUnavailable")}</p> : null}
      {state.engine === "identity-mismatch" ? <p role="alert" className="text-body text-danger-strong">{t("status.identityMismatch")}</p> : null}

      <main id="offline-main" tabIndex={-1} className="space-y-4 outline-none">
        {!route ? null : view === "sync" ? (
          <SyncCenter locked={locked} />
        ) : view === "storage" ? (
          <StorageView locked={locked} />
        ) : view === "project" && route.id ? (
          <ProjectView projectId={route.id} tab={route.tab} go={go} locked={locked} />
        ) : view === "diary" && route.project ? (
          <DiaryEditor route={route} locked={locked} onOpen={(id) => go({ view: "diary", id, project: route.project }, { replace: true })} />
        ) : view === "task" && route.id ? (
          <TaskView projectId={route.project} taskId={route.id} locked={locked} />
        ) : (
          <Home locked={locked} go={go} time={time} />
        )}
      </main>
    </div>
  );
}

function Home({ locked, go, time }: { locked: boolean; go: ReturnType<typeof useOfflineRoute>["go"]; time: (value: number | null) => string }) {
  const t = useTranslations("offline");
  const state = useOffline();

  if (state.ready === false && !state.unsupported) return null;
  if (!state.userId) return <p className="text-body text-fg-muted">{t("app.noUser")}</p>;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Card compact interactive>
          <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => go({ view: "sync" })} data-testid="home-sync">
            <span className="flex items-center gap-2 font-medium"><RefreshCw className="size-4" aria-hidden /> {t("app.sync")}</span>
            <span className="flex items-center gap-2">
              {state.unsynced > 0 ? <Badge tone={state.queue.failed + state.queue.needsReview > 0 ? "warning" : "info"}>{state.unsynced}</Badge> : null}
              <ChevronRight className="size-4 text-fg-muted" aria-hidden />
            </span>
          </button>
        </Card>
        <Card compact interactive>
          <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => go({ view: "storage" })} data-testid="home-storage">
            <span className="flex items-center gap-2 font-medium"><HardDrive className="size-4" aria-hidden /> {t("app.storage")}</span>
            <ChevronRight className="size-4 text-fg-muted" aria-hidden />
          </button>
        </Card>
      </div>

      <section className="space-y-2">
        <h2 className="px-1 text-h3 font-semibold">{t("app.projects")}</h2>
        {state.projects.length === 0 ? (
          <div className="space-y-1 px-1">
            <p className="text-body">{t("app.nothing")}</p>
            <p className="text-body text-fg-muted">{t("app.nothingHint")}</p>
          </div>
        ) : null}
        {state.projects.map((project) => (
          <Card key={project.projectId} compact interactive data-testid="home-project">
            <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => go({ view: "project", id: project.projectId })} disabled={locked} data-testid="home-project-open">
              <span className="min-w-0">
                <span className="block truncate font-medium">{locked ? project.code : project.name}</span>
                <span className="block text-micro text-fg-muted">{project.lastSyncedAt ? t("app.lastSynced", { time: time(project.lastSyncedAt) }) : t("app.neverSynced")}</span>
                {project.revoked ? <span className="block text-micro text-warning-strong">{t("app.revoked")}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                {project.pending > 0 ? <Badge tone="warning">{project.pending}</Badge> : null}
                <ChevronRight className="size-4 text-fg-muted" aria-hidden />
              </span>
            </button>
          </Card>
        ))}
      </section>
    </div>
  );
}
