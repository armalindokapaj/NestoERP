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
import { currencyOptions } from "@/lib/modules/finance/finance.currency";
import type { LeadDuplicateMatch } from "@/lib/modules/sales/sales.types";

/**
 * Lead → Opportunity (PRD #17 §52, §159).
 *
 * The client decision is explicit, with three answers rather than two, because
 * "no client yet" is a real and common outcome: a lead may become an
 * opportunity long before anybody signs anything. What it may not do is become
 * a *won* opportunity that way (PRD #17 §159).
 */
export function ConvertLeadForm({
  action,
  owners,
  clients,
  canLinkClient,
  canCreateClient,
  defaults,
  duplicates,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  owners: SelectOption[];
  clients: SelectOption[];
  /** Linking and creating are separate permissions (PRD #17 §53, §54). */
  canLinkClient: boolean;
  canCreateClient: boolean;
  defaults: {
    opportunityName: string;
    ownerMemberId: string;
    estimatedValue: string;
    currency: string;
    newClientName: string;
  };
  duplicates?: LeadDuplicateMatch[];
  cancelHref: string;
}) {
  const [clientMode, setClientMode] = React.useState("NONE");

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel="Convert to opportunity"
      pendingLabel="Converting…"
    >
      {duplicates && duplicates.length > 0 ? (
        <section role="alert" className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3">
          <h2 className="text-table font-semibold text-warning-strong">
            A client like this already exists
          </h2>
          <ul className="mt-2 space-y-1 text-meta text-fg-muted">
            {duplicates.map((match) => (
              <li key={`${match.kind}-${match.id}`}>
                <span className="font-medium text-fg">{match.label}</span> — {match.reason}
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-table text-fg">
            <input type="checkbox" name="acceptDuplicate" value="on" defaultChecked />
            Create it anyway
          </label>
        </section>
      ) : null}

      <FormSection title="Opportunity" description="What the deal becomes once it is real.">
        <Field label="Opportunity name" name="opportunityName" required className="sm:col-span-2">
          <Input
            id="opportunityName"
            name="opportunityName"
            defaultValue={defaults.opportunityName}
            required
            maxLength={200}
          />
        </Field>

        <Field label="Owner" name="ownerMemberId" required>
          <select
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={defaults.ownerMemberId}
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

        <Field label="Expected close" name="expectedCloseDate">
          <Input id="expectedCloseDate" name="expectedCloseDate" type="date" />
        </Field>

        <Field label="Estimated value" name="estimatedValue" required>
          <Input
            id="estimatedValue"
            name="estimatedValue"
            inputMode="decimal"
            defaultValue={defaults.estimatedValue}
            required
          />
        </Field>

        <Field label="Currency" name="currency" required>
          <select
            id="currency"
            name="currency"
            className={selectClass}
            defaultValue={defaults.currency}
          >
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="Client"
        description="Optional now. A deal can be worked before the customer record exists."
      >
        <Field label="Client" name="clientMode" className="sm:col-span-2">
          <select
            id="clientMode"
            name="clientMode"
            className={selectClass}
            value={clientMode}
            onChange={(event) => setClientMode(event.target.value)}
          >
            <option value="NONE">No client yet</option>
            {canLinkClient ? <option value="EXISTING">Link an existing client</option> : null}
            {canCreateClient ? <option value="NEW">Create a new client</option> : null}
          </select>
        </Field>

        {clientMode === "EXISTING" ? (
          <Field label="Existing client" name="clientId" required className="sm:col-span-2">
            <select id="clientId" name="clientId" className={selectClass} defaultValue="">
              <option value="">Choose a client</option>
              {clients.map((client) => (
                <option key={client.value} value={client.value}>
                  {client.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {clientMode === "NEW" ? (
          <Field
            label="New client name"
            name="newClientName"
            required
            className="sm:col-span-2"
            hint="Created through the Clients module, with the lead's contact details."
          >
            <Input
              id="newClientName"
              name="newClientName"
              defaultValue={defaults.newClientName}
              maxLength={200}
            />
          </Field>
        ) : null}
      </FormSection>
    </RecordForm>
  );
}
