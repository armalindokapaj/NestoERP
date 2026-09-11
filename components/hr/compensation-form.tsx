"use client";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import { PAY_TYPES } from "@/lib/modules/hr/hr.schema";

const PAY_TYPE_LABELS: Record<(typeof PAY_TYPES)[number], string> = {
  SALARY: "Salary",
  HOURLY: "Hourly",
  DAILY: "Daily",
  OTHER: "Other",
};

/**
 * Record a new pay level (PRD #16 §60, §65, §321).
 *
 * There is no edit: a change is a new effective-dated record, and the server
 * closes the current one the day before this one starts. Currency, pay type,
 * amount and effective date are each labelled in full, because a salary read
 * wrong is a salary paid wrong (PRD #16 §321).
 */
export function CompensationForm({
  action,
  currentAmount,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  /** Shown as context, never pre-filled: a new figure should be typed. */
  currentAmount?: { baseAmount: string; currency: string; payType: string } | null;
  cancelHref: string;
}) {
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel="Record compensation"
      pendingLabel="Recording…"
    >
      <FormSection
        title="New pay record"
        description="The record currently open is closed the day before this one starts."
      >
        <Field label="Pay type" name="payType" required>
          <select
            id="payType"
            name="payType"
            className={selectClass}
            defaultValue={currentAmount?.payType ?? "SALARY"}
          >
            {PAY_TYPES.map((type) => (
              <option key={type} value={type}>
                {PAY_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Currency" name="currency" required>
          <select
            id="currency"
            name="currency"
            className={selectClass}
            defaultValue={currentAmount?.currency ?? "EUR"}
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Base amount"
          name="baseAmount"
          required
          hint={
            currentAmount
              ? `Currently ${currentAmount.baseAmount} ${currentAmount.currency}.`
              : "Gross, per the pay type above."
          }
        >
          <Input id="baseAmount" name="baseAmount" inputMode="decimal" required placeholder="0.00" />
        </Field>

        <Field label="Effective from" name="effectiveFrom" required>
          <Input
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </Field>

        <Field
          label="Notes"
          name="notes"
          className="sm:col-span-2"
          hint="Why the level changed. Never repeated in the activity trail."
        >
          <Textarea id="notes" name="notes" rows={3} maxLength={2000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
