"use client";

import { RelationSelector } from "@/components/forms/relation-selector";
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
import { useSalesTranslations } from "@/components/sales/sales-text";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { currencyOptions, formatAmount } from "@/lib/modules/finance/finance.currency";
import { OPEN_STAGE_VALUES } from "@/lib/modules/sales/opportunities/opportunity.schema";
import {
  getDefaultStageProbability,
  opportunityStageLabels,
} from "@/lib/modules/sales/opportunities/opportunity.stage";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useSalesTranslations();
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
      <FormSection title={t("forms.opportunityTitle")} description={t("forms.opportunityRunDescription")}>
        <Field label={t("forms.name")} name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("forms.owner")} name="ownerMemberId" required>
          <FormSelect
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={values?.ownerMemberId ?? ""}
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

        <Field label={t("forms.stage")} name="stage" required>
          <FormSelect
            id="stage"
            name="stage"
            className={selectClass}
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            {OPEN_STAGE_VALUES.map((option) => (
              <option key={option} value={option}>
                {salesLabel(t, "stage", option, opportunityStageLabels[option])} · {getDefaultStageProbability(option)}%
              </option>
            ))}
          </FormSelect>
        </Field>
      </FormSection>

      <FormSection
        title={t("forms.clientTitle")}
        description={t("forms.clientEarlyDescription")}
      >
        <Field label={t("forms.clientTitle")} name="clientId">
          {/* A searchable sheet, not a long native dropdown (MOB-04 §30, §31); clearing it is "no client yet". */}
          <RelationSelector
            name="clientId"
            label={t("forms.clientTitle")}
            id="clientId"
            value={clientId}
            selected={clients.find((client) => client.value === clientId) ?? null}
            options={clients.map((client) => ({ value: client.value, label: client.label }))}
            placeholder={t("forms.noClientYet")}
            onChange={(option) => setClientId(option?.value ?? "")}
          />
        </Field>

        <Field
          label={t("forms.contact")}
          name="contactId"
          hint={clientId ? undefined : t("forms.chooseClientFirst")}
        >
          <FormSelect
            id="contactId"
            name="contactId"
            className={selectClass}
            defaultValue={values?.contactId ?? ""}
            disabled={contacts.length === 0}
          >
            <option value="">{t("forms.noContact")}</option>
            {contacts.map((contact) => (
              <option key={contact.value} value={contact.value}>
                {contact.label}
              </option>
            ))}
          </FormSelect>
        </Field>
      </FormSection>

      <FormSection title={t("forms.commercialTitle")} description={t("forms.commercialDescription")}>
        <Field label={t("forms.estimatedValue")} name="estimatedValue" required>
          <Input
            id="estimatedValue"
            name="estimatedValue"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </Field>

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

        <Field
          label={t("forms.probabilityOverride")}
          name="probabilityOverride"
          hint={t("forms.probabilityHint", { percent: getDefaultStageProbability(stage as (typeof OPEN_STAGE_VALUES)[number]) })}
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
              t("forms.enterValue")
            ) : (
              <>
                <span className="font-semibold tabular-nums text-fg">
                  {formatAmount(weighted, currency)}
                </span>{" "}
                {t("forms.weightedAt", { percent: probability ?? "" })}
              </>
            )}
          </p>
        </div>

        <Field label={t("forms.expectedClose")} name="expectedCloseDate">
          <Input
            id="expectedCloseDate"
            name="expectedCloseDate"
            type="date"
            defaultValue={values?.expectedCloseDate ?? ""}
          />
        </Field>

        <Field label={t("forms.nextStep")} name="nextStep" hint={t("forms.nextStepHint")}>
          <Input
            id="nextStep"
            name="nextStep"
            defaultValue={values?.nextStep ?? ""}
            maxLength={500}
          />
        </Field>

        <Field label={t("forms.description")} name="description" className="sm:col-span-2">
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
