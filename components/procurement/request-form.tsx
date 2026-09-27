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
import { currencyOptions } from "@/lib/modules/finance/finance.currency";
import {
  CATEGORIES,
  PRIORITIES,
  categoryLabels,
  priorityLabels,
} from "@/lib/modules/procurement/procurement.status";
import { LineItemsEditor, type LineValue } from "./line-items";
import { withSavedOption } from "@/components/finance/saved-option";
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";
import { useProcurementTranslations } from "./procurement-text";

export type RequestFormValues = {
  title: string;
  description: string;
  projectId: string;
  departmentId: string;
  ownerMemberId: string;
  requiredDate: string;
  priority: string;
  currency: string;
  items: LineValue[];
};

/**
 * Raise or revise a purchase request (PRD #19 §50, §51, §265).
 *
 * There is no status field: a request starts as a draft and moves through named
 * actions, so there is nothing here for a browser to lie about (PRD #19 §19).
 *
 * The line prices are labelled estimates because that is what they are. A
 * request is a need; what a thing actually costs is what a supplier quotes
 * (PRD #19 §48).
 */
export function RequestForm({
  action,
  projects,
  departments,
  members,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  projects: SelectOption[];
  departments: SelectOption[];
  members: SelectOption[];
  values?: RequestFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  // Saved links the pickers no longer offer stay on this request (FV-10).
  const t = useProcurementTranslations();
  const projectOptions = withSavedOption(projects, values?.projectId, t("requests.savedProject"));
  const departmentOptions = withSavedOption(departments, values?.departmentId, t("requests.savedDepartment"));
  const memberOptions = withSavedOption(members, values?.ownerMemberId, t("requests.savedBuyer"));

  return (
    <RecordForm
      action={action}
      module="procurement"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title={t("requests.formSection")}
        description={t("requests.formDescription")}
      >
        <Field label={t("common.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={250} />
        </Field>

        <Field label={t("common.priority")} name="priority" required>
          <select
            id="priority"
            name="priority"
            className={selectClass}
            defaultValue={values?.priority ?? "MEDIUM"}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {procurementLabel(t, "priority", priority, priorityLabels[priority])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("requests.neededBy")} name="requiredDate">
          <Input
            id="requiredDate"
            name="requiredDate"
            type="date"
            defaultValue={values?.requiredDate ?? ""}
          />
        </Field>

        <Field label={t("common.notes")} name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={values?.description ?? ""}
            maxLength={4000}
          />
        </Field>
      </FormSection>

      <FormSection
        title={t("common.whereItBelongs")}
        description={t("requests.belongsDescription")}
      >
        <Field label={t("common.project")} name="projectId">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">{t("common.noProject")}</option>
            {projectOptions.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("common.department")} name="departmentId">
          <select
            id="departmentId"
            name="departmentId"
            className={selectClass}
            defaultValue={values?.departmentId ?? ""}
          >
            <option value="">{t("common.notSet")}</option>
            {departmentOptions.map((department) => (
              <option key={department.value} value={department.value}>
                {department.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("requests.buyer")} name="ownerMemberId" hint={t("requests.buyerHint")}>
          <select
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={values?.ownerMemberId ?? ""}
          >
            <option value="">{t("requests.notAssigned")}</option>
            {memberOptions.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("common.currency")} name="currency" hint={t("requests.currencyHint")}>
          <select
            id="currency"
            name="currency"
            className={selectClass}
            defaultValue={values?.currency ?? "EUR"}
          >
            <option value="">{t("common.notSet")}</option>
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title={t("common.lines")}
        description={t("requests.linesDescription")}
      >
        <div className="sm:col-span-2">
          <LineItemsEditor
            initial={values?.items}
            columns={["quantity", "unit", "estimatedUnitPrice", "category"]}
            categories={CATEGORIES.map((category) => ({
              value: category,
              label: procurementLabel(t, "category", category, categoryLabels[category]),
            }))}
            priceLabel={t("requests.estimatedUnitPrice")}
            priceField="estimatedUnitPrice"
          />
        </div>
      </FormSection>
    </RecordForm>
  );
}
