"use client";

import { unsaved } from "@/lib/unsaved/coordinator";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload } from "lucide-react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { checkModelFile, formatMegabytes, MAX_MODEL_BYTES, putModelFile, type ModelUploadIntent } from "@/lib/3d/platform/model-upload";
import { cn } from "@/lib/utils/cn";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import type { Translate } from "@/lib/i18n/translator";
import { RemoveModelDialog } from "./RemoveModelDialog";
import { useModelProcessingPoll } from "./use-model-processing-poll";
import { FormSelect } from "@/components/ui/form-select";

export type IngestionVersion = { id: string; version: number; status: string; validationStatus: string; originalFileName: string; validationIssues?: unknown; stalled?: boolean; assetMissing?: boolean };
export type IngestionSlot = { id: string; displayName: string; role: string; versions: IngestionVersion[] };

/** One upload in flight, kept across a retry so a retry never makes a second version. */
type Attempt = { file: File; slotId: string; intent?: ModelUploadIntent; sent: boolean };

/** One file in the multi-upload list (Models page): its own model, uploaded in turn. */
type Item = { key: string; file: File; state: "queued" | "sending" | "verifying" | "done" | "failed" | "rejected"; percent: number; error: string | null };
type ItemAttempt = { slotId?: string; intent?: ModelUploadIntent; sent: boolean };

const ROLES = ["BUILDING", "UNITS", "SURROUNDINGS", "CONTEXT", "CUSTOM"] as const;

function slugOf(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : `model-${slug}`.replace(/-+$/, "");
}

const ENGLISH_STATES = {
  uploadNotFinished: "Upload not finished",
  stalled: "Preparation stalled",
  preparing: "Preparing…",
  failed: "Failed",
  fileMissing: "File missing",
  published: "Published",
  readyWarnings: "Ready, with warnings",
  ready: "Ready",
} as const;

/**
 * The state of a model version, in words. Pass the adminPlatform translator to
 * read it in the reader's language; without one (the Experience Editor, which
 * has no dictionary of its own mounted) it reads in English.
 */
export function versionStateLabel(version: IngestionVersion, t?: Translate<"adminPlatform">): string {
  const word = (key: keyof typeof ENGLISH_STATES) => (t ? t(`threeDAdmin.ingestion.versionStates.${key}`) : ENGLISH_STATES[key]);
  if (version.status === "UPLOADED") return word("uploadNotFinished");
  if (version.status === "PROCESSING") return version.stalled ? word("stalled") : word("preparing");
  if (version.status === "FAILED") return word("failed");
  if (version.assetMissing) return word("fileMissing");
  if (version.status === "PUBLISHED") return word("published");
  if (version.status === "READY") return version.validationStatus === "WARNING" ? word("readyWarnings") : word("ready");
  return version.status.toLowerCase();
}

export function versionIssues(version: IngestionVersion): string[] {
  return Array.isArray(version.validationIssues) ? version.validationIssues.filter((issue): issue is string => typeof issue === "string") : [];
}

/**
 * Upload a GLB — a new model, or a new version of one — in the editor's Scene
 * panel (`compact`, dark) and on the Models page. The bytes go straight to the
 * private storage grant with measured progress; a retry reuses the same grant
 * and version, and once the bytes are there only the verification repeats.
 * Uploading never publishes: a release does that.
 */
export function ModelIngestionPanel({ projectId, slots, uploadLimitBytes = MAX_MODEL_BYTES, compact = false, onBusyChange, onQueued }: {
  projectId: string;
  slots: IngestionSlot[];
  uploadLimitBytes?: number;
  compact?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** Called with the new version once its bytes are verified and it is being prepared. */
  onQueued?: (versionId: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("adminPlatform");
  const id = React.useId();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const attempt = React.useRef<Attempt | null>(null);
  const busy = React.useRef(false);
  const [target, setTarget] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("BUILDING");
  const [file, setFile] = React.useState<File | null>(null);
  const [pending, setPending] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [step, setStep] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [retryable, setRetryable] = React.useState(false);
  const [queuedId, setQueuedId] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<IngestionSlot | null>(null);
  const [items, setItems] = React.useState<Item[]>([]);
  const attempts = React.useRef(new Map<string, ItemAttempt>());

  // The editor runs its own poll; the Models page relies on this one.
  useModelProcessingPoll(projectId, compact ? [] : slots, compact ? null : queuedId);

  const targetSlot = slots.find((slot) => slot.id === target) ?? null;
  // Several files at once: the Models page, as new models (a new version is one file of one model).
  const multi = !compact && !targetSlot;
  const patchItem = (key: string, patch: Partial<Item>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const queued = queuedId ? slots.flatMap((slot) => slot.versions).find((version) => version.id === queuedId) ?? null : null;

  React.useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => {
      if (unsaved.isLeaving()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending]);

  function setBusy(value: boolean) {
    busy.current = value;
    setPending(value);
    onBusyChange?.(value);
  }

  async function chooseFile(next: File | null) {
    attempt.current = null;
    setRetryable(false);
    setError(null);
    setStep("");
    setFile(next);
    if (!next) return;
    if (!name.trim()) setName(next.name.replace(/\.glb$/i, "").slice(0, 120));
    try {
      await checkModelFile(next, uploadLimitBytes);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("threeDAdmin.ingestion.fileRejected"));
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const known = new Set(items.map((item) => `${item.file.name}:${item.file.size}`));
    const added: Item[] = [];
    for (const next of Array.from(list)) {
      const fingerprint = `${next.name}:${next.size}`;
      if (known.has(fingerprint)) continue;
      known.add(fingerprint);
      let state: Item["state"] = "queued";
      let message: string | null = null;
      try {
        await checkModelFile(next, uploadLimitBytes);
      } catch (failure) {
        state = "rejected";
        message = failure instanceof Error ? failure.message : t("threeDAdmin.ingestion.fileRejected");
      }
      added.push({ key: crypto.randomUUID(), file: next, state, percent: 0, error: message });
    }
    setItems((current) => [...current, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeItem(key: string) {
    attempts.current.delete(key);
    setItems((current) => current.filter((item) => item.key !== key));
  }

  async function uploadItems() {
    if (busy.current) return;
    const todo = items.filter((item) => item.state === "queued" || item.state === "failed");
    if (todo.length === 0) return;
    setBusy(true);
    setError(null);
    let done = 0;
    let failed = 0;
    let lastQueued: string | null = null;
    for (const [index, item] of todo.entries()) {
      setStep(t("threeDAdmin.ingestion.multi.progressTitle", { current: index + 1, total: todo.length }));
      const mine = attempts.current.get(item.key) ?? { sent: false };
      attempts.current.set(item.key, mine);
      try {
        patchItem(item.key, { state: "sending", percent: 0, error: null });
        if (!mine.slotId) {
          const displayName = (todo.length === 1 && name.trim() ? name.trim() : item.file.name.replace(/\.glb$/i, "")).slice(0, 120);
          if (displayName.length < 2) throw new Error(t("threeDAdmin.ingestion.nameTooShort"));
          const slot = await engineeringApi<{ id: string }>(`/api/platform/3d/projects/${projectId}/slots`, {
            body: { kind: "DETAIL", role, slotKey: `${slugOf(displayName)}-${crypto.randomUUID().slice(0, 8)}`, displayName, sortOrder: slots.length + index },
          });
          mine.slotId = slot.id;
        }
        if (!mine.intent) {
          mine.intent = await engineeringApi<ModelUploadIntent>(`/api/platform/3d/projects/${projectId}/slots/${mine.slotId}/uploads`, {
            body: { fileName: item.file.name, sizeBytes: item.file.size },
          });
        }
        if (!mine.sent) {
          if (Date.parse(mine.intent.upload.expiresAt) <= Date.now()) {
            mine.intent = undefined;
            throw new Error(t("threeDAdmin.ingestion.grantExpired"));
          }
          await putModelFile(mine.intent, item.file, (percent) => patchItem(item.key, { percent }));
          mine.sent = true;
        }
        patchItem(item.key, { state: "verifying", percent: 100 });
        await engineeringApi(`/api/platform/3d/projects/${projectId}/versions/${mine.intent.versionId}/complete`, { body: {} });
        patchItem(item.key, { state: "done" });
        attempts.current.delete(item.key);
        lastQueued = mine.intent.versionId;
        done += 1;
      } catch (failure) {
        failed += 1;
        patchItem(item.key, { state: "failed", error: failureMessage(failure, failure instanceof Error ? failure.message : t("threeDAdmin.ingestion.uploadFailed")) });
      }
    }
    setStep("");
    setBusy(false);
    if (lastQueued) setQueuedId(lastQueued);
    setItems((current) => current.filter((item) => item.state !== "done"));
    if (failed === 0) {
      setName("");
      toast({ title: t("threeDAdmin.ingestion.multi.allDone", { count: done }), description: t("threeDAdmin.ingestion.uploadedToastDescription"), tone: "success" });
    } else {
      setError(t("threeDAdmin.ingestion.multi.someFailed", { done, failed }));
    }
    router.refresh();
  }

  function clearFile() {
    attempt.current = null;
    setRetryable(false);
    setFile(null);
    setName("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function upload() {
    if (multi) return uploadItems();
    if (busy.current || !file) return;
    setBusy(true);
    setError(null);
    try {
      await checkModelFile(file, uploadLimitBytes);
      if (!attempt.current) {
        let slotId = targetSlot?.id ?? "";
        if (!slotId) {
          const displayName = (name.trim() || file.name.replace(/\.glb$/i, "")).slice(0, 120);
          if (displayName.length < 2) throw new Error(t("threeDAdmin.ingestion.nameTooShort"));
          setStep(t("threeDAdmin.ingestion.creatingModel"));
          const slot = await engineeringApi<{ id: string }>(`/api/platform/3d/projects/${projectId}/slots`, {
            body: { kind: "DETAIL", role, slotKey: `${slugOf(displayName)}-${crypto.randomUUID().slice(0, 8)}`, displayName, sortOrder: slots.length },
          });
          slotId = slot.id;
          // From here on, a retry adds a version to this model instead of creating another.
          setTarget(slot.id);
        }
        attempt.current = { file, slotId, sent: false };
      }
      const current = attempt.current;
      if (!current.intent) {
        setStep(t("threeDAdmin.ingestion.preparingUpload"));
        current.intent = await engineeringApi<ModelUploadIntent>(`/api/platform/3d/projects/${projectId}/slots/${current.slotId}/uploads`, {
          body: { fileName: current.file.name, sizeBytes: current.file.size },
        });
      }
      if (!current.sent) {
        if (Date.parse(current.intent.upload.expiresAt) <= Date.now()) {
          attempt.current = { ...current, intent: undefined };
          throw new Error(t("threeDAdmin.ingestion.grantExpired"));
        }
        setStep(t("threeDAdmin.ingestion.uploading"));
        setProgress(0);
        await putModelFile(current.intent, current.file, setProgress);
        current.sent = true;
      }
      setProgress(null);
      setStep(t("threeDAdmin.ingestion.verifying"));
      await engineeringApi(`/api/platform/3d/projects/${projectId}/versions/${current.intent.versionId}/complete`, { body: {} });
      setQueuedId(current.intent.versionId);
      onQueued?.(current.intent.versionId);
      setStep(t("threeDAdmin.ingestion.uploadedPreparing"));
      setTarget("");
      clearFile();
      if (!compact) toast({ title: t("threeDAdmin.ingestion.uploadedToast"), description: t("threeDAdmin.ingestion.uploadedToastDescription"), tone: "success" });
    } catch (failure) {
      setProgress(null);
      setStep("");
      setRetryable(Boolean(attempt.current?.intent));
      setError(failureMessage(failure, failure instanceof Error ? failure.message : t("threeDAdmin.ingestion.uploadFailed")));
    } finally {
      setBusy(false);
      // Shows the new model (or reconciles a create whose answer was lost) without touching unsaved edits.
      router.refresh();
    }
  }

  const locked = pending || retryable;
  const queuedLabel = queued ? (queued.status === "READY" || queued.status === "PUBLISHED" ? t("threeDAdmin.ingestion.queuedReady") : queued.status === "FAILED" ? t("threeDAdmin.ingestion.queuedFailed") : "") : "";
  const status = pending ? step : queuedLabel || step;

  const field = compact
    ? "mt-1 block h-9 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2.5 text-xs text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
    : cn(selectClass, "mt-1.5");
  const label = compact ? "block text-[11px] font-medium text-fg-muted" : "block text-meta font-medium text-fg-muted";
  const hint = compact ? "text-[11px] leading-4 text-fg-subtle" : "text-table text-fg-muted";

  const form = (
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
      <fieldset disabled={locked} className="min-w-0 space-y-3">
        <label className={label} htmlFor={`${id}-target`}>
          {t("threeDAdmin.ingestion.uploadAs")}
          <FormSelect id={`${id}-target`} className={field} value={targetSlot ? target : ""} onChange={(event) => { setTarget(event.target.value); if (event.target.value) { setItems([]); attempts.current.clear(); } }}>
            <option value="">{t("threeDAdmin.ingestion.newModel")}</option>
            {slots.map((slot) => <option key={slot.id} value={slot.id}>{t("threeDAdmin.ingestion.newVersionOf", { name: slot.displayName })}</option>)}
          </FormSelect>
        </label>
        {targetSlot ? (
          <p className={hint}>{t("threeDAdmin.ingestion.addsVersion", { version: Math.max(0, ...targetSlot.versions.map((version) => version.version)) + 1 })}</p>
        ) : (
          <div className={compact ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
            {multi && items.length > 1 ? null : <label className={label} htmlFor={`${id}-name`}>
              {t("threeDAdmin.ingestion.modelName")}
              {compact ? <input id={`${id}-name`} className={field} value={name} maxLength={120} placeholder={t("threeDAdmin.ingestion.modelNamePlaceholder")} onChange={(event) => setName(event.target.value)} /> : <Input id={`${id}-name`} className="mt-1.5" value={name} maxLength={120} placeholder={t("threeDAdmin.ingestion.modelNamePlaceholder")} onChange={(event) => setName(event.target.value)} />}
            </label>}
            <label className={label} htmlFor={`${id}-role`}>
              {t("threeDAdmin.ingestion.purpose")}
              <FormSelect id={`${id}-role`} className={field} value={role} onChange={(event) => setRole(event.target.value)}>
                {ROLES.map((option) => <option key={option} value={option}>{t(`threeDAdmin.ingestion.roles.${option}`)}</option>)}
              </FormSelect>
            </label>
          </div>
        )}
      </fieldset>
      <label className={label} htmlFor={`${id}-file`}>
        {t("threeDAdmin.ingestion.glbFile")}
        <input
          ref={fileInput}
          id={`${id}-file`}
          type="file"
          accept=".glb,model/gltf-binary"
          disabled={pending}
          multiple={multi}
          className={cn(compact ? "mt-1 block w-full min-w-0 text-[11px] text-fg-muted file:mr-2 file:rounded file:border-0 file:bg-surface-muted file:px-2 file:py-1.5 file:text-xs file:text-fg hover:file:bg-line-strong" : "mt-1.5 block w-full text-table text-fg file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-table file:text-fg")}
          onChange={(event) => (multi ? void addFiles(event.target.files) : void chooseFile(event.target.files?.[0] ?? null))}
        />
      </label>
      {multi ? (
        <>
          <p className={hint}>{t("threeDAdmin.ingestion.multi.hint", { limit: formatMegabytes(uploadLimitBytes) })}</p>
          {items.length > 0 ? (
            <ul className="divide-y divide-line rounded-lg border border-line" aria-label={t("threeDAdmin.ingestion.glbFile")}>
              {items.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-table">
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">{item.file.name}</span>
                  <span className="text-meta text-fg-subtle">{formatMegabytes(item.file.size)}</span>
                  <Badge tone={item.state === "failed" || item.state === "rejected" ? "danger" : item.state === "done" ? "success" : item.state === "queued" ? "neutral" : "info"}>
                    {item.state === "sending" ? t("threeDAdmin.ingestion.multi.states.sending", { percent: item.percent }) : t(`threeDAdmin.ingestion.multi.states.${item.state}`)}
                  </Badge>
                  {!pending ? <Button type="button" size="sm" variant="ghost" aria-label={t("threeDAdmin.ingestion.multi.removeFile", { name: item.file.name })} onClick={() => removeItem(item.key)}><Trash2 aria-hidden="true" /></Button> : null}
                  {item.state === "sending" ? <progress aria-label={t("threeDAdmin.ingestion.progressLabel")} className="h-1.5 w-full overflow-hidden rounded [&::-webkit-progress-bar]:bg-line-strong [&::-webkit-progress-value]:bg-accent" max={100} value={item.percent} /> : null}
                  {item.error ? <p role="alert" className="w-full break-words text-meta text-danger-strong">{item.error}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className={hint}>{file ? t("threeDAdmin.ingestion.fileInfo", { name: file.name, size: formatMegabytes(file.size) }) : ""}{t("threeDAdmin.ingestion.hint", { limit: formatMegabytes(uploadLimitBytes) })}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || (multi ? !items.some((item) => item.state === "queued" || item.state === "failed") : !file)}>
          <Upload aria-hidden="true" />{pending ? t("threeDAdmin.ingestion.working") : multi ? (items.some((item) => item.state === "failed") ? t("threeDAdmin.ingestion.multi.retryFailed") : t("threeDAdmin.ingestion.multi.uploadN", { count: items.filter((item) => item.state === "queued").length })) : retryable ? t("threeDAdmin.ingestion.retryUpload") : t("threeDAdmin.ingestion.uploadGlb")}
        </Button>
        {multi && items.length > 0 && !pending ? <Button type="button" size="sm" variant="ghost" onClick={() => { setItems([]); attempts.current.clear(); setError(null); }}>{t("threeDAdmin.ingestion.multi.clearAll")}</Button> : null}
        {retryable && !pending ? <Button type="button" size="sm" variant="ghost" className={compact ? "text-fg-muted hover:text-fg" : undefined} onClick={() => { clearFile(); setError(null); }}>{t("threeDAdmin.ingestion.startOver")}</Button> : null}
      </div>
      {progress !== null ? (
        <div>
          <progress aria-label={t("threeDAdmin.ingestion.progressLabel")} className="h-1.5 w-full overflow-hidden rounded [&::-webkit-progress-bar]:bg-line-strong [&::-webkit-progress-value]:bg-accent" max={100} value={progress} />
          <p className={hint}>{t("threeDAdmin.ingestion.percentSent", { percent: progress })}</p>
        </div>
      ) : null}
      <p role="status" className={cn(hint, !status && "sr-only")}>{status}</p>
      {error ? <p role="alert" className={compact ? "break-words text-xs text-danger-strong" : "break-words text-table text-danger-strong"}>{error}</p> : null}
    </form>
  );

  if (compact) {
    return (
      <section aria-label={t("threeDAdmin.ingestion.sectionLabel")} className="border-b border-line p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">{t("threeDAdmin.ingestion.sectionTitle")}</p>
        {form}
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("threeDAdmin.ingestion.uploadCardTitle")}</CardTitle>
            <CardDescription>{t("threeDAdmin.ingestion.uploadCardDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>{form}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("threeDAdmin.ingestion.modelsTitle")}</CardTitle>
            <CardDescription>{t("threeDAdmin.ingestion.modelsDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {slots.length === 0 ? <p className="text-table text-fg-muted">{t("threeDAdmin.ingestion.noModels")}</p> : null}
          {slots.map((slot) => (
            <section key={slot.id} aria-label={slot.displayName} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-body font-semibold text-fg">{slot.displayName}</h3>
                  <p className="text-meta text-fg-subtle">{enumLabel(t, "threeDAdmin.ingestion.roles", slot.role)}</p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(slot)}><Trash2 aria-hidden="true" />{t("threeDAdmin.ingestion.removeModel")}</Button>
              </div>
              {slot.versions.length === 0 ? <p className="mt-2 text-table text-fg-muted">{t("threeDAdmin.ingestion.noVersions")}</p> : null}
              <ul className="mt-2 space-y-2">
                {slot.versions.map((version) => (
                  <li key={version.id} className="border-t border-line pt-2 text-table">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg">v{version.version}</span>
                      <span className="min-w-0 truncate text-fg-muted">{version.originalFileName}</span>
                      <Badge tone={version.status === "FAILED" || version.stalled || version.assetMissing ? "danger" : version.status === "PROCESSING" ? "info" : version.status === "UPLOADED" ? "neutral" : version.validationStatus === "WARNING" ? "warning" : "success"}>{versionStateLabel(version, t)}</Badge>
                    </div>
                    {versionIssues(version).map((issue, index) => <p key={index} className="mt-1 text-meta text-warning-strong">{issue}</p>)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>
      <RemoveModelDialog projectId={projectId} slot={removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} onRemoved={() => { toast({ title: t("threeDAdmin.ingestion.modelRemoved"), tone: "success" }); router.refresh(); }} />
    </div>
  );
}
