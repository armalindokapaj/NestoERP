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
import { localToday } from "./local-date";
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import { formatAmount } from "@/lib/modules/finance/finance.currency";
import { previewDecimal, sumDecimal } from "@/lib/modules/finance/finance.decimal";
import { useFieldErrors } from "@/components/forms/record-form";
import { MONEY_RULE } from "@/lib/modules/finance/finance.fields";
import { DecimalCell } from "./line-rows";

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
 * rather than the record (PRD #15 §92). The preview is exact decimal
 * arithmetic, and shows nothing rather than a guess while a figure is not a
 * number (AUD-09 §4, §7, FV-06).
 *
 * Net is required on both sides; tax may be left empty, which the domain reads
 * as "no tax" (0). A saved project the picker no longer offers stays
 * selectable on this expense so an edit does not erase it (FV-10).
 */
export function ExpenseForm({
  action,
  projects,
  values,
  canCreateCompanyWide,
  defaultCurrency = "EUR",
  today,
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
  /** The company's base currency: the default for a new expense. */
  defaultCurrency?: string;
  /** The company's calendar today (`companyToday`). */
  today?: string;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [currency, setCurrency] = React.useState(values?.currency || defaultCurrency);
  const [net, setNet] = React.useState(values?.netAmount ?? "");
  const [tax, setTax] = React.useState(values?.taxAmount ?? "");

  const netValue = previewDecimal(net, 2);
  const taxValue = tax.trim() === "" ? "0" : previewDecimal(tax, 2);
  const total = netValue !== null && taxValue !== null ? sumDecimal([netValue, taxValue], 2) : null;

  const projectOptions = React.useMemo(() => {
    const saved = values?.projectId;
    if (!saved || projects.some((project) => project.value === saved)) return projects;
    return [...projects, { value: saved, label: "Current project (no longer available for new expenses)" }];
  }, [projects, values?.projectId]);

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
            defaultValue={values?.expenseDate ?? today ?? localToday()}
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
            {projectOptions.map((project) => (
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

        <AmountField
          name="netAmount"
          label="Net amount"
          currency={currency}
          value={net}
          onChange={setNet}
          required
        />

        <AmountField
          name="taxAmount"
          label="Tax amount"
          currency={currency}
          value={tax}
          onChange={setTax}
          hint="Optional. Leave empty if there is no tax."
        />

        <div className="flex items-end justify-end sm:col-span-1">
          <p className="text-table text-fg-muted">
            Total (preview){" "}
            <span className="font-semibold tabular-nums text-fg">
              {total !== null ? formatAmount(total, currency) : "—"}
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

/**
 * A money field with the shared decimal rule (AUD-09 §4, FV-06): checked on
 * blur with the server's own sentence, the server's error beside it after a
 * refused save.
 */
function AmountField({
  name,
  label,
  currency,
  value,
  onChange,
  required,
  hint,
}: {
  name: string;
  label: string;
  currency: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
}) {
  const errors = useFieldErrors();
  const [sent, setSent] = React.useState<Record<string, string[]>>(errors);
  const [edited, setEdited] = React.useState(false);
  if (sent !== errors) {
    setSent(errors);
    setEdited(false);
  }
  return (
    <div className="space-y-1.5">
      <DecimalCell
        id={name}
        name={name}
        label={label}
        markRequired
        unit={currency}
        value={value}
        required={required}
        rule={{ label, ...MONEY_RULE }}
        serverError={edited ? undefined : errors[name]?.[0]}
        onChange={(next) => {
          setEdited(true);
          onChange(next);
        }}
      />
      {hint ? <p className="text-meta text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
