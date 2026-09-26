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
import { formatAmount } from "@/lib/modules/finance/finance.currency";

export type ExpenseFormValues = {
  expenseNumber: string | null;
  projectId: string | null;
  expenseDate: string;
  category: string;
  description: string;
  payeeName: string | null;
  currency: string;
  netAmount: string;
  taxAmount: string;
  notes: string | null;
};

/**
 * Create and edit an expense (PRD #15 §94).
 *
 * Net and tax are entered separately and the total is shown as a preview; the
 * server adds them again before storing, so the figure on screen is a courtesy
 * rather than the record (PRD #15 §92).
 */
export function ExpenseForm({
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
  values?: ExpenseFormValues;
  /** Company-level finance scope; below it, an expense needs a project. */
  canCreateCompanyWide: boolean;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [currency, setCurrency] = React.useState(values?.currency ?? "EUR");
  const [net, setNet] = React.useState(values?.netAmount ?? "0");
  const [tax, setTax] = React.useState(values?.taxAmount ?? "0");

  const total = round2(toNumber(net) + toNumber(tax));

  return (
    <RecordForm
      action={action}
      module="finance"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection title="Expense details" description="What the cost was, and who it was paid to.">
        <Field label="Description" name="description" required className="sm:col-span-2">
          <Input
            id="description"
            name="description"
            required
            minLength={2}
            maxLength={500}
            defaultValue={values?.description ?? ""}
            placeholder="Groundworks package — February"
          />
        </Field>

        <Field label="Category" name="category" required>
          <select
            id="category"
            name="category"
            className={selectClass}
            defaultValue={values?.category ?? "MATERIALS"}
          >
            {Object.entries(expenseCategoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Expense date" name="expenseDate" required>
          <Input
            id="expenseDate"
            name="expenseDate"
            type="date"
            required
            defaultValue={values?.expenseDate ?? new Date().toISOString().slice(0, 10)}
          />
        </Field>

        <Field
          label="Project"
          name="projectId"
          required={!canCreateCompanyWide}
          hint={
            canCreateCompanyWide
              ? "Leave empty for a company overhead."
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

        <Field label="Payee" name="payeeName">
          <Input
            id="payeeName"
            name="payeeName"
            maxLength={250}
            defaultValue={values?.payeeName ?? ""}
            placeholder="Terra Ndërtim sh.p.k."
          />
        </Field>

        <Field label="Reference" name="expenseNumber" hint="Optional internal number.">
          <Input
            id="expenseNumber"
            name="expenseNumber"
            maxLength={60}
            defaultValue={values?.expenseNumber ?? ""}
            placeholder="EXP-019"
          />
        </Field>
      </FormSection>

      <FormSection title="Amounts" description="The server adds net and tax to reach the total.">
        <Field label="Currency" name="currency" required>
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
        </Field>

        <Field label="Net amount" name="netAmount" required>
          <Input
            id="netAmount"
            name="netAmount"
            inputMode="decimal"
            required
            value={net}
            onChange={(event) => setNet(event.target.value)}
          />
        </Field>

        <Field label="Tax amount" name="taxAmount">
          <Input
            id="taxAmount"
            name="taxAmount"
            inputMode="decimal"
            value={tax}
            onChange={(event) => setTax(event.target.value)}
          />
        </Field>

        <div className="flex items-end justify-end sm:col-span-1">
          <p className="text-table text-fg-muted">
            Total{" "}
            <span className="font-semibold tabular-nums text-fg">
              {formatAmount(total.toFixed(2), currency)}
            </span>
          </p>
        </div>

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

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
