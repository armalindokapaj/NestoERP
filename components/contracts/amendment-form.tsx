"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount } from "@/lib/modules/finance/finance.currency";
import { previewDecimal, sumDecimal } from "@/lib/modules/finance/finance.decimal";

export type AmendmentFormValues = {
  amendmentNumber: string;
  title: string;
  summary: string;
  effectiveDate: string | null;
  newContractValue: string | null;
  newExpiryDate: string | null;
};

/**
 * Draft or revise an amendment (PRD #18 §166–§168).
 *
 * The resulting value is asked for, never the delta: a delta computed in a
 * browser is a number nobody can check, and the server derives it from what the
 * contract holds now (PRD #18 §167, §332).
 *
 * There is no currency field. An amendment changes what is owed, never the
 * currency it is owed in (PRD #18 §281).
 */
export function AmendmentForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  contract,
  canEditCommercial,
  requireReductionAcknowledgement,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: AmendmentFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  contract: {
    contractNumber: string;
    currency: string | null;
    contractValue: string | null;
    expiryDate: string | null;
  };
  canEditCommercial: boolean;
  /** Set after the server refused an unacknowledged reduction (PRD #18 §168). */
  requireReductionAcknowledgement: boolean;
}) {
  const [newValue, setNewValue] = React.useState(values?.newContractValue ?? "");
  const [newExpiry, setNewExpiry] = React.useState(values?.newExpiryDate ?? "");

  // Exact, and only for a value the server would accept: "12abc" and "1e5" used
  // to preview as 12 and 100000 (AUD-09 §4, FV-06). A preview; the server
  // derives the delta itself.
  const next = newValue.trim() === "" ? null : previewDecimal(newValue, 2);
  const delta =
    contract.contractValue && next !== null
      ? sumDecimal([next, contract.contractValue.startsWith("-") ? contract.contractValue.slice(1) : `-${contract.contractValue}`], 2)
      : null;

  const shortens =
    Boolean(newExpiry) && Boolean(contract.expiryDate) && newExpiry < contract.expiryDate!;
  const reduces = delta !== null && delta.startsWith("-");

  return (
    <RecordForm
      action={action}
      module="contracts"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Amendment"
        description={`A legal change to ${contract.contractNumber}. It does not replace the contract.`}
      >
        <Field label="Amendment number" name="amendmentNumber" required>
          <Input
            id="amendmentNumber"
            name="amendmentNumber"
            defaultValue={values?.amendmentNumber ?? ""}
            required
            maxLength={60}
            placeholder="AMD-001"
          />
        </Field>

        <Field label="Effective date" name="effectiveDate">
          <Input
            id="effectiveDate"
            name="effectiveDate"
            type="date"
            defaultValue={values?.effectiveDate ?? ""}
          />
        </Field>

        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={250} />
        </Field>

        <Field
          label="Summary"
          name="summary"
          required
          className="sm:col-span-2"
          hint="What changes, in the words the parties agreed."
        >
          <Textarea
            id="summary"
            name="summary"
            rows={4}
            maxLength={5000}
            defaultValue={values?.summary ?? ""}
            required
          />
        </Field>
      </FormSection>

      <FormSection
        title="What it changes"
        description="Leave a field empty to leave that term as it is."
      >
        {canEditCommercial ? (
          <Field
            label="New contract value"
            name="newContractValue"
            hint={
              contract.contractValue && contract.currency
                ? `Currently ${formatAmount(contract.contractValue, contract.currency)}`
                : "The contract has no recorded value."
            }
          >
            <Input
              id="newContractValue"
              name="newContractValue"
              inputMode="decimal"
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              placeholder="0.00"
            />
          </Field>
        ) : null}

        <Field
          label="New expiry date"
          name="newExpiryDate"
          hint={contract.expiryDate ? `Currently ${contract.expiryDate}` : "No fixed expiry today."}
        >
          <Input
            id="newExpiryDate"
            name="newExpiryDate"
            type="date"
            value={newExpiry}
            onChange={(event) => setNewExpiry(event.target.value)}
          />
        </Field>

        {delta !== null && contract.currency ? (
          <p className="text-meta text-fg-subtle sm:col-span-2">
            Change (preview): {reduces ? "−" : "+"}
            {formatAmount(delta.replace(/^-/, ""), contract.currency)}. The server recalculates
            this from the contract&apos;s value at the moment the amendment is activated.
          </p>
        ) : null}

        {reduces || shortens || requireReductionAcknowledgement ? (
          <label className="flex items-start gap-2 text-table text-fg sm:col-span-2">
            <input
              type="checkbox"
              name="acknowledgeReduction"
              defaultChecked={requireReductionAcknowledgement}
              className="mt-0.5 size-4 rounded border-line"
            />
            <span>
              This amendment {reduces ? "reduces the contract value" : ""}
              {reduces && shortens ? " and " : ""}
              {shortens ? "shortens the term" : ""}
              {!reduces && !shortens ? "reduces the terms" : ""}. Confirm that the reduction is
              intended.
            </span>
          </label>
        ) : null}
      </FormSection>
    </RecordForm>
  );
}
