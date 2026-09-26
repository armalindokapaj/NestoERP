"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, ReasonDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RecruitmentOptionsDTO } from "@/lib/modules/hr/recruitment/candidate.options";
import type { CandidateDetailDTO } from "@/lib/modules/hr/recruitment/candidate.service";
import { EMPLOYMENT_TYPES } from "@/lib/modules/hr/hr.schema";
import { statusLabel } from "@/lib/utils/status";
import { candidateFields } from "./candidate-fields";

type Open = "edit" | "select" | "hire" | "access" | "reject" | "withdraw" | null;

/**
 * What HR does with a candidate (E-06 §62): mark them selected, hire them into
 * the target company, and ask Group IT for their NESTO account. Only the
 * actions the server would allow are offered.
 */
export function CandidateActions({ candidate, choices }: { candidate: CandidateDetailDTO; choices: RecruitmentOptionsDTO | null }) {
  const { pending, run } = useCommand();
  const [open, setOpen] = React.useState<Open>(null);
  const [companyId, setCompanyId] = React.useState(candidate.targetCompany?.id ?? "");
  const base = `/api/hr/candidates/${candidate.id}`;
  const actions = candidate.actions;
  const close = (next: boolean) => !next && setOpen(null);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="candidate-actions">
      {actions.canRequestAccess ? (
        <Button size="sm" onClick={() => setOpen("access")}>
          Request NESTO access
        </Button>
      ) : null}
      {actions.canHire ? (
        <Button size="sm" onClick={() => setOpen("hire")}>
          Create employment
        </Button>
      ) : null}
      {actions.canSelect ? (
        <Button size="sm" onClick={() => setOpen("select")}>
          Mark selected
        </Button>
      ) : null}
      {actions.canEdit && choices ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen("edit")}>
          Edit
        </Button>
      ) : null}
      {actions.canWithdraw ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen("withdraw")}>
          Withdrawn
        </Button>
      ) : null}
      {actions.canReject ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen("reject")}>
          Reject
        </Button>
      ) : null}

      <ConfirmDialog
        open={open === "select"}
        onOpenChange={close}
        title={`Mark ${candidate.name} selected?`}
        description="They keep the same person record through the hire and the account request."
        confirmLabel="Mark selected"
        destructive={false}
        pending={pending === "select"}
        onConfirm={() => void run("select", () => engineeringApi(`${base}/select`, { body: {} }), "Candidate selected.", () => setOpen(null))}
      />

      {choices ? (
        <FormDialog
          open={open === "edit"}
          onOpenChange={close}
          title="Edit candidate"
          fields={candidateFields(choices, companyId)}
          initial={{ ...candidate.person, targetCompanyId: candidate.targetCompany?.id, targetDepartmentId: candidate.targetDepartment?.id, targetRoleKey: candidate.targetRole?.key, targetJobTitle: candidate.targetJobTitle, hiringManagerUserId: candidate.hiringManager?.userId, interviewStage: candidate.interviewStage, notes: candidate.notes }}
          onValuesChange={(values) => setCompanyId(String(values.targetCompanyId ?? ""))}
          submitLabel="Save"
          module="hr"
          wide
          onSubmit={async (payload) => {
            await engineeringApi(base, { method: "PATCH", body: payload });
            await run("edit", async () => null, "Candidate updated.");
          }}
        />
      ) : null}

      <FormDialog
        open={open === "hire"}
        onOpenChange={close}
        title={`Create ${candidate.name}'s employment`}
        description={`A planned employment in ${candidate.targetCompany?.name ?? "the target company"}, with no login. The account is a separate request to Group IT.`}
        fields={[
          { name: "employeeNumber", label: "Employee number", type: "text" },
          { name: "employmentType", label: "Employment type", type: "select", required: true, options: EMPLOYMENT_TYPES.map((value) => ({ value, label: statusLabel(value) })) },
          { name: "startDate", label: "Start date", type: "date" },
        ]}
        initial={{ employmentType: "FULL_TIME" }}
        submitLabel="Create employment"
        // Hiring is a workflow step, never run from the unsaved-changes prompt (AUD-03 §3).
        saveKind="none"
        module="hr"
        testId="hire-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${base}/hire`, { body: payload });
          await run("hire", async () => null, "Employment created.");
        }}
      />

      <FormDialog
        open={open === "access"}
        onOpenChange={close}
        title={`Request a NESTO account for ${candidate.name}`}
        description="Group IT creates it from this person's HR record once the Head of Group HR or the Owner approves. Nobody retypes their details."
        fields={[
          { name: "requestedUsername", label: "Preferred username", type: "text", hint: "Optional. Group IT follows firstname.lastname otherwise." },
          { name: "requestedActivationDate", label: "Needed from", type: "date" },
          { name: "notes", label: "Notes for Group IT", type: "textarea", rows: 3 },
        ]}
        submitLabel="Submit request"
        module="hr"
        testId="access-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/hr/user-provisioning-requests", { body: { ...payload, employeeProfileId: candidate.employment?.id, submit: true } });
          await run("access", async () => null, "Account request submitted.");
        }}
      />

      <ReasonDialog
        open={open === "reject"}
        onOpenChange={close}
        title={`Reject ${candidate.name}?`}
        confirmLabel="Reject"
        label="Note"
        required={false}
        onConfirm={async () => {
          await engineeringApi(`${base}/reject`, { body: {} });
          await run("reject", async () => null, "Candidate rejected.");
        }}
      />
      <ReasonDialog
        open={open === "withdraw"}
        onOpenChange={close}
        title={`Mark ${candidate.name} withdrawn?`}
        confirmLabel="Mark withdrawn"
        label="Note"
        required={false}
        onConfirm={async () => {
          await engineeringApi(`${base}/withdraw`, { body: {} });
          await run("withdraw", async () => null, "Candidate withdrawn.");
        }}
      />
    </div>
  );
}
