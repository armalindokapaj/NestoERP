"use client";

import * as React from "react";
import { Camera, FileText, Paperclip, X } from "lucide-react";

import { uploadErrorText, useDocumentsTranslations } from "@/components/documents/documents-text";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * Attachment input for a form (MOB-04 §40-§43).
 *
 * "Choose file" and, on a device that has a camera, "Take photo" — both plain
 * browser inputs, so the field works everywhere and the future native shell can
 * swap the capture without touching a page. Before anything is sent each chosen
 * file shows its name, type, size and, for an image, a thumbnail, with a
 * remove control, so the wrong file is not uploaded silently. The chosen files
 * ride in the form's own FormData under `name`.
 *
 * This is the field, not the upload. A file that belongs in the Document
 * library goes through the canonical Document upload (`useUploadQueue`,
 * signed direct upload, server verification); a captured file is not an
 * attachment until the server accepts it. `UploadProgress` renders that queue's
 * per-file state: the same rows, whatever module owns the form.
 */
export type PickedFile = { key: string; file: File; previewUrl: string | null };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadField({
  name,
  accept,
  multiple = true,
  capture = true,
  maxBytes,
  disabled,
  onChange,
  describedBy,
  id,
}: {
  name: string;
  accept?: string;
  multiple?: boolean;
  /** Offer "Take photo" (the camera on a phone; the file chooser where there is none). */
  capture?: boolean;
  maxBytes?: number;
  disabled?: boolean;
  onChange?: (files: File[]) => void;
  describedBy?: string;
  id?: string;
}) {
  const t = useTranslations("ui");
  const [picked, setPicked] = React.useState<PickedFile[]>([]);
  const [rejected, setRejected] = React.useState<string | null>(null);
  const chooser = React.useRef<HTMLInputElement>(null);
  const camera = React.useRef<HTMLInputElement>(null);
  const holder = React.useRef<HTMLInputElement>(null);

  // The form submits `holder`: keep its FileList equal to what is shown.
  React.useEffect(() => {
    if (!holder.current || typeof DataTransfer === "undefined") return;
    const transfer = new DataTransfer();
    picked.forEach((entry) => transfer.items.add(entry.file));
    holder.current.files = transfer.files;
    onChange?.(picked.map((entry) => entry.file));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  React.useEffect(() => () => picked.forEach((entry) => entry.previewUrl && URL.revokeObjectURL(entry.previewUrl)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function add(list: FileList | null) {
    if (!list) return;
    const accepted: PickedFile[] = [];
    let refused: string | null = null;
    for (const file of Array.from(list)) {
      if (maxBytes && file.size > maxBytes) {
        refused = t("mob04TooLarge", { name: file.name, size: formatBytes(file.size), max: formatBytes(maxBytes) });
        continue;
      }
      accepted.push({ key: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 7)}`, file, previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    }
    setRejected(refused);
    setPicked((current) => (multiple ? [...current, ...accepted] : accepted.slice(0, 1)));
    if (chooser.current) chooser.current.value = "";
    if (camera.current) camera.current.value = "";
  }

  function remove(key: string) {
    setPicked((current) => {
      const gone = current.find((entry) => entry.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return current.filter((entry) => entry.key !== key);
    });
  }

  return (
    <div className="space-y-3" data-upload-field>
      <input ref={holder} type="file" name={name} multiple className="sr-only" tabIndex={-1} aria-hidden="true" />
      <input ref={chooser} id={id} type="file" accept={accept} multiple={multiple} hidden aria-describedby={describedBy} onChange={(event) => add(event.target.files)} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => add(event.target.files)} />

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={disabled} onClick={() => chooser.current?.click()}>
          <Paperclip aria-hidden="true" />
          {t("mob04ChooseFile")}
        </Button>
        {capture ? (
          <Button type="button" variant="secondary" disabled={disabled} onClick={() => camera.current?.click()}>
            <Camera aria-hidden="true" />
            {t("mob04TakePhoto")}
          </Button>
        ) : null}
      </div>

      {rejected ? (
        <p role="alert" className="text-table text-danger-strong">
          {rejected}
        </p>
      ) : null}

      {picked.length > 0 ? (
        <ul className="space-y-2" aria-label={t("mob04AddAttachment")}>
          {picked.map((entry) => (
            <li key={entry.key} className="flex items-center gap-3 rounded-md border border-line bg-surface p-2" data-picked-file>
              {entry.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entry.previewUrl} alt="" className="size-10 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded bg-hover text-fg-subtle">
                  <FileText aria-hidden="true" className="size-5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-fg">{entry.file.name}</span>
                <span className="block text-meta text-fg-subtle">
                  {entry.file.type || t("mob04File")} · {formatBytes(entry.file.size)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(entry.key)}
                disabled={disabled}
                aria-label={t("mob04RemoveFile", { name: entry.file.name })}
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export type UploadRowState = { id: string; fileName: string; status: "queued" | "uploading" | "verifying" | "done" | "failed"; progress?: number; error?: string };

/**
 * Per-file upload state: progress while sending, then ready or failed with a retry and a remove.
 * A failure is the upload queue's own message, raised in English; it is read
 * back into the reader's language here, as the Documents queue does.
 */
export function UploadProgress({ items, onRetry, onRemove }: { items: UploadRowState[]; onRetry?: (id: string) => void; onRemove?: (id: string) => void }) {
  const t = useTranslations("ui");
  const tDocuments = useDocumentsTranslations();
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2" data-upload-progress>
      {items.map((item) => {
        const percent = Math.round(item.progress ?? 0);
        return (
          <li key={item.id} className="rounded-md border border-line bg-surface p-3" data-upload-status={item.status}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-body text-fg">{item.fileName}</span>
              <span className={cn("shrink-0 text-meta", item.status === "failed" ? "text-danger-strong" : "text-fg-subtle")} aria-live="polite">
                {item.status === "uploading" ? t("mob04Uploading", { percent }) : item.status === "failed" ? t("mob04Failed") : item.status === "done" ? t("mob04Ready") : t("working")}
              </span>
            </div>
            {item.status === "uploading" ? (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={item.fileName}>
                <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
              </div>
            ) : null}
            {item.status === "failed" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {item.error ? <span className="text-meta text-danger-strong">{uploadErrorText(tDocuments, item.error)}</span> : null}
                {onRetry ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => onRetry(item.id)}>
                    {t("retry")}
                  </Button>
                ) : null}
                {onRemove ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(item.id)}>
                    {t("mob04RemoveFile", { name: item.fileName })}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
