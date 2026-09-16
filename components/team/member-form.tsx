"use client";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";

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
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel="Save changes"
      pendingLabel="Saving…"
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Person"
        description="Managed in their own profile, not by the company."
      >
        <Field label="Name" name="fullName">
          <Input id="fullName" value={profile.fullName} readOnly disabled />
        </Field>
        <Field label="Email" name="email">
          <Input id="email" value={profile.email ?? ""} placeholder="—" readOnly disabled />
        </Field>
      </FormSection>

      <FormSection title="Membership" description="What this person can reach in this company.">
        <Field
          label="Role"
          name="roleId"
          required
          hint={canAssignRole ? undefined : "You do not have permission to change roles."}
        >
          {/* A disabled select submits nothing, so the current value travels in
              a hidden field and the server still receives a complete record. */}
          <select
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
          </select>
          {canAssignRole ? null : <input type="hidden" name="roleId" value={values.roleId} />}
        </Field>

        <Field
          label="Department"
          name="departmentId"
          hint={
            canAssignDepartment
              ? undefined
              : "You do not have permission to change departments."
          }
        >
          <select
            id="departmentId"
            name={canAssignDepartment ? "departmentId" : undefined}
            className={selectClass}
            defaultValue={values.departmentId ?? ""}
            disabled={!canAssignDepartment}
          >
            <option value="">No department</option>
            {departments.map((department) => (
              <option key={department.value} value={department.value}>
                {department.label}
              </option>
            ))}
          </select>
          {canAssignDepartment ? null : (
            <input type="hidden" name="departmentId" value={values.departmentId ?? ""} />
          )}
        </Field>

        <Field label="Job title" name="jobTitle" className="sm:col-span-2">
          <Input
            id="jobTitle"
            name="jobTitle"
            maxLength={160}
            defaultValue={values.jobTitle ?? ""}
            placeholder="Site Engineer"
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
