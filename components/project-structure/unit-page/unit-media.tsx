"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { ArrowDown, ArrowUp, ImageIcon, Link2, Loader2, MoreHorizontal, Pencil, Star, Trash2, Upload } from "lucide-react";

import { UploadQueueList } from "@/components/documents/document-uploader";
import { uploadErrorText, useDocumentsTranslations } from "@/components/documents/documents-text";
import { acceptedTypesText, DEFAULT_UPLOAD_MAX_BYTES, megabytes, uploadAccept } from "@/components/documents/upload-client";
import { UPLOAD_IN_FLIGHT, useUploadQueue } from "@/components/documents/upload-queue";
import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { COMMITTED, failureOutcome, useValuesEditor } from "@/components/project-planning/use-values-editor";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { CAPTION_MAX, MAX_UNIT_MEDIA, UNIT_MEDIA_CATEGORIES, type UnitFilesDTO, type UnitMediaCategory, type UnitMediaDTO } from "@/lib/modules/project-structure/unit-publishing.types";
import { Field, FormError, failureMessage, isFailure, structureApi } from "../structure-ui";
import { AttachDialog } from "./unit-documents";
import { UnitImage } from "./unit-image";
import { PersonLink } from "@/components/people/person-link";
import { FormSelect } from "@/components/ui/form-select";

/**
 * A unit's images and renders (E-05D §40-§44, §94).
 *
 * Each image is a canonical Document shown through its thumbnail; the unit
 * keeps its category, caption, order and whether it is the primary image —
 * the one the unit page, Sales and the 3D explorer show first (§42). Every
 * action is also a plain button or menu item: nothing here needs a drag or a
 * hover (§115).
 */

const PROCESSING: readonly string[] = UPLOAD_IN_FLIGHT;
/** Unit media is images only — the registry's image group, as the server's check (AUD-09 §8). */
const UNIT_IMAGE_GROUPS = ["image"] as const;

export function UnitMediaGallery({ unitId, unitCode, files }: { unitId: string; unitCode: string; files: UnitFilesDTO }) {
  const t = useTranslations("projects");
  // The upload queue raises its messages in English; they are read back here.
  const tDocuments = useDocumentsTranslations();
  const router = useRouter();
  const toast = useToast();
  const input = React.useRef<HTMLInputElement>(null);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UnitMediaDTO | null>(null);
  const [removing, setRemoving] = React.useState<UnitMediaDTO | null>(null);
  const [viewing, setViewing] = React.useState<UnitMediaDTO | null>(null);
  const [pending, setPending] = React.useState(false);
  const media = files.media;
  const can = files.capabilities;

  /*
   * Upload, then attach (AUD-09 §8, FV-18). The attachment is the queue's own
   * last step: when it fails, Retry repeats only the attachment — the image is
   * not uploaded again — and "already on this unit" is the answer to a retry
   * whose first attempt landed, not a second link.
   */
  const queue = useUploadQueue({
    parent: { context: "record", entityType: "project_unit", entityId: unitId },
    groups: UNIT_IMAGE_GROUPS,
    link: async (documentId) => {
      try {
        await structureApi(`/api/project-units/${unitId}/media`, { body: { documentId, category: "OTHER", caption: null } });
      } catch (error) {
        if (isFailure(error) && (error as { detailCode?: string }).detailCode === "UNIT_MEDIA_ALREADY_ADDED") return;
        throw new Error(failureMessage(error, t("unitMedia.addFailed")));
      }
    },
    onUploaded: () => router.refresh(),
  });
  const queueVisible = queue.items.some((item) => item.status !== "done");
  const uploading = queue.items.filter((item) => PROCESSING.includes(item.status)).length;

  React.useEffect(() => {
    const failed = queue.items.find((item) => item.status === "failed" && item.error);
    if (failed) toast({ title: uploadErrorText(tDocuments, failed.error ?? t("unitMedia.uploadFailed")), tone: "danger" });
    // Report each failure once, as it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.items.filter((item) => item.status === "failed").length]);

  /** Answers what happened (AUD-03 §6): a lost connection is unknown, not a refusal. */
  async function call(url: string, init: { method?: string; body?: unknown }, success: string): Promise<SaveOutcome> {
    setPending(true);
    try {
      await structureApi(url, init);
      toast({ title: success });
      router.refresh();
      return COMMITTED;
    } catch (error) {
      toast({ title: failureMessage(error, t("unitMedia.failed")), tone: "danger" });
      return failureOutcome(error);
    } finally {
      setPending(false);
    }
  }

  function move(index: number, by: -1 | 1) {
    const ids = media.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    void call(`/api/project-units/${unitId}/media/reorder`, { body: { ids } }, t("unitMedia.orderSaved"));
  }

  if (!files.visible) return <p className="nesto-card p-5 text-table text-fg-muted">{t("unitFiles.noAccess")}</p>;

  return (
    <section className="nesto-card p-5" aria-labelledby="unit-media-heading" data-testid="unit-media">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="unit-media-heading" className="text-card font-semibold text-fg">
            {t("unitMedia.media")}
          </h2>
          <p className="mt-1 text-meta text-fg-muted" id="unit-media-rules" data-testid="unit-media-rules">
            {t("unitMedia.rules", { types: acceptedTypesText(UNIT_IMAGE_GROUPS), size: megabytes(DEFAULT_UPLOAD_MAX_BYTES), max: MAX_UNIT_MEDIA, count: media.length })}
          </p>
        </div>
        {can.canManageMedia ? (
          <div className="flex flex-wrap items-center gap-2">
            {uploading ? (
              <span className="inline-flex items-center gap-1.5 text-meta text-fg-muted" aria-live="polite">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {t("unitMedia.uploading", { what: uploading })}
              </span>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => setAttachOpen(true)}>
              <Link2 aria-hidden="true" />
              {t("unitMedia.fromProject")}
            </Button>
            {can.canUpload ? (
              <>
                <input ref={input} type="file" multiple accept={uploadAccept(UNIT_IMAGE_GROUPS)} className="sr-only" aria-label={t("unitMedia.uploadImagesLabel")} aria-describedby="unit-media-rules" data-testid="unit-media-input" onChange={(event) => {
                  const chosen = [...(event.target.files ?? [])];
                  if (chosen.length) queue.enqueue(chosen, (file) => ({ name: file.name.replace(/\.[^.]+$/, "") }));
                  event.target.value = "";
                }} />
                <Button size="sm" onClick={() => input.current?.click()}>
                  <Upload aria-hidden="true" />
                  {t("unitMedia.uploadImages")}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Each file's own state — selected, uploading, being checked, being
          added, failed — until it is on the unit (AUD-09 §8, FV-18). */}
      {queueVisible ? (
        <div className="mt-4">
          <UploadQueueList
            items={queue.items.filter((item) => item.status !== "done")}
            onRetry={(item) => void queue.retry(item.id)}
            onRecheck={(item) => void queue.recheck(item.id)}
            onCancel={(item) => void queue.cancel(item.id)}
            onClear={(id) => queue.clear(id)}
          />
        </div>
      ) : null}

      {media.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 py-8 text-center">
          <ImageIcon className="size-6 text-fg-subtle" aria-hidden="true" />
          <p className="text-table text-fg-muted">{t("unitMedia.empty")}</p>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("unitMedia.imagesOf", { code: unitCode })}>
          {media.map((item, index) => (
            <li key={item.id} className="overflow-hidden rounded-lg border border-line bg-surface" data-testid="unit-media-item" data-primary={item.isPrimary}>
              <button type="button" className="block aspect-[4/3] w-full bg-surface-muted" onClick={() => setViewing(item)} aria-label={t("unitMedia.view", { name: item.caption ?? item.document.name })}>
                {item.thumbnailHref ? (
                  <UnitImage documentId={item.document.documentId} thumbnailHref={item.thumbnailHref} alt={item.caption ?? item.document.name} />
                ) : (
                  <span className="flex h-full items-center justify-center text-meta text-fg-subtle">{item.document.archived ? t("unitMedia.archived") : t("unitMedia.beingChecked")}</span>
                )}
              </button>
              <div className="flex items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.isPrimary ? (
                      <Badge tone="success">
                        <Star className="size-3" aria-hidden="true" /> {t("unitMedia.primary")}
                      </Badge>
                    ) : null}
                    <Badge>{t(`mediaCategory.${item.category}`)}</Badge>
                  </div>
                  <p className="mt-1 truncate text-table text-fg">{item.caption ?? item.document.name}</p>
                  {item.document.uploadedBy ? (
                    <p className="truncate text-meta text-fg-subtle">
                      {t("unitFiles.uploadedBy")} <PersonLink memberId={item.document.uploadedByMemberId} name={item.document.uploadedBy} />
                    </p>
                  ) : null}
                </div>
                {can.canManageMedia ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t("unitMedia.actionsFor", { name: item.caption ?? item.document.name })} disabled={pending}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!item.isPrimary ? (
                        <DropdownMenuItem onSelect={() => void call(`/api/project-units/${unitId}/media/${item.id}`, { method: "PATCH", body: { isPrimary: true } }, t("unitMedia.primaryChanged"))}>
                          <Star aria-hidden="true" /> {t("unitMedia.makePrimary")}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setEditing(item)}>
                        <Pencil aria-hidden="true" /> {t("unitMedia.editDetails")}
                      </DropdownMenuItem>
                      {index > 0 ? (
                        <DropdownMenuItem onSelect={() => move(index, -1)}>
                          <ArrowUp aria-hidden="true" /> {t("unitMedia.moveEarlier")}
                        </DropdownMenuItem>
                      ) : null}
                      {index < media.length - 1 ? (
                        <DropdownMenuItem onSelect={() => move(index, 1)}>
                          <ArrowDown aria-hidden="true" /> {t("unitMedia.moveLater")}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setRemoving(item)}>
                        <Trash2 aria-hidden="true" /> {t("unitMedia.remove")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <MediaDetailsDialog item={editing} onClose={() => setEditing(null)} onSave={(body) => call(`/api/project-units/${unitId}/media/${editing!.id}`, { method: "PATCH", body }, t("unitMedia.detailsSaved"))} />
      <AttachDialog open={attachOpen} onOpenChange={setAttachOpen} unitId={unitId} kind="image" onAttached={() => router.refresh()} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(value) => !value && setRemoving(null)}
        title={t("unitMedia.removeTitle")}
        description={removing?.isPrimary ? t("unitMedia.removePrimaryBody") : t("unitMedia.removeBody")}
        confirmLabel={t("unitMedia.remove")}
        pending={pending}
        onConfirm={() => void call(`/api/project-units/${unitId}/media/${removing!.id}`, { method: "DELETE" }, t("unitMedia.removed")).then((outcome) => outcome.kind === "committed" && setRemoving(null))}
      />
      <Dialog open={viewing !== null} onOpenChange={(value) => !value && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle>{viewing?.caption ?? viewing?.document.name}</DialogTitle>
          <DialogDescription>{viewing ? t(`mediaCategory.${viewing.category}`) : ""}</DialogDescription>
          {/* Room is left for the title and footer, so Open in Documents and Close stay on screen in landscape (AUD-04 §6, MW-10). */}
          {viewing ? (
            <div className="mt-4 max-h-[min(70dvh,calc(100dvh-12rem))] overflow-hidden rounded-md bg-surface-muted">
              <UnitImage documentId={viewing.document.documentId} thumbnailHref={viewing.thumbnailHref} alt={viewing.caption ?? viewing.document.name} fit="contain" lazy={false} className="max-h-[min(70dvh,calc(100dvh-12rem))]" />
            </div>
          ) : null}
          <DialogFooter>
            {viewing ? (
              <Button variant="secondary" asChild>
                <Link href={viewing.document.href}>{t("unitMedia.openInDocuments")}</Link>
              </Button>
            ) : null}
            <Button onClick={() => setViewing(null)}>{t("unitMedia.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MediaDetailsDialog({ item, onClose, onSave }: { item: UnitMediaDTO | null; onClose: () => void; onSave: (body: { category: UnitMediaCategory; caption: string | null }) => Promise<SaveOutcome> }) {
  const t = useTranslations("projects");
  return (
    <Dialog open={item !== null} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t("unitMedia.detailsTitle")}</DialogTitle>
        <DialogDescription>{item?.document.name}</DialogDescription>
        {item ? <MediaDetailsForm item={item} onClose={onClose} onSave={onSave} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted per image being edited; closing with changes asks (AUD-03 §5). */
function MediaDetailsForm({ item, onClose, onSave }: { item: UnitMediaDTO; onClose: () => void; onSave: (body: { category: UnitMediaCategory; caption: string | null }) => Promise<SaveOutcome> }) {
  const t = useTranslations("projects");
  const [category, setCategory] = React.useState<UnitMediaCategory>(item.category);
  const [caption, setCaption] = React.useState(item.caption ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => COMMITTED);
  const editor = useValuesEditor({ category, caption }, { module: "units", saveKind: "save", label: t("unitMedia.detailsOf", { name: item.caption ?? item.document.name }), save: () => persist.current() });
  const { setSaving, setUnresolved, rebaseline } = editor;

  persist.current = async () => {
    setPending(true);
    setSaving(true);
    setError(null);
    const outcome = await onSave({ category, caption: caption.trim() || null });
    setSaving(false);
    setPending(false);
    setUnresolved(outcome.kind === "unknown");
    if (outcome.kind === "committed") {
      rebaseline();
      onClose();
    } else setError(t("unitMedia.detailsFailed"));
    return outcome;
  };

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void persist.current();
      }}
    >
      <FormError message={error} />
      <Field label={t("unitMedia.category")} htmlFor="media-category">
        <FormSelect id="media-category" className={selectClass} value={category} onChange={(event) => setCategory(event.target.value as UnitMediaCategory)}>
          {UNIT_MEDIA_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`mediaCategory.${value}`)}
            </option>
          ))}
        </FormSelect>
      </Field>
      <Field label={t("unitMedia.caption")} htmlFor="media-caption">
        <Input id="media-caption" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={CAPTION_MAX} />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("unitMedia.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? t("unitMedia.saving") : t("unitMedia.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
