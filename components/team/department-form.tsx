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
import { Textarea } from "@/components/ui/textarea";

export type DepartmentFormValues = {
  name: string;
  key: string | null;
  description: string | null;
  managerMemberId: string | null;
  status: string;
};

/**
 * Create and edit a department (PRD #14 §116, §117).
 *
 * The manager list is active members only, because naming somebody without
 * access as department manager is how an org chart stops matching reality
 * (PRD #14 §248).
 */
export function DepartmentForm({
  action,
  managers,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  managers: SelectOption[];
  values?: DepartmentFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection title="Department" description="How this group appears across the workspace.">
        <Field label="Name" name="name" required className="sm:col-span-2">
          <Input
            id="name"
            name="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={values?.name ?? ""}
            placeholder="Engineering"
          />
        </Field>

        <Field
          label="Key"
          name="key"
          hint="Optional short identifier used in reports. Lowercase letters, numbers, hyphens."
        >
          <Input
            id="key"
            name="key"
            maxLength={60}
            defaultValue={values?.key ?? ""}
            placeholder="engineering"
          />
        </Field>

        <Field label="Manager" name="managerMemberId">
          <select
            id="managerMemberId"
            name="managerMemberId"
            className={selectClass}
            defaultValue={values?.managerMemberId ?? ""}
          >
            <option value="">No manager</option>
            {managers.map((manager) => (
              <option key={manager.value} value={manager.value}>
                {manager.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Description" name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={values?.description ?? ""}
          />
        </Field>

        <Field label="Status" name="status">
          <select
            id="status"
            name="status"
            className={selectClass}
            defaultValue={values?.status ?? "ACTIVE"}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
      </FormSection>
    </RecordForm>
  );
}
