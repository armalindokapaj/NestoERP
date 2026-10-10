"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { useFinanceTranslations } from "@/components/finance/finance-text";
import { Input } from "@/components/ui/input";
import { localToday } from "./local-date";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount } from "@/lib/modules/finance/finance.currency";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useFinanceTranslations();
  const [targetId, setTargetId] = React.useState(defaultTargetId ?? targets[0]?.id ?? "");
  const target = targets.find((entry) => entry.id === targetId);
  const field = direction === "RECEIPT" ? "invoiceId" : "expenseId";

  return (
    <RecordForm
      action={action}
      module="finance"
      cancelHref={cancelHref}
      submitLabel={direction === "RECEIPT" ? t("paymentForm.recordReceipt") : t("paymentForm.recordPayment")}
      pendingLabel={t("paymentForm.recording")}
    >
      <FormSection
        title={direction === "RECEIPT" ? t("paymentForm.received") : t("paymentForm.paidOut")}
        description={
          direction === "RECEIPT"
            ? t("paymentForm.receivedHint")
            : t("paymentForm.paidOutHint")
        }
      >
        <Field
          label={direction === "RECEIPT" ? t("kind.invoice") : t("kind.expense")}
          name={field}
          required
          className="sm:col-span-2"
        >
          <FormSelect
            id={field}
            name={field}
            className={selectClass}
            required
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="" disabled>
              {direction === "RECEIPT" ? t("paymentForm.chooseInvoice") : t("paymentForm.chooseExpense")}
            </option>
            {targets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {t("paymentForm.targetOption", { label: entry.label, amount: formatAmount(entry.outstanding, entry.currency) })}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field
          label={t("form.amount")}
          name="amount"
          required
          hint={
            target
              ? t("paymentForm.outstandingIn", { amount: formatAmount(target.outstanding, target.currency), currency: target.currency })
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

        <Field label={t("paymentForm.date")} name="paymentDate" required>
          <Input
            id="paymentDate"
            name="paymentDate"
            type="date"
            required
            defaultValue={localToday()}
          />
        </Field>

        <Field label={t("columns.method")} name="method" required>
          <FormSelect id="method" name="method" className={selectClass} defaultValue="BANK_TRANSFER">
            <option value="BANK_TRANSFER">{t("method.BANK_TRANSFER")}</option>
            <option value="CARD">{t("method.CARD")}</option>
            <option value="CASH">{t("method.CASH")}</option>
            <option value="CHECK">{t("method.CHECK")}</option>
            <option value="OTHER">{t("method.OTHER")}</option>
          </FormSelect>
        </Field>

        <Field label={t("form.reference")} name="reference" hint={t("paymentForm.referenceHint")}>
          <Input id="reference" name="reference" maxLength={200} />
        </Field>

        <Field label={t("form.notes")} name="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
