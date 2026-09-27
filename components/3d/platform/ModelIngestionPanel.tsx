"use client";

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
import { RemoveModelDialog } from "./RemoveModelDialog";
import { useModelProcessingPoll } from "./use-model-processing-poll";

export type IngestionVersion = { id: string; version: number; status: string; validationStatus: string; originalFileName: string; validationIssues?: unknown; stalled?: boolean; assetMissing?: boolean };
export type IngestionSlot = { id: string; displayName: string; role: string; versions: IngestionVersion[] };

/** One upload in flight, kept across a retry so a retry never makes a second version. */
type Attempt = { file: File; slotId: string; intent?: ModelUploadIntent; sent: boolean };

const ROLES = [
  { value: "BUILDING", label: "Building" },
  { value: "UNITS", label: "Units (Unit_<code> blocks)" },
  { value: "SURROUNDINGS", label: "Surroundings" },
  { value: "CONTEXT", label: "Context" },
  { value: "CUSTOM", label: "Other" },
];

function slugOf(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : `model-${slug}`.replace(/-+$/, "");
}

export function versionStateLabel(version: IngestionVersion): string {
  if (version.status === "UPLOADED") return "Upload not finished";
  if (version.status === "PROCESSING") return version.stalled ? "Preparation stalled" : "Preparing…";
  if (version.status === "FAILED") return "Failed";
  if (version.assetMissing) return "File missing";
  if (version.status === "PUBLISHED") return "Published";
  if (version.status === "READY") return version.validationStatus === "WARNING" ? "Ready, with warnings" : "Ready";
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

  // The editor runs its own poll; the Models page relies on this one.
  useModelProcessingPoll(projectId, compact ? [] : slots, compact ? null : queuedId);

  const targetSlot = slots.find((slot) => slot.id === target) ?? null;
  const queued = queuedId ? slots.flatMap((slot) => slot.versions).find((version) => version.id === queuedId) ?? null : null;

  React.useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => {
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
      setError(failure instanceof Error ? failure.message : "This file cannot be uploaded.");
    }
  }

  function clearFile() {
    attempt.current = null;
    setRetryable(false);
    setFile(null);
    setName("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function upload() {
    if (busy.current || !file) return;
    setBusy(true);
    setError(null);
    try {
      await checkModelFile(file, uploadLimitBytes);
      if (!attempt.current) {
        let slotId = targetSlot?.id ?? "";
        if (!slotId) {
          const displayName = (name.trim() || file.name.replace(/\.glb$/i, "")).slice(0, 120);
          if (displayName.length < 2) throw new Error("Give the model a name of at least two characters.");
          setStep("Creating the model…");
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
        setStep("Preparing a private upload…");
        current.intent = await engineeringApi<ModelUploadIntent>(`/api/platform/3d/projects/${projectId}/slots/${current.slotId}/uploads`, {
          body: { fileName: current.file.name, sizeBytes: current.file.size },
        });
      }
      if (!current.sent) {
        if (Date.parse(current.intent.upload.expiresAt) <= Date.now()) {
          attempt.current = { ...current, intent: undefined };
          throw new Error("The upload grant expired. Select Upload again to start over.");
        }
        setStep("Uploading…");
        setProgress(0);
        await putModelFile(current.intent, current.file, setProgress);
        current.sent = true;
      }
      setProgress(null);
      setStep("Verifying the upload…");
      await engineeringApi(`/api/platform/3d/projects/${projectId}/versions/${current.intent.versionId}/complete`, { body: {} });
      setQueuedId(current.intent.versionId);
      onQueued?.(current.intent.versionId);
      setStep("Uploaded. Preparing the model for the scene…");
      setTarget("");
      clearFile();
      if (!compact) toast({ title: "Model uploaded.", description: "It appears in the scene once it has been prepared.", tone: "success" });
    } catch (failure) {
      setProgress(null);
      setStep("");
      setRetryable(Boolean(attempt.current?.intent));
      setError(failureMessage(failure, failure instanceof Error ? failure.message : "The model could not be uploaded."));
    } finally {
      setBusy(false);
      // Shows the new model (or reconciles a create whose answer was lost) without touching unsaved edits.
      router.refresh();
    }
  }

  const locked = pending || retryable;
  const queuedLabel = queued ? (queued.status === "READY" || queued.status === "PUBLISHED" ? "Model ready in the scene." : queued.status === "FAILED" ? "The model could not be prepared. See its issues in the model list." : "") : "";
  const status = pending ? step : queuedLabel || step;

  const field = compact
    ? "mt-1 block h-9 w-full min-w-0 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
    : cn(selectClass, "mt-1.5");
  const label = compact ? "block text-[11px] font-medium text-neutral-400" : "block text-meta font-medium text-fg-muted";
  const hint = compact ? "text-[11px] leading-4 text-neutral-500" : "text-table text-fg-muted";

  const form = (
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
      <fieldset disabled={locked} className="min-w-0 space-y-3">
        <label className={label} htmlFor={`${id}-target`}>
          Upload as
          <select id={`${id}-target`} className={field} value={targetSlot ? target : ""} onChange={(event) => setTarget(event.target.value)}>
            <option value="">A new model</option>
            {slots.map((slot) => <option key={slot.id} value={slot.id}>New version of {slot.displayName}</option>)}
          </select>
        </label>
        {targetSlot ? (
          <p className={hint}>Adds version {Math.max(0, ...targetSlot.versions.map((version) => version.version)) + 1} as a draft. Check its position and unit links before publishing.</p>
        ) : (
          <div className={compact ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
            <label className={label} htmlFor={`${id}-name`}>
              Model name
              {compact ? <input id={`${id}-name`} className={field} value={name} maxLength={120} placeholder="From the file name" onChange={(event) => setName(event.target.value)} /> : <Input id={`${id}-name`} className="mt-1.5" value={name} maxLength={120} placeholder="From the file name" onChange={(event) => setName(event.target.value)} />}
            </label>
            <label className={label} htmlFor={`${id}-role`}>
              Purpose
              <select id={`${id}-role`} className={field} value={role} onChange={(event) => setRole(event.target.value)}>
                {ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        )}
      </fieldset>
      <label className={label} htmlFor={`${id}-file`}>
        GLB file
        <input
          ref={fileInput}
          id={`${id}-file`}
          type="file"
          accept=".glb,model/gltf-binary"
          disabled={pending}
          className={cn(compact ? "mt-1 block w-full min-w-0 text-[11px] text-neutral-300 file:mr-2 file:rounded file:border-0 file:bg-neutral-800 file:px-2 file:py-1.5 file:text-xs file:text-neutral-100 hover:file:bg-neutral-700" : "mt-1.5 block w-full text-table text-fg file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-table file:text-fg")}
          onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <p className={hint}>{file ? `${file.name} · ${formatMegabytes(file.size)}. ` : ""}GLB 2.0 up to {formatMegabytes(uploadLimitBytes)}; Draco and Meshopt compression are kept. The file stays private and is prepared in the background.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !file}>
          <Upload aria-hidden="true" />{pending ? "Working…" : retryable ? "Retry upload" : "Upload GLB"}
        </Button>
        {retryable && !pending ? <Button type="button" size="sm" variant="ghost" className={compact ? "text-neutral-400 hover:text-white" : undefined} onClick={() => { clearFile(); setError(null); }}>Start over</Button> : null}
      </div>
      {progress !== null ? (
        <div>
          <progress aria-label="Upload progress" className="h-1.5 w-full overflow-hidden rounded [&::-webkit-progress-bar]:bg-neutral-700 [&::-webkit-progress-value]:bg-indigo-400" max={100} value={progress} />
          <p className={hint}>{progress}% sent</p>
        </div>
      ) : null}
      <p role="status" className={cn(hint, !status && "sr-only")}>{status}</p>
      {error ? <p role="alert" className={compact ? "break-words text-xs text-red-300" : "break-words text-table text-danger-strong"}>{error}</p> : null}
    </form>
  );

  if (compact) {
    return (
      <section aria-label="Upload a model" className="border-b border-neutral-800 p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Upload model</p>
        {form}
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Upload a model</CardTitle>
            <CardDescription>Add a GLB as a new model, or as a new version of one. The Experience Editor shows it once it has been prepared; publishing is a separate step in Releases.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>{form}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Models</CardTitle>
            <CardDescription>Every model in this Experience and its uploaded versions. A release publishes one ready version of each.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {slots.length === 0 ? <p className="text-table text-fg-muted">No models yet. Upload a GLB to begin.</p> : null}
          {slots.map((slot) => (
            <section key={slot.id} aria-label={slot.displayName} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-body font-semibold text-fg">{slot.displayName}</h3>
                  <p className="text-meta text-fg-subtle">{ROLES.find((option) => option.value === slot.role)?.label ?? slot.role}</p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(slot)}><Trash2 aria-hidden="true" />Remove model</Button>
              </div>
              {slot.versions.length === 0 ? <p className="mt-2 text-table text-fg-muted">No version uploaded yet.</p> : null}
              <ul className="mt-2 space-y-2">
                {slot.versions.map((version) => (
                  <li key={version.id} className="border-t border-line pt-2 text-table">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg">v{version.version}</span>
                      <span className="min-w-0 truncate text-fg-muted">{version.originalFileName}</span>
                      <Badge tone={version.status === "FAILED" || version.stalled || version.assetMissing ? "danger" : version.status === "PROCESSING" ? "info" : version.status === "UPLOADED" ? "neutral" : version.validationStatus === "WARNING" ? "warning" : "success"}>{versionStateLabel(version)}</Badge>
                    </div>
                    {versionIssues(version).map((issue, index) => <p key={index} className="mt-1 text-meta text-warning-strong">{issue}</p>)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>
      <RemoveModelDialog projectId={projectId} slot={removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} onRemoved={() => { toast({ title: "Model removed.", tone: "success" }); router.refresh(); }} />
    </div>
  );
}
