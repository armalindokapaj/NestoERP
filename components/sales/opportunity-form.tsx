"use client";

import * as React from "react";
import { percentOfDecimal, previewDecimal } from "@/lib/modules/finance/finance.decimal";

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
import { currencyOptions, formatAmount } from "@/lib/modules/finance/finance.currency";
import { OPEN_STAGE_VALUES } from "@/lib/modules/sales/opportunities/opportunity.schema";
import {
  getDefaultStageProbability,
  opportunityStageLabels,
} from "@/lib/modules/sales/opportunities/opportunity.stage";

export type OpportunityFormValues = {
  name: string;
  ownerMemberId: string;
  stage: string;
  estimatedValue: string;
  currency: string;
  clientId: string | null;
  contactId: string | null;
  expectedCloseDate: string | null;
  probabilityOverride: string | null;
  description: string | null;
  nextStep: string | null;
};

export type ClientOption = SelectOption & { contacts: SelectOption[] };

/**
 * Create and edit an opportunity (PRD #17 §76, §77, §408).
 *
 * Two things happen in the browser purely as a courtesy. The weighted preview
 * shows what the stage and probability imply, and the contact list narrows to
 * the chosen client's own contacts. Both are recomputed on the server before
 * anything is stored, and the contact/client pairing is refused there if it does
 * not hold (PRD #17 §65, §219, §224).
 */
export function OpportunityForm({
  action,
  owners,
  clients,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  owners: SelectOption[];
  clients: ClientOption[];
  values?: OpportunityFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [stage, setStage] = React.useState(values?.stage ?? "PROSPECTING");
  const [value, setValue] = React.useState(values?.estimatedValue ?? "");
  const [currency, setCurrency] = React.useState(values?.currency ?? "EUR");
  const [override, setOverride] = React.useState(values?.probabilityOverride ?? "");
  const [clientId, setClientId] = React.useState(values?.clientId ?? "");

  // Exact preview by the shared decimal rule (AUD-09 §4, FV-06): nothing is
  // shown for a figure the server would refuse ("12abc" used to preview as 12).
  const probability =
    override.trim() === ""
      ? String(getDefaultStageProbability(stage as (typeof OPEN_STAGE_VALUES)[number]))
      : previewDecimal(override, 2);

  const amount = previewDecimal(value, 2);
  const weighted = amount !== null && probability !== null ? percentOfDecimal(amount, probability) : null;

  const contacts = clients.find((client) => client.value === clientId)?.contacts ?? [];

  return (
    <RecordForm
      action={action}
      module="sales"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection title="Opportunity" description="The deal, and who is running it.">
        <Field label="Name" name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field label="Owner" name="ownerMemberId" required>
          <select
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={values?.ownerMemberId ?? ""}
            required
          >
            <option value="">Choose an owner</option>
            {owners.map((owner) => (
              <option key={owner.value} value={owner.value}>
                {owner.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Stage" name="stage" required>
          <select
            id="stage"
            name="stage"
            className={selectClass}
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            {OPEN_STAGE_VALUES.map((option) => (
              <option key={option} value={option}>
                {opportunityStageLabels[option]} · {getDefaultStageProbability(option)}%
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="Client"
        description="Optional while the deal is early. A won deal needs one."
      >
        <Field label="Client" name="clientId">
          <select
            id="clientId"
            name="clientId"
            className={selectClass}
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="">No client yet</option>
            {clients.map((client) => (
              <option key={client.value} value={client.value}>
                {client.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Contact"
          name="contactId"
          hint={clientId ? undefined : "Choose a client first."}
        >
          <select
            id="contactId"
            name="contactId"
            className={selectClass}
            defaultValue={values?.contactId ?? ""}
            disabled={contacts.length === 0}
          >
            <option value="">No contact</option>
            {contacts.map((contact) => (
              <option key={contact.value} value={contact.value}>
                {contact.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Commercial" description="What it is worth, and when it should close.">
        <Field label="Estimated value" name="estimatedValue" required>
          <Input
            id="estimatedValue"
            name="estimatedValue"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </Field>

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

        <Field
          label="Probability override"
          name="probabilityOverride"
          hint={`Leave empty to use the stage default, ${getDefaultStageProbability(stage as (typeof OPEN_STAGE_VALUES)[number])}%.`}
        >
          <Input
            id="probabilityOverride"
            name="probabilityOverride"
            inputMode="decimal"
            value={override}
            onChange={(event) => setOverride(event.target.value)}
          />
        </Field>

        <div className="flex items-end">
          <p aria-live="polite" className="text-table text-fg-muted">
            {weighted === null ? (
              "Enter a value to see the weighted figure."
            ) : (
              <>
                <span className="font-semibold tabular-nums text-fg">
                  {formatAmount(weighted, currency)}
                </span>{" "}
                weighted at {probability}%
              </>
            )}
          </p>
        </div>

        <Field label="Expected close" name="expectedCloseDate">
          <Input
            id="expectedCloseDate"
            name="expectedCloseDate"
            type="date"
            defaultValue={values?.expectedCloseDate ?? ""}
          />
        </Field>

        <Field label="Next step" name="nextStep" hint="One line. Longer plans belong in a task.">
          <Input
            id="nextStep"
            name="nextStep"
            defaultValue={values?.nextStep ?? ""}
            maxLength={500}
          />
        </Field>

        <Field label="Description" name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={values?.description ?? ""}
            maxLength={5000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
