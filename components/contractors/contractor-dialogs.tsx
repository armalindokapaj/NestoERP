"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Pencil, Plus } from "lucide-react";

import { engineeringApi, isFailure } from "@/components/engineering/engineering-api";
import { FormDialog } from "@/components/engineering/form-kit";
import { assignmentFields, contractorFields, workPackageFields } from "@/components/engineering/record-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { CONTRACTOR_STATUS_LABELS, type DuplicateWarning } from "@/lib/modules/contractors/contractor.types";
import type { Option } from "@/lib/modules/engineering/engineering.types";
import { contractorsLabel } from "@/lib/i18n/modules/contractors/labels";
import { useContractorsTranslations } from "./contractors-text";

/**
 * Contractor, assignment and work package dialogs (PRD #46 §16, §17, §25-§40,
 * §308). A likely duplicate is shown, never merged: the writer sees which
 * contractor it resembles and why, and confirms before a second record is made.
 */

/**
 * A dialog's options, read once. A failed read is said, not cached: the
 * dialog stays closed, the toast says why, and the next click tries again —
 * an empty list standing in for "could not load" used to open a form whose
 * missing supplier or contract choices looked like "none" (AUD-09 §5, FV-09).
 * Resolves `null` on failure.
 */
function useLoad<T>(url: string, fallback: T) {
  const toast = useToast();
  const t = useContractorsTranslations();
  const [data, setData] = React.useState<T>(fallback);
  const [loaded, setLoaded] = React.useState(false);
  const load = React.useCallback(async (): Promise<T | null> => {
    if (loaded) return data;
    try {
      const next = await engineeringApi<T>(url);
      setData(next);
      setLoaded(true);
      return next;
    } catch {
      toast({ title: t("dialogs.loadFailed"), tone: "danger" });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, url]);
  return { data, loaded, load };
}

/* Contractors -------------------------------------------------------------- */

export function NewContractorButton() {
  const t = useContractorsTranslations();
  const [open, setOpen] = React.useState(false);
  const [duplicates, setDuplicates] = React.useState<DuplicateWarning[]>([]);
  const [confirmed, setConfirmed] = React.useState(false);
  const options = useLoad<{ suppliers: Option[] }>("/api/contractors/options", { suppliers: [] });

  return (
    <>
      <Button type="button" size="sm" data-testid="new-contractor" onClick={() => void options.load().then((next) => { if (!next) return; setDuplicates([]); setConfirmed(false); setOpen(true); })}>
        <Plus aria-hidden="true" />
        {t("dialogs.newContractor")}
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.newContractor")}
          description={t("dialogs.newContractorDescription")}
          fields={contractorFields(options.data.suppliers, "create", t)}
          initial={{ status: "PROSPECTIVE" }}
          submitLabel={duplicates.length ? t("dialogs.createAnyway") : t("dialogs.createContractor")}
          saveKind="create"
          wide
          testId="contractor-form"
          onSubmit={async (payload) => {
            try {
              const created = await engineeringApi<{ id: string }>("/api/contractors", { body: { ...payload, confirmDuplicate: confirmed } });
              return { redirectTo: `/contractors/${created.id}` };
            } catch (failure) {
              if (isFailure(failure) && failure.detailCode === "CONTRACTOR_DUPLICATE" && Array.isArray(failure.details.duplicates)) setDuplicates(failure.details.duplicates as DuplicateWarning[]);
              throw failure;
            }
          }}
        >
          {duplicates.length ? (
            <div className="space-y-3 rounded-md border border-warning/40 bg-warning-soft px-4 py-3" data-testid="duplicate-warning">
              <p className="text-table font-medium text-warning-strong">{t("dialogs.duplicateTitle")}</p>
              <ul className="space-y-1.5 text-table text-fg">
                {duplicates.map((duplicate, index) => (
                  <li key={`${duplicate.id}:${index}`}>
                    {duplicate.id ? (
                      <Link href={`/contractors/${duplicate.id}`} className="font-medium underline-offset-4 hover:underline" target="_blank">
                        {duplicate.legalName}
                      </Link>
                    ) : (
                      <span className="font-medium">{duplicate.legalName}</span>
                    )}
                    <span className="text-fg-muted"> · {contractorsLabel(t, "contractorStatus", duplicate.status, CONTRACTOR_STATUS_LABELS[duplicate.status])} · {duplicate.reasons.join(", ")}</span>
                  </li>
                ))}
              </ul>
              <label htmlFor="confirm-duplicate" className="flex items-center gap-2 text-table text-fg">
                <Checkbox id="confirm-duplicate" checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />
                {t("dialogs.duplicateConfirm")}
              </label>
            </div>
          ) : null}
        </FormDialog>
      ) : null}
    </>
  );
}

export function EditContractorButton({ contractor }: { contractor: Record<string, unknown> & { id: string; version: number } }) {
  const router = useRouter();
  const t = useContractorsTranslations();
  const [open, setOpen] = React.useState(false);
  const options = useLoad<{ suppliers: Option[] }>("/api/contractors/options", { suppliers: [] });
  return (
    <>
      <Button type="button" size="sm" variant="secondary" data-testid="edit-contractor" onClick={() => void options.load().then((next) => next && setOpen(true))}>
        <Pencil aria-hidden="true" />
        {t("dialogs.edit")}
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.editContractor")}
          fields={contractorFields(options.data.suppliers, "edit", t)}
          initial={contractor}
          submitLabel={t("dialogs.saveChanges")}
          saveKind="save"
          wide
          onSubmit={async (payload) => {
            await engineeringApi(`/api/contractors/${contractor.id}`, { method: "PATCH", body: { ...payload, expectedVersion: contractor.version } });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* Assignments -------------------------------------------------------------- */

type AssignmentOptions = { contractors: Array<Option & { status: string; assigned: boolean; contacts: Option[] }>; members: Option[]; contracts: Option[] };

export function AssignContractorButton({ projectId, contractorId, label }: { projectId: string; contractorId?: string; label?: string }) {
  const router = useRouter();
  const t = useContractorsTranslations();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [chosen, setChosen] = React.useState<string | null>(contractorId ?? null);
  const options = useLoad<AssignmentOptions>(`/api/projects/${projectId}/contractors/options`, { contractors: [], members: [], contracts: [] });
  return (
    <>
      <Button type="button" size="sm" data-testid="assign-contractor" onClick={() => void options.load().then((next) => next && setOpen(true))}>
        <Plus aria-hidden="true" />
        {label ?? t("dialogs.assignContractor")}
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.assignTitle")}
          description={t("dialogs.assignDescription")}
          fields={assignmentFields(options.data, chosen, "create", t)}
          initial={{ status: "PLANNED", contractorId }}
          onValuesChange={(values) => setChosen(typeof values.contractorId === "string" && values.contractorId ? values.contractorId : null)}
          submitLabel={t("dialogs.assign")}
          saveKind="none"
          wide
          testId="assignment-form"
          onSubmit={async (payload) => {
            // A contact of the contractor chosen before is not this one's: cleared, as the field's hint says (AUD-09 §5, FV-08).
            const contacts = options.data.contractors?.find((item) => item.id === payload.contractorId)?.contacts ?? [];
            if (payload.primaryContractorContactId && !contacts.some((contact) => contact.id === payload.primaryContractorContactId)) payload.primaryContractorContactId = null;
            await engineeringApi(`/api/projects/${projectId}/contractors`, { body: payload });
            toast({ title: t("dialogs.assigned"), tone: "success" });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

export function EditAssignmentButton({ projectId, assignment, subject }: { projectId: string; subject?: string; assignment: { id: string; contractorId: string; version: number; status: string; scopeSummary: string | null; contractId: string | null; internalManagerMemberId: string | null; primaryContractorContactId: string | null; startDate: string | null; endDate: string | null } }) {
  const router = useRouter();
  const t = useContractorsTranslations();
  const [open, setOpen] = React.useState(false);
  const options = useLoad<AssignmentOptions>(`/api/projects/${projectId}/contractors/options`, { contractors: [], members: [], contracts: [] });
  return (
    <>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={subject ? t("dialogs.editAssignmentFor", { subject }) : t("dialogs.editAssignment")} data-testid="edit-assignment" onClick={() => void options.load().then((next) => next && setOpen(true))}>
        <Pencil aria-hidden="true" />
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.editAssignment")}
          fields={assignmentFields(options.data, assignment.contractorId, "edit", t)}
          initial={assignment}
          submitLabel={t("dialogs.saveChanges")}
          saveKind="save"
          wide
          onSubmit={async (payload) => {
            await engineeringApi(`/api/project-contractor-assignments/${assignment.id}`, { method: "PATCH", body: { ...payload, expectedVersion: assignment.version } });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* Work packages ------------------------------------------------------------ */

type WorkPackageOptions = { contractors: Option[]; contracts: Option[]; members: Option[]; canSetValue: boolean };

export function NewWorkPackageButton({ projectId, contractorId }: { projectId: string; contractorId?: string }) {
  const t = useContractorsTranslations();
  const [open, setOpen] = React.useState(false);
  const options = useLoad<WorkPackageOptions>(`/api/projects/${projectId}/work-packages/options`, { contractors: [], contracts: [], members: [], canSetValue: false });
  return (
    <>
      <Button type="button" size="sm" data-testid="new-work-package" onClick={() => void options.load().then((next) => next && setOpen(true))}>
        <Plus aria-hidden="true" />
        {t("dialogs.newWorkPackage")}
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.newWorkPackage")}
          description={t("dialogs.newWorkPackageDescription")}
          fields={workPackageFields(options.data, "create", t)}
          initial={{ status: "PLANNED", contractorId }}
          submitLabel={t("dialogs.createWorkPackage")}
          saveKind="create"
          wide
          testId="work-package-form"
          onSubmit={async (payload) => {
            const created = await engineeringApi<{ id: string }>(`/api/projects/${projectId}/work-packages`, { body: payload });
            return { redirectTo: `/projects/${projectId}/work-packages/${created.id}` };
          }}
        />
      ) : null}
    </>
  );
}

export function EditWorkPackageButton({ projectId, workPackage }: { projectId: string; workPackage: Record<string, unknown> & { id: string; version: number } }) {
  const router = useRouter();
  const t = useContractorsTranslations();
  const [open, setOpen] = React.useState(false);
  const options = useLoad<WorkPackageOptions>(`/api/projects/${projectId}/work-packages/options`, { contractors: [], contracts: [], members: [], canSetValue: false });
  return (
    <>
      <Button type="button" size="sm" variant="secondary" data-testid="edit-work-package" onClick={() => void options.load().then((next) => next && setOpen(true))}>
        <Pencil aria-hidden="true" />
        {t("dialogs.edit")}
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.editWorkPackage")}
          fields={workPackageFields(options.data, "edit", t)}
          initial={workPackage}
          submitLabel={t("dialogs.saveChanges")}
          saveKind="save"
          wide
          onSubmit={async (payload) => {
            await engineeringApi(`/api/work-packages/${workPackage.id}`, { method: "PATCH", body: { ...payload, expectedVersion: workPackage.version } });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

export function CompleteWorkPackageButton({ workPackageId, version }: { workPackageId: string; version: number }) {
  const router = useRouter();
  const toast = useToast();
  const t = useContractorsTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" data-testid="complete-work-package" onClick={() => setOpen(true)}>
        {t("dialogs.complete")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("dialogs.completeTitle")}
        description={t("dialogs.completeDescription")}
        fields={[{ name: "actualFinishDate", label: t("dialogs.actualFinish"), type: "date", hint: t("dialogs.actualFinishHint") }]}
        submitLabel={t("dialogs.complete")}
        saveKind="none"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/work-packages/${workPackageId}/complete`, { body: { ...payload, expectedVersion: version } });
          toast({ title: t("dialogs.completed"), tone: "success" });
          router.refresh();
        }}
      />
    </>
  );
}
