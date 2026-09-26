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
import { PricedLineItems, type PricedLineValue } from "@/components/finance/line-items-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { currencyOptions } from "@/lib/modules/finance/finance.currency";

export type ProposalFormValues = {
  proposalNumber: string;
  title: string;
  currency: string;
  issueDate: string;
  validUntil: string | null;
  notes: string | null;
  lineItems: PricedLineValue[];
};

/**
 * Draft and revise a proposal (PRD #17 §114, §409).
 *
 * The opportunity is chosen once, on create, and then fixed: moving a proposal
 * to a different deal would take its approval history with it (PRD #17 §426).
 *
 * Every total on screen is a preview. The server recalculates each line from
 * quantity, unit price and tax rate before anything is stored, so the price the
 * client is quoted is never one the browser arrived at (PRD #17 §224).
 */
export function ProposalForm({
  action,
  opportunities,
  values,
  versionUpdatedAt,
  lockedOpportunity,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  /** Absent when editing: the opportunity is fixed after creation. */
  opportunities?: SelectOption[];
  values?: ProposalFormValues;
  versionUpdatedAt?: string;
  lockedOpportunity?: { id: string; name: string };
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [currency, setCurrency] = React.useState(values?.currency ?? "EUR");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <RecordForm
      action={action}
      module="sales"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Proposal"
        description="A commercial offer against one opportunity. It is not an invoice."
      >
        <Field label="Proposal number" name="proposalNumber" required>
          <Input
            id="proposalNumber"
            name="proposalNumber"
            defaultValue={values?.proposalNumber ?? ""}
            required
            maxLength={60}
          />
        </Field>

        <Field label="Title" name="title" required>
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        {opportunities ? (
          <Field
            label="Opportunity"
            name="opportunityId"
            required
            className="sm:col-span-2"
            hint="Fixed once the proposal exists — its approval history belongs to this deal."
          >
            <select
              id="opportunityId"
              name="opportunityId"
              className={selectClass}
              defaultValue={lockedOpportunity?.id ?? ""}
              required
            >
              <option value="">Choose an opportunity</option>
              {opportunities.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        ) : lockedOpportunity ? (
          <div className="sm:col-span-2">
            <p className="nesto-eyebrow text-fg-subtle">Opportunity</p>
            <p className="mt-0.5 text-table text-fg">{lockedOpportunity.name}</p>
          </div>
        ) : null}

        <Field label="Currency" name="currency" required>
          <select
            id="currency"
            name="currency"
            className={selectClass}
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Issue date" name="issueDate" required>
          <Input
            id="issueDate"
            name="issueDate"
            type="date"
            defaultValue={values?.issueDate ?? today}
            required
          />
        </Field>

        <Field label="Valid until" name="validUntil" hint="Optional. Cannot be before the issue date.">
          <Input
            id="validUntil"
            name="validUntil"
            type="date"
            defaultValue={values?.validUntil ?? ""}
          />
        </Field>
      </FormSection>

      <PricedLineItems currency={currency} defaultLines={values?.lineItems} />

      <FormSection title="Notes" description="Internal commercial context. Not exported.">
        <Field label="Notes" name="notes" className="sm:col-span-2">
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={values?.notes ?? ""}
            maxLength={5000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
