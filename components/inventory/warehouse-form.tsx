"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  WAREHOUSE_TYPES,
  warehouseTypeLabels,
} from "@/lib/modules/inventory/inventory.status";

export type WarehouseFormValues = {
  code: string;
  name: string;
  description: string;
  warehouseType: string;
  projectId: string;
  address: string;
  city: string;
  country: string;
  status: string;
};

/**
 * Create and edit a warehouse (PRD #20 §50–§55).
 *
 * A project-site warehouse must name its project: a site store with no site is
 * a store nobody can find, and it is also what scopes who may see the stock
 * inside it (PRD #20 §53, §245).
 */
export function WarehouseForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: WarehouseFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: { value: string; label: string }[];
}) {
  const [warehouseType, setWarehouseType] = React.useState(
    values?.warehouseType ?? "CENTRAL",
  );

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Warehouse"
        description="Somewhere stock is physically kept. A new warehouse gets a GENERAL location automatically, so it can take stock immediately."
      >
        <Field label="Code" name="code" required hint="Unique across the company">
          <Input id="code" name="code" defaultValue={values?.code ?? ""} required maxLength={40} />
        </Field>

        <Field label="Type" name="warehouseType" required>
          <select
            id="warehouseType"
            name="warehouseType"
            className={selectClass}
            value={warehouseType}
            onChange={(event) => setWarehouseType(event.target.value)}
          >
            {WAREHOUSE_TYPES.map((type) => (
              <option key={type} value={type}>
                {warehouseTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Name" name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field
          label="Project"
          name="projectId"
          required={warehouseType === "PROJECT_SITE"}
          hint={
            warehouseType === "PROJECT_SITE"
              ? "A site store belongs to one project, and that is what decides who can see its stock."
              : undefined
          }
        >
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">Not set</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status" name="status" required>
          <select
            id="status"
            name="status"
            className={selectClass}
            defaultValue={values?.status === "ARCHIVED" ? "INACTIVE" : (values?.status ?? "ACTIVE")}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>

        <Field label="Description" name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={values?.description ?? ""}
            maxLength={2000}
          />
        </Field>
      </FormSection>

      <FormSection title="Where it is">
        <Field label="Address" name="address" className="sm:col-span-2">
          <Input id="address" name="address" defaultValue={values?.address ?? ""} maxLength={400} />
        </Field>

        <Field label="City" name="city">
          <Input id="city" name="city" defaultValue={values?.city ?? ""} maxLength={120} />
        </Field>

        <Field label="Country" name="country">
          <Input id="country" name="country" defaultValue={values?.country ?? ""} maxLength={120} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
