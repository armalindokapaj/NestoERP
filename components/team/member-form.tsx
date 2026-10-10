"use client";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { useTeamTranslations } from "@/components/team/team-text";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Edit a membership (PRD #14 §85, §86).
 *
 * Role, department and job title — the three things the company owns. Name,
 * email, phone and photo belong to the person's own profile and are shown here
 * read-only, so it is clear they exist and equally clear they are not edited
 * from this screen (PRD #14 §87).
 */
export function MemberForm({
  action,
  roles,
  departments,
  values,
  profile,
  versionUpdatedAt,
  cancelHref,
  canAssignRole,
  canAssignDepartment,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  roles: SelectOption[];
  departments: SelectOption[];
  values: { roleId: string; departmentId: string | null; jobTitle: string | null };
  profile: { fullName: string; email: string | null };
  versionUpdatedAt?: string;
  cancelHref: string;
  canAssignRole: boolean;
  canAssignDepartment: boolean;
}) {
  const t = useTeamTranslations();
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={t("form.save")}
      saveKind="save"
      pendingLabel={t("form.saving")}
      versionUpdatedAt={versionUpdatedAt}
      module="team"
    >
      <FormSection
        title={t("form.person")}
        description={t("form.personDescription")}
      >
        <Field label={t("form.name")} name="fullName">
          <Input id="fullName" value={profile.fullName} readOnly disabled />
        </Field>
        <Field label={t("form.email")} name="email">
          <Input id="email" value={profile.email ?? ""} placeholder="—" readOnly disabled />
        </Field>
      </FormSection>

      <FormSection title={t("form.membership")} description={t("form.membershipDescription")}>
        <Field
          label={t("form.role")}
          name="roleId"
          required
          hint={canAssignRole ? undefined : t("form.noRolePermission")}
        >
          {/* A disabled select submits nothing, so the current value travels in
              a hidden field and the server still receives a complete record. */}
          <FormSelect
            id="roleId"
            name={canAssignRole ? "roleId" : undefined}
            className={selectClass}
            defaultValue={values.roleId}
            disabled={!canAssignRole}
            required={canAssignRole}
          >
            {roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </FormSelect>
          {canAssignRole ? null : <input type="hidden" name="roleId" value={values.roleId} />}
        </Field>

        <Field
          label={t("form.department")}
          name="departmentId"
          hint={
            canAssignDepartment
              ? undefined
              : t("form.noDepartmentPermission")
          }
        >
          <FormSelect
            id="departmentId"
            name={canAssignDepartment ? "departmentId" : undefined}
            className={selectClass}
            defaultValue={values.departmentId ?? ""}
            disabled={!canAssignDepartment}
          >
            <option value="">{t("form.noDepartment")}</option>
            {departments.map((department) => (
              <option key={department.value} value={department.value}>
                {department.label}
              </option>
            ))}
            {/* An archived department the member is still in stays chosen, so saving the title does not remove it (AUD-09 §5, FV-09). */}
            {values.departmentId && !departments.some((department) => department.value === values.departmentId) ? (
              <option value={values.departmentId}>{t("form.currentDepartment")}</option>
            ) : null}
          </FormSelect>
          {/* Not the reader's to change: nothing is sent, and the server keeps it (AUD-09 §5, FV-10). */}
        </Field>

        <Field label={t("form.jobTitle")} name="jobTitle" className="sm:col-span-2">
          <Input
            id="jobTitle"
            name="jobTitle"
            maxLength={160}
            defaultValue={values.jobTitle ?? ""}
            placeholder={t("form.jobTitlePlaceholder")}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
