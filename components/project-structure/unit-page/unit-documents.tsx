"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Link2, Loader2, Paperclip, Trash2, Upload } from "lucide-react";

import { useUploadQueue } from "@/components/documents/upload-queue";
import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  UNIT_DOCUMENT_CATEGORIES,
  UNIT_DOCUMENT_CATEGORY_LABELS,
  UNIT_MEDIA_CATEGORIES,
  UNIT_MEDIA_CATEGORY_LABELS,
  type AttachableDocumentDTO,
  type UnitDocumentCategory,
  type UnitDocumentLinkDTO,
  type UnitFileDTO,
  type UnitFilesDTO,
} from "@/lib/modules/project-structure/unit-publishing.types";
import { formatRelativeTime } from "@/lib/utils/format";
import { Field, FormError, failureMessage, structureApi } from "../structure-ui";
import { fileSize, uploadNewVersion } from "./unit-upload";

/**
 * A unit's Sales Plan and technical documents (E-05D §33-§39, §63, §94).
 *
 * Every file is a canonical Document: uploaded with the unit as its parent, or
 * already filed on the project and attached here without copying it. The Sales
 * Plan is one logical document; replacing it uploads a new version (§36).
 */

const PROCESSING = ["queued", "authorising", "uploading", "verifying", "processing"];

function FileLine({ file, children }: { file: UnitFileDTO; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      <Link href={file.href} className="min-w-0 truncate font-medium text-fg hover:underline">
        {file.name}
      </Link>
      {file.versionNumber ? <span className="text-meta tabular-nums text-fg-muted">v{file.versionNumber}</span> : null}
      {file.archived ? <Badge tone="warning">Archived</Badge> : file.storageStatus !== "AVAILABLE" ? <Badge tone="info">Being checked</Badge> : null}
      <span className="text-meta text-fg-subtle">
        {fileSize(file.sizeBytes)} · {formatRelativeTime(file.uploadedAt)}
      </span>
      {children}
    </div>
  );
}

export function UnitDocuments({ unitId, unitCode, files }: { unitId: string; unitCode: string; files: UnitFilesDTO }) {
  const router = useRouter();
  const toast = useToast();
  const planInput = React.useRef<HTMLInputElement>(null);
  const [planBusy, setPlanBusy] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<UnitDocumentLinkDTO | null>(null);
  const [pending, setPending] = React.useState(false);
  const categoryRef = React.useRef<UnitDocumentCategory>("TECHNICAL_DRAWING");
  const { capabilities: can } = files;

  const planQueue = useUploadQueue({
    parent: { context: "record", entityType: "project_unit", entityId: unitId },
    onUploaded: (documentId) => {
      void structureApi(`/api/project-units/${unitId}/sales-plan`, { body: { documentId } })
        .then(() => toast({ title: `Sales Plan added to ${unitCode}.` }))
        .catch((error) => toast({ title: failureMessage(error, "The Sales Plan could not be added."), tone: "danger" }))
        .finally(() => router.refresh());
    },
  });
  const docQueue = useUploadQueue({
    parent: { context: "record", entityType: "project_unit", entityId: unitId },
    onUploaded: (documentId) => {
      void structureApi(`/api/project-units/${unitId}/documents`, { body: { documentId, category: categoryRef.current } })
        .catch((error) => toast({ title: failureMessage(error, "The document could not be attached."), tone: "danger" }))
        .finally(() => router.refresh());
    },
  });
  const planUploading = planBusy || planQueue.items.some((item) => PROCESSING.includes(item.status));
  const docsUploading = docQueue.items.filter((item) => PROCESSING.includes(item.status)).length;

  React.useEffect(() => {
    const failed = [...planQueue.items, ...docQueue.items].find((item) => item.status === "failed" && item.error);
    if (failed) toast({ title: failed.error ?? "The file could not be uploaded.", tone: "danger" });
    // Report each failure once, as it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...planQueue.items, ...docQueue.items].filter((item) => item.status === "failed").length]);

  async function choosePlan(file: File | undefined) {
    if (!file) return;
    if (file.type && file.type !== "application/pdf") return toast({ title: "The Sales Plan must be a PDF.", tone: "danger" });
    if (!files.salesPlan) return planQueue.enqueue([file], () => ({ name: `${unitCode} Sales Plan` }));
    setPlanBusy(true);
    try {
      const result = await uploadNewVersion(files.salesPlan.documentId, file);
      const recorded = await structureApi<{ versionNumber: number | null; changed: boolean }>(`/api/project-units/${unitId}/sales-plan`, { body: { documentId: files.salesPlan.documentId } });
      toast({ title: result.status === "AVAILABLE" && recorded.changed ? `Sales Plan version ${recorded.versionNumber} uploaded.` : "New version received. It counts once it has been checked." });
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error, "The new version could not be uploaded."), tone: "danger" });
    } finally {
      setPlanBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setPending(true);
    try {
      await structureApi(`/api/project-units/${unitId}/documents/${removing.id}`, { method: "DELETE" });
      toast({ title: `“${removing.document.name}” removed from ${unitCode}. The document itself is kept.` });
      setRemoving(null);
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error, "The document could not be removed."), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  if (!files.visible) {
    return <p className="nesto-card p-5 text-table text-fg-muted">You do not have access to documents.</p>;
  }

  return (
    <div className="space-y-4">
      <section className="nesto-card p-5" aria-labelledby="sales-plan-heading" data-testid="sales-plan">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="sales-plan-heading" className="text-card font-semibold text-fg">
              Sales Plan
            </h2>
            <p className="mt-1 text-meta text-fg-muted">One document for this unit. A new upload becomes its next version; earlier versions stay.</p>
          </div>
          {can.canUpload && (files.salesPlan ? can.canUploadVersion : true) && !files.salesPlanHidden ? (
            <>
              <input ref={planInput} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label={files.salesPlan ? "Upload a new Sales Plan version" : "Upload the Sales Plan"} data-testid="sales-plan-input" onChange={(event) => void choosePlan(event.target.files?.[0]).finally(() => (event.target.value = ""))} />
              <Button size="sm" variant="secondary" onClick={() => planInput.current?.click()} disabled={planUploading}>
                {planUploading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                {files.salesPlan ? "Upload new version" : "Upload Sales Plan"}
              </Button>
            </>
          ) : null}
        </div>
        <div className="mt-4 text-table">
          {files.salesPlan ? (
            <FileLine file={files.salesPlan}>
              <Link href={files.salesPlan.href} className="text-meta font-medium text-accent-strong hover:underline">
                Versions
              </Link>
            </FileLine>
          ) : files.salesPlanHidden ? (
            <p className="text-fg-muted">This unit has a Sales Plan you cannot open.</p>
          ) : (
            <p className="text-fg-muted">Sales Plan missing. Required before publishing.</p>
          )}
        </div>
      </section>

      <section className="nesto-card p-5" aria-labelledby="unit-documents-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="unit-documents-heading" className="text-card font-semibold text-fg">
            Technical documents
          </h2>
          {can.canManageDocuments ? (
            <div className="flex flex-wrap gap-2">
              {docsUploading ? (
                <span className="inline-flex items-center gap-1.5 text-meta text-fg-muted" aria-live="polite">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Uploading {docsUploading}…
                </span>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => setAttachOpen(true)}>
                <Link2 aria-hidden="true" />
                Attach existing
              </Button>
              {can.canUpload ? (
                <Button size="sm" variant="secondary" onClick={() => setUploadOpen(true)}>
                  <Paperclip aria-hidden="true" />
                  Add document
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {files.documents.length === 0 ? (
          <p className="mt-4 text-table text-fg-muted">No documents attached.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line" data-testid="unit-document-list">
            {files.documents.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-table">
                <FileLine file={link.document}>
                  <Badge>{UNIT_DOCUMENT_CATEGORY_LABELS[link.category]}</Badge>
                </FileLine>
                {can.canManageDocuments ? (
                  <Button variant="ghost" size="icon" aria-label={`Remove ${link.document.name} from ${unitCode}`} onClick={() => setRemoving(link)}>
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {files.unfiled.length ? (
        <section className="nesto-card p-5" aria-labelledby="unit-unfiled-heading">
          <h2 id="unit-unfiled-heading" className="text-card font-semibold text-fg">
            Other files on this unit
          </h2>
          <p className="mt-1 text-meta text-fg-muted">Uploaded to the unit but not yet its Sales Plan, a document or an image.</p>
          <ul className="mt-3 divide-y divide-line">
            {files.unfiled.map((file) => (
              <li key={file.documentId} className="py-2.5 text-table">
                <FileLine file={file} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onChoose={(chosen, category) => {
          categoryRef.current = category;
          docQueue.enqueue(chosen, (file) => ({ name: file.name.replace(/\.[^.]+$/, "") }));
          setUploadOpen(false);
        }}
      />
      <AttachDialog open={attachOpen} onOpenChange={setAttachOpen} unitId={unitId} kind="document" onAttached={() => router.refresh()} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(value) => !value && setRemoving(null)}
        title={`Remove this document from ${unitCode}?`}
        description="The unit stops pointing at it. The document itself stays in Documents, and anything else that uses it keeps it."
        confirmLabel="Remove"
        pending={pending}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function UploadDocumentDialog({ open, onOpenChange, onChoose }: { open: boolean; onOpenChange: (open: boolean) => void; onChoose: (files: File[], category: UnitDocumentCategory) => void }) {
  const [category, setCategory] = React.useState<UnitDocumentCategory>("TECHNICAL_DRAWING");
  const [chosen, setChosen] = React.useState<File[]>([]);
  React.useEffect(() => {
    if (open) setChosen([]);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Add document</DialogTitle>
        <DialogDescription>The file is uploaded to Documents with this unit as its home.</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen.length) onChoose(chosen, category);
          }}
        >
          <Field label="Category" htmlFor="unit-document-category">
            <select id="unit-document-category" className={selectClass} value={category} onChange={(event) => setCategory(event.target.value as UnitDocumentCategory)}>
              {UNIT_DOCUMENT_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {UNIT_DOCUMENT_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Files" htmlFor="unit-document-files" required>
            <Input id="unit-document-files" type="file" multiple onChange={(event) => setChosen([...(event.target.files ?? [])])} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!chosen.length}>
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Attach a document or image already filed on this unit or its project (E-05D §63): referenced, never copied. */
export function AttachDialog({ open, onOpenChange, unitId, kind, onAttached }: { open: boolean; onOpenChange: (open: boolean) => void; unitId: string; kind: "document" | "image"; onAttached: () => void }) {
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<AttachableDocumentDTO[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [category, setCategory] = React.useState<string>(kind === "image" ? "OTHER" : "TECHNICAL_DRAWING");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSelected(null);
    setError(null);
    const handle = window.setTimeout(() => {
      void structureApi<AttachableDocumentDTO[]>(`/api/project-units/${unitId}/document-candidates?kind=${kind}&q=${encodeURIComponent(q)}`)
        .then(setItems)
        .catch(() => setItems([]));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, q, unitId, kind]);

  async function attach() {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      await structureApi(kind === "image" ? `/api/project-units/${unitId}/media` : `/api/project-units/${unitId}/documents`, { body: kind === "image" ? { documentId: selected, category, caption: null } : { documentId: selected, category } });
      toast({ title: kind === "image" ? "Image added." : "Document attached." });
      onOpenChange(false);
      onAttached();
    } catch (failure) {
      setError(failureMessage(failure, "That file could not be attached."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{kind === "image" ? "Add an existing image" : "Attach an existing document"}</DialogTitle>
        <DialogDescription>Files uploaded to this unit or filed on its project. The file is referenced, not copied.</DialogDescription>
        <div className="mt-4 space-y-4">
          <FormError message={error} />
          <Field label="Search" htmlFor="attach-search">
            <Input id="attach-search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="File name" autoFocus />
          </Field>
          <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Files">
            {items === null ? (
              <li className="text-table text-fg-muted">Loading…</li>
            ) : items.length === 0 ? (
              <li className="text-table text-fg-muted">No files to attach.</li>
            ) : (
              items.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-table hover:bg-hover">
                    <input type="radio" name="attach-file" value={item.id} checked={selected === item.id} onChange={() => setSelected(item.id)} />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="text-meta text-fg-subtle">{item.onUnit ? "This unit" : "Project"}</span>
                  </label>
                </li>
              ))
            )}
          </ul>
          <Field label="Category" htmlFor="attach-category">
            <select id="attach-category" className={selectClass} value={category} onChange={(event) => setCategory(event.target.value)}>
              {(kind === "image" ? UNIT_MEDIA_CATEGORIES : UNIT_DOCUMENT_CATEGORIES).map((value) => (
                <option key={value} value={value}>
                  {kind === "image" ? UNIT_MEDIA_CATEGORY_LABELS[value as keyof typeof UNIT_MEDIA_CATEGORY_LABELS] : UNIT_DOCUMENT_CATEGORY_LABELS[value as UnitDocumentCategory]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void attach()} disabled={!selected || pending}>
            {pending ? "Attaching…" : kind === "image" ? "Add image" : "Attach"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
