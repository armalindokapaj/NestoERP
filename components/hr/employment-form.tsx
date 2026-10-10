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
import { EMPLOYMENT_TYPES, WORKER_CATEGORIES } from "@/lib/modules/hr/hr.schema";
import { hrLabel, useHrFormAction, useHrTranslations } from "./hr-text";
import { FormSelect } from "@/components/ui/form-select";

const WORK_LOCATION_TYPES = ["OFFICE", "SITE", "REMOTE", "HYBRID", "OTHER"] as const;

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
  const t = useHrTranslations();
  const translatedAction = useHrFormAction(action);
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
      action={translatedAction}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
      module="hr"
      onFailure={(result) => setDuplicates((result as { duplicates?: Duplicate[] }).duplicates ?? [])}
    >
      {creating ? (
        <FormSection title={t("employmentForm.who")} description={t("employmentForm.whoDescription")}>
          <input type="hidden" name="subject" value={subject} />
          <Field label={t("employmentForm.employeeIs")} name="subject" className="sm:col-span-2">
            <FormSelect
              id="subject"
              className={selectClass}
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value as Subject);
                setDuplicates([]);
              }}
            >
              <option value="NEW">{t("employmentForm.subjectNew")}</option>
              {members && members.length > 0 ? <option value="MEMBER">{t("employmentForm.subjectMember")}</option> : null}
              {people && people.length > 0 ? <option value="PERSON">{t("employmentForm.subjectPerson")}</option> : null}
            </FormSelect>
          </Field>

          {subject === "MEMBER" ? (
            <Field label={t("employmentForm.teamMember")} name="companyMemberId" required hint={t("employmentForm.teamMemberHint")} className="sm:col-span-2">
              <FormSelect
                id="companyMemberId"
                name="companyMemberId"
                className={selectClass}
                required
                value={selectedMember}
                onChange={(event) => setSelectedMember(event.target.value)}
              >
                <option value="" disabled>
                  {t("employmentForm.chooseMember")}
                </option>
                {(members ?? []).map((member) => (
                  <option key={member.value} value={member.value}>
                    {member.label}
                  </option>
                ))}
              </FormSelect>
            </Field>
          ) : null}

          {subject === "PERSON" ? (
            <Field label={t("recruitment.person")} name="personProfileId" required hint={t("employmentForm.personHint")} className="sm:col-span-2">
              <FormSelect
                id="personProfileId"
                name="personProfileId"
                className={selectClass}
                required
                value={selectedPerson}
                onChange={(event) => setSelectedPerson(event.target.value)}
              >
                <option value="" disabled>
                  {t("employmentForm.choosePerson")}
                </option>
                {(people ?? []).map((person) => (
                  <option key={person.value} value={person.value}>
                    {person.label}
                  </option>
                ))}
              </FormSelect>
            </Field>
          ) : null}

          {subject === "NEW" ? (
            <>
              <Field label={t("employmentForm.firstName")} name="firstName" required>
                <Input id="firstName" name="firstName" maxLength={80} required />
              </Field>
              <Field label={t("employmentForm.lastName")} name="lastName" required>
                <Input id="lastName" name="lastName" maxLength={80} required />
              </Field>
              <Field label={t("employmentForm.dateOfBirth")} name="dateOfBirth" hint={t("employmentForm.dateOfBirthHint")}>
                <Input id="dateOfBirth" name="dateOfBirth" type="date" />
              </Field>
              <Field label={t("recruitment.workPhone")} name="workPhone">
                <Input id="workPhone" name="workPhone" maxLength={40} inputMode="tel" />
              </Field>
              <Field label={t("recruitment.personalPhone")} name="personalPhone" hint={t("employmentForm.privateToHr")}>
                <Input id="personalPhone" name="personalPhone" maxLength={40} inputMode="tel" />
              </Field>
              {confirmNew ? <input type="hidden" name="confirmNewPerson" value="true" /> : null}
            </>
          ) : null}

          {subject === "NEW" && duplicates.length > 0 ? (
            <div className="space-y-3 rounded-md border border-warning/30 bg-warning-soft p-4 sm:col-span-2" data-testid="probable-duplicates">
              <p className="text-table font-medium text-warning-strong">{t("employmentForm.maybeDuplicate")}</p>
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
                      {t("employmentForm.employThis")}
                    </Button>
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2 text-table text-fg">
                <input type="checkbox" checked={confirmNew} onChange={(event) => setConfirmNew(event.target.checked)} />
                {t("employmentForm.noneNew")}
              </label>
            </div>
          ) : null}
        </FormSection>
      ) : null}

      <FormSection title={t("tabs.employment")} description={t("employmentForm.employmentDescription")}>
        {creating ? (
          <Field label={t("fields.employmentType")} name="employmentType" required>
            <FormSelect id="employmentType" name="employmentType" className={selectClass} defaultValue="FULL_TIME">
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {hrLabel(t, "employmentType", type)}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : null}

        <Field label={t("fields.employeeNumber")} name="employeeNumber" hint={t("employmentForm.employeeNumberHint")}>
          <Input id="employeeNumber" name="employeeNumber" maxLength={60} defaultValue={values?.employeeNumber ?? ""} placeholder="EMP-014" />
        </Field>

        <Field label={t("fields.workerCategory")} name="workerCategory" hint={t("employmentForm.workerCategoryHint")}>
          <FormSelect id="workerCategory" name="workerCategory" className={selectClass} defaultValue={values?.workerCategory ?? ""}>
            <option value="">{t("employmentForm.notSet")}</option>
            {WORKER_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {hrLabel(t, "workerCategory", category)}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("columns.trade")} name="tradeId" hint={trades.length === 0 ? t("employmentForm.noTrades") : undefined}>
          <FormSelect id="tradeId" name="tradeId" className={selectClass} defaultValue={values?.tradeId ?? ""}>
            <option value="">{t("employmentForm.notSet")}</option>
            {trades.map((trade) => (
              <option key={trade.value} value={trade.value}>
                {trade.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        {creating && subject !== "MEMBER" ? (
          <>
            <Field label={t("columns.department")} name="departmentId">
              <FormSelect id="departmentId" name="departmentId" className={selectClass} defaultValue="">
                <option value="">{t("employmentForm.notSet")}</option>
                {(departments ?? []).map((department) => (
                  <option key={department.value} value={department.value}>
                    {department.label}
                  </option>
                ))}
              </FormSelect>
            </Field>
            <Field label={t("fields.jobTitle")} name="jobTitle">
              <Input id="jobTitle" name="jobTitle" maxLength={160} placeholder={t("employmentForm.jobTitlePlaceholder")} />
            </Field>
          </>
        ) : null}

        {creating ? (
          <Field label={t("columns.manager")} name="managerMemberId" hint={t("employmentForm.managerHint")}>
            <FormSelect id="managerMemberId" name="managerMemberId" className={selectClass} defaultValue="">
              <option value="">{t("employmentForm.noManager")}</option>
              {managerChoices.map((manager) => (
                <option key={manager.value} value={manager.value}>
                  {manager.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : (
          <p className="text-meta text-fg-subtle sm:col-span-2">
            {t("employmentForm.editNote")}
          </p>
        )}
      </FormSection>

      <FormSection title={t("dateRange.dates")} description={t("employmentForm.datesDescription")}>
        {creating ? (
          <Field label={t("fields.plannedStart")} name="startDate" hint={t("employmentForm.plannedStartHint")}>
            <Input id="startDate" name="startDate" type="date" defaultValue="" />
          </Field>
        ) : null}

        <Field label={t("fields.probationEnds")} name="probationEndDate">
          <Input id="probationEndDate" name="probationEndDate" type="date" defaultValue={values?.probationEndDate ?? ""} />
        </Field>

        <Field label={t("fields.endDate")} name="endDate" hint={t("employmentForm.endDateHint")}>
          <Input id="endDate" name="endDate" type="date" defaultValue={values?.endDate ?? ""} />
        </Field>
      </FormSection>

      <FormSection title={t("employmentForm.workingArrangement")}>
        {creating ? (
          <>
            <Field label={t("employmentForm.worksAt")} name="workLocationType">
              <FormSelect id="workLocationType" name="workLocationType" className={selectClass} defaultValue="">
                <option value="">{t("employmentForm.notSet")}</option>
                {WORK_LOCATION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {hrLabel(t, "workLocationType", value)}
                  </option>
                ))}
              </FormSelect>
            </Field>
            <Field label={t("fields.workLocation")} name="workLocation">
              <Input id="workLocation" name="workLocation" maxLength={160} defaultValue="" placeholder={t("employmentForm.workLocationPlaceholder")} />
            </Field>
          </>
        ) : null}

        <Field label={t("fields.weeklyHours")} name="weeklyHours" hint={t("employmentForm.weeklyHoursHint")}>
          <Input id="weeklyHours" name="weeklyHours" inputMode="decimal" defaultValue={values?.weeklyHours ?? ""} placeholder="40" />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
