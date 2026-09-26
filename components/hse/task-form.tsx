"use client";

import { Field, FormSection, RecordForm, selectClass } from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createHseTaskAction } from "@/lib/actions/hse";
import type { Option } from "./hse-forms";

/** A canonical Task raised to discharge an HSE action (PRD #22 §126). */
export function HseTaskForm({
  actionId,
  defaultTitle,
  cancelHref,
  members,
}: {
  actionId: string;
  defaultTitle: string;
  cancelHref: string;
  members: Option[];
}) {
  const action = createHseTaskAction.bind(null, actionId);

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel="Create task"
      pendingLabel="Creating…"
    >
      <FormSection
        title="Task"
        description="It lands on the project's board and carries the action's priority across."
      >
        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={defaultTitle} required maxLength={200} />
        </Field>

        <Field label="Description" name="description" className="sm:col-span-2">
          <Textarea id="description" name="description" rows={3} maxLength={4000} />
        </Field>

        <Field label="Assign to" name="assigneeMemberId">
          <select id="assigneeMemberId" name="assigneeMemberId" className={selectClass}>
            <option value="">Nobody yet</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
