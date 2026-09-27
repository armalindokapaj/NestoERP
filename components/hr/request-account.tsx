"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { useHrTranslations } from "./hr-text";

/**
 * Ask Group IT for a NESTO login for an employee who has none (E-04 §88,
 * §145; E-06 §27). The request is anchored on this employment, so the login
 * Group IT provisions is linked to the same employee — the same history, pay,
 * documents and assignments — never a second one (E-04 §5, §262).
 */
export function RequestAccountButton({
  employeeId,
  name,
  departmentId,
  departments,
  roles,
}: {
  employeeId: string;
  name: string;
  departmentId: string | null;
  departments: Array<{ id: string; name: string }>;
  roles: Array<{ key: string; label: string }>;
}) {
  const t = useHrTranslations();
  const { run } = useCommand();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="request-account">
        {t("account.request")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("account.dialogTitle", { name })}
        description={t("account.dialogDescription")}
        fields={[
          // An empty first choice, so nothing looks chosen that is not: a required select without one showed its first
          // option while sending nothing, and the request fell back to another department or role (AUD-09 §5).
          { name: "companyDepartmentId", label: t("columns.department"), type: "select", required: true, emptyLabel: t("account.chooseDepartment"), options: departments.map((department) => ({ value: department.id, label: department.name })) },
          { name: "functionalRoleKey", label: t("account.nestoRole"), type: "select", required: true, emptyLabel: t("account.chooseRole"), options: roles.map((role) => ({ value: role.key, label: role.label })) },
          { name: "requestedUsername", label: t("account.preferredUsername"), type: "text", hint: t("account.usernameHint") },
          { name: "requestedActivationDate", label: t("account.neededFrom"), type: "date" },
          { name: "notes", label: t("account.notes"), type: "textarea", rows: 3 },
        ]}
        initial={{ companyDepartmentId: departmentId ?? "" }}
        submitLabel={t("account.submit")}
        module="hr"
        testId="request-account-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/hr/user-provisioning-requests", { body: { ...payload, employeeProfileId: employeeId, submit: true } });
          await run("access", async () => null, t("account.submitted"));
        }}
      />
    </>
  );
}
