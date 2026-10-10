"use client";

import * as React from "react";
import { localToday } from "@/components/finance/local-date";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { PricedLineItems, type PricedLineValue } from "@/components/finance/line-items-field";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { currencyOptions } from "@/lib/modules/finance/finance.currency";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useSalesTranslations();
  const [currency, setCurrency] = React.useState(values?.currency ?? "EUR");
  const today = localToday();

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
        title={t("forms.proposalTitle")}
        description={t("forms.proposalDescription")}
      >
        <Field label={t("forms.proposalNumber")} name="proposalNumber" required>
          <Input
            id="proposalNumber"
            name="proposalNumber"
            defaultValue={values?.proposalNumber ?? ""}
            required
            maxLength={60}
          />
        </Field>

        <Field label={t("forms.title")} name="title" required>
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        {opportunities ? (
          <Field
            label={t("forms.opportunity")}
            name="opportunityId"
            required
            className="sm:col-span-2"
            hint={t("forms.opportunityFixedHint")}
          >
            <FormSelect
              id="opportunityId"
              name="opportunityId"
              className={selectClass}
              defaultValue={lockedOpportunity?.id ?? ""}
              required
            >
              <option value="">{t("forms.chooseOpportunity")}</option>
              {opportunities.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : lockedOpportunity ? (
          <div className="sm:col-span-2">
            <p className="nesto-eyebrow text-fg-subtle">{t("forms.opportunity")}</p>
            <p className="mt-0.5 text-table text-fg">{lockedOpportunity.name}</p>
          </div>
        ) : null}

        <Field label={t("forms.currency")} name="currency" required>
          <FormSelect
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
          </FormSelect>
        </Field>

        <Field label={t("forms.issueDate")} name="issueDate" required>
          <Input
            id="issueDate"
            name="issueDate"
            type="date"
            defaultValue={values?.issueDate ?? today}
            required
          />
        </Field>

        <Field label={t("forms.validUntil")} name="validUntil" hint={t("forms.validUntilHint")}>
          <Input
            id="validUntil"
            name="validUntil"
            type="date"
            defaultValue={values?.validUntil ?? ""}
          />
        </Field>
      </FormSection>

      <PricedLineItems currency={currency} defaultLines={values?.lineItems} />

      <FormSection title={t("forms.notes")} description={t("forms.notesDescription")}>
        <Field label={t("forms.notes")} name="notes" className="sm:col-span-2">
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
