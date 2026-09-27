"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";

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
  const { run } = useCommand();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="request-account">
        Request NESTO account
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Request a NESTO account for ${name}`}
        description="Group IT creates it from this employee's HR record once the Head of Group HR or the Owner approves. Their employment, pay, documents and assignments stay exactly as they are."
        fields={[
          // An empty first choice, so nothing looks chosen that is not: a required select without one showed its first
          // option while sending nothing, and the request fell back to another department or role (AUD-09 §5).
          { name: "companyDepartmentId", label: "Department", type: "select", required: true, emptyLabel: "Choose a department", options: departments.map((department) => ({ value: department.id, label: department.name })) },
          { name: "functionalRoleKey", label: "NESTO role", type: "select", required: true, emptyLabel: "Choose a role", options: roles.map((role) => ({ value: role.key, label: role.label })) },
          { name: "requestedUsername", label: "Preferred username", type: "text", hint: "Optional. Group IT follows firstname.lastname otherwise." },
          { name: "requestedActivationDate", label: "Needed from", type: "date" },
          { name: "notes", label: "Notes for Group IT", type: "textarea", rows: 3 },
        ]}
        initial={{ companyDepartmentId: departmentId ?? "" }}
        submitLabel="Submit request"
        module="hr"
        testId="request-account-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/hr/user-provisioning-requests", { body: { ...payload, employeeProfileId: employeeId, submit: true } });
          await run("access", async () => null, "Account request submitted.");
        }}
      />
    </>
  );
}
