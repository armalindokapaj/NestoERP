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
import { WAREHOUSE_TYPES, warehouseTypeLabels } from "@/lib/modules/inventory/inventory.status";
import { inventoryLabel, useInventoryTranslations } from "./inventory-text";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useInventoryTranslations();
  const [warehouseType, setWarehouseType] = React.useState(
    values?.warehouseType ?? "CENTRAL",
  );

  return (
    <RecordForm
      action={action}
      module="inventory"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title={t("warehouseForm.section")}
        description={t("warehouseForm.sectionDescription")}
      >
        <Field label={t("fields.code")} name="code" required hint={t("fields.uniqueHint")}>
          <Input id="code" name="code" defaultValue={values?.code ?? ""} required maxLength={40} />
        </Field>

        <Field label={t("fields.type")} name="warehouseType" required>
          <FormSelect
            id="warehouseType"
            name="warehouseType"
            className={selectClass}
            value={warehouseType}
            onChange={(event) => setWarehouseType(event.target.value)}
          >
            {WAREHOUSE_TYPES.map((type) => (
              <option key={type} value={type}>
                {inventoryLabel(t, "warehouseType", type, warehouseTypeLabels[type])}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("fields.name")} name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field
          label={t("fields.project")}
          name="projectId"
          required={warehouseType === "PROJECT_SITE"}
          hint={
            warehouseType === "PROJECT_SITE"
              ? t("warehouseForm.projectHint")
              : undefined
          }
        >
          <FormSelect
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">{t("fields.notSet")}</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("fields.status")} name="status" required>
          <FormSelect
            id="status"
            name="status"
            className={selectClass}
            defaultValue={values?.status === "ARCHIVED" ? "INACTIVE" : (values?.status ?? "ACTIVE")}
          >
            <option value="ACTIVE">{t("labels.warehouseStatus.ACTIVE")}</option>
            <option value="INACTIVE">{t("labels.warehouseStatus.INACTIVE")}</option>
          </FormSelect>
        </Field>

        <Field label={t("fields.description")} name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={values?.description ?? ""}
            maxLength={2000}
          />
        </Field>
      </FormSection>

      <FormSection title={t("warehouseForm.whereItIs")}>
        <Field label={t("fields.address")} name="address" className="sm:col-span-2">
          <Input id="address" name="address" defaultValue={values?.address ?? ""} maxLength={400} />
        </Field>

        <Field label={t("fields.city")} name="city">
          <Input id="city" name="city" defaultValue={values?.city ?? ""} maxLength={120} />
        </Field>

        <Field label={t("fields.country")} name="country">
          <Input id="country" name="country" defaultValue={values?.country ?? ""} maxLength={120} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
