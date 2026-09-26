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
import { formatAmount } from "@/lib/modules/finance/finance.currency";

export type PayableTarget = {
  id: string;
  label: string;
  currency: string;
  outstanding: string;
};

/**
 * Record a payment (PRD #15 §82).
 *
 * The currency is inherited from the record being settled and shown read-only,
 * because V0.1 has no FX engine and a mismatch has no honest resolution
 * (PRD #15 §76). The outstanding balance is displayed so nobody has to guess —
 * and the server refuses anything above it, recalculated inside the transaction
 * (PRD #15 §79, §83).
 */
export function PaymentForm({
  action,
  direction,
  targets,
  defaultTargetId,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  direction: "RECEIPT" | "DISBURSEMENT";
  targets: PayableTarget[];
  defaultTargetId?: string;
  cancelHref: string;
}) {
  const [targetId, setTargetId] = React.useState(defaultTargetId ?? targets[0]?.id ?? "");
  const target = targets.find((entry) => entry.id === targetId);
  const field = direction === "RECEIPT" ? "invoiceId" : "expenseId";

  return (
    <RecordForm
      action={action}
      module="finance"
      cancelHref={cancelHref}
      submitLabel={direction === "RECEIPT" ? "Record receipt" : "Record payment"}
      pendingLabel="Recording…"
    >
      <FormSection
        title={direction === "RECEIPT" ? "Money received" : "Money paid out"}
        description={
          direction === "RECEIPT"
            ? "Against an invoice that has been sent."
            : "Against an approved expense."
        }
      >
        <Field
          label={direction === "RECEIPT" ? "Invoice" : "Expense"}
          name={field}
          required
          className="sm:col-span-2"
        >
          <select
            id={field}
            name={field}
            className={selectClass}
            required
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="" disabled>
              {direction === "RECEIPT" ? "Choose an invoice" : "Choose an expense"}
            </option>
            {targets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} — {formatAmount(entry.outstanding, entry.currency)} outstanding
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Amount"
          name="amount"
          required
          hint={
            target
              ? `${formatAmount(target.outstanding, target.currency)} outstanding in ${target.currency}.`
              : undefined
          }
        >
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={target?.outstanding ?? "0"}
            key={targetId}
          />
        </Field>

        <Field label="Payment date" name="paymentDate" required>
          <Input
            id="paymentDate"
            name="paymentDate"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </Field>

        <Field label="Method" name="method" required>
          <select id="method" name="method" className={selectClass} defaultValue="BANK_TRANSFER">
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CARD">Card</option>
            <option value="CASH">Cash</option>
            <option value="CHECK">Cheque</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>

        <Field label="Reference" name="reference" hint="Bank reference or receipt number.">
          <Input id="reference" name="reference" maxLength={200} />
        </Field>

        <Field label="Notes" name="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
