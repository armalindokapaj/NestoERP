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

/**
 * Contractor, assignment and work package dialogs (PRD #46 §16, §17, §25-§40,
 * §308). A likely duplicate is shown, never merged: the writer sees which
 * contractor it resembles and why, and confirms before a second record is made.
 */

function useLoad<T>(url: string, fallback: T) {
  const [data, setData] = React.useState<T>(fallback);
  const [loaded, setLoaded] = React.useState(false);
  const load = React.useCallback(async () => {
    if (loaded) return data;
    const next = await engineeringApi<T>(url).catch(() => fallback);
    setData(next);
    setLoaded(true);
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, url]);
  return { data, loaded, load };
}

/* Contractors -------------------------------------------------------------- */

export function NewContractorButton() {
  const [open, setOpen] = React.useState(false);
  const [duplicates, setDuplicates] = React.useState<DuplicateWarning[]>([]);
  const [confirmed, setConfirmed] = React.useState(false);
  const options = useLoad<{ suppliers: Option[] }>("/api/contractors/options", { suppliers: [] });

  return (
    <>
      <Button type="button" size="sm" data-testid="new-contractor" onClick={() => void options.load().then(() => { setDuplicates([]); setConfirmed(false); setOpen(true); })}>
        <Plus aria-hidden="true" />
        New contractor
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="New contractor"
          description="An organisation you engage — not a user and not a supplier. Contacts are added on its record."
          fields={contractorFields(options.data.suppliers, "create")}
          initial={{ status: "PROSPECTIVE" }}
          submitLabel={duplicates.length ? "Create anyway" : "Create contractor"}
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
              <p className="text-table font-medium text-warning-strong">This looks like a contractor already in the directory.</p>
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
                    <span className="text-fg-muted"> · {CONTRACTOR_STATUS_LABELS[duplicate.status]} · {duplicate.reasons.join(", ")}</span>
                  </li>
                ))}
              </ul>
              <label htmlFor="confirm-duplicate" className="flex items-center gap-2 text-table text-fg">
                <Checkbox id="confirm-duplicate" checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />
                It is a different organisation — create it anyway
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
  const [open, setOpen] = React.useState(false);
  const options = useLoad<{ suppliers: Option[] }>("/api/contractors/options", { suppliers: [] });
  return (
    <>
      <Button type="button" size="sm" variant="secondary" data-testid="edit-contractor" onClick={() => void options.load().then(() => setOpen(true))}>
        <Pencil aria-hidden="true" />
        Edit
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="Edit contractor"
          fields={contractorFields(options.data.suppliers, "edit")}
          initial={contractor}
          submitLabel="Save changes"
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

export function AssignContractorButton({ projectId, contractorId, label = "Assign contractor" }: { projectId: string; contractorId?: string; label?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [chosen, setChosen] = React.useState<string | null>(contractorId ?? null);
  const options = useLoad<AssignmentOptions>(`/api/projects/${projectId}/contractors/options`, { contractors: [], members: [], contracts: [] });
  return (
    <>
      <Button type="button" size="sm" data-testid="assign-contractor" onClick={() => void options.load().then(() => setOpen(true))}>
        <Plus aria-hidden="true" />
        {label}
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="Assign a contractor"
          description="Each project assignment stands on its own: its status, scope, contract and manager."
          fields={assignmentFields(options.data, chosen, "create")}
          initial={{ status: "PLANNED", contractorId }}
          onValuesChange={(values) => setChosen(typeof values.contractorId === "string" && values.contractorId ? values.contractorId : null)}
          submitLabel="Assign"
          wide
          testId="assignment-form"
          onSubmit={async (payload) => {
            await engineeringApi(`/api/projects/${projectId}/contractors`, { body: payload });
            toast({ title: "Contractor assigned.", tone: "success" });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

export function EditAssignmentButton({ projectId, assignment }: { projectId: string; assignment: { id: string; contractorId: string; version: number; status: string; scopeSummary: string | null; contractId: string | null; internalManagerMemberId: string | null; primaryContractorContactId: string | null; startDate: string | null; endDate: string | null } }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const options = useLoad<AssignmentOptions>(`/api/projects/${projectId}/contractors/options`, { contractors: [], members: [], contracts: [] });
  return (
    <>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Edit assignment" data-testid="edit-assignment" onClick={() => void options.load().then(() => setOpen(true))}>
        <Pencil aria-hidden="true" />
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="Edit assignment"
          fields={assignmentFields(options.data, assignment.contractorId, "edit")}
          initial={assignment}
          submitLabel="Save changes"
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
  const [open, setOpen] = React.useState(false);
  const options = useLoad<WorkPackageOptions>(`/api/projects/${projectId}/work-packages/options`, { contractors: [], contracts: [], members: [], canSetValue: false });
  return (
    <>
      <Button type="button" size="sm" data-testid="new-work-package" onClick={() => void options.load().then(() => setOpen(true))}>
        <Plus aria-hidden="true" />
        New work package
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="New work package"
          description="A unit of scope: which contractor, under which contract, who answers for it, and when."
          fields={workPackageFields(options.data, "create")}
          initial={{ status: "PLANNED", contractorId }}
          submitLabel="Create work package"
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
  const [open, setOpen] = React.useState(false);
  const options = useLoad<WorkPackageOptions>(`/api/projects/${projectId}/work-packages/options`, { contractors: [], contracts: [], members: [], canSetValue: false });
  return (
    <>
      <Button type="button" size="sm" variant="secondary" data-testid="edit-work-package" onClick={() => void options.load().then(() => setOpen(true))}>
        <Pencil aria-hidden="true" />
        Edit
      </Button>
      {options.loaded ? (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="Edit work package"
          fields={workPackageFields(options.data, "edit")}
          initial={workPackage}
          submitLabel="Save changes"
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
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" data-testid="complete-work-package" onClick={() => setOpen(true)}>
        Complete
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Complete work package"
        description="Completing it closes nothing else — not the contract, not the project, not the final account."
        fields={[{ name: "actualFinishDate", label: "Actual finish", type: "date", hint: "Left blank, today." }]}
        submitLabel="Complete"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/work-packages/${workPackageId}/complete`, { body: { ...payload, expectedVersion: version } });
          toast({ title: "Work package completed.", tone: "success" });
          router.refresh();
        }}
      />
    </>
  );
}
