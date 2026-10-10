"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { WorkflowForm } from "@/components/sales/workflow-form";
import { Input } from "@/components/ui/input";
import { currencyOptions } from "@/lib/modules/finance/finance.currency";
import type { LeadDuplicateMatch } from "@/lib/modules/sales/sales.types";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useSalesTranslations();
  const [clientMode, setClientMode] = React.useState("NONE");

  return (
    // Converting is a workflow step: leaving asks Stay or Discard, never
    // converts on the person's behalf (AUD-03 §4).
    <WorkflowForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={t("forms.convertSubmit")}
      pendingLabel={t("forms.converting")}
      workflow={t("forms.convert")}
    >
      {duplicates && duplicates.length > 0 ? (
        <section role="alert" className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3">
          <h2 className="text-table font-semibold text-warning-strong">
            {t("forms.clientExists")}
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
            {t("forms.createAnyway")}
          </label>
        </section>
      ) : null}

      <FormSection title={t("forms.opportunityTitle")} description={t("forms.opportunityDescription")}>
        <Field label={t("forms.opportunityName")} name="opportunityName" required className="sm:col-span-2">
          <Input
            id="opportunityName"
            name="opportunityName"
            defaultValue={defaults.opportunityName}
            required
            maxLength={200}
          />
        </Field>

        <Field label={t("forms.owner")} name="ownerMemberId" required>
          <FormSelect
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={defaults.ownerMemberId}
            required
          >
            <option value="">{t("forms.chooseOwner")}</option>
            {owners.map((owner) => (
              <option key={owner.value} value={owner.value}>
                {owner.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("forms.expectedClose")} name="expectedCloseDate">
          <Input id="expectedCloseDate" name="expectedCloseDate" type="date" />
        </Field>

        <Field label={t("forms.estimatedValue")} name="estimatedValue" required>
          <Input
            id="estimatedValue"
            name="estimatedValue"
            inputMode="decimal"
            defaultValue={defaults.estimatedValue}
            required
          />
        </Field>

        <Field label={t("forms.currency")} name="currency" required>
          <FormSelect
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
          </FormSelect>
        </Field>
      </FormSection>

      <FormSection
        title={t("forms.clientTitle")}
        description={t("forms.clientOptionalDescription")}
      >
        <Field label={t("forms.clientTitle")} name="clientMode" className="sm:col-span-2">
          <FormSelect
            id="clientMode"
            name="clientMode"
            className={selectClass}
            value={clientMode}
            onChange={(event) => setClientMode(event.target.value)}
          >
            <option value="NONE">{t("forms.noClientYet")}</option>
            {canLinkClient ? <option value="EXISTING">{t("forms.linkExistingClient")}</option> : null}
            {canCreateClient ? <option value="NEW">{t("forms.createNewClient")}</option> : null}
          </FormSelect>
        </Field>

        {clientMode === "EXISTING" ? (
          <Field label={t("forms.existingClient")} name="clientId" required className="sm:col-span-2">
            <FormSelect id="clientId" name="clientId" className={selectClass} defaultValue="">
              <option value="">{t("forms.chooseClient")}</option>
              {clients.map((client) => (
                <option key={client.value} value={client.value}>
                  {client.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : null}

        {clientMode === "NEW" ? (
          <Field
            label={t("forms.newClientName")}
            name="newClientName"
            required
            className="sm:col-span-2"
            hint={t("forms.newClientHint")}
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
    </WorkflowForm>
  );
}
