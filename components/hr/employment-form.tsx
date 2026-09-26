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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workLocationTypeLabels } from "@/lib/modules/hr/employment/employment.labels";
import { EMPLOYMENT_TYPES, WORKER_CATEGORIES } from "@/lib/modules/hr/hr.schema";
import { employmentTypeLabels, workerCategoryLabels } from "@/lib/modules/hr/hr.status";

export type EmploymentFormValues = {
  employeeNumber: string | null;
  probationEndDate: string | null;
  endDate: string | null;
  weeklyHours: string | null;
  workerCategory: string | null;
  tradeId: string | null;
};

type Subject = "NEW" | "MEMBER" | "PERSON";

/** A person the new employee might already be (E-04 §92, §176). */
type Duplicate = { personId: string; name: string; companies: string[]; reasons: string[] };

/**
 * Create an employment record, and edit what of it is not history (PRD #16
 * §38, §50; E-03 §37, §187; E-04 §228-§230).
 *
 * On create, the employee is one of three: somebody new with no NESTO account
 * — a construction worker, a driver — who gets a person and an employment and
 * nothing to sign in with; a team member who already has a login here; or a
 * person the group already knows, so nobody is recorded twice (E-04 §5, §89).
 * Where they will sit becomes the first row of the employment's history.
 *
 * On edit, only the number, probation, planned end, hours, worker category and
 * trade: department, title, manager, location, type and status are dated
 * changes, made through "Change employment" and kept (E-03 §7).
 */
export function EmploymentForm({
  action,
  members,
  people,
  departments,
  trades,
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
  /** Only on create: people of the group with no employment here. */
  people?: SelectOption[];
  departments?: SelectOption[];
  trades: SelectOption[];
  managers?: SelectOption[];
  values?: EmploymentFormValues;
  /** On edit: the employee's own login, never offered as their manager. */
  memberId?: string | null;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const creating = members !== undefined;
  const [subject, setSubject] = React.useState<Subject>("NEW");
  const [selectedMember, setSelectedMember] = React.useState("");
  const [selectedPerson, setSelectedPerson] = React.useState("");
  const [duplicates, setDuplicates] = React.useState<Duplicate[]>([]);
  const [confirmNew, setConfirmNew] = React.useState(false);

  // Nobody manages themselves: a loop would make the approval chain infinite (PRD #16 §32).
  const self = memberId ?? (subject === "MEMBER" ? selectedMember : null);
  const managerChoices = (managers ?? []).filter((manager) => manager.value !== self);

  function employExistingPerson(personId: string) {
    setSubject("PERSON");
    setSelectedPerson(personId);
    setDuplicates([]);
  }

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
      module="hr"
      onFailure={(result) => setDuplicates((result as { duplicates?: Duplicate[] }).duplicates ?? [])}
    >
      {creating ? (
        <FormSection title="Who" description="Employment is for a person. A NESTO login is optional, and most site workers never need one.">
          <input type="hidden" name="subject" value={subject} />
          <Field label="The employee is" name="subject" className="sm:col-span-2">
            <select
              id="subject"
              className={selectClass}
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value as Subject);
                setDuplicates([]);
              }}
            >
              <option value="NEW">Somebody new, with no NESTO account</option>
              {members && members.length > 0 ? <option value="MEMBER">A team member who already has a login here</option> : null}
              {people && people.length > 0 ? <option value="PERSON">Somebody the group already knows</option> : null}
            </select>
          </Field>

          {subject === "MEMBER" ? (
            <Field label="Team member" name="companyMemberId" required hint="Only members without an employment record are listed." className="sm:col-span-2">
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
                {(members ?? []).map((member) => (
                  <option key={member.value} value={member.value}>
                    {member.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {subject === "PERSON" ? (
            <Field label="Person" name="personProfileId" required hint="A former employee, a hired candidate, or somebody employed by another company of the group." className="sm:col-span-2">
              <select
                id="personProfileId"
                name="personProfileId"
                className={selectClass}
                required
                value={selectedPerson}
                onChange={(event) => setSelectedPerson(event.target.value)}
              >
                <option value="" disabled>
                  Choose the person
                </option>
                {(people ?? []).map((person) => (
                  <option key={person.value} value={person.value}>
                    {person.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {subject === "NEW" ? (
            <>
              <Field label="First name" name="firstName" required>
                <Input id="firstName" name="firstName" maxLength={80} required />
              </Field>
              <Field label="Last name" name="lastName" required>
                <Input id="lastName" name="lastName" maxLength={80} required />
              </Field>
              <Field label="Date of birth" name="dateOfBirth" hint="Private to HR. Helps tell two people with the same name apart.">
                <Input id="dateOfBirth" name="dateOfBirth" type="date" />
              </Field>
              <Field label="Work phone" name="workPhone">
                <Input id="workPhone" name="workPhone" maxLength={40} inputMode="tel" />
              </Field>
              <Field label="Personal phone" name="personalPhone" hint="Private to HR.">
                <Input id="personalPhone" name="personalPhone" maxLength={40} inputMode="tel" />
              </Field>
              {confirmNew ? <input type="hidden" name="confirmNewPerson" value="true" /> : null}
            </>
          ) : null}

          {subject === "NEW" && duplicates.length > 0 ? (
            <div className="space-y-3 rounded-md border border-warning/30 bg-warning-soft p-4 sm:col-span-2" data-testid="probable-duplicates">
              <p className="text-table font-medium text-warning-strong">This may be somebody the group already has:</p>
              <ul className="space-y-2">
                {duplicates.map((person) => (
                  <li key={person.personId} className="flex flex-wrap items-center justify-between gap-2 text-table">
                    <span>
                      <span className="font-medium text-fg">{person.name}</span>
                      <span className="text-fg-muted">
                        {" · "}
                        {person.reasons.join(", ")}
                        {person.companies.length > 0 ? ` · ${person.companies.join(", ")}` : ""}
                      </span>
                    </span>
                    <Button type="button" size="sm" variant="secondary" onClick={() => employExistingPerson(person.personId)}>
                      Employ this person
                    </Button>
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2 text-table text-fg">
                <input type="checkbox" checked={confirmNew} onChange={(event) => setConfirmNew(event.target.checked)} />
                None of them — this is somebody new
              </label>
            </div>
          ) : null}
        </FormSection>
      ) : null}

      <FormSection title="Employment" description="Who this person is to the company, and on what terms.">
        {creating ? (
          <Field label="Employment type" name="employmentType" required>
            <select id="employmentType" name="employmentType" className={selectClass} defaultValue="FULL_TIME">
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {employmentTypeLabels[type]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Employee number" name="employeeNumber" hint="Optional, and unique in the company.">
          <Input id="employeeNumber" name="employeeNumber" maxLength={60} defaultValue={values?.employeeNumber ?? ""} placeholder="EMP-014" />
        </Field>

        <Field label="Worker category" name="workerCategory" hint="What kind of worker — not a NESTO role.">
          <select id="workerCategory" name="workerCategory" className={selectClass} defaultValue={values?.workerCategory ?? ""}>
            <option value="">Not set</option>
            {WORKER_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {workerCategoryLabels[category]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Trade" name="tradeId" hint={trades.length === 0 ? "The company has no trades listed yet." : undefined}>
          <select id="tradeId" name="tradeId" className={selectClass} defaultValue={values?.tradeId ?? ""}>
            <option value="">Not set</option>
            {trades.map((trade) => (
              <option key={trade.value} value={trade.value}>
                {trade.label}
              </option>
            ))}
          </select>
        </Field>

        {creating && subject !== "MEMBER" ? (
          <>
            <Field label="Department" name="departmentId">
              <select id="departmentId" name="departmentId" className={selectClass} defaultValue="">
                <option value="">Not set</option>
                {(departments ?? []).map((department) => (
                  <option key={department.value} value={department.value}>
                    {department.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Job title" name="jobTitle">
              <Input id="jobTitle" name="jobTitle" maxLength={160} placeholder="Senior electrician" />
            </Field>
          </>
        ) : null}

        {creating ? (
          <Field label="Manager" name="managerMemberId" hint="Who this person reports to.">
            <select id="managerMemberId" name="managerMemberId" className={selectClass} defaultValue="">
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
            Department, job title, manager, work location, employment type and status change through “Change employment”, each from a date, and are kept
            in the history.
          </p>
        )}
      </FormSection>

      <FormSection title="Dates" description="Employment cannot end before it starts.">
        {creating ? (
          <Field label="Planned start" name="startDate" hint="The employment is planned until HR starts it.">
            <Input id="startDate" name="startDate" type="date" defaultValue="" />
          </Field>
        ) : null}

        <Field label="Probation ends" name="probationEndDate">
          <Input id="probationEndDate" name="probationEndDate" type="date" defaultValue={values?.probationEndDate ?? ""} />
        </Field>

        <Field label="End date" name="endDate" hint="A planned last day. Ending employment is a separate action.">
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
          <Input id="weeklyHours" name="weeklyHours" inputMode="decimal" defaultValue={values?.weeklyHours ?? ""} placeholder="40" />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
