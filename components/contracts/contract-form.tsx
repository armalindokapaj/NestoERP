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
import { Textarea } from "@/components/ui/textarea";
import { currencyOptions } from "@/lib/modules/finance/finance.currency";
import {
  CONTRACT_TYPES,
  RENEWAL_TYPES,
  contractTypeLabels,
} from "@/lib/modules/contracts/contracts/contract.schema";
import { renewalTypeLabels } from "@/lib/modules/contracts/contracts/contract.status";

export type ContractFormValues = {
  contractNumber: string;
  title: string;
  contractType: string;
  ownerMemberId: string;
  clientId: string | null;
  projectId: string | null;
  opportunityId: string | null;
  proposalId: string | null;
  counterpartyName: string | null;
  currency: string | null;
  contractValue: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  signedDate: string | null;
  renewalType: string;
  renewalNoticeDays: string | null;
  autoRenewalPeriodMonths: string | null;
  governingLaw: string | null;
  jurisdiction: string | null;
  summary: string | null;
  commercialNotes: string | null;
  legalNotes: string | null;
};

/**
 * Create and edit a contract (PRD #18 §95–§98, §357).
 *
 * The renewal fields appear and disappear with the renewal type, because "notice
 * days" on a contract that does not renew is a question with no answer. The
 * server validates the same combinations again — this is a courtesy, not the
 * rule (PRD #18 §275).
 *
 * The commercial and confidential sections render only for a reader who holds
 * the grant behind them. A form that shows an empty "Legal notes" box to
 * somebody who cannot read legal notes would silently blank the field on save
 * (PRD #18 §22, §23).
 */
export function ContractForm({
  action,
  owners,
  clients,
  projects,
  opportunities,
  proposals,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  canEditCommercial,
  canEditConfidential,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  owners: SelectOption[];
  clients: SelectOption[];
  projects: SelectOption[];
  opportunities: SelectOption[];
  proposals: SelectOption[];
  values?: ContractFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  canEditCommercial: boolean;
  canEditConfidential: boolean;
}) {
  const [renewalType, setRenewalType] = React.useState(values?.renewalType ?? "NONE");
  const [contractValue, setContractValue] = React.useState(values?.contractValue ?? "");

  const renews = renewalType !== "NONE";
  const autoRenews = renewalType === "AUTO_RENEW";
  const valued = contractValue.trim() !== "";

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection title="Contract" description="What the agreement is, and who answers for it.">
        <Field label="Contract number" name="contractNumber" required>
          <Input
            id="contractNumber"
            name="contractNumber"
            defaultValue={values?.contractNumber ?? ""}
            required
            maxLength={80}
          />
        </Field>

        <Field label="Contract type" name="contractType" required>
          <select
            id="contractType"
            name="contractType"
            className={selectClass}
            defaultValue={values?.contractType ?? "CLIENT_AGREEMENT"}
          >
            {CONTRACT_TYPES.map((type) => (
              <option key={type} value={type}>
                {contractTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={250} />
        </Field>

        <Field
          label="Owner"
          name="ownerMemberId"
          required
          hint="The internal record owner. Ownership is not permission."
        >
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

        <Field
          label="Counterparty"
          name="counterpartyName"
          hint="The legal entity on the other side, as it appears in the agreement."
        >
          <Input
            id="counterpartyName"
            name="counterpartyName"
            defaultValue={values?.counterpartyName ?? ""}
            maxLength={250}
          />
        </Field>
      </FormSection>

      <FormSection
        title="Client and project"
        description="Both optional. An NDA or a lease may have neither."
      >
        <Field label="Client" name="clientId">
          <select
            id="clientId"
            name="clientId"
            className={selectClass}
            defaultValue={values?.clientId ?? ""}
          >
            <option value="">No client</option>
            {clients.map((client) => (
              <option key={client.value} value={client.value}>
                {client.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Project" name="projectId">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      {opportunities.length > 0 || proposals.length > 0 ? (
        <FormSection
          title="Sales source"
          description="Where the agreement came from. Lineage only — it changes nothing about the contract."
        >
          <Field label="Opportunity" name="opportunityId">
            <select
              id="opportunityId"
              name="opportunityId"
              className={selectClass}
              defaultValue={values?.opportunityId ?? ""}
            >
              <option value="">No opportunity</option>
              {opportunities.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Proposal" name="proposalId">
            <select
              id="proposalId"
              name="proposalId"
              className={selectClass}
              defaultValue={values?.proposalId ?? ""}
            >
              <option value="">No proposal</option>
              {proposals.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>
      ) : null}

      {canEditCommercial ? (
        <FormSection
          title="Commercial terms"
          description="A value needs a currency. Totals are never added across currencies."
        >
          <Field label="Contract value" name="contractValue">
            <Input
              id="contractValue"
              name="contractValue"
              inputMode="decimal"
              value={contractValue}
              onChange={(event) => setContractValue(event.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field label="Currency" name="currency" required={valued}>
            <select
              id="currency"
              name="currency"
              className={selectClass}
              defaultValue={values?.currency ?? ""}
            >
              <option value="">No currency</option>
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Commercial notes" name="commercialNotes" className="sm:col-span-2">
            <Textarea
              id="commercialNotes"
              name="commercialNotes"
              rows={3}
              maxLength={5000}
              defaultValue={values?.commercialNotes ?? ""}
            />
          </Field>
        </FormSection>
      ) : null}

      <FormSection title="Dates" description="Expiry may be left empty for an open-ended agreement.">
        <Field label="Effective date" name="effectiveDate">
          <Input
            id="effectiveDate"
            name="effectiveDate"
            type="date"
            defaultValue={values?.effectiveDate ?? ""}
          />
        </Field>

        <Field label="Expiry date" name="expiryDate">
          <Input
            id="expiryDate"
            name="expiryDate"
            type="date"
            defaultValue={values?.expiryDate ?? ""}
          />
        </Field>

        <Field
          label="Signed date"
          name="signedDate"
          hint="An agreement is often signed after it takes effect. Either order is accepted."
        >
          <Input
            id="signedDate"
            name="signedDate"
            type="date"
            defaultValue={values?.signedDate ?? ""}
          />
        </Field>
      </FormSection>

      <FormSection title="Renewal" description="What happens when the term runs out.">
        <Field label="Renewal type" name="renewalType" required>
          <select
            id="renewalType"
            name="renewalType"
            className={selectClass}
            value={renewalType}
            onChange={(event) => setRenewalType(event.target.value)}
          >
            {RENEWAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {renewalTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>

        {renews ? (
          <Field
            label="Notice days"
            name="renewalNoticeDays"
            hint="How far ahead of expiry the renewal conversation has to start."
          >
            <Input
              id="renewalNoticeDays"
              name="renewalNoticeDays"
              type="number"
              min={0}
              max={3650}
              defaultValue={values?.renewalNoticeDays ?? ""}
            />
          </Field>
        ) : null}

        {autoRenews ? (
          <Field label="Renewal period (months)" name="autoRenewalPeriodMonths" required>
            <Input
              id="autoRenewalPeriodMonths"
              name="autoRenewalPeriodMonths"
              type="number"
              min={1}
              max={120}
              defaultValue={values?.autoRenewalPeriodMonths ?? ""}
            />
          </Field>
        ) : null}
      </FormSection>

      <FormSection title="Legal terms" description="Free text. There is no jurisdiction engine.">
        <Field label="Governing law" name="governingLaw">
          <Input
            id="governingLaw"
            name="governingLaw"
            defaultValue={values?.governingLaw ?? ""}
            maxLength={200}
            placeholder="Law of Albania"
          />
        </Field>

        <Field label="Jurisdiction" name="jurisdiction">
          <Input
            id="jurisdiction"
            name="jurisdiction"
            defaultValue={values?.jurisdiction ?? ""}
            maxLength={200}
            placeholder="Tirana, Albania"
          />
        </Field>

        <Field label="Summary" name="summary" className="sm:col-span-2">
          <Textarea
            id="summary"
            name="summary"
            rows={3}
            maxLength={5000}
            defaultValue={values?.summary ?? ""}
          />
        </Field>

        {canEditConfidential ? (
          <Field
            label="Legal notes"
            name="legalNotes"
            className="sm:col-span-2"
            hint="Confidential. Visible only with the confidential-terms permission."
          >
            <Textarea
              id="legalNotes"
              name="legalNotes"
              rows={3}
              maxLength={5000}
              defaultValue={values?.legalNotes ?? ""}
            />
          </Field>
        ) : null}
      </FormSection>
    </RecordForm>
  );
}

/**
 * The correction an approved contract still allows (PRD #18 §107).
 *
 * A separate, deliberately small form: owner and internal summary. Everything
 * else is a term of the agreement, and a term changes by amendment.
 */
export function ContractMetadataForm({
  action,
  owners,
  values,
  versionUpdatedAt,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  owners: SelectOption[];
  values: { ownerMemberId: string; summary: string | null };
  versionUpdatedAt?: string;
  cancelHref: string;
}) {
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel="Save changes"
      pendingLabel="Saving…"
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Record details"
        description="This contract is approved, so its terms change by amendment. The owner and the internal summary can still be corrected."
      >
        <Field label="Owner" name="ownerMemberId" required>
          <select
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={values.ownerMemberId}
            required
          >
            {owners.map((owner) => (
              <option key={owner.value} value={owner.value}>
                {owner.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Summary" name="summary" className="sm:col-span-2">
          <Textarea
            id="summary"
            name="summary"
            rows={4}
            maxLength={5000}
            defaultValue={values.summary ?? ""}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
