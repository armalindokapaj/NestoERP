"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { FileText, Link2, Loader2, Paperclip, Trash2, Upload } from "lucide-react";

import { UPLOAD_IN_FLIGHT, useUploadQueue } from "@/components/documents/upload-queue";
import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { COMMITTED, failureOutcome, INVALID, useValuesEditor } from "@/components/project-planning/use-values-editor";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import {
  UNIT_DOCUMENT_CATEGORIES,
  UNIT_MEDIA_CATEGORIES,
  type AttachableDocumentDTO,
  type UnitDocumentCategory,
  type UnitMediaCategory,
  type UnitDocumentLinkDTO,
  type UnitFileDTO,
  type UnitFilesDTO,
} from "@/lib/modules/project-structure/unit-publishing.types";
import { formatRelativeTime } from "@/lib/utils/format";
import { PersonLink } from "@/components/people/person-link";
import { Field, FormError, failureMessage, structureApi } from "../structure-ui";
import { fileSize, uploadNewVersion } from "./unit-upload";
import { FormSelect } from "@/components/ui/form-select";

/**
 * A unit's Sales Plan and technical documents (E-05D §33-§39, §63, §94).
 *
 * Every file is a canonical Document: uploaded with the unit as its parent, or
 * already filed on the project and attached here without copying it. The Sales
 * Plan is one logical document; replacing it uploads a new version (§36).
 */

const PROCESSING: readonly string[] = UPLOAD_IN_FLIGHT;

function FileLine({ file, children }: { file: UnitFileDTO; children?: React.ReactNode }) {
  const t = useTranslations("projects");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      <Link href={file.href} className="min-w-0 truncate font-medium text-fg hover:underline">
        {file.name}
      </Link>
      {file.versionNumber ? <span className="text-meta tabular-nums text-fg-muted">v{file.versionNumber}</span> : null}
      {file.archived ? <Badge tone="warning">{t("unitFiles.archived")}</Badge> : file.storageStatus !== "AVAILABLE" ? <Badge tone="info">{t("unitFiles.beingChecked")}</Badge> : null}
      <span className="text-meta text-fg-subtle">
        {fileSize(file.sizeBytes)} · {formatRelativeTime(file.uploadedAt)}
        {file.uploadedBy ? (
          <>
            {" · "}
            {t("unitFiles.uploadedBy")} <PersonLink memberId={file.uploadedByMemberId} name={file.uploadedBy} />
          </>
        ) : null}
      </span>
      {children}
    </div>
  );
}

export function UnitDocuments({ unitId, unitCode, files }: { unitId: string; unitCode: string; files: UnitFilesDTO }) {
  const t = useTranslations("projects");
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
        .then(() => toast({ title: t("unitFiles.planAdded", { code: unitCode }) }))
        .catch((error) => toast({ title: failureMessage(error, t("unitFiles.planAddFailed")), tone: "danger" }))
        .finally(() => router.refresh());
    },
  });
  const docQueue = useUploadQueue({
    parent: { context: "record", entityType: "project_unit", entityId: unitId },
    onUploaded: (documentId) => {
      void structureApi(`/api/project-units/${unitId}/documents`, { body: { documentId, category: categoryRef.current } })
        .catch((error) => toast({ title: failureMessage(error, t("unitFiles.attachFailed")), tone: "danger" }))
        .finally(() => router.refresh());
    },
  });
  const planUploading = planBusy || planQueue.items.some((item) => PROCESSING.includes(item.status));
  // A new Sales Plan version on its way: leaving asks first (AUD-03 §3).
  const planVersion = useUnsavedEditor({ module: "units", saveKind: "none", label: t("unitFiles.planUploadLabel", { code: unitCode }) });
  const { setPendingUploads } = planVersion;
  React.useEffect(() => setPendingUploads(planBusy), [planBusy, setPendingUploads]);
  const docsUploading = docQueue.items.filter((item) => PROCESSING.includes(item.status)).length;

  React.useEffect(() => {
    const failed = [...planQueue.items, ...docQueue.items].find((item) => item.status === "failed" && item.error);
    if (failed) toast({ title: failed.error ?? t("unitFiles.uploadFailed"), tone: "danger" });
    // Report each failure once, as it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...planQueue.items, ...docQueue.items].filter((item) => item.status === "failed").length]);

  async function choosePlan(file: File | undefined) {
    if (!file) return;
    if (file.type && file.type !== "application/pdf") return toast({ title: t("unitFiles.planPdf"), tone: "danger" });
    if (!files.salesPlan) return planQueue.enqueue([file], () => ({ name: t("unitFiles.planName", { code: unitCode }) }));
    setPlanBusy(true);
    try {
      const result = await uploadNewVersion(files.salesPlan.documentId, file);
      const recorded = await structureApi<{ versionNumber: number | null; changed: boolean }>(`/api/project-units/${unitId}/sales-plan`, { body: { documentId: files.salesPlan.documentId } });
      toast({ title: result.status === "AVAILABLE" && recorded.changed ? t("unitFiles.planVersionUploaded", { version: recorded.versionNumber ?? "" }) : t("unitFiles.versionReceived") });
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error, t("unitFiles.versionFailed")), tone: "danger" });
    } finally {
      setPlanBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setPending(true);
    try {
      await structureApi(`/api/project-units/${unitId}/documents/${removing.id}`, { method: "DELETE" });
      toast({ title: t("unitFiles.removed", { name: removing.document.name, code: unitCode }) });
      setRemoving(null);
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error, t("unitFiles.removeFailed")), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  if (!files.visible) {
    return <p className="nesto-card p-5 text-table text-fg-muted">{t("unitFiles.noAccess")}</p>;
  }

  return (
    <div className="space-y-4">
      <section className="nesto-card p-5" aria-labelledby="sales-plan-heading" data-testid="sales-plan">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="sales-plan-heading" className="text-card font-semibold text-fg">
              {t("unitFiles.salesPlan")}
            </h2>
            <p className="mt-1 text-meta text-fg-muted">{t("unitFiles.planBody")}</p>
          </div>
          {can.canUpload && (files.salesPlan ? can.canUploadVersion : true) && !files.salesPlanHidden ? (
            <>
              <input ref={planInput} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label={files.salesPlan ? t("unitFiles.uploadNewVersionLabel") : t("unitFiles.uploadPlanLabel")} data-testid="sales-plan-input" onChange={(event) => void choosePlan(event.target.files?.[0]).finally(() => (event.target.value = ""))} />
              <Button size="sm" variant="secondary" onClick={() => planInput.current?.click()} disabled={planUploading}>
                {planUploading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                {files.salesPlan ? t("unitFiles.uploadNewVersion") : t("unitFiles.uploadPlan")}
              </Button>
            </>
          ) : null}
        </div>
        <div className="mt-4 text-table">
          {files.salesPlan ? (
            <FileLine file={files.salesPlan}>
              <Link href={files.salesPlan.href} className="text-meta font-medium text-accent-strong hover:underline">
                {t("unitFiles.versions")}
              </Link>
            </FileLine>
          ) : files.salesPlanHidden ? (
            <p className="text-fg-muted">{t("unitFiles.planHidden")}</p>
          ) : (
            <p className="text-fg-muted">{t("unitFiles.planMissing")}</p>
          )}
        </div>
      </section>

      <section className="nesto-card p-5" aria-labelledby="unit-documents-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="unit-documents-heading" className="text-card font-semibold text-fg">
            {t("unitFiles.technical")}
          </h2>
          {can.canManageDocuments ? (
            <div className="flex flex-wrap gap-2">
              {docsUploading ? (
                <span className="inline-flex items-center gap-1.5 text-meta text-fg-muted" aria-live="polite">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {t("unitFiles.uploading", { what: docsUploading })}
                </span>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => setAttachOpen(true)}>
                <Link2 aria-hidden="true" />
                {t("unitFiles.attachExisting")}
              </Button>
              {can.canUpload ? (
                <Button size="sm" variant="secondary" onClick={() => setUploadOpen(true)}>
                  <Paperclip aria-hidden="true" />
                  {t("unitFiles.addDocument")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {files.documents.length === 0 ? (
          <p className="mt-4 text-table text-fg-muted">{t("unitFiles.noDocuments")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line" data-testid="unit-document-list">
            {files.documents.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-table">
                <FileLine file={link.document}>
                  <Badge>{t(`documentCategory.${link.category}`)}</Badge>
                </FileLine>
                {can.canManageDocuments ? (
                  <Button variant="ghost" size="icon" aria-label={t("unitFiles.removeFrom", { name: link.document.name, code: unitCode })} onClick={() => setRemoving(link)}>
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
            {t("unitFiles.otherFiles")}
          </h2>
          <p className="mt-1 text-meta text-fg-muted">{t("unitFiles.otherFilesBody")}</p>
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
        title={t("unitFiles.removeTitle", { code: unitCode })}
        description={t("unitFiles.removeBody")}
        confirmLabel={t("unitFiles.remove")}
        pending={pending}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function UploadDocumentDialog({ open, onOpenChange, onChoose }: { open: boolean; onOpenChange: (open: boolean) => void; onChoose: (files: File[], category: UnitDocumentCategory) => void }) {
  const t = useTranslations("projects");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t("unitFiles.addDocument")}</DialogTitle>
        <DialogDescription>{t("unitFiles.uploadBody")}</DialogDescription>
        <UploadDocumentForm onChoose={onChoose} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted per opening; the chosen files are input until Upload starts them (AUD-03 §5). */
function UploadDocumentForm({ onChoose }: { onChoose: (files: File[], category: UnitDocumentCategory) => void }) {
  const t = useTranslations("projects");
  const [category, setCategory] = React.useState<UnitDocumentCategory>("TECHNICAL_DRAWING");
  const [chosen, setChosen] = React.useState<File[]>([]);
  useValuesEditor({ category, files: chosen.map((file) => [file.name, file.size, file.lastModified]) }, { module: "units", saveKind: "none", workflow: "Upload", label: t("unitFiles.toUpload") });
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen.length) onChoose(chosen, category);
      }}
    >
      <Field label={t("unitFiles.category")} htmlFor="unit-document-category">
        <FormSelect id="unit-document-category" className={selectClass} value={category} onChange={(event) => setCategory(event.target.value as UnitDocumentCategory)}>
          {UNIT_DOCUMENT_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`documentCategory.${value}`)}
            </option>
          ))}
        </FormSelect>
      </Field>
      <Field label={t("unitFiles.files")} htmlFor="unit-document-files" required>
        <Input id="unit-document-files" type="file" multiple onChange={(event) => setChosen([...(event.target.files ?? [])])} />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            {t("unitFiles.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!chosen.length}>
          {t("unitFiles.upload")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Attach a document or image already filed on this unit or its project (E-05D §63): referenced, never copied. */
export function AttachDialog({ open, onOpenChange, unitId, kind, onAttached }: { open: boolean; onOpenChange: (open: boolean) => void; unitId: string; kind: "document" | "image"; onAttached: () => void }) {
  const t = useTranslations("projects");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{kind === "image" ? t("unitFiles.addExistingImage") : t("unitFiles.attachExistingDocument")}</DialogTitle>
        <DialogDescription>{t("unitFiles.attachBody")}</DialogDescription>
        <AttachForm unitId={unitId} kind={kind} onAttached={onAttached} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted per opening. The chosen file and its category are input (AUD-03
 * §5); the search is a filter and is not. Save and continue attaches, exactly
 * as the Attach button does.
 */
function AttachForm({ unitId, kind, onAttached, onDone }: { unitId: string; kind: "document" | "image"; onAttached: () => void; onDone: () => void }) {
  const t = useTranslations("projects");
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<AttachableDocumentDTO[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [category, setCategory] = React.useState<string>(kind === "image" ? "OTHER" : "TECHNICAL_DRAWING");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => INVALID);
  const editor = useValuesEditor({ selected, category }, { module: "units", saveKind: "create", label: kind === "image" ? t("unitFiles.imageToAdd") : t("unitFiles.documentToAttach"), save: () => persist.current() });

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      void structureApi<AttachableDocumentDTO[]>(`/api/project-units/${unitId}/document-candidates?kind=${kind}&q=${encodeURIComponent(q)}`)
        .then(setItems)
        .catch(() => setItems([]));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [q, unitId, kind]);

  persist.current = async () => {
    if (!selected) return INVALID;
    setPending(true);
    setError(null);
    try {
      await editor.track(() => structureApi(kind === "image" ? `/api/project-units/${unitId}/media` : `/api/project-units/${unitId}/documents`, { body: kind === "image" ? { documentId: selected, category, caption: null } : { documentId: selected, category } }));
      toast({ title: kind === "image" ? t("unitFiles.imageAdded") : t("unitFiles.documentAttached") });
      onDone();
      onAttached();
      return COMMITTED;
    } catch (failure) {
      setError(failureMessage(failure, t("unitFiles.fileAttachFailed")));
      return failureOutcome(failure);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="mt-4 space-y-4">
        <FormError message={error} />
        <Field label={t("unitFiles.search")} htmlFor="attach-search">
          <Input id="attach-search" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t("unitFiles.fileName")} autoFocus />
        </Field>
        <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={t("unitFiles.files")}>
          {items === null ? (
            <li className="text-table text-fg-muted">{t("unitFiles.loading")}</li>
          ) : items.length === 0 ? (
            <li className="text-table text-fg-muted">{t("unitFiles.noFiles")}</li>
          ) : (
            items.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-table hover:bg-hover">
                  <input type="radio" name="attach-file" value={item.id} checked={selected === item.id} onChange={() => setSelected(item.id)} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-meta text-fg-subtle">{item.onUnit ? t("unitFiles.thisUnit") : t("unitFiles.project")}</span>
                </label>
              </li>
            ))
          )}
        </ul>
        <Field label={t("unitFiles.category")} htmlFor="attach-category">
          <FormSelect id="attach-category" className={selectClass} value={category} onChange={(event) => setCategory(event.target.value)}>
            {(kind === "image" ? UNIT_MEDIA_CATEGORIES : UNIT_DOCUMENT_CATEGORIES).map((value) => (
              <option key={value} value={value}>
                {kind === "image" ? t(`mediaCategory.${value as UnitMediaCategory}`) : t(`documentCategory.${value as UnitDocumentCategory}`)}
              </option>
            ))}
          </FormSelect>
        </Field>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("unitFiles.cancel")}
          </Button>
        </DialogClose>
        <Button onClick={() => void persist.current()} disabled={!selected || pending}>
          {pending ? t("unitFiles.attaching") : kind === "image" ? t("unitFiles.addImage") : t("unitFiles.attach")}
        </Button>
      </DialogFooter>
    </>
  );
}
