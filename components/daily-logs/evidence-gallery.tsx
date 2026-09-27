"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { Camera, FileText, ImageIcon, Loader2, Pencil, Upload } from "lucide-react";

import { UploadQueueList } from "@/components/documents/document-uploader";
import { acceptedTypesText, uploadAccept } from "@/components/documents/upload-client";
import { UPLOAD_IN_FLIGHT, useUploadQueue } from "@/components/documents/upload-queue";
import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { PersonLink } from "@/components/people/person-link";
import { stripJpegMetadata } from "@/lib/modules/daily-logs/daily-log.exif";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, type DocumentCategory, type EvidenceDTO } from "@/lib/modules/daily-logs/daily-log.types";
import { cn } from "@/lib/utils/cn";
import { dailyLogApi, dailyLogFailureOutcome, failureMessage } from "./daily-log-api";
import { dailyLogsLabel } from "@/lib/i18n/modules/dailyLogs/labels";
import { useDailyLogsTranslations } from "./daily-logs-text";

/**
 * The day's evidence (PRD #43 §74-§83, §152, §214, §241, §261).
 *
 * Photos first, as a grid of thumbnails that load only when they scroll into
 * view, with a large preview; delivery tickets, sketches and reports below.
 * Files go through the canonical upload pipeline against the log, and a JPEG
 * has its location metadata removed in the browser before it is sent.
 *
 * Every chosen file keeps its own row until it is in the gallery (AUD-04 §6,
 * MW-14, MW-18, J-D3, D-08-09): waiting, uploading, being checked, or failed —
 * a failure stays on screen with Retry and Remove instead of passing as a
 * toast, and a file of a kind the log does not take says which kinds it
 * does. Photos/Files is the ordinary picker; the camera is an extra button on
 * a phone, never the only way in.
 */

/**
 * What a log's evidence may be, from the registry the server enforces: photos,
 * PDFs, Word and spreadsheet files. The picker, the hint and the pre-check read
 * the same groups, so a file of any other kind is refused before it is sent,
 * with the kinds it could have been.
 */
const EVIDENCE_GROUPS = ["image", "pdf", "office", "spreadsheet"] as const;
/** `image/*` as well, so a phone offers its photo library, not only its files. */
const EVIDENCE_ACCEPT = `image/*,${uploadAccept(EVIDENCE_GROUPS)}`;

function Thumbnail({ item, onOpen }: { item: EvidenceDTO; onOpen: () => void }) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!item.previewHref) return;
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void fetch(item.previewHref!, { method: "POST" })
        .then(async (response) => {
          if (!response.ok) throw new Error("preview");
          const grant = (await response.json()) as { url: string };
          if (!cancelled) setUrl(grant.url);
        })
        .catch(() => !cancelled && setFailed(true));
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [item.previewHref]);

  return (
    <button ref={ref} type="button" onClick={onOpen} className="group relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-line bg-surface-muted text-left" data-testid="evidence-photo">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={item.caption ?? item.name} className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" loading="lazy" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-fg-subtle">{failed ? <ImageIcon className="size-6" aria-hidden="true" /> : <Loader2 className="size-5 animate-spin" aria-hidden="true" />}</span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-2 pt-6 text-micro text-white">
        <span className="line-clamp-1">{item.caption ?? item.name}</span>
      </span>
    </button>
  );
}

export function EvidenceGallery({
  dailyLogId,
  evidence,
  canUpload,
  canEdit,
  zone,
  onChanged,
}: {
  dailyLogId: string;
  evidence: EvidenceDTO[];
  canUpload: boolean;
  canEdit: boolean;
  zone: string;
  onChanged: () => Promise<void>;
}) {
  const t = useDailyLogsTranslations();
  const category = (value: DocumentCategory) => dailyLogsLabel(t, "documentCategory", value, DOCUMENT_CATEGORY_LABELS[value]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = React.useState<EvidenceDTO | null>(null);
  const [viewUrl, setViewUrl] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<EvidenceDTO | null>(null);

  const itemsRef = React.useRef<Array<{ documentId: string | null; file: File }>>([]);
  const queue = useUploadQueue({
    parent: { context: "record", entityType: "daily_log", entityId: dailyLogId },
    groups: EVIDENCE_GROUPS,
    onUploaded: (documentId) => {
      // An image is a site photo until somebody says otherwise; anything else starts as "other".
      const file = itemsRef.current.find((item) => item.documentId === documentId)?.file;
      const category: DocumentCategory = file?.type.startsWith("image/") ? "PHOTO" : "OTHER";
      void dailyLogApi(`/api/daily-logs/${dailyLogId}/evidence/${documentId}`, { method: "PUT", body: { category } })
        .catch(() => undefined)
        .finally(() => void onChanged());
    },
  });
  itemsRef.current = queue.items;
  const uploading = queue.items.filter((item) => UPLOAD_IN_FLIGHT.includes(item.status));

  // A file still on its way is lost by leaving (AUD-03 §3). Nothing to save:
  // a finished upload is already stored, and discarding never deletes it.
  const uploads = useUnsavedEditor({ module: "daily_logs", saveKind: "none", label: t("evidence.upload") });
  const { setPendingUploads } = uploads;
  React.useEffect(() => setPendingUploads(uploading.length > 0), [uploading.length, setPendingUploads]);

  // A photo whose location data could not be removed is not sent at all; it
  // is named here, never dropped without a word (AUD-04 §6, MW-18).
  const [unprepared, setUnprepared] = React.useState<string[]>([]);

  async function choose(files: FileList | null) {
    // A cancelled picker chooses nothing, and nothing changes.
    if (!files?.length) return;
    const failed: string[] = [];
    const prepared = await Promise.all(
      [...files].map(async (file) => {
        if (file.type !== "image/jpeg" && !/\.jpe?g$/i.test(file.name)) return file;
        try {
          const bytes = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()));
          return new File([bytes.slice().buffer as ArrayBuffer], file.name, { type: "image/jpeg", lastModified: file.lastModified });
        } catch {
          failed.push(file.name);
          return null;
        }
      }),
    );
    setUnprepared(failed);
    const ready = prepared.filter((file): file is File => file !== null);
    if (ready.length) queue.enqueue(ready, (file) => ({ name: file.name }));
  }

  // A row leaves once its file is in the gallery: until then it is the only
  // proof of where the file stands (a preview is not; §6).
  const inGallery = new Set(evidence.map((item) => item.documentId));
  const rows = queue.items.filter((item) => !(item.status === "done" && item.documentId && inGallery.has(item.documentId)));

  React.useEffect(() => {
    if (!viewing?.previewHref) {
      setViewUrl(null);
      return;
    }
    let cancelled = false;
    void fetch(viewing.previewHref, { method: "POST" })
      .then(async (response) => (response.ok ? ((await response.json()) as { url: string }).url : null))
      .then((url) => !cancelled && setViewUrl(url));
    return () => {
      cancelled = true;
    };
  }, [viewing]);

  const photos = evidence.filter((item) => item.category === "PHOTO" && item.isImage);
  const others = evidence.filter((item) => !(item.category === "PHOTO" && item.isImage));
  const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(new Date(iso)) : null);

  return (
    <div className="space-y-4" data-testid="evidence-gallery">
      {canUpload ? (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label={t("evidence.takePhoto")} onChange={(event) => void choose(event.target.files).finally(() => (event.target.value = ""))} />
          <input ref={inputRef} type="file" multiple accept={EVIDENCE_ACCEPT} className="sr-only" aria-label={t("evidence.addFiles")} data-testid="evidence-input" onChange={(event) => void choose(event.target.files).finally(() => (event.target.value = ""))} />
          <Button type="button" size="sm" onClick={() => cameraRef.current?.click()} className="sm:hidden">
            <Camera aria-hidden="true" />
            {t("evidence.takePhotoButton")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" />
            {t("evidence.addFiles")}
          </Button>
          {uploading.length ? (
            <span className="inline-flex items-center gap-1.5 text-meta text-fg-muted" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {t("evidence.uploading", { count: uploading.length })}
            </span>
          ) : null}
          <p className="w-full text-meta text-fg-subtle" data-testid="evidence-accepted-types">
            {t("evidence.accepted", { types: acceptedTypesText(EVIDENCE_GROUPS) })}
          </p>
        </div>
      ) : null}

      {unprepared.length ? (
        <p role="alert" className="text-meta text-danger-strong" data-testid="evidence-unprepared">
          {t("evidence.notUploaded", { names: unprepared.join(", ") })}
        </p>
      ) : null}

      {rows.length ? (
        <UploadQueueList
          items={rows}
          onRetry={(item) => void queue.retry(item.id)}
          onRecheck={(item) => void queue.recheck(item.id)}
          onCancel={(item) => void queue.cancel(item.id)}
          onClear={(id) => queue.clear(id)}
        />
      ) : null}

      {photos.length === 0 && others.length === 0 ? <p className="text-table text-fg-muted">{t("evidence.empty")}</p> : null}

      {photos.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label={t("evidence.photos")}>
          {photos.map((item) => (
            <li key={item.documentId}>
              <Thumbnail item={item} onOpen={() => setViewing(item)} />
            </li>
          ))}
        </ul>
      ) : null}

      {others.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line" aria-label={t("evidence.files")}>
          {others.map((item) => (
            <li key={item.documentId} className="flex items-center gap-3 px-3 py-2.5">
              <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <Link href={item.href} className="block truncate text-table font-medium text-fg hover:text-accent-strong">
                  {item.caption ?? item.name}
                </Link>
                <span className="block text-meta text-fg-muted">
                  {category(item.category)}
                  {item.uploadedBy ? <> · <PersonLink memberId={item.uploadedByMemberId} name={item.uploadedBy} /></> : null}
                </span>
              </span>
              {canEdit ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("evidence.describeNamed", { name: item.name })} onClick={() => setEditing(item)}>
                  <Pencil />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-4xl">
          <DialogTitle>{viewing?.caption ?? viewing?.name}</DialogTitle>
          <DialogDescription>{[viewing ? category(viewing.category) : null, time(viewing?.takenAt ?? null), viewing?.uploadedBy].filter(Boolean).join(" · ")}</DialogDescription>
          {/* Sized to the dynamic viewport, so the footer stays reachable on a phone on its side (AUD-04 §6, MW-10, D-08-10). */}
          <div className="mt-4 flex min-h-[30dvh] items-center justify-center overflow-hidden rounded-lg bg-surface-muted">
            {viewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewUrl} alt={viewing?.caption ?? viewing?.name ?? t("evidence.photo")} className="max-h-[55dvh] w-auto object-contain" />
            ) : (
              <Loader2 className="size-6 animate-spin text-fg-subtle" aria-hidden="true" />
            )}
          </div>
          <DialogFooter>
            {viewing ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={viewing.href}>{t("evidence.openDocument")}</Link>
              </Button>
            ) : null}
            {canEdit && viewing ? (
              <Button size="sm" onClick={() => { const item = viewing; setViewing(null); setEditing(item); }}>
                <Pencil aria-hidden="true" /> {t("evidence.describe")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogTitle>{t("evidence.describeTitle")}</DialogTitle>
          <DialogDescription>{editing?.name}</DialogDescription>
          {/* Inside the dialog, so the description belongs to its guarded close (AUD-03 §5). */}
          {editing ? <DescribeForm key={editing.documentId} dailyLogId={dailyLogId} item={editing} takenTime={time(editing.takenAt) ?? ""} onDone={() => setEditing(null)} onChanged={onChanged} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Meta = { category: DocumentCategory; caption: string; takenTime: string };

function DescribeForm({ dailyLogId, item, takenTime, onDone, onChanged }: { dailyLogId: string; item: EvidenceDTO; takenTime: string; onDone: () => void; onChanged: () => Promise<void> | void }) {
  const toast = useToast();
  const t = useDailyLogsTranslations();
  const [initial] = React.useState<Meta>(() => ({ category: item.category, caption: item.caption ?? "", takenTime }));
  const [meta, setMeta] = React.useState<Meta>(initial);
  const [saving, setSavingState] = React.useState(false);

  const run = React.useRef<() => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module: "daily_logs", saveKind: "save", label: t("evidence.descriptionOf", { name: item.name }), save: () => run.current() });
  const { setDirty, setSaving, setUnresolved } = editor;
  React.useEffect(() => setDirty(meta.category !== initial.category || meta.caption !== initial.caption || meta.takenTime !== initial.takenTime), [meta, initial, setDirty]);

  run.current = async () => {
    if (saving) return { kind: "unknown" };
    setSavingState(true);
    setSaving(true);
    try {
      await dailyLogApi(`/api/daily-logs/${dailyLogId}/evidence/${item.documentId}`, { method: "PUT", body: { category: meta.category, caption: meta.caption || null, takenTime: meta.takenTime || null } });
      setDirty(false);
      setUnresolved(false);
      setSaving(false);
      onDone();
      // Saved; reading the gallery back is not part of it.
      await Promise.resolve(onChanged()).catch(() => undefined);
      return { kind: "committed" };
    } catch (error) {
      const outcome = dailyLogFailureOutcome(error);
      setUnresolved(outcome.kind === "unknown");
      toast({ title: failureMessage(error, t("common.somethingWrong")), description: outcome.kind === "unknown" ? OUTCOME_COPY.unknown : undefined, tone: "danger" });
      return outcome;
    } finally {
      setSavingState(false);
      setSaving(false);
    }
  };

  return (
    <>
      <fieldset disabled={saving} className="m-0 mt-4 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
        <label className="flex flex-col">
          <span className="text-table font-medium text-fg">{t("evidence.category")}</span>
          <select className={cn(selectClass, "mt-1.5")} value={meta.category} onChange={(event) => setMeta({ ...meta, category: event.target.value as DocumentCategory })}>
            {DOCUMENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {dailyLogsLabel(t, "documentCategory", category, DOCUMENT_CATEGORY_LABELS[category])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-table font-medium text-fg">{t("evidence.takenAt")}</span>
          <Input type="time" className="mt-1.5" value={meta.takenTime} onChange={(event) => setMeta({ ...meta, takenTime: event.target.value })} />
        </label>
        <label className="flex flex-col sm:col-span-2">
          <span className="text-table font-medium text-fg">{t("evidence.caption")}</span>
          <Input className="mt-1.5" maxLength={500} value={meta.caption} onChange={(event) => setMeta({ ...meta, caption: event.target.value })} />
        </label>
      </fieldset>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary" size="sm" disabled={saving}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button size="sm" onClick={() => void run.current()} disabled={saving}>
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
