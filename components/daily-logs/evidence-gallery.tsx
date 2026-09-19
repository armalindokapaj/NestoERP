"use client";

import * as React from "react";
import Link from "next/link";
import { Camera, FileText, ImageIcon, Loader2, Pencil, Upload } from "lucide-react";

import { useUploadQueue } from "@/components/documents/upload-queue";
import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PersonLink } from "@/components/people/person-link";
import { stripJpegMetadata } from "@/lib/modules/daily-logs/daily-log.exif";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, type DocumentCategory, type EvidenceDTO } from "@/lib/modules/daily-logs/daily-log.types";
import { cn } from "@/lib/utils/cn";
import { dailyLogApi, failureMessage } from "./daily-log-api";

/**
 * The day's evidence (PRD #43 §74-§83, §152, §214, §241, §261).
 *
 * Photos first, as a grid of thumbnails that load only when they scroll into
 * view, with a large preview; delivery tickets, sketches and reports below.
 * Files go through the canonical upload pipeline against the log, and a JPEG
 * has its location metadata removed in the browser before it is sent.
 */

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
  const toast = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = React.useState<EvidenceDTO | null>(null);
  const [viewUrl, setViewUrl] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<EvidenceDTO | null>(null);
  const [meta, setMeta] = React.useState<{ category: DocumentCategory; caption: string; takenTime: string }>({ category: "PHOTO", caption: "", takenTime: "" });
  const [saving, setSaving] = React.useState(false);

  const itemsRef = React.useRef<Array<{ documentId: string | null; file: File }>>([]);
  const queue = useUploadQueue({
    parent: { context: "record", entityType: "daily_log", entityId: dailyLogId },
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
  const uploading = queue.items.filter((item) => ["queued", "authorising", "uploading", "verifying", "processing"].includes(item.status));

  async function choose(files: FileList | null) {
    if (!files?.length) return;
    const prepared = await Promise.all(
      [...files].map(async (file) => {
        if (file.type !== "image/jpeg" && !/\.jpe?g$/i.test(file.name)) return file;
        const bytes = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()));
        return new File([bytes.slice().buffer as ArrayBuffer], file.name, { type: "image/jpeg", lastModified: file.lastModified });
      }),
    );
    queue.enqueue(prepared, (file) => ({ name: file.name }));
  }

  React.useEffect(() => {
    const failed = queue.items.find((item) => item.status === "failed" && item.error);
    if (failed) toast({ title: failed.error ?? "The file could not be uploaded.", tone: "danger" });
    // Report each failure once, as it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.items.filter((item) => item.status === "failed").length]);

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

  async function saveMeta() {
    if (!editing) return;
    setSaving(true);
    try {
      await dailyLogApi(`/api/daily-logs/${dailyLogId}/evidence/${editing.documentId}`, { method: "PUT", body: { category: meta.category, caption: meta.caption || null, takenTime: meta.takenTime || null } });
      setEditing(null);
      await onChanged();
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  const photos = evidence.filter((item) => item.category === "PHOTO" && item.isImage);
  const others = evidence.filter((item) => !(item.category === "PHOTO" && item.isImage));
  const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(new Date(iso)) : null);

  return (
    <div className="space-y-4" data-testid="evidence-gallery">
      {canUpload ? (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={(event) => void choose(event.target.files).finally(() => (event.target.value = ""))} />
          <input ref={inputRef} type="file" multiple accept="image/*,application/pdf,.docx,.xlsx" className="sr-only" aria-label="Add photos or files" data-testid="evidence-input" onChange={(event) => void choose(event.target.files).finally(() => (event.target.value = ""))} />
          <Button type="button" size="sm" onClick={() => cameraRef.current?.click()} className="sm:hidden">
            <Camera aria-hidden="true" />
            Take photo
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" />
            Add photos or files
          </Button>
          {uploading.length ? (
            <span className="inline-flex items-center gap-1.5 text-meta text-fg-muted" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Uploading {uploading.length}…
            </span>
          ) : null}
          <span className="text-meta text-fg-subtle">Location data is removed from photos before upload.</span>
        </div>
      ) : null}

      {photos.length === 0 && others.length === 0 ? <p className="text-table text-fg-muted">No photos or files on this log yet.</p> : null}

      {photos.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label="Photos">
          {photos.map((item) => (
            <li key={item.documentId}>
              <Thumbnail item={item} onOpen={() => setViewing(item)} />
            </li>
          ))}
        </ul>
      ) : null}

      {others.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Files">
          {others.map((item) => (
            <li key={item.documentId} className="flex items-center gap-3 px-3 py-2.5">
              <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <Link href={item.href} className="block truncate text-table font-medium text-fg hover:text-accent-strong">
                  {item.caption ?? item.name}
                </Link>
                <span className="block text-meta text-fg-muted">
                  {DOCUMENT_CATEGORY_LABELS[item.category]}
                  {item.uploadedBy ? <> · <PersonLink memberId={item.uploadedByMemberId} name={item.uploadedBy} /></> : null}
                </span>
              </span>
              {canEdit ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Describe ${item.name}`} onClick={() => { setEditing(item); setMeta({ category: item.category, caption: item.caption ?? "", takenTime: time(item.takenAt) ?? "" }); }}>
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
          <DialogDescription>{[viewing ? DOCUMENT_CATEGORY_LABELS[viewing.category] : null, time(viewing?.takenAt ?? null), viewing?.uploadedBy].filter(Boolean).join(" · ")}</DialogDescription>
          <div className="mt-4 flex min-h-[40vh] items-center justify-center overflow-hidden rounded-lg bg-surface-muted">
            {viewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewUrl} alt={viewing?.caption ?? viewing?.name ?? "Photo"} className="max-h-[70vh] w-auto object-contain" />
            ) : (
              <Loader2 className="size-6 animate-spin text-fg-subtle" aria-hidden="true" />
            )}
          </div>
          <DialogFooter>
            {viewing ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={viewing.href}>Open document</Link>
              </Button>
            ) : null}
            {canEdit && viewing ? (
              <Button size="sm" onClick={() => { const item = viewing; setViewing(null); setEditing(item); setMeta({ category: item.category, caption: item.caption ?? "", takenTime: time(item.takenAt) ?? "" }); }}>
                <Pencil aria-hidden="true" /> Describe
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogTitle>Describe this file</DialogTitle>
          <DialogDescription>{editing?.name}</DialogDescription>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col">
              <span className="text-table font-medium text-fg">Category</span>
              <select className={cn(selectClass, "mt-1.5")} value={meta.category} onChange={(event) => setMeta({ ...meta, category: event.target.value as DocumentCategory })}>
                {DOCUMENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {DOCUMENT_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span className="text-table font-medium text-fg">Taken at</span>
              <Input type="time" className="mt-1.5" value={meta.takenTime} onChange={(event) => setMeta({ ...meta, takenTime: event.target.value })} />
            </label>
            <label className="flex flex-col sm:col-span-2">
              <span className="text-table font-medium text-fg">Caption</span>
              <Input className="mt-1.5" maxLength={500} value={meta.caption} onChange={(event) => setMeta({ ...meta, caption: event.target.value })} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void saveMeta()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
