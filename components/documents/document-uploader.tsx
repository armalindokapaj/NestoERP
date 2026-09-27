"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { CheckCircle2, CircleAlert, RotateCcw, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { Field, FormSection, selectClass, type SelectOption } from "@/components/forms/record-form";
import { formatFileSize } from "@/lib/modules/documents/document.files";
import { UPLOAD_RETRY_LIMIT } from "@/lib/core/storage";
import { acceptedTypesText, uploadAccept } from "./upload-client";
import {
  uploadStatusLabel,
  useUploadQueue,
  type LostUpload,
  type UploadContextInput,
  type UploadItem,
} from "./upload-queue";

/**
 * The upload surface (PRD #29 §166-§174, §333-§346).
 *
 * Files go straight to storage from the browser, so the form's job is the
 * things a server cannot do: show real progress, let somebody retry one file
 * without disturbing the others, cancel a transfer properly, and never present
 * a file as ready before the server has said so (PRD #29 §342).
 *
 * The dropzone is a button, not a `div` with a drop handler bolted on, so the
 * keyboard and a screen reader reach it the same way a mouse does
 * (PRD #29 §343).
 *
 * The context, name and description typed before a file is picked are unsaved
 * work (AUD-03 §3): leaving asks. Picking files starts the upload, so there is
 * no ordinary save to offer; the queue itself holds the page while a file is
 * on its way.
 */
export function DocumentUploader({
  projects,
  clients,
  canFileToCompany,
  lockedContext,
  maxMegabytes,
  cancelHref,
  doneHref,
}: {
  projects: SelectOption[];
  clients: SelectOption[];
  canFileToCompany: boolean;
  lockedContext?:
    | { kind: "project" | "client"; id: string; label: string }
    | { kind: "record"; id: string; label: string; entityType: string };
  maxMegabytes: number;
  cancelHref: string;
  doneHref: string;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [contextKind, setContextKind] = React.useState<string>(
    lockedContext?.kind ??
      (projects.length > 0 ? "project" : canFileToCompany ? "company" : "client"),
  );
  const [projectId, setProjectId] = React.useState(projects[0]?.value ?? "");
  const [clientId, setClientId] = React.useState(clients[0]?.value ?? "");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dragging, setDragging] = React.useState(false);

  const values = JSON.stringify({ contextKind, projectId, clientId, name, description });
  // What the page opened with; after an upload, what that upload used.
  const [baseline, setBaseline] = React.useState(values);
  const editor = useUnsavedEditor({ module: "documents", saveKind: "none", workflow: "Upload", label: "Document details" });
  const { setDirty } = editor;
  React.useEffect(() => setDirty(values !== baseline), [values, baseline, setDirty]);

  const parent = React.useMemo<UploadContextInput>(() => {
    if (lockedContext?.kind === "record") {
      return { context: "record", entityType: lockedContext.entityType, entityId: lockedContext.id };
    }
    if (lockedContext?.kind === "project") return { context: "project", projectId: lockedContext.id };
    if (lockedContext?.kind === "client") return { context: "client", clientId: lockedContext.id };
    if (contextKind === "project") return { context: "project", projectId };
    if (contextKind === "client") return { context: "client", clientId };
    return { context: "company" };
  }, [lockedContext, contextKind, projectId, clientId]);

  // The queue outlives a remount of this page (AUD-09 FV-19): files still on
  // their way show their real state on return, and a failed file whose bytes
  // went with the old page comes back as a name to choose again.
  const queue = useUploadQueue({
    parent,
    onUploaded: () => router.refresh(),
    persistKey: `documents/new:${lockedContext ? `${lockedContext.kind}:${lockedContext.id}` : "any"}`,
    maxBytes: maxMegabytes * 1024 * 1024,
  });

  /**
   * One document name for one file; several files each take their own name
   * from the file itself, since making somebody type five names before the
   * first byte moves would defeat batch upload (PRD #29 §168, §174).
   */
  const metadataFor = React.useCallback(
    (file: File, index: number) => {
      const fallback = file.name.replace(/\.[^.]+$/, "");
      const chosen = name.trim();
      return {
        name: chosen && index === 0 ? chosen : fallback,
        description: description.trim() || undefined,
      };
    },
    [name, description],
  );

  const start = React.useCallback(
    (files: FileList | File[] | null) => {
      const selected = Array.from(files ?? []);
      if (selected.length === 0) return;
      queue.enqueue(selected, metadataFor);
      setName("");
      setBaseline(JSON.stringify({ contextKind, projectId, clientId, name: "", description }));
    },
    [queue, metadataFor, contextKind, projectId, clientId, description],
  );

  const finished = queue.items.filter((item) => item.status === "done").length;
  const checking = queue.items.filter((item) => ["verifying", "processing", "pending"].includes(item.status)).length;

  return (
    <div className="space-y-5">
      <FormSection title="Where it belongs">
        {lockedContext ? (
          <div className="sm:col-span-2">
            <Field label="Context" name="context">
              <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-body text-fg">
                {lockedContext.label}
              </p>
            </Field>
          </div>
        ) : (
          <>
            <Field label="Context" name="context" required>
              <select
                id="context"
                value={contextKind}
                onChange={(event) => setContextKind(event.target.value)}
                className={selectClass}
              >
                {projects.length > 0 ? <option value="project">Project</option> : null}
                {clients.length > 0 ? <option value="client">Client</option> : null}
                {canFileToCompany ? <option value="company">Company</option> : null}
              </select>
            </Field>

            {contextKind === "project" ? (
              <Field label="Project" name="projectId" required>
                <select
                  id="projectId"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className={selectClass}
                >
                  {projects.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {contextKind === "client" ? (
              <Field label="Client" name="clientId" required>
                <select
                  id="clientId"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  className={selectClass}
                >
                  {clients.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {contextKind === "company" ? (
              <p className="sm:col-span-2 text-meta text-fg-subtle">
                A company document is visible to colleagues with company-level Documents access.
              </p>
            ) : null}
          </>
        )}
      </FormSection>

      <FormSection title="Details">
        <div className="sm:col-span-2">
          <Field
            label="Document name"
            name="name"
            hint="Optional. Each file otherwise takes its own name."
          >
            <Input
              id="name"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Description" name="description">
            <Textarea
              id="description"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Files">
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              start(event.dataTransfer.files);
            }}
            aria-describedby="upload-hint"
            className={`flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging ? "border-accent bg-accent-soft" : "border-line bg-surface-2"
            }`}
          >
            <Upload aria-hidden="true" className="size-5 text-fg-muted" />
            <span className="text-body font-medium text-fg">
              Drop files here, or choose files
            </span>
          </button>
          {/* What is accepted, before anything is chosen, from the registry and
              ceiling the server enforces — not a second list (AUD-09 §8). */}
          <p id="upload-hint" className="mt-2 text-meta text-fg-muted" data-testid="upload-accepted-types">
            Required: at least one file; each becomes its own document. Up to {maxMegabytes} MB
            each. Accepted: {acceptedTypesText()}. Executables, scripts, archives and
            macro-enabled Office files are not accepted, and every file is checked by its
            contents, not its name, before it is ready.
          </p>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept={uploadAccept()}
            className="sr-only"
            aria-label="Choose files to upload"
            data-testid="document-upload-input"
            onChange={(event) => {
              start(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {queue.items.length > 0 || queue.lost.length > 0 ? (
          <div className="sm:col-span-2">
            <UploadQueueList
              items={queue.items}
              lost={queue.lost}
              onRetry={(item) => void queue.retry(item.id)}
              onRecheck={(item) => void queue.recheck(item.id)}
              onCancel={(item) => void queue.cancel(item.id)}
              onClear={(id) => queue.clear(id)}
              onReselect={(lost, file) => queue.reselect(lost.id, file, metadataFor)}
            />
          </div>
        ) : null}
      </FormSection>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <p aria-live="polite" className="text-meta text-fg-muted">
          {queue.active
            ? "Uploading. Stay on this page until it finishes."
            : [
                finished > 0 ? `${finished} file${finished === 1 ? "" : "s"} ready.` : "",
                checking > 0 ? `${checking} still being checked — not ready yet.` : "",
              ].filter(Boolean).join(" ")}
        </p>

        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={cancelHref}>{finished > 0 ? "Back" : "Cancel"}</Link>
          </Button>
          {finished > 0 && !queue.active ? (
            <Button asChild size="sm">
              <Link href={doneHref}>Done</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The queue (PRD #29 §334; AUD-09 §8, FV-18, FV-19).
 *
 * Each row shows the file name, its size, its progress and its state, with
 * retry and cancel where each makes sense. The live region announces state
 * changes rather than leaving a screen-reader user watching a silent bar
 * (PRD #29 §343). Selected, uploading, being checked, ready and failed read
 * differently, in words and not colour alone; only the server's verdict makes
 * a row "Ready". A file lost with a remount is shown by name with "Select this
 * file again" — never as attached.
 */
export function UploadQueueList({
  items,
  lost = [],
  onRetry,
  onRecheck,
  onCancel,
  onClear,
  onReselect,
}: {
  items: UploadItem[];
  lost?: LostUpload[];
  onRetry: (item: UploadItem) => void;
  onRecheck?: (item: UploadItem) => void;
  onCancel: (item: UploadItem) => void;
  onClear: (id: string) => void;
  onReselect?: (lost: LostUpload, file: File) => void;
}) {
  return (
    <ul className="divide-y divide-line rounded-md border border-line" aria-label="Upload queue" data-testid="upload-queue">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="upload-queue-item" data-status={item.status}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-table font-medium text-fg">{item.file.name}</p>
            <p className="mt-0.5 text-meta text-fg-muted" aria-live="polite">
              {formatFileSize(item.file.size)} · {uploadStatusLabel(item)}
            </p>

            {item.status === "uploading" ? (
              <div
                role="progressbar"
                aria-valuenow={item.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Uploading ${item.file.name}`}
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            ) : null}

            {item.error ? (
              <p role={item.status === "failed" ? "alert" : undefined} className={`mt-1 text-meta ${item.status === "failed" ? "text-danger-strong" : "text-warning-strong"}`}>
                {item.error}
              </p>
            ) : null}
          </div>

          {item.status === "done" ? (
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-success-strong" />
          ) : null}
          {item.status === "failed" ? (
            <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-danger-strong" />
          ) : null}

          {/* Retry only for a transient failure — a rejected file needs a
              different file, not another attempt (PRD #29 §335). It resumes
              where the failure was: nothing already uploaded goes again. */}
          {item.status === "failed" && !item.terminal && item.attempts < UPLOAD_RETRY_LIMIT ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onRetry(item)} aria-label={`Retry ${item.file.name}`}>
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          ) : null}

          {item.status === "pending" && onRecheck ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onRecheck(item)} aria-label={`Check ${item.file.name} again`}>
              <RotateCcw aria-hidden="true" />
              Check again
            </Button>
          ) : null}

          {["queued", "authorising", "uploading"].includes(item.status) ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Cancel upload of ${item.file.name}`}
              onClick={() => onCancel(item)}
            >
              <X />
            </Button>
          ) : null}

          {["done", "failed", "cancelled"].includes(item.status) ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${item.file.name} from the list`}
              onClick={() => onClear(item.id)}
            >
              <X />
            </Button>
          ) : null}
        </li>
      ))}
      {lost.map((entry) => (
        <LostUploadRow key={entry.id} entry={entry} onClear={onClear} onReselect={onReselect} />
      ))}
    </ul>
  );
}

/** A file whose bytes went with a remount: its name, and a way to choose it again (FV-19). */
function LostUploadRow({
  entry,
  onClear,
  onReselect,
}: {
  entry: LostUpload;
  onClear: (id: string) => void;
  onReselect?: (lost: LostUpload, file: File) => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="upload-queue-lost" data-status="lost">
      <div className="min-w-0 flex-1">
        <p className="truncate text-table font-medium text-fg">{entry.fileName}</p>
        <p className="mt-0.5 text-meta text-warning-strong" aria-live="polite">
          {formatFileSize(entry.fileSize)} · Not attached. The file was not kept when this page reloaded — select this file again.
        </p>
      </div>
      {onReselect ? (
        <>
          <input
            ref={input}
            type="file"
            accept={uploadAccept()}
            className="sr-only"
            tabIndex={-1}
            aria-label={`Select ${entry.fileName} again`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onReselect(entry, file);
            }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
            Select this file again
          </Button>
        </>
      ) : null}
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${entry.fileName} from the list`} onClick={() => onClear(entry.id)}>
        <X />
      </Button>
    </li>
  );
}
