"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand, type FormField, type FormValues } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Translate } from "@/lib/i18n/translator";
import { useOrganizationTranslations } from "./organization-text";

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

const departmentFields = (t: Translate<"organization">): FormField[] => [
  { name: "name", label: t("departmentActions.name"), type: "text", required: true, placeholder: "Finance" },
  { name: "code", label: t("departmentActions.code"), type: "text", required: true, placeholder: "FIN", hint: t("departmentActions.codeHint") },
  { name: "description", label: t("departmentActions.description"), type: "textarea", rows: 3, wide: true },
];

export function NewDepartmentButton({ api, label }: { api: DepartmentApi; label?: string }) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  const t = useOrganizationTranslations();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {label ?? t("departmentActions.newDepartment")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("departmentActions.newDepartment")}
        description={t("departmentActions.newDescription")}
        fields={departmentFields(t)}
        submitLabel={t("departmentActions.createDepartment")}
        saveKind="create"
        testId="new-department-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${api.base}/departments`, { body: { name: payload.name, code: payload.code, description: payload.description ?? undefined } });
          await run("create", async () => null, t("departmentActions.created"));
        }}
      />
    </>
  );
}

export function EditDepartmentButton({ api, department }: { api: DepartmentApi; department: { id: string; name: string; code: string; description: string | null } }) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  const t = useOrganizationTranslations();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("departmentActions.edit")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("departmentActions.editTitle", { department: department.name })}
        description={t("departmentActions.editDescription")}
        fields={departmentFields(t)}
        initial={department}
        submitLabel={t("departmentActions.save")}
        saveKind="save"
        testId="edit-department-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${api.base}/departments/${enc(department.id)}`, { method: "PATCH", body: { name: payload.name, code: payload.code, description: payload.description } });
          await run("edit", async () => null, t("departmentActions.saved"));
        }}
      />
    </>
  );
}

/** Deactivating keeps everything; reactivating brings it back (E-13 §90, §140). */
export function DepartmentStatusButton({ department }: { department: { id: string; name: string; status: "ACTIVE" | "INACTIVE" } }) {
  const { open, setOpen } = useOpen();
  const { pending, run } = useCommand();
  const t = useOrganizationTranslations();
  const active = department.status === "ACTIVE";
  const url = `/api/organization/departments/${enc(department.id)}/${active ? "deactivate" : "reactivate"}`;
  if (!active) {
    return (
      <Button size="sm" variant="secondary" disabled={pending === "status"} onClick={() => void run("status", () => engineeringApi(url, { body: {} }), t("departmentActions.activeAgain", { department: department.name }))}>
        {t("departmentActions.reactivate")}
      </Button>
    );
  }
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("departmentActions.deactivate")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("departmentActions.deactivateTitle", { department: department.name })}
        description={t("departmentActions.deactivateDescription")}
        confirmLabel={t("departmentActions.deactivateDepartment")}
        pending={pending === "status"}
        onConfirm={() => void run("status", () => engineeringApi(url, { body: {} }), t("departmentActions.inactive", { department: department.name }), () => setOpen(false))}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Companies                                                                   */
/* -------------------------------------------------------------------------- */

/** Activate in several companies at once (E-13 §41, §42). */
export function ActivateCompaniesButton({ api, department, companies, label }: { api: DepartmentApi; department: { id: string; name: string }; companies: Array<{ id: string; name: string; reactivates: boolean }>; label?: string }) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  const t = useOrganizationTranslations();
  if (companies.length === 0) return null;
  const fields: FormField[] = companies.map((company) => ({ name: `company:${company.id}`, label: company.reactivates ? t("departmentActions.reactivateCompany", { company: company.name }) : company.name, type: "checkbox" }));
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {label ?? t("departmentActions.activateInCompanies")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("departmentActions.activateTitle", { department: department.name })}
        description={t("departmentActions.activateDescription")}
        fields={fields}
        submitLabel={t("departmentActions.activateSelected")}
        saveKind="none"
        testId="activate-companies-dialog"
        onSubmit={async (payload) => {
          const companyIds = Object.entries(payload).filter(([, value]) => value === true).map(([key]) => key.slice("company:".length));
          if (companyIds.length === 0) throw { status: 400, code: "VALIDATION_ERROR", message: t("departmentActions.chooseCompany"), details: {} };
          await engineeringApi(`${api.base}/departments/${enc(department.id)}/companies`, { body: { companyIds } });
          await run("activate", async () => null, companyIds.length === 1 ? t("departmentActions.activated") : t("departmentActions.activatedIn", { count: companyIds.length }));
        }}
      />
    </>
  );
}

/** One company's branch: activate, deactivate (confirmed), reactivate (E-13 §17-§19, §35, §39). */
export function BranchStatusButton({ api, department, company, status }: { api: DepartmentApi; department: { id: string; name: string }; company: { id: string; name: string }; status: "ACTIVE" | "INACTIVE" | null }) {
  const { open, setOpen } = useOpen();
  const { pending, run } = useCommand();
  const t = useOrganizationTranslations();
  const activate = () => engineeringApi(`${api.base}/departments/${enc(department.id)}/companies`, { body: { companyIds: [company.id] } });
  if (status !== "ACTIVE") {
    return (
      <Button size="sm" variant="ghost" disabled={pending === "branch"} onClick={() => void run("branch", activate, t("departmentActions.activeIn", { department: department.name, company: company.name }))} aria-label={t(status === "INACTIVE" ? "departmentActions.reactivateIn" : "departmentActions.activateIn", { department: department.name, company: company.name })}>
        {status === "INACTIVE" ? t("departmentActions.reactivate") : t("departmentActions.activateDepartment", { department: department.name })}
      </Button>
    );
  }
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={t("departmentActions.deactivateIn", { department: department.name, company: company.name })}>
        {t("departmentActions.deactivate")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("departmentActions.deactivateInTitle", { department: department.name, company: company.name })}
        description={t("departmentActions.deactivateInDescription")}
        confirmLabel={t("departmentActions.deactivate")}
        pending={pending === "branch"}
        onConfirm={() => void run("branch", () => engineeringApi(`${api.base}/departments/${enc(department.id)}/companies/${enc(company.id)}/deactivate`, { body: {} }), t("departmentActions.inactiveIn", { department: department.name, company: company.name }), () => setOpen(false))}
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
  const t = useOrganizationTranslations();
  if (candidates.length === 0) return null;
  const url = target.kind === "head" ? `${api.base}/departments/${enc(target.departmentId)}/group-head` : `${api.base}/company-departments/${enc(target.branchId)}/manager`;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {label ?? (holder ? t("departmentActions.replace") : target.kind === "head" ? t("departmentActions.assignHead") : t("departmentActions.assignManager"))}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={
          holder
            ? t("departmentActions.replaceDescription", { holder })
            : t("departmentActions.appointDescription")
        }
        fields={[{ name: "personId", label: t("departmentActions.person"), type: "select", required: true, options: candidates.map((candidate) => ({ value: candidate.personId, label: candidate.label })) }]}
        initial={{ personId: candidates[0]?.personId }}
        submitLabel={holder ? t("departmentActions.replaceHolder", { holder }) : t("departmentActions.appoint")}
        saveKind="none"
        testId={target.kind === "head" ? "appoint-head-dialog" : "appoint-manager-dialog"}
        onSubmit={async (payload) => {
          await engineeringApi(url, { body: { personId: payload.personId, replace: Boolean(holder) } });
          await run("appoint", async () => null, t("departmentActions.appointed"));
        }}
      />
    </>
  );
}

/** Ends an appointment or a member's place; it stays in the history (E-13 §47, §67). */
export function EndAssignmentButton({ assignmentId, personName, what, label = "End" }: { assignmentId: string; personName: string; what: string; label?: string }) {
  const { open, setOpen } = useOpen();
  const { pending, run } = useCommand();
  const t = useOrganizationTranslations();
  // `label` is "End" or "Remove": the mode, whose words are the reader's.
  const shown = label === "Remove" ? t("departmentActions.remove") : label === "End" ? t("departmentActions.end") : label;
  return (
    <>
      <button type="button" className="text-meta text-accent-strong hover:underline" onClick={() => setOpen(true)} aria-label={t("departmentActions.endLabel", { action: shown, person: personName, what })}>
        {shown}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={label === "Remove" ? t("departmentActions.removeTitle", { person: personName, what }) : t("departmentActions.endTitle", { person: personName, what })}
        description={t("departmentActions.endDescription")}
        confirmLabel={label === "Remove" ? t("departmentActions.removeConfirm") : t("departmentActions.endConfirm")}
        pending={pending === "end"}
        onConfirm={() => void run("end", () => engineeringApi(`/api/organization/department-assignments/${enc(assignmentId)}/end`, { body: {} }), label === "Remove" ? t("departmentActions.removed", { person: personName, what }) : t("departmentActions.ended"), () => setOpen(false))}
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
  const t = useOrganizationTranslations();
  const usable = branches.filter((branch) => branch.candidates.length > 0);
  if (usable.length === 0) return null;
  const fields: FormField[] = [
    ...(usable.length > 1 ? [{ name: "branchId", label: t("departmentActions.company"), type: "select" as const, required: true, options: usable.map((branch) => ({ value: branch.id, label: branch.companyName })) }] : []),
    ...usable.map((branch) => ({
      name: `person:${branch.id}`,
      label: t("departmentActions.person"),
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
        {t("departmentActions.addMember")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("departmentActions.addTitle", { department: departmentName })}
        description={t("departmentActions.addDescription")}
        fields={fields}
        initial={initial}
        submitLabel={t("departmentActions.addMember")}
        saveKind="create"
        testId="add-member-dialog"
        onSubmit={async (payload) => {
          const branchId = usable.length === 1 ? usable[0]!.id : String(payload.branchId);
          const personId = payload[`person:${branchId}`];
          await engineeringApi(`${api.base}/company-departments/${enc(branchId)}/members`, { body: { personId } });
          await run("add", async () => null, t("departmentActions.added"));
        }}
      />
    </>
  );
}

/** Moves a member's place to another company's branch of the same department (E-13 §36, §72, §85). */
export function MovePlaceButton({ assignmentId, personName, from, branches }: { assignmentId: string; personName: string; from: string; branches: Array<{ id: string; companyName: string }> }) {
  const { open, setOpen } = useOpen();
  const { run } = useCommand();
  const t = useOrganizationTranslations();
  if (branches.length === 0) return null;
  return (
    <>
      <button type="button" className="text-meta text-accent-strong hover:underline" onClick={() => setOpen(true)} aria-label={t("departmentActions.moveLabel", { person: personName, from })}>
        {t("departmentActions.move")}
      </button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("departmentActions.moveTitle", { person: personName })}
        description={t("departmentActions.moveDescription", { from })}
        fields={[{ name: "companyDepartmentId", label: t("departmentActions.to"), type: "select", required: true, options: branches.map((branch) => ({ value: branch.id, label: branch.companyName })) }]}
        initial={{ companyDepartmentId: branches[0]?.id }}
        submitLabel={t("departmentActions.move")}
        saveKind="none"
        testId="move-place-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/organization/department-assignments/${enc(assignmentId)}`, { method: "PATCH", body: { companyDepartmentId: payload.companyDepartmentId } });
          await run("move", async () => null, t("departmentActions.moved", { person: personName }));
        }}
      />
    </>
  );
}
