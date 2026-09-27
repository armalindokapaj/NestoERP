"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, ReasonDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RecruitmentOptionsDTO } from "@/lib/modules/hr/recruitment/candidate.options";
import type { CandidateDetailDTO } from "@/lib/modules/hr/recruitment/candidate.service";
import { EMPLOYMENT_TYPES } from "@/lib/modules/hr/hr.schema";
import { hrLabel, useHrTranslations } from "../hr-text";
import { candidateFields, withinCompany } from "./candidate-fields";

type Open = "edit" | "select" | "hire" | "access" | "reject" | "withdraw" | null;

/**
 * What HR does with a candidate (E-06 §62): mark them selected, hire them into
 * the target company, and ask Group IT for their NESTO account. Only the
 * actions the server would allow are offered.
 */
export function CandidateActions({ candidate, choices }: { candidate: CandidateDetailDTO; choices: RecruitmentOptionsDTO | null }) {
  const t = useHrTranslations();
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
          {t("candidate.requestAccess")}
        </Button>
      ) : null}
      {actions.canHire ? (
        <Button size="sm" onClick={() => setOpen("hire")}>
          {t("candidate.createEmployment")}
        </Button>
      ) : null}
      {actions.canSelect ? (
        <Button size="sm" onClick={() => setOpen("select")}>
          {t("candidate.markSelected")}
        </Button>
      ) : null}
      {actions.canEdit && choices ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen("edit")}>
          {t("common.edit")}
        </Button>
      ) : null}
      {actions.canWithdraw ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen("withdraw")}>
          {t("candidate.withdrawn")}
        </Button>
      ) : null}
      {actions.canReject ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen("reject")}>
          {t("leaveActions.reject")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={open === "select"}
        onOpenChange={close}
        title={t("candidate.selectTitle", { name: candidate.name })}
        description={t("candidate.selectDescription")}
        confirmLabel={t("candidate.markSelected")}
        destructive={false}
        pending={pending === "select"}
        onConfirm={() => void run("select", () => engineeringApi(`${base}/select`, { body: {} }), t("candidate.selected"), () => setOpen(null))}
      />

      {choices ? (
        <FormDialog
          open={open === "edit"}
          onOpenChange={close}
          title={t("candidate.editTitle")}
          fields={candidateFields(t, choices, companyId)}
          initial={{ ...candidate.person, targetCompanyId: candidate.targetCompany?.id, targetDepartmentId: candidate.targetDepartment?.id, targetRoleKey: candidate.targetRole?.key, targetJobTitle: candidate.targetJobTitle, hiringManagerUserId: candidate.hiringManager?.userId, interviewStage: candidate.interviewStage, notes: candidate.notes }}
          onValuesChange={(values) => setCompanyId(String(values.targetCompanyId ?? ""))}
          submitLabel={t("candidate.save")}
          module="hr"
          wide
          onSubmit={async (payload) => {
            await engineeringApi(base, { method: "PATCH", body: withinCompany(payload, choices) });
            await run("edit", async () => null, t("candidate.updated"));
          }}
        />
      ) : null}

      <FormDialog
        open={open === "hire"}
        onOpenChange={close}
        title={t("candidate.hireTitle", { name: candidate.name })}
        description={t("candidate.hireDescription", { company: candidate.targetCompany?.name ?? t("candidate.targetCompany") })}
        fields={[
          { name: "employeeNumber", label: t("fields.employeeNumber"), type: "text" },
          { name: "employmentType", label: t("fields.employmentType"), type: "select", required: true, options: EMPLOYMENT_TYPES.map((value) => ({ value, label: hrLabel(t, "employmentType", value) })) },
          { name: "startDate", label: t("fields.startDate"), type: "date" },
        ]}
        initial={{ employmentType: "FULL_TIME" }}
        submitLabel={t("candidate.createEmployment")}
        // Hiring is a workflow step, never run from the unsaved-changes prompt (AUD-03 §3).
        saveKind="none"
        module="hr"
        testId="hire-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`${base}/hire`, { body: payload });
          await run("hire", async () => null, t("candidate.employmentCreated"));
        }}
      />

      <FormDialog
        open={open === "access"}
        onOpenChange={close}
        title={t("account.dialogTitle", { name: candidate.name })}
        description={t("candidate.accessDescription")}
        fields={[
          { name: "requestedUsername", label: t("account.preferredUsername"), type: "text", hint: t("account.usernameHint") },
          { name: "requestedActivationDate", label: t("account.neededFrom"), type: "date" },
          { name: "notes", label: t("account.notes"), type: "textarea", rows: 3 },
        ]}
        submitLabel={t("account.submit")}
        module="hr"
        testId="access-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/hr/user-provisioning-requests", { body: { ...payload, employeeProfileId: candidate.employment?.id, submit: true } });
          await run("access", async () => null, t("account.submitted"));
        }}
      />

      <ReasonDialog
        open={open === "reject"}
        onOpenChange={close}
        title={t("candidate.rejectTitle", { name: candidate.name })}
        confirmLabel={t("leaveActions.reject")}
        label={t("candidate.note")}
        required={false}
        onConfirm={async () => {
          await engineeringApi(`${base}/reject`, { body: {} });
          await run("reject", async () => null, t("candidate.rejected"));
        }}
      />
      <ReasonDialog
        open={open === "withdraw"}
        onOpenChange={close}
        title={t("candidate.withdrawTitle", { name: candidate.name })}
        confirmLabel={t("candidate.markWithdrawn")}
        label={t("candidate.note")}
        required={false}
        onConfirm={async () => {
          await engineeringApi(`${base}/withdraw`, { body: {} });
          await run("withdraw", async () => null, t("candidate.withdrawnDone"));
        }}
      />
    </div>
  );
}
