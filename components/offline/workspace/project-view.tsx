"use client";

import * as React from "react";
import { ChevronRight, Loader2, Plus, Search } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { composeDiaries, type LocalDiaryView } from "@/lib/offline/modules/diary";
import type { OfflineTask } from "@/lib/offline/modules/tasks";
import { pendingTaskChanges } from "@/lib/offline/modules/tasks";

import { useOffline, useTimeLabel } from "../use-offline";
import { DocumentsPanel } from "./documents-panel";
import { HseForm } from "./hse-form";
import { useOfflineQuery } from "./use-offline-data";
import type { OfflineRoute, OfflineView } from "./use-offline-route";

type UnitRow = { id: string; unitCode: string; name: string | null; unitType?: { name?: string }; floor?: { name: string }; building?: { name: string }; areas?: Record<string, string | null>; commercialStatus?: string };
type DiaryRow = { id: string; workDate: string; status: string; summary: string | null };

const TABS = ["tasks", "diary", "hse", "documents", "units"] as const;
type Tab = (typeof TABS)[number];

/**
 * One project on the device (MOB-09 §7-§9, §44, §54, §110-§113). Everything is
 * from the last sync and says so; search covers only what was downloaded.
 */
export function ProjectView({ projectId, tab, go, locked }: { projectId: string; tab: string | null; go: (route: Partial<OfflineRoute> & { view: OfflineView }) => void; locked: boolean }) {
  const t = useTranslations("offline");
  const state = useOffline();
  const time = useTimeLabel();
  const [query, setQuery] = React.useState("");
  const project = state.projects.find((entry) => entry.projectId === projectId);
  const active: Tab = (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "tasks";

  const data = useOfflineQuery(
    async (db) => {
      const [tasks, units, logs, diaries] = await Promise.all([
        db.listCache<OfflineTask>(projectId, "tasks"),
        db.listCache<UnitRow>(projectId, "units"),
        db.listCache<DiaryRow>(projectId, "dailyLogs"),
        composeDiaries(db, projectId),
      ]);
      const pending = new Map<string, number>();
      for (const { data: task } of tasks) pending.set(task.id, (await pendingTaskChanges(db, task.id)).length);
      return { tasks: tasks.map((entry) => entry.data), units: units.map((entry) => entry.data), logs: logs.map((entry) => entry.data), diaries, pending };
    },
    [projectId],
  );

  if (!project) return <p className="text-body text-fg-muted">{t("app.nothing")}</p>;
  if (locked) return <p className="text-body text-fg-muted">{t("status.locked")}</p>;
  if (project.revoked) {
    return (
      <div className="space-y-2" data-testid="project-revoked">
        <h2 className="text-h2 font-semibold">{project.name}</h2>
        <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-body text-warning-strong">{t("app.revoked")}</p>
        {project.pending > 0 ? <p className="text-body">{t("app.revokedPending", { count: project.pending })}</p> : null}
        <Button variant="secondary" onClick={() => go({ view: "sync" })}>{t("app.sync")}</Button>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const tasks = (data?.tasks ?? []).filter((task) => !q || task.title.toLowerCase().includes(q));
  const units = (data?.units ?? []).filter((unit) => !q || `${unit.unitCode} ${unit.name ?? ""} ${unit.unitType?.name ?? ""}`.toLowerCase().includes(q));
  const serverLogs = data?.logs ?? [];
  const localDiaries = data?.diaries ?? [];
  const localIds = new Set(localDiaries.map((entry) => entry.targetId));

  return (
    <div className="space-y-4" data-testid="project-view">
      <div className="space-y-1">
        <h2 className="text-h2 font-semibold">{project.name}</h2>
        <p className="text-body text-fg-muted">{project.lastSyncedAt ? t("app.offlineNote", { time: time(project.lastSyncedAt) }) : t("app.neverSynced")}</p>
        <p className="text-micro text-fg-muted">{t("app.staleNote")}</p>
      </div>

      <div role="tablist" aria-label={project.name} className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((name) => (
          <button key={name} role="tab" aria-selected={active === name} data-testid={`project-tab-${name}`} onClick={() => go({ view: "project", id: projectId, tab: name })} className={`min-h-11 shrink-0 border-b-2 px-3 text-body font-medium ${active === name ? "border-accent text-fg" : "border-transparent text-fg-muted"}`}>
            {t(`project.${name}` as never)}
          </button>
        ))}
      </div>

      {(active === "tasks" || active === "units") ? (
        <div className="space-y-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("app.search")} aria-label={t("app.search")} data-testid="offline-search" />
          </div>
          <p className="px-1 text-micro text-fg-muted">{t("app.searching")}</p>
        </div>
      ) : null}

      {!data ? <Loader2 className="mx-auto size-5 animate-spin text-fg-muted" aria-label={t("sync.syncing")} /> : null}

      {data && active === "tasks" ? (
        <ul className="space-y-2" data-testid="offline-tasks">
          {tasks.length === 0 ? <li className="text-body text-fg-muted">{t("project.noTasks")}</li> : null}
          {tasks.map((task) => (
            <li key={task.id}>
              <Card compact interactive>
                <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => go({ view: "task", id: task.id, project: projectId })} data-testid="offline-task">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{task.title}</span>
                    <span className="flex flex-wrap items-center gap-2 text-micro text-fg-muted">
                      <Badge tone="neutral">{t(`tasks.status.${task.status}` as never)}</Badge>
                      {task.dueDate ? t("tasks.due", { date: task.dueDate.slice(0, 10) }) : t("tasks.noDue")}
                      {(data.pending.get(task.id) ?? 0) > 0 ? <Badge tone="warning">{t("tasks.waitingToSync")}</Badge> : null}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden />
                </button>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {data && active === "diary" ? (
        <div className="space-y-2" data-testid="offline-diaries">
          <Button onClick={() => go({ view: "diary", id: "new", project: projectId })} data-testid="diary-new"><Plus aria-hidden /> {t("diary.newEntry")}</Button>
          {localDiaries.length === 0 && serverLogs.length === 0 ? <p className="text-body text-fg-muted">{t("diary.none")}</p> : null}
          {localDiaries.map((entry) => <DiaryRowCard key={entry.targetId} view={entry} onOpen={() => go({ view: "diary", id: entry.targetId, project: projectId })} />)}
          {serverLogs.filter((log) => !localIds.has(log.id)).map((log) => (
            <Card key={log.id} compact interactive>
              <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => go({ view: "diary", id: log.id, project: projectId })} data-testid="offline-diary-row">
                <span className="min-w-0"><span className="block font-medium">{log.workDate}</span><span className="block truncate text-micro text-fg-muted">{log.summary ?? ""}</span></span>
                <Badge>{t(`diary.status.${log.status}` as never)}</Badge>
              </button>
            </Card>
          ))}
        </div>
      ) : null}

      {active === "hse" ? <HseForm projectId={projectId} projectName={project.name} companyId={project.companyId} locked={locked} /> : null}

      {active === "documents" ? <DocumentsPanel projectId={projectId} companyId={project.companyId} locked={locked} /> : null}

      {data && active === "units" ? (
        <div className="space-y-2" data-testid="offline-units">
          <p className="text-micro text-fg-muted">{t("project.unitsSnapshot")}</p>
          {units.length === 0 ? <p className="text-body text-fg-muted">{t("project.noUnits")}</p> : null}
          {units.map((unit) => (
            <Card key={unit.id} compact data-testid="offline-unit">
              <p className="font-medium">{unit.unitCode}{unit.name ? ` · ${unit.name}` : ""}</p>
              <p className="text-micro text-fg-muted">{[unit.building?.name, unit.floor?.name, unit.unitType?.name, unit.areas?.internalArea ? `${unit.areas.internalArea} m²` : null].filter(Boolean).join(" · ")}</p>
              {unit.commercialStatus ? <Badge>{unit.commercialStatus}</Badge> : null}
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DiaryRowCard({ view, onOpen }: { view: LocalDiaryView; onOpen: () => void }) {
  const t = useTranslations("offline");
  const text = view.submission.queued ? t("diary.submissionQueued") : view.syncState === "LOCAL_ONLY" ? t("diary.savedOnDevice") : t("diary.waitingToSync");
  return (
    <Card compact interactive status={view.attention ? "warning" : undefined}>
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={onOpen} data-testid="offline-diary-local">
        <span className="min-w-0"><span className="block font-medium">{view.workDate ?? t("diary.today")}</span><span className="block truncate text-micro text-fg-muted">{view.fields.summary ?? ""}</span></span>
        <Badge tone={view.attention ? "warning" : "info"}>{text}</Badge>
      </button>
    </Card>
  );
}
