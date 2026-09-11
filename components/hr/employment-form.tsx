"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { EMPLOYMENT_TYPES } from "@/lib/modules/hr/hr.schema";
import { employmentTypeLabels } from "@/lib/modules/hr/hr.status";

export type EmploymentFormValues = {
  employeeNumber: string | null;
  employmentType: string;
  startDate: string | null;
  probationEndDate: string | null;
  endDate: string | null;
  managerMemberId: string | null;
  workLocation: string | null;
  weeklyHours: string | null;
};

/**
 * Create and edit an employment record (PRD #16 §38, §50).
 *
 * Employment status is deliberately absent: it is a transition with its own
 * rules and its own activity entry, not a dropdown on an edit form
 * (PRD #16 §54). So is company access — ending employment here never touches
 * somebody's membership (PRD #16 §230).
 */
export function EmploymentForm({
  action,
  members,
  managers,
  values,
  memberId,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  /** Only on create: members who have no employment record yet (PRD #16 §225). */
  members?: SelectOption[];
  managers: SelectOption[];
  values?: EmploymentFormValues;
  /** On edit, so the manager list can exclude the employee themselves. */
  memberId?: string;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [selectedMember, setSelectedMember] = React.useState(members?.[0]?.value ?? "");

  // Nobody manages themselves: a loop would make the approval chain infinite
  // (PRD #16 §32).
  const self = memberId ?? selectedMember;
  const managerChoices = managers.filter((manager) => manager.value !== self);

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Employment"
        description="Who this person is to the company, and on what terms."
      >
        {members ? (
          <Field
            label="Team member"
            name="companyMemberId"
            required
            hint="Only members without an employment record are listed."
          >
            <select
              id="companyMemberId"
              name="companyMemberId"
              className={selectClass}
              required
              value={selectedMember}
              onChange={(event) => setSelectedMember(event.target.value)}
            >
              <option value="" disabled>
                Choose a team member
              </option>
              {members.map((member) => (
                <option key={member.value} value={member.value}>
                  {member.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Employment type" name="employmentType" required>
          <select
            id="employmentType"
            name="employmentType"
            className={selectClass}
            defaultValue={values?.employmentType ?? "FULL_TIME"}
          >
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {employmentTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Employee number" name="employeeNumber" hint="Optional, and unique.">
          <Input
            id="employeeNumber"
            name="employeeNumber"
            maxLength={60}
            defaultValue={values?.employeeNumber ?? ""}
            placeholder="EMP-014"
          />
        </Field>

        <Field label="Manager" name="managerMemberId" hint="Who this person reports to.">
          <select
            id="managerMemberId"
            name="managerMemberId"
            className={selectClass}
            defaultValue={values?.managerMemberId ?? ""}
          >
            <option value="">No manager</option>
            {managerChoices.map((manager) => (
              <option key={manager.value} value={manager.value}>
                {manager.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Dates" description="Employment cannot end before it starts.">
        <Field label="Start date" name="startDate">
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={values?.startDate ?? ""}
          />
        </Field>

        <Field label="Probation ends" name="probationEndDate">
          <Input
            id="probationEndDate"
            name="probationEndDate"
            type="date"
            defaultValue={values?.probationEndDate ?? ""}
          />
        </Field>

        <Field
          label="End date"
          name="endDate"
          hint="A planned last day. Ending employment is a separate action."
        >
          <Input id="endDate" name="endDate" type="date" defaultValue={values?.endDate ?? ""} />
        </Field>
      </FormSection>

      <FormSection title="Working arrangement">
        <Field label="Work location" name="workLocation">
          <Input
            id="workLocation"
            name="workLocation"
            maxLength={160}
            defaultValue={values?.workLocation ?? ""}
            placeholder="Tirana office"
          />
        </Field>

        <Field label="Weekly hours" name="weeklyHours" hint="Contracted hours, such as 40.">
          <Input
            id="weeklyHours"
            name="weeklyHours"
            inputMode="decimal"
            defaultValue={values?.weeklyHours ?? ""}
            placeholder="40"
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
