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
import { BudgetLineItems, type BudgetLineValue } from "./line-items-field";

export type BudgetFormValues = {
  projectId: string;
  name: string | null;
  currency: string;
  notes: string | null;
  lineItems: BudgetLineValue[];
};

/**
 * Create and edit a project budget (PRD #15 §108).
 *
 * On an existing version the project and currency are fixed: a budget belongs
 * to the project it was drawn for, and once a project has an approved budget
 * its currency is settled because its costs are recorded in it (PRD #15 §117).
 */
export function BudgetForm({
  action,
  projects,
  values,
  lockedCurrency,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  projects: SelectOption[];
  values?: BudgetFormValues;
  /** Set when the project already has an approved budget (PRD #15 §117). */
  lockedCurrency?: string | null;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const isEdit = Boolean(values);
  const [currency, setCurrency] = React.useState(
    lockedCurrency ?? values?.currency ?? "EUR",
  );

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection title="Budget" description="Planned cost for one project.">
        <Field label="Project" name="projectId" required>
          {isEdit ? (
            <>
              <Input
                id="projectId-display"
                value={
                  projects.find((project) => project.value === values?.projectId)?.label ??
                  "Project"
                }
                readOnly
                disabled
              />
              <input type="hidden" name="projectId" value={values!.projectId} />
            </>
          ) : (
            <select id="projectId" name="projectId" className={selectClass} required defaultValue="">
              <option value="" disabled>
                Choose a project
              </option>
              {projects.map((project) => (
                <option key={project.value} value={project.value}>
                  {project.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          label="Currency"
          name="currency"
          required
          hint={
            lockedCurrency
              ? `Fixed at ${lockedCurrency} by the project's approved budget.`
              : undefined
          }
        >
          {lockedCurrency ? (
            <>
              <Input id="currency-display" value={lockedCurrency} readOnly disabled />
              <input type="hidden" name="currency" value={lockedCurrency} />
            </>
          ) : (
            <select
              id="currency"
              name="currency"
              className={selectClass}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {SUPPORTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Name" name="name" className="sm:col-span-2" hint="Optional label for this version.">
          <Input
            id="name"
            name="name"
            maxLength={160}
            defaultValue={values?.name ?? ""}
            placeholder="Construction budget"
          />
        </Field>
      </FormSection>

      <BudgetLineItems currency={currency} defaultLines={values?.lineItems} />

      <FormSection title="Notes" description="Assumptions and exclusions worth recording.">
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
