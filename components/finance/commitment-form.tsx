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
import { Textarea } from "@/components/ui/textarea";
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";

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
        title="Commitment"
        description="Money the company has undertaken to spend, but has not yet incurred."
      >
        <Field label="Description" name="description" required className="sm:col-span-2">
          <Input
            id="description"
            name="description"
            required
            minLength={2}
            maxLength={500}
            defaultValue={values?.description ?? ""}
            placeholder="Superstructure frame package"
          />
        </Field>

        <Field label="Counterparty" name="counterpartyName">
          <Input
            id="counterpartyName"
            name="counterpartyName"
            maxLength={250}
            defaultValue={values?.counterpartyName ?? ""}
          />
        </Field>

        <Field label="Reference" name="reference" hint="Optional internal number.">
          <Input
            id="reference"
            name="reference"
            maxLength={60}
            defaultValue={values?.reference ?? ""}
            placeholder="COM-013"
          />
        </Field>

        <Field label="Category" name="category" required>
          <select
            id="category"
            name="category"
            className={selectClass}
            defaultValue={values?.category ?? "SUBCONTRACTOR"}
          >
            {Object.entries(expenseCategoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Project"
          name="projectId"
          required={!canCreateCompanyWide}
          hint={
            canCreateCompanyWide
              ? "Leave empty for a company-wide commitment."
              : "Your finance access is limited to your projects, so a project is required."
          }
        >
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            required={!canCreateCompanyWide}
            defaultValue={values?.projectId ?? ""}
          >
            {canCreateCompanyWide ? <option value="">Company-wide</option> : null}
            {!canCreateCompanyWide ? (
              <option value="" disabled>
                Choose a project
              </option>
            ) : null}
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Currency" name="currency" required>
          <select
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
          </select>
        </Field>

        <Field label="Amount" name="amount" required>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={values?.amount ?? ""}
          />
        </Field>

        <Field label="Expected date" name="expectedDate" hint="When the cost is expected to land.">
          <Input
            id="expectedDate"
            name="expectedDate"
            type="date"
            defaultValue={values?.expectedDate ?? ""}
          />
        </Field>

        <Field label="Notes" name="notes" className="sm:col-span-2">
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
