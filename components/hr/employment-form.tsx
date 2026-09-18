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
import { workLocationTypeLabels } from "@/lib/modules/hr/employment/employment.labels";
import { EMPLOYMENT_TYPES } from "@/lib/modules/hr/hr.schema";
import { employmentTypeLabels } from "@/lib/modules/hr/hr.status";

export type EmploymentFormValues = {
  employeeNumber: string | null;
  probationEndDate: string | null;
  endDate: string | null;
  weeklyHours: string | null;
};

/**
 * Create an employment record, and edit what of it is not history (PRD #16
 * §38, §50; E-03 §37, §187).
 *
 * On create, where the person will sit — type, manager, planned start,
 * location — becomes the first row of the employment's history; the department
 * and title are the membership's. On edit, only the number, probation, planned
 * end and hours: department, title, manager, location, type and status are
 * dated changes, made through "Change employment" and kept (E-03 §7). Company
 * access is never touched here (PRD #16 §230).
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
  managers?: SelectOption[];
  values?: EmploymentFormValues;
  /** On create only, as a stand-in for the member chosen. */
  memberId?: string;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [selectedMember, setSelectedMember] = React.useState(members?.[0]?.value ?? "");
  const creating = members !== undefined;

  // Nobody manages themselves: a loop would make the approval chain infinite
  // (PRD #16 §32).
  const self = memberId ?? selectedMember;
  const managerChoices = (managers ?? []).filter((manager) => manager.value !== self);

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

        {creating ? (
        <Field label="Employment type" name="employmentType" required>
          <select
            id="employmentType"
            name="employmentType"
            className={selectClass}
            defaultValue="FULL_TIME"
          >
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {employmentTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>
        ) : null}

        <Field label="Employee number" name="employeeNumber" hint="Optional, and unique.">
          <Input
            id="employeeNumber"
            name="employeeNumber"
            maxLength={60}
            defaultValue={values?.employeeNumber ?? ""}
            placeholder="EMP-014"
          />
        </Field>

        {creating ? (
        <Field label="Manager" name="managerMemberId" hint="Who this person reports to.">
          <select
            id="managerMemberId"
            name="managerMemberId"
            className={selectClass}
            defaultValue=""
          >
            <option value="">No manager</option>
            {managerChoices.map((manager) => (
              <option key={manager.value} value={manager.value}>
                {manager.label}
              </option>
            ))}
          </select>
        </Field>
        ) : (
          <p className="text-meta text-fg-subtle sm:col-span-2">
            Department, job title, manager, work location, employment type and status change through
            “Change employment”, each from a date, and are kept in the history.
          </p>
        )}
      </FormSection>

      <FormSection title="Dates" description="Employment cannot end before it starts.">
        {creating ? (
        <Field label="Planned start" name="startDate" hint="The employment is planned until HR starts it.">
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue=""
          />
        </Field>
        ) : null}

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
        {creating ? (
          <>
            <Field label="Works at" name="workLocationType">
              <select id="workLocationType" name="workLocationType" className={selectClass} defaultValue="">
                <option value="">Not set</option>
                {Object.entries(workLocationTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Work location" name="workLocation">
              <Input id="workLocation" name="workLocation" maxLength={160} defaultValue="" placeholder="Tirana office" />
            </Field>
          </>
        ) : null}

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
