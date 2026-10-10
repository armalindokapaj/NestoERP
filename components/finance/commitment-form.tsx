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
import { useFinanceTranslations } from "@/components/finance/finance-text";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import { FormSelect } from "@/components/ui/form-select";

export type CommitmentFormValues = {
  projectId: string | null;
  reference: string | null;
  description: string;
  counterpartyName: string | null;
  category: string;
  currency: string;
  amount: string;
  expectedDate: string | null;
  notes: string | null;
};

/** Create and edit a commitment (PRD #15 §129). */
export function CommitmentForm({
  action,
  projects,
  values,
  canCreateCompanyWide,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  projects: SelectOption[];
  values?: CommitmentFormValues;
  canCreateCompanyWide: boolean;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const t = useFinanceTranslations();
  return (
    <RecordForm
      action={action}
      module="finance"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title={t("commitmentForm.title")}
        description={t("commitmentForm.hint")}
      >
        <Field label={t("form.description")} name="description" required className="sm:col-span-2">
          <Input
            id="description"
            name="description"
            required
            minLength={2}
            maxLength={500}
            defaultValue={values?.description ?? ""}
            placeholder={t("commitmentForm.descriptionPlaceholder")}
          />
        </Field>

        <Field label={t("commitmentForm.counterparty")} name="counterpartyName">
          <Input
            id="counterpartyName"
            name="counterpartyName"
            maxLength={250}
            defaultValue={values?.counterpartyName ?? ""}
          />
        </Field>

        <Field label={t("form.reference")} name="reference" hint={t("form.internalNumber")}>
          <Input
            id="reference"
            name="reference"
            maxLength={60}
            defaultValue={values?.reference ?? ""}
            placeholder="COM-013"
          />
        </Field>

        <Field label={t("form.category")} name="category" required>
          <FormSelect
            id="category"
            name="category"
            className={selectClass}
            defaultValue={values?.category ?? "SUBCONTRACTOR"}
          >
            {Object.keys(expenseCategoryLabels).map((value) => (
              <option key={value} value={value}>
                {t(`category.${value as keyof typeof expenseCategoryLabels}`)}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field
          label={t("form.project")}
          name="projectId"
          required={!canCreateCompanyWide}
          hint={
            canCreateCompanyWide
              ? t("commitmentForm.projectHint")
              : t("form.projectRequired")
          }
        >
          <FormSelect
            id="projectId"
            name="projectId"
            className={selectClass}
            required={!canCreateCompanyWide}
            defaultValue={values?.projectId ?? ""}
          >
            {canCreateCompanyWide ? <option value="">{t("companyWide")}</option> : null}
            {!canCreateCompanyWide ? (
              <option value="" disabled>
                {t("form.chooseProject")}
              </option>
            ) : null}
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("form.currency")} name="currency" required>
          <FormSelect
            id="currency"
            name="currency"
            className={selectClass}
            defaultValue={values?.currency ?? "EUR"}
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("form.amount")} name="amount" required>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={values?.amount ?? ""}
          />
        </Field>

        <Field label={t("commitmentForm.expectedDate")} name="expectedDate" hint={t("commitmentForm.expectedHint")}>
          <Input
            id="expectedDate"
            name="expectedDate"
            type="date"
            defaultValue={values?.expectedDate ?? ""}
          />
        </Field>

        <Field label={t("form.notes")} name="notes" className="sm:col-span-2">
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={values?.notes ?? ""}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
