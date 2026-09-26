"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { ArrowDown, ArrowUp, ImageIcon, Link2, Loader2, MoreHorizontal, Pencil, Star, Trash2, Upload } from "lucide-react";

import { useUploadQueue } from "@/components/documents/upload-queue";
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
import { CAPTION_MAX, UNIT_MEDIA_CATEGORIES, UNIT_MEDIA_CATEGORY_LABELS, type UnitFilesDTO, type UnitMediaCategory, type UnitMediaDTO } from "@/lib/modules/project-structure/unit-publishing.types";
import { Field, FormError, failureMessage, structureApi } from "../structure-ui";
import { AttachDialog } from "./unit-documents";
import { UnitImage } from "./unit-image";

/**
 * A unit's images and renders (E-05D §40-§44, §94).
 *
 * Each image is a canonical Document shown through its thumbnail; the unit
 * keeps its category, caption, order and whether it is the primary image —
 * the one the unit page, Sales and the 3D explorer show first (§42). Every
 * action is also a plain button or menu item: nothing here needs a drag or a
 * hover (§115).
 */

const PROCESSING = ["queued", "authorising", "uploading", "verifying", "processing"];

export function UnitMediaGallery({ unitId, unitCode, files }: { unitId: string; unitCode: string; files: UnitFilesDTO }) {
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

  const queue = useUploadQueue({
    parent: { context: "record", entityType: "project_unit", entityId: unitId },
    onUploaded: (documentId) => {
      void structureApi(`/api/project-units/${unitId}/media`, { body: { documentId, category: "OTHER", caption: null } })
        .catch((error) => toast({ title: failureMessage(error, "The image could not be added."), tone: "danger" }))
        .finally(() => router.refresh());
    },
  });
  const uploading = queue.items.filter((item) => PROCESSING.includes(item.status)).length;

  React.useEffect(() => {
    const failed = queue.items.find((item) => item.status === "failed" && item.error);
    if (failed) toast({ title: failed.error ?? "The image could not be uploaded.", tone: "danger" });
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
      toast({ title: failureMessage(error, "That did not work. Try again."), tone: "danger" });
      return failureOutcome(error);
    } finally {
      setPending(false);
    }
  }

  function move(index: number, by: -1 | 1) {
    const ids = media.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    void call(`/api/project-units/${unitId}/media/reorder`, { body: { ids } }, "Order saved.");
  }

  if (!files.visible) return <p className="nesto-card p-5 text-table text-fg-muted">You do not have access to documents.</p>;

  return (
    <section className="nesto-card p-5" aria-labelledby="unit-media-heading" data-testid="unit-media">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="unit-media-heading" className="text-card font-semibold text-fg">
            Media
          </h2>
          <p className="mt-1 text-meta text-fg-muted">JPEG, PNG or WebP. The primary image is the one shown first everywhere this unit appears.</p>
        </div>
        {can.canManageMedia ? (
          <div className="flex flex-wrap items-center gap-2">
            {uploading ? (
              <span className="inline-flex items-center gap-1.5 text-meta text-fg-muted" aria-live="polite">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Uploading {uploading}…
              </span>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => setAttachOpen(true)}>
              <Link2 aria-hidden="true" />
              From the project
            </Button>
            {can.canUpload ? (
              <>
                <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload images" data-testid="unit-media-input" onChange={(event) => {
                  const chosen = [...(event.target.files ?? [])];
                  if (chosen.length) queue.enqueue(chosen, (file) => ({ name: file.name.replace(/\.[^.]+$/, "") }));
                  event.target.value = "";
                }} />
                <Button size="sm" onClick={() => input.current?.click()}>
                  <Upload aria-hidden="true" />
                  Upload images
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {media.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 py-8 text-center">
          <ImageIcon className="size-6 text-fg-subtle" aria-hidden="true" />
          <p className="text-table text-fg-muted">No unit media yet.</p>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={`Images of ${unitCode}`}>
          {media.map((item, index) => (
            <li key={item.id} className="overflow-hidden rounded-lg border border-line bg-surface" data-testid="unit-media-item" data-primary={item.isPrimary}>
              <button type="button" className="block aspect-[4/3] w-full bg-surface-muted" onClick={() => setViewing(item)} aria-label={`View ${item.caption ?? item.document.name}`}>
                {item.thumbnailHref ? (
                  <UnitImage documentId={item.document.documentId} thumbnailHref={item.thumbnailHref} alt={item.caption ?? item.document.name} />
                ) : (
                  <span className="flex h-full items-center justify-center text-meta text-fg-subtle">{item.document.archived ? "Archived" : "Being checked"}</span>
                )}
              </button>
              <div className="flex items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.isPrimary ? (
                      <Badge tone="success">
                        <Star className="size-3" aria-hidden="true" /> Primary
                      </Badge>
                    ) : null}
                    <Badge>{UNIT_MEDIA_CATEGORY_LABELS[item.category]}</Badge>
                  </div>
                  <p className="mt-1 truncate text-table text-fg">{item.caption ?? item.document.name}</p>
                </div>
                {can.canManageMedia ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${item.caption ?? item.document.name}`} disabled={pending}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!item.isPrimary ? (
                        <DropdownMenuItem onSelect={() => void call(`/api/project-units/${unitId}/media/${item.id}`, { method: "PATCH", body: { isPrimary: true } }, "Primary image changed.")}>
                          <Star aria-hidden="true" /> Make primary
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setEditing(item)}>
                        <Pencil aria-hidden="true" /> Edit details
                      </DropdownMenuItem>
                      {index > 0 ? (
                        <DropdownMenuItem onSelect={() => move(index, -1)}>
                          <ArrowUp aria-hidden="true" /> Move earlier
                        </DropdownMenuItem>
                      ) : null}
                      {index < media.length - 1 ? (
                        <DropdownMenuItem onSelect={() => move(index, 1)}>
                          <ArrowDown aria-hidden="true" /> Move later
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setRemoving(item)}>
                        <Trash2 aria-hidden="true" /> Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <MediaDetailsDialog item={editing} onClose={() => setEditing(null)} onSave={(body) => call(`/api/project-units/${unitId}/media/${editing!.id}`, { method: "PATCH", body }, "Image details saved.")} />
      <AttachDialog open={attachOpen} onOpenChange={setAttachOpen} unitId={unitId} kind="image" onAttached={() => router.refresh()} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(value) => !value && setRemoving(null)}
        title="Remove this image from the unit?"
        description={removing?.isPrimary ? "It is the primary image: the unit will have none until you choose another. The file stays in Documents." : "The file stays in Documents."}
        confirmLabel="Remove"
        pending={pending}
        onConfirm={() => void call(`/api/project-units/${unitId}/media/${removing!.id}`, { method: "DELETE" }, "Image removed.").then((outcome) => outcome.kind === "committed" && setRemoving(null))}
      />
      <Dialog open={viewing !== null} onOpenChange={(value) => !value && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle>{viewing?.caption ?? viewing?.document.name}</DialogTitle>
          <DialogDescription>{viewing ? UNIT_MEDIA_CATEGORY_LABELS[viewing.category] : ""}</DialogDescription>
          {viewing ? (
            <div className="mt-4 max-h-[70dvh] overflow-hidden rounded-md bg-surface-muted">
              <UnitImage documentId={viewing.document.documentId} thumbnailHref={viewing.thumbnailHref} alt={viewing.caption ?? viewing.document.name} fit="contain" lazy={false} className="max-h-[70dvh]" />
            </div>
          ) : null}
          <DialogFooter>
            {viewing ? (
              <Button variant="secondary" asChild>
                <Link href={viewing.document.href}>Open in Documents</Link>
              </Button>
            ) : null}
            <Button onClick={() => setViewing(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MediaDetailsDialog({ item, onClose, onSave }: { item: UnitMediaDTO | null; onClose: () => void; onSave: (body: { category: UnitMediaCategory; caption: string | null }) => Promise<SaveOutcome> }) {
  return (
    <Dialog open={item !== null} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>Image details</DialogTitle>
        <DialogDescription>{item?.document.name}</DialogDescription>
        {item ? <MediaDetailsForm item={item} onClose={onClose} onSave={onSave} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted per image being edited; closing with changes asks (AUD-03 §5). */
function MediaDetailsForm({ item, onClose, onSave }: { item: UnitMediaDTO; onClose: () => void; onSave: (body: { category: UnitMediaCategory; caption: string | null }) => Promise<SaveOutcome> }) {
  const [category, setCategory] = React.useState<UnitMediaCategory>(item.category);
  const [caption, setCaption] = React.useState(item.caption ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => COMMITTED);
  const editor = useValuesEditor({ category, caption }, { module: "units", saveKind: "save", label: `Details of ${item.caption ?? item.document.name}`, save: () => persist.current() });
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
    } else setError("The details could not be saved.");
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
      <Field label="Category" htmlFor="media-category">
        <select id="media-category" className={selectClass} value={category} onChange={(event) => setCategory(event.target.value as UnitMediaCategory)}>
          {UNIT_MEDIA_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {UNIT_MEDIA_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Caption" htmlFor="media-caption">
        <Input id="media-caption" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={CAPTION_MAX} />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
