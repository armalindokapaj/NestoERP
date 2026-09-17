"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PersonRefDTO } from "@/lib/modules/organization/department.service";

/**
 * Appointing a department head or a branch manager, and ending an appointment
 * (E-06 §37, §38, §90). The server decides who may; these only appear for them.
 */
export function AppointButton({ label, title, groupDepartmentId, companyId, candidates }: { label: string; title: string; groupDepartmentId: string; companyId: string | null; candidates: PersonRefDTO[] }) {
  const { run } = useCommand();
  const [open, setOpen] = React.useState(false);
  if (candidates.length === 0) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description="The position widens what they already work as, and nothing else."
        fields={[{ name: "userId", label: "Person", type: "select", required: true, options: candidates.map((person) => ({ value: person.userId, label: person.name })) }]}
        initial={{ userId: candidates[0]?.userId }}
        submitLabel="Appoint"
        testId="appoint-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/organization/department-assignments", { body: { userId: payload.userId, groupDepartmentId, branchCompanyId: companyId } });
          await run("appoint", async () => null, "Appointment recorded.");
        }}
      />
    </>
  );
}

export function EndAppointmentButton({ person, what }: { person: PersonRefDTO; what: string }) {
  const { pending, run } = useCommand();
  const [open, setOpen] = React.useState(false);
  if (!person.assignmentId) return null;
  return (
    <>
      <button type="button" className="text-meta text-accent-strong hover:underline" onClick={() => setOpen(true)} aria-label={`End ${person.name}'s appointment as ${what}`}>
        End
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`End ${person.name}'s appointment as ${what}?`}
        description="They keep their job and their projects; the position and what it widened end now. The appointment stays in the history."
        confirmLabel="End appointment"
        pending={pending === "end"}
        onConfirm={() => void run("end", () => engineeringApi(`/api/organization/department-assignments/${person.assignmentId}/end`, { body: {} }), "Appointment ended.", () => setOpen(false))}
      />
    </>
  );
}
