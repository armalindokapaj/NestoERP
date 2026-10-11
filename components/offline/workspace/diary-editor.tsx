"use client";

import * as React from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getPlatformServices } from "@/lib/device/registry";
import { prepareImage } from "@/lib/field/image-prepare";
import {
  addDiaryEntry,
  addDiaryPhoto,
  composeDiaries,
  removeDiaryEntry,
  removeDiaryPhoto,
  saveDiaryFields,
  startDiary,
  submitDiary,
  type LocalDiaryView,
} from "@/lib/offline/modules/diary";
import { retry } from "@/lib/offline/queue";
import { offlineRuntime } from "@/lib/offline/runtime";

import { useOffline } from "../use-offline";
import { useOfflineQuery } from "./use-offline-data";
import type { OfflineRoute } from "./use-offline-route";

type ServerDraft = { id: string; version: number; status: string; workDate: string; summary: string | null; generalNotes: string | null; weatherSummary: string | null; activities?: Array<{ title: string }>; workforce?: Array<{ organizationName: string; headcount: number }>; photos?: number };

/**
 * The Site Diary, offline (MOB-09 §36-§39, §40-§43).
 *
 * Everything here writes to the device. The screen says "Saved on this device"
 * and "Submission queued" — never "Submitted" — because the server has not
 * spoken yet; a photo confirmed here is stored and survives the app closing.
 */
export function DiaryEditor({ route, onOpen, locked }: { route: OfflineRoute; onOpen: (id: string) => void; locked: boolean }) {
  const t = useTranslations("offline");
  const state = useOffline();
  const projectId = route.project ?? "";
  const project = state.projects.find((entry) => entry.projectId === projectId);
  const target = route.id && route.id !== "new" ? route.id : null;

  // A new entry is the day's diary: the one already on the device or the server, or a fresh one.
  React.useEffect(() => {
    if (route.id !== "new" || !project || locked) return;
    const runtime = offlineRuntime();
    void (async () => {
      const db = runtime.database;
      if (!db) return;
      const info = await db.getProject(projectId);
      const workDate = info?.body.diary.today ?? new Date().toISOString().slice(0, 10);
      const id = await startDiary(db, { companyId: project.companyId, projectId, workDate, projectLabel: project.name });
      runtime.notifyChanged();
      onOpen(id);
    })();
  }, [route.id, project, projectId, locked, onOpen]);

  const loaded = useOfflineQuery(
    async (db) => {
      if (!target) return null;
      const views = await composeDiaries(db, projectId);
      const view = views.find((entry) => entry.targetId === target) ?? null;
      let server: ServerDraft | null = null;
      for (const kind of ["dailyLogDrafts", "dailyLogs"] as const) {
        const hit = await db.getCache<ServerDraft>(projectId, kind, target);
        if (hit) {
          server = hit.data;
          break;
        }
      }
      const info = await db.getProject(projectId);
      return { view, server, canCreate: info?.body.diary.canCreate ?? true };
    },
    [target, projectId],
  );

  if (!project) return <p className="text-body text-fg-muted">{t("app.nothing")}</p>;
  if (!target || !loaded) return <Loader2 className="mx-auto size-5 animate-spin text-fg-muted" aria-label={t("sync.syncing")} />;
  const { view, server } = loaded;
  return <DiaryForm key={target} targetId={target} view={view} server={server} project={project} locked={locked} />;
}

function DiaryForm({ targetId, view, server, project, locked }: { targetId: string; view: LocalDiaryView | null; server: ServerDraft | null; project: { projectId: string; companyId: string; name: string }; locked: boolean }) {
  const t = useTranslations("offline");
  const [summary, setSummary] = React.useState(view?.fields.summary ?? server?.summary ?? "");
  const [notes, setNotes] = React.useState(view?.fields.generalNotes ?? server?.generalNotes ?? "");
  const [work, setWork] = React.useState("");
  const [crew, setCrew] = React.useState("");
  const [headcount, setHeadcount] = React.useState("1");
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const label = t("diary.queueLabel", { project: project.name });
  const context = { companyId: project.companyId, projectId: project.projectId, label };
  const editable = !server || server.status === "DRAFT" || server.status === "CORRECTION_REQUIRED";
  const activities = view?.entries.filter((entry) => entry.section === "activities") ?? [];
  const crews = view?.entries.filter((entry) => entry.section === "workforce") ?? [];
  const photos = view?.photos ?? [];
  const submitted = view?.submission.queued ?? false;
  const runtime = offlineRuntime();

  const persistFields = async () => {
    await runtime.run((db) => saveDiaryFields(db, { targetId, ...context, fields: { summary: summary.trim() || null, generalNotes: notes.trim() || null } }));
  };

  const save = async () => {
    setBusy(true);
    try {
      await persistFields();
      setMessage(t("diary.saved"));
    } finally {
      setBusy(false);
    }
  };

  const addWork = async () => {
    const title = work.trim();
    if (!title) return;
    await runtime.run((db) => addDiaryEntry(db, { targetId, ...context, section: "activities", entry: { title } }));
    setWork("");
  };

  const addCrew = async () => {
    const name = crew.trim();
    const people = Number(headcount);
    if (!name || !Number.isInteger(people) || people < 1) return;
    await runtime.run((db) => addDiaryEntry(db, { targetId, ...context, section: "workforce", entry: { organizationName: name, headcount: people } }));
    setCrew("");
    setHeadcount("1");
  };

  const addPhotos = async (source: "camera" | "files") => {
    const capture = getPlatformServices().capture;
    const captured = source === "camera" ? [await capture.capturePhoto()].filter((entry) => entry !== null) : await capture.selectPhotos({ multiple: true });
    for (const item of captured) {
      const prepared = await prepareImage(item.file);
      await runtime.run((db) => addDiaryPhoto(db, { targetId, ...context, file: prepared, name: prepared.name || "photo.jpg", mime: prepared.type || "image/jpeg", takenTime: new Date().toTimeString().slice(0, 5) }));
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await persistFields();
      await runtime.run((db) => submitDiary(db, { targetId, ...context }));
      setMessage(t("diary.submissionQueued"));
    } finally {
      setBusy(false);
    }
  };

  const hasContent = activities.length + crews.length + photos.length > 0 || (server?.activities?.length ?? 0) + (server?.workforce?.length ?? 0) + (server?.photos ?? 0) > 0;
  const sync = view?.syncState;
  const statusLine = submitted ? t("diary.submissionQueued") : !view ? t("diary.synced") : sync === "LOCAL_ONLY" ? t("diary.savedOnDevice") : t("diary.waitingToSync");

  return (
    <div className="space-y-4" data-testid="diary-editor">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-h2 font-semibold">{t("diary.title")}</h2>
        <Badge tone={sync === "FAILED" || sync === "CONFLICT" ? "warning" : view ? "info" : "success"} data-testid="diary-status">
          {statusLine}
        </Badge>
        {view?.workDate ?? server?.workDate ? <span className="text-body text-fg-muted">{view?.workDate ?? server?.workDate}</span> : null}
      </div>
      {server ? <p className="text-body text-fg-muted">{t("diary.serverStatus", { status: t(`diary.status.${server.status}` as never) })}</p> : null}
      {view?.attention ? (
        <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-body text-warning-strong" data-testid="diary-attention">
          {t("diary.attention", { message: view.attention.message ?? view.attention.label })}
        </p>
      ) : null}

      {locked || !editable || submitted ? (
        <fieldset disabled className="space-y-2 opacity-80">
          <p className="whitespace-pre-wrap text-body">{summary}</p>
        </fieldset>
      ) : (
        <Card className="space-y-3">
          <label className="block space-y-1">
            <span className="text-body font-medium">{t("diary.summary")}</span>
            <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={t("diary.summaryPlaceholder")} rows={3} data-testid="diary-summary" />
          </label>
          <label className="block space-y-1">
            <span className="text-body font-medium">{t("diary.notes")}</span>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} data-testid="diary-notes" />
          </label>
        </Card>
      )}

      <Card className="space-y-3">
        <h3 className="font-semibold">{t("diary.workDone")}</h3>
        <ul className="space-y-1">
          {activities.map((entry) => (
            <li key={entry.mutationId} className="flex items-center justify-between gap-2 text-body" data-testid="diary-work-row">
              <span>{String(entry.input.title)}</span>
              {!submitted ? <Button size="icon-sm" variant="ghost" aria-label={t("diary.remove")} onClick={() => void runtime.run((db) => removeDiaryEntry(db, entry.mutationId))}><Trash2 aria-hidden /></Button> : null}
            </li>
          ))}
        </ul>
        {!locked && editable && !submitted ? (
          <div className="flex gap-2">
            <Input value={work} onChange={(event) => setWork(event.target.value)} placeholder={t("diary.workDonePlaceholder")} aria-label={t("diary.workDone")} data-testid="diary-work-input" />
            <Button variant="secondary" onClick={addWork} data-testid="diary-work-add"><Plus aria-hidden /> {t("diary.addWork")}</Button>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">{t("diary.workforce")}</h3>
        <ul className="space-y-1">
          {crews.map((entry) => (
            <li key={entry.mutationId} className="flex items-center justify-between gap-2 text-body" data-testid="diary-crew-row">
              <span>{String(entry.input.organizationName)} · {String(entry.input.headcount)}</span>
              {!submitted ? <Button size="icon-sm" variant="ghost" aria-label={t("diary.remove")} onClick={() => void runtime.run((db) => removeDiaryEntry(db, entry.mutationId))}><Trash2 aria-hidden /></Button> : null}
            </li>
          ))}
        </ul>
        {!locked && editable && !submitted ? (
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-40 flex-1" value={crew} onChange={(event) => setCrew(event.target.value)} placeholder={t("diary.crewName")} aria-label={t("diary.crewName")} data-testid="diary-crew-input" />
            <Input className="w-24" type="number" min={1} value={headcount} onChange={(event) => setHeadcount(event.target.value)} aria-label={t("diary.headcount")} data-testid="diary-headcount-input" />
            <Button variant="secondary" onClick={addCrew} data-testid="diary-crew-add"><Plus aria-hidden /> {t("diary.addCrew")}</Button>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">{t("diary.photos")}</h3>
        <ul className="space-y-1" data-testid="diary-photos">
          {photos.map((photo) => (
            <li key={photo.mutationId} className="flex flex-wrap items-center justify-between gap-2 text-body" data-testid="diary-photo-row" data-state={photo.state}>
              <span className="truncate">{photo.name}</span>
              <span className="flex items-center gap-2">
                <Badge tone={photo.state === "FAILED" ? "danger" : photo.state === "SYNCING" ? "info" : "default"}>
                  {photo.state === "FAILED" ? t("diary.photoFailed") : photo.state === "SYNCING" ? t("diary.photoUploading", { progress: photo.progress }) : t("diary.photoWaiting")}
                </Badge>
                {photo.state === "FAILED" ? (
                  <Button size="sm" variant="secondary" onClick={() => void runtime.run((db) => retry(db, photo.mutationId)).then(() => runtime.syncNow("retry", { manual: true }))}>
                    <RefreshCw aria-hidden /> {t("diary.retry")}
                  </Button>
                ) : null}
                {photo.state !== "SYNCING" && !submitted ? <Button size="icon-sm" variant="ghost" aria-label={t("diary.remove")} onClick={() => void runtime.run((db) => removeDiaryPhoto(db, photo.mutationId))}><Trash2 aria-hidden /></Button> : null}
              </span>
            </li>
          ))}
        </ul>
        {!locked && editable && !submitted ? (
          <div className="flex flex-wrap gap-2">
            {getPlatformServices().capture.supportsCamera ? (
              <Button variant="secondary" onClick={() => void addPhotos("camera")} data-testid="diary-photo-camera"><Camera aria-hidden /> {t("diary.takePhoto")}</Button>
            ) : null}
            <Button variant="secondary" onClick={() => void addPhotos("files")} data-testid="diary-photo-add"><ImagePlus aria-hidden /> {t("diary.chooseFile")}</Button>
          </div>
        ) : null}
      </Card>

      {!locked && editable ? (
        <div className="space-y-2">
          {!hasContent && !submitted ? <p className="text-body text-fg-muted">{t("diary.needsContent")}</p> : null}
          <div className="flex flex-wrap gap-2">
            {!submitted ? (
              <>
                <Button variant="secondary" onClick={save} loading={busy} data-testid="diary-save">
                  {t("diary.save")}
                </Button>
                <Button onClick={submit} loading={busy} disabled={!hasContent} data-testid="diary-submit">
                  <CheckCircle2 aria-hidden /> {t("diary.submit")}
                </Button>
              </>
            ) : null}
          </div>
          {!submitted ? <p className="text-micro text-fg-muted">{t("diary.submitNote")}</p> : null}
          {message ? <p role="status" className="text-body text-success-strong" data-testid="diary-message">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
