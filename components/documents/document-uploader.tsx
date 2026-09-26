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
import {
  useUploadQueue,
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

  const queue = useUploadQueue({ parent, onUploaded: () => router.refresh() });

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
            <span id="upload-hint" className="text-meta text-fg-muted">
              Up to {maxMegabytes} MB each. Executables, scripts, archives and macro-enabled
              Office files are not accepted.
            </span>
          </button>

          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            aria-label="Choose files to upload"
            onChange={(event) => {
              start(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {queue.items.length > 0 ? (
          <div className="sm:col-span-2">
            <UploadQueueList
              items={queue.items}
              onRetry={(item) => queue.retry(item.id, metadataFor(item.file, 0))}
              onCancel={(item) => queue.cancel(item.id)}
              onClear={(item) => queue.clear(item.id)}
            />
          </div>
        ) : null}
      </FormSection>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <p aria-live="polite" className="text-meta text-fg-muted">
          {queue.active
            ? "Uploading. Stay on this page until it finishes."
            : finished > 0
              ? `${finished} file${finished === 1 ? "" : "s"} uploaded.`
              : ""}
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
 * The queue (PRD #29 §334).
 *
 * Each row shows the file name, its size, its progress and its state, with
 * retry and cancel where each makes sense. The live region announces state
 * changes rather than leaving a screen-reader user watching a silent bar
 * (PRD #29 §343).
 */
function UploadQueueList({
  items,
  onRetry,
  onCancel,
  onClear,
}: {
  items: UploadItem[];
  onRetry: (item: UploadItem) => void;
  onCancel: (item: UploadItem) => void;
  onClear: (item: UploadItem) => void;
}) {
  return (
    <ul className="divide-y divide-line rounded-md border border-line" aria-label="Upload queue">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-table font-medium text-fg">{item.file.name}</p>
            <p className="mt-0.5 text-meta text-fg-muted" aria-live="polite">
              {formatFileSize(item.file.size)} · {label(item)}
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
                  className="h-full rounded-full bg-accent transition-[width] duration-200"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            ) : null}

            {item.error ? (
              <p role="alert" className="mt-1 text-meta text-danger-strong">
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
              different file, not another attempt (PRD #29 §335). */}
          {item.status === "failed" && !item.terminal && item.attempts < UPLOAD_RETRY_LIMIT ? (
            <Button variant="ghost" size="sm" onClick={() => onRetry(item)}>
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          ) : null}

          {["queued", "authorising", "uploading"].includes(item.status) ? (
            <Button
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
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${item.file.name} from the list`}
              onClick={() => onClear(item)}
            >
              <X />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function label(item: UploadItem): string {
  switch (item.status) {
    case "queued":
      return "Waiting";
    case "authorising":
      return "Preparing";
    case "uploading":
      return `Uploading ${item.progress}%`;
    case "verifying":
      return "Verifying";
    case "processing":
      return "Processing";
    case "done":
      return "Uploaded";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}
