"use client";

import * as React from "react";
import { Camera, FileText, ImageIcon, Loader2, Upload, X } from "lucide-react";

import { UploadQueueList } from "@/components/documents/document-uploader";
import { useDocumentsTranslations } from "@/components/documents/documents-text";
import { acceptedTypesText, uploadAccept } from "@/components/documents/upload-client";
import { useUploadQueue, type UploadContextInput } from "@/components/documents/upload-queue";
import { Button } from "@/components/ui/button";
import { CaptureError, getCaptureService, type CapturedFile } from "@/lib/field/capture-service";
import { prepareImage } from "@/lib/field/image-prepare";
import { cn } from "@/lib/utils/cn";

/**
 * EvidenceCapture (MOB-07 §27-§30, §35-§42, §57, §89, §106): the one capture
 * and upload control every field workflow uses — Task evidence, Site Diary
 * photos, HSE issue photos, and later QA/QC, punch lists and NCRs.
 *
 *   Take photo -> preview -> Retake / Use photo -> (Take another) -> upload queue
 *
 * - Nothing is uploaded until "Use photo(s)": an accidental capture is removed
 *   from the local strip and never reaches NESTO (§28, §30).
 * - Capture goes through `CaptureService`, so the native shell swaps the camera
 *   without a change here (§26).
 * - Files then travel through the canonical upload engine. `enqueue` snapshots
 *   `parent` when "Use" is pressed, so the Project/entity a photo was taken for
 *   is the one it lands on even if the reader switches Project mid-upload
 *   (§87-§89). One file keeps one upload key through every retry, so a flaky
 *   connection produces exactly one Document (§40, §42).
 * - The server re-validates type, size, scan, company and the parent record.
 */

export type EvidenceCaptureProps = {
  parent: UploadContextInput;
  /** Keeps the queue (and its retry state) across navigation within the tab. */
  persistKey: string;
  /** Attach a ready document to the record, when the parent link is not implied by `parent`. */
  link?: (documentId: string, file: File) => Promise<void>;
  onUploaded?: (documentId: string, file: File) => void;
  /** Registry groups the workflow takes (e.g. `["image", "pdf"]`). */
  groups?: readonly string[];
  /** Offer non-photo files too. Default true. */
  allowFiles?: boolean;
  /** Keep the file exactly as chosen (evidence that must stay original). */
  keepOriginal?: boolean;
  /** Names the upload (document name); defaults to the file name. */
  nameFor?: (file: File) => string;
  className?: string;
};

type Staged = CapturedFile & { url: string | null };

export type StagedCaptureState = ReturnType<typeof useStagedCapture>;

/** The local, not-yet-uploaded part of capture: take, choose, preview, retake, remove. */
export function useStagedCapture(options: { keepOriginal?: boolean } = {}) {
  const capture = getCaptureService();
  const [staged, setStaged] = React.useState<Staged[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const [denied, setDenied] = React.useState(false);
  const stagedRef = React.useRef(staged);
  stagedRef.current = staged;

  React.useEffect(
    () => () => {
      for (const entry of stagedRef.current) if (entry.url) URL.revokeObjectURL(entry.url);
    },
    [],
  );

  const stage = React.useCallback((files: CapturedFile[]) => {
    setStaged((current) => [
      ...current,
      ...files.map((entry) => ({ ...entry, url: entry.file.type.startsWith("image/") ? URL.createObjectURL(entry.file) : null })),
    ]);
  }, []);

  const remove = React.useCallback((id: string) => {
    setStaged((current) => {
      const gone = current.find((entry) => entry.id === id);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  const run = React.useCallback(
    async (action: () => Promise<CapturedFile[]>) => {
      setDenied(false);
      try {
        const files = await action();
        if (files.length) stage(files);
      } catch (error) {
        if (error instanceof CaptureError && error.code === "PERMISSION_DENIED") setDenied(true);
      }
    },
    [stage],
  );

  const retake = React.useCallback(async () => {
    const last = stagedRef.current[stagedRef.current.length - 1];
    await run(async () => {
      const replacement = await capture.capturePhoto();
      if (!replacement) return [];
      // Replace only after the new photo exists, so cancelling the camera keeps the old one.
      if (last) remove(last.id);
      return [replacement];
    });
  }, [capture, remove, run]);

  /** Prepares (compresses, strips location) and empties the strip. */
  const take = React.useCallback(async (): Promise<File[]> => {
    setPreparing(true);
    try {
      const current = stagedRef.current;
      const files = await Promise.all(
        current.map(async (entry) => (entry.source === "files" ? entry.file : prepareImage(entry.file, { keepOriginal: options.keepOriginal }))),
      );
      for (const entry of current) if (entry.url) URL.revokeObjectURL(entry.url);
      setStaged([]);
      return files;
    } finally {
      setPreparing(false);
    }
  }, [options.keepOriginal]);

  return { staged, preparing, denied, run, remove, retake, take, capture };
}

/** The buttons, the preview, the strip. `onUse` is what "Use photo(s)" does. */
export function StagedCaptureView({
  state,
  groups,
  allowFiles = true,
  onUse,
  useLabel,
  hideUse,
}: {
  state: StagedCaptureState;
  groups?: readonly string[];
  allowFiles?: boolean;
  onUse?: () => void;
  useLabel?: string;
  hideUse?: boolean;
}) {
  const t = useDocumentsTranslations();
  const { staged, preparing, denied, run, remove, retake, capture } = state;
  const photos = staged.filter((entry) => entry.url);
  const last = staged[staged.length - 1];
  const count = staged.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {capture.supportsCamera ? (
          <Button type="button" variant="secondary" onClick={() => run(async () => [await capture.capturePhoto()].filter((f): f is CapturedFile => f !== null))} data-testid="capture-take-photo">
            <Camera aria-hidden="true" />
            {count ? t("capture.takeAnother") : t("capture.takePhoto")}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => run(() => capture.selectPhotos({ multiple: true }))} data-testid="capture-choose-photos">
          <ImageIcon aria-hidden="true" />
          {t("capture.choosePhotos")}
        </Button>
        {allowFiles ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => run(() => capture.selectFiles({ accept: uploadAccept(groups), multiple: true }))}
            data-testid="capture-upload-file"
          >
            <Upload aria-hidden="true" />
            {t("capture.uploadFile")}
          </Button>
        ) : null}
      </div>

      {denied ? (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-meta text-fg">
          {t("capture.permissionDenied")}
        </p>
      ) : null}

      {count ? (
        <section aria-label={t("capture.staged")} className="space-y-3 rounded-md border border-line p-3" data-testid="capture-staged">
          {last?.url ? (
            <div className="overflow-hidden rounded-md bg-surface-muted">
              {/* A local object URL: next/image cannot optimise it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={last.url} alt={t("capture.previewOf", { name: last.file.name })} className="mx-auto max-h-[50dvh] w-auto max-w-full object-contain" data-testid="capture-preview" />
            </div>
          ) : null}

          <ul className="flex flex-wrap gap-2" aria-label={t("capture.selected", { count })}>
            {staged.map((entry) => (
              <li key={entry.id} className="relative size-16 overflow-hidden rounded-md border border-line bg-surface-muted" data-testid="capture-staged-item">
                {entry.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={entry.url} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-fg-muted" title={entry.file.name}>
                    <FileText aria-hidden="true" className="size-5" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remove(entry.id)}
                  aria-label={t("capture.remove", { name: entry.file.name })}
                  className="absolute right-0 top-0 flex size-6 items-center justify-center rounded-bl-md bg-black/60 text-white"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            {last?.source === "camera" && capture.supportsCamera ? (
              <Button type="button" variant="ghost" onClick={retake} data-testid="capture-retake">
                {t("capture.retake")}
              </Button>
            ) : null}
            {hideUse ? (
              <p className="text-meta text-fg-muted" data-testid="capture-pending-note">{t("capture.unsaved")}</p>
            ) : (
              <Button type="button" onClick={onUse} disabled={preparing} data-testid="capture-use">
                {preparing ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                {preparing
                  ? t("capture.preparing")
                  : (useLabel ??
                    (photos.length === count
                      ? count === 1
                        ? t("capture.usePhoto")
                        : t("capture.usePhotos", { count })
                      : t("capture.useFiles", { count })))}
              </Button>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function EvidenceCapture({ parent, persistKey, link, onUploaded, groups, allowFiles = true, keepOriginal, nameFor, className }: EvidenceCaptureProps) {
  const state = useStagedCapture({ keepOriginal });
  const queue = useUploadQueue({ parent, persistKey, link, onUploaded, groups });

  async function use() {
    const files = await state.take();
    if (files.length) queue.enqueue(files, (file) => ({ name: nameFor ? nameFor(file) : file.name }));
  }

  return (
    <div className={cn("space-y-3", className)} data-testid="evidence-capture">
      <StagedCaptureView state={state} groups={groups} allowFiles={allowFiles} onUse={use} />
      {queue.items.length || queue.lost.length ? (
        <UploadQueueList
          items={queue.items}
          lost={queue.lost}
          onRetry={(item) => queue.retry(item.id)}
          onRecheck={(item) => queue.recheck(item.id)}
          onCancel={(item) => queue.cancel(item.id)}
          onClear={queue.clear}
          onReselect={(lost, file) => queue.reselect(lost.id, file, (f) => ({ name: nameFor ? nameFor(f) : f.name }))}
        />
      ) : null}
      <p className="text-meta text-fg-muted">{acceptedTypesText(groups)}</p>
    </div>
  );
}
