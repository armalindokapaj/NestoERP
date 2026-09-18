"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand, type FormField, type FormValues } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Changing the group's departments (E-13 §34, §35, §39-§45, §139).
 *
 * The same dialogs serve Organization and the Platform Admin's group setup: only
 * the API they call differs (`/api/organization` or the platform's group),
 * because both work on the same records through the same services (§51). The
 * server decides who may; a button is only shown to someone it would let.
 * Deactivating, replacing and removing are confirmed first (§139).
 */

/** Where a surface's department API lives. */
export type DepartmentApi = { base: string; platform: boolean };

const enc = encodeURIComponent;

export type CandidateOption = { personId: string; label: string };

function useOpen() {
  const [open, setOpen] = React.useState(false);
  return { open, setOpen };
}

/* -------------------------------------------------------------------------- */
/* The department                                                              */
/* -------------------------------------------------------------------------- */

const departmentFields: FormField[] = [
  { name: "name", label: "Name", type: "text", required: true, placeholder: "Finance" },
  { name: "code", label: "Code", type: "text", required: true, placeholder: "FIN", hint: "Short, unique in the group. Letters, digits, hyphens." },
  { name: "description", label: "Description", type: "textarea", rows: 3, wide: true },
];

export function NewDepartmentButton({ api, label = "New department" }: { api: DepartmentApi; label?: string }) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New department"
        description="Defined once for the group; each company activates it when it needs it."
        fields={departmentFields}
        submitLabel="Create department"
        testId="new-department-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${api.base}/departments`, { body: { name: payload.name, code: payload.code, description: payload.description ?? undefined } });
          await run("create", async () => null, "Department created.");
        }}
      />
    </>
  );
}

export function EditDepartmentButton({ api, department }: { api: DepartmentApi; department: { id: string; name: string; code: string; description: string | null } }) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Edit ${department.name}`}
        description="A new name reaches every company's branch of it."
        fields={departmentFields}
        initial={department}
        submitLabel="Save"
        testId="edit-department-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${api.base}/departments/${enc(department.id)}`, { method: "PATCH", body: { name: payload.name, code: payload.code, description: payload.description } });
          await run("edit", async () => null, "Department saved.");
        }}
      />
    </>
  );
}

/** Deactivating keeps everything; reactivating brings it back (E-13 §90, §140). */
export function DepartmentStatusButton({ department }: { department: { id: string; name: string; status: "ACTIVE" | "INACTIVE" } }) {
  const { open, setOpen } = useOpen();
  const { pending, run } = useCommand();
  const active = department.status === "ACTIVE";
  const url = `/api/organization/departments/${enc(department.id)}/${active ? "deactivate" : "reactivate"}`;
  if (!active) {
    return (
      <Button size="sm" variant="secondary" disabled={pending === "status"} onClick={() => void run("status", () => engineeringApi(url, { body: {} }), `${department.name} is active again.`)}>
        Reactivate
      </Button>
    );
  }
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Deactivate
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Deactivate ${department.name}?`}
        description="No company can activate it and nobody new joins it. Its branches, people, head and history stay as they are, and reactivating brings it all back. Its positions stop widening anything while it is inactive."
        confirmLabel="Deactivate department"
        pending={pending === "status"}
        onConfirm={() => void run("status", () => engineeringApi(url, { body: {} }), `${department.name} is inactive.`, () => setOpen(false))}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Companies                                                                   */
/* -------------------------------------------------------------------------- */

/** Activate in several companies at once (E-13 §41, §42). */
export function ActivateCompaniesButton({ api, department, companies, label = "Activate in companies" }: { api: DepartmentApi; department: { id: string; name: string }; companies: Array<{ id: string; name: string; reactivates: boolean }>; label?: string }) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  if (companies.length === 0) return null;
  const fields: FormField[] = companies.map((company) => ({ name: `company:${company.id}`, label: company.reactivates ? `${company.name} (reactivate)` : company.name, type: "checkbox" }));
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Activate ${department.name}`}
        description="Each company chosen gets its branch of the department, or has its old one back."
        fields={fields}
        submitLabel="Activate selected"
        testId="activate-companies-dialog"
        onSubmit={async (payload) => {
          const companyIds = Object.entries(payload).filter(([, value]) => value === true).map(([key]) => key.slice("company:".length));
          if (companyIds.length === 0) throw { status: 400, code: "VALIDATION_ERROR", message: "Choose at least one company.", details: {} };
          await engineeringApi(`${api.base}/departments/${enc(department.id)}/companies`, { body: { companyIds } });
          await run("activate", async () => null, companyIds.length === 1 ? "Department activated." : `Activated in ${companyIds.length} companies.`);
        }}
      />
    </>
  );
}

/** One company's branch: activate, deactivate (confirmed), reactivate (E-13 §17-§19, §35, §39). */
export function BranchStatusButton({ api, department, company, status }: { api: DepartmentApi; department: { id: string; name: string }; company: { id: string; name: string }; status: "ACTIVE" | "INACTIVE" | null }) {
  const { open, setOpen } = useOpen();
  const { pending, run } = useCommand();
  const activate = () => engineeringApi(`${api.base}/departments/${enc(department.id)}/companies`, { body: { companyIds: [company.id] } });
  if (status !== "ACTIVE") {
    return (
      <Button size="sm" variant="ghost" disabled={pending === "branch"} onClick={() => void run("branch", activate, `${department.name} is active in ${company.name}.`)} aria-label={`${status === "INACTIVE" ? "Reactivate" : "Activate"} ${department.name} in ${company.name}`}>
        {status === "INACTIVE" ? "Reactivate" : `Activate ${department.name}`}
      </Button>
    );
  }
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Deactivate ${department.name} in ${company.name}`}>
        Deactivate
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Deactivate ${department.name} in ${company.name}?`}
        description="The branch is kept with its people, its manager and every record that names it. Nobody new joins it until it is reactivated."
        confirmLabel="Deactivate"
        pending={pending === "branch"}
        onConfirm={() => void run("branch", () => engineeringApi(`${api.base}/departments/${enc(department.id)}/companies/${enc(company.id)}/deactivate`, { body: {} }), `${department.name} is inactive in ${company.name}.`, () => setOpen(false))}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Heads and managers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Appoints a head or a branch manager (E-13 §43, §44, §70, §71). With somebody
 * in office the dialog says so and replaces them on purpose (§22, §139).
 */
export function AppointButton({
  api,
  target,
  title,
  holder,
  candidates,
  label,
}: {
  api: DepartmentApi;
  target: { kind: "head"; departmentId: string } | { kind: "manager"; branchId: string };
  title: string;
  holder: string | null;
  candidates: CandidateOption[];
  label?: string;
}) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  if (candidates.length === 0) return null;
  const url = target.kind === "head" ? `${api.base}/departments/${enc(target.departmentId)}/group-head` : `${api.base}/company-departments/${enc(target.branchId)}/manager`;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {label ?? (holder ? "Replace" : target.kind === "head" ? "Assign head" : "Assign manager")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={
          holder
            ? `${holder}'s appointment ends now and stays in the history. The position widens what the new holder already works as, and nothing else.`
            : "The position widens what they already work as, and nothing else."
        }
        fields={[{ name: "personId", label: "Person", type: "select", required: true, options: candidates.map((candidate) => ({ value: candidate.personId, label: candidate.label })) }]}
        initial={{ personId: candidates[0]?.personId }}
        submitLabel={holder ? `Replace ${holder}` : "Appoint"}
        testId={target.kind === "head" ? "appoint-head-dialog" : "appoint-manager-dialog"}
        onSubmit={async (payload) => {
          await engineeringApi(url, { body: { personId: payload.personId, replace: Boolean(holder) } });
          await run("appoint", async () => null, "Appointment recorded.");
        }}
      />
    </>
  );
}

/** Ends an appointment or a member's place; it stays in the history (E-13 §47, §67). */
export function EndAssignmentButton({ assignmentId, personName, what, label = "End" }: { assignmentId: string; personName: string; what: string; label?: string }) {
  const { open, setOpen } = useOpen();
  const { pending, run } = useCommand();
  return (
    <>
      <button type="button" className="text-meta text-accent-strong hover:underline" onClick={() => setOpen(true)} aria-label={`${label === "End" ? "End" : label} ${personName}'s place as ${what}`}>
        {label}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={label === "Remove" ? `Remove ${personName} from ${what}?` : `End ${personName}'s appointment as ${what}?`}
        description="They keep their job, their login, their company access and their projects. The place ends now and stays in the history."
        confirmLabel={label === "Remove" ? "Remove from department" : "End appointment"}
        pending={pending === "end"}
        onConfirm={() => void run("end", () => engineeringApi(`/api/organization/department-assignments/${enc(assignmentId)}/end`, { body: {} }), label === "Remove" ? `${personName} is no longer in ${what}.` : "Appointment ended.", () => setOpen(false))}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Members                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Adds an existing person to one of the department's company branches (E-13
 * §45, §79). Nobody is created here; the people offered already work in that
 * company or for the whole group.
 */
export function AddMemberButton({ api, departmentName, branches }: { api: DepartmentApi; departmentName: string; branches: Array<{ id: string; companyName: string; candidates: CandidateOption[] }> }) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  const usable = branches.filter((branch) => branch.candidates.length > 0);
  if (usable.length === 0) return null;
  const fields: FormField[] = [
    ...(usable.length > 1 ? [{ name: "branchId", label: "Company", type: "select" as const, required: true, options: usable.map((branch) => ({ value: branch.id, label: branch.companyName })) }] : []),
    ...usable.map((branch) => ({
      name: `person:${branch.id}`,
      label: "Person",
      type: "select" as const,
      required: true,
      options: branch.candidates.map((candidate) => ({ value: candidate.personId, label: candidate.label })),
      visible: (values: FormValues) => usable.length === 1 || values.branchId === branch.id,
    })),
  ];
  const initial: Record<string, unknown> = { branchId: usable[0]!.id };
  for (const branch of usable) initial[`person:${branch.id}`] = branch.candidates[0]?.personId;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Add member
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Add to ${departmentName}`}
        description="Somebody who already works in that company, or for the whole group. They get a place on the team; their login, job and projects are unchanged."
        fields={fields}
        initial={initial}
        submitLabel="Add member"
        testId="add-member-dialog"
        onSubmit={async (payload) => {
          const branchId = usable.length === 1 ? usable[0]!.id : String(payload.branchId);
          const personId = payload[`person:${branchId}`];
          await engineeringApi(`${api.base}/company-departments/${enc(branchId)}/members`, { body: { personId } });
          await run("add", async () => null, "Member added.");
        }}
      />
    </>
  );
}

/** Moves a member's place to another company's branch of the same department (E-13 §36, §72, §85). */
export function MovePlaceButton({ assignmentId, personName, from, branches }: { assignmentId: string; personName: string; from: string; branches: Array<{ id: string; companyName: string }> }) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  if (branches.length === 0) return null;
  return (
    <>
      <button type="button" className="text-meta text-accent-strong hover:underline" onClick={() => setOpen(true)} aria-label={`Move ${personName}'s place in ${from}`}>
        Move
      </button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Move ${personName}`}
        description={`Their place in ${from} ends and stays in the history; a new one begins in the company chosen.`}
        fields={[{ name: "companyDepartmentId", label: "To", type: "select", required: true, options: branches.map((branch) => ({ value: branch.id, label: branch.companyName })) }]}
        initial={{ companyDepartmentId: branches[0]?.id }}
        submitLabel="Move"
        testId="move-place-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/organization/department-assignments/${enc(assignmentId)}`, { method: "PATCH", body: { companyDepartmentId: payload.companyDepartmentId } });
          await run("move", async () => null, `${personName} moved.`);
        }}
      />
    </>
  );
}
