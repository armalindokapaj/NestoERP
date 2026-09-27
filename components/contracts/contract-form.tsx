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
  FORM_CONTRACT_TYPES,
  RENEWAL_TYPES,
  contractTypeLabels,
} from "@/lib/modules/contracts/contracts/contract.schema";
import { renewalTypeLabels } from "@/lib/modules/contracts/contracts/contract.status";
import { contractsLabel, useContractsTranslations } from "./contracts-text";

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
  const t = useContractsTranslations();
  const [renewalType, setRenewalType] = React.useState(values?.renewalType ?? "NONE");
  const [contractValue, setContractValue] = React.useState(values?.contractValue ?? "");

  const renews = renewalType !== "NONE";
  const autoRenews = renewalType === "AUTO_RENEW";
  const valued = contractValue.trim() !== "";

  return (
    <RecordForm
      action={action}
      module="contracts"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection title={t("form.contract")} description={t("form.contractDescription")}>
        <Field label={t("form.contractNumber")} name="contractNumber" required>
          <Input
            id="contractNumber"
            name="contractNumber"
            defaultValue={values?.contractNumber ?? ""}
            required
            maxLength={80}
          />
        </Field>

        <Field label={t("form.contractType")} name="contractType" required>
          <select
            id="contractType"
            name="contractType"
            className={selectClass}
            defaultValue={values?.contractType ?? "CLIENT_AGREEMENT"}
          >
            {/* A sale agreement is drafted from its unit; an existing one keeps its type (E-05F §12). */}
            {(values?.contractType === "SALE_AGREEMENT" ? CONTRACT_TYPES : FORM_CONTRACT_TYPES).map((type) => (
              <option key={type} value={type}>
                {contractsLabel(t, "contractType", type, contractTypeLabels[type])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("common.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={250} />
        </Field>

        <Field
          label={t("form.owner")}
          name="ownerMemberId"
          required
          hint={t("form.ownerHint")}
        >
          <select
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={values?.ownerMemberId ?? ""}
            required
          >
            <option value="">{t("form.chooseOwner")}</option>
            {owners.map((owner) => (
              <option key={owner.value} value={owner.value}>
                {owner.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t("form.counterparty")}
          name="counterpartyName"
          hint={t("form.counterpartyHint")}
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
        title={t("form.clientProject")}
        description={t("form.clientProjectDescription")}
      >
        <Field label={t("form.client")} name="clientId">
          <select
            id="clientId"
            name="clientId"
            className={selectClass}
            defaultValue={values?.clientId ?? ""}
          >
            <option value="">{t("form.noClient")}</option>
            {clients.map((client) => (
              <option key={client.value} value={client.value}>
                {client.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("form.project")} name="projectId">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">{t("form.noProject")}</option>
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
          title={t("form.salesSource")}
          description={t("form.salesSourceDescription")}
        >
          <Field label={t("form.opportunity")} name="opportunityId">
            <select
              id="opportunityId"
              name="opportunityId"
              className={selectClass}
              defaultValue={values?.opportunityId ?? ""}
            >
              <option value="">{t("form.noOpportunity")}</option>
              {opportunities.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("form.proposal")} name="proposalId">
            <select
              id="proposalId"
              name="proposalId"
              className={selectClass}
              defaultValue={values?.proposalId ?? ""}
            >
              <option value="">{t("form.noProposal")}</option>
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
          title={t("form.commercial")}
          description={t("form.commercialDescription")}
        >
          <Field label={t("form.contractValue")} name="contractValue">
            <Input
              id="contractValue"
              name="contractValue"
              inputMode="decimal"
              value={contractValue}
              onChange={(event) => setContractValue(event.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field label={t("form.currency")} name="currency" required={valued}>
            <select
              id="currency"
              name="currency"
              className={selectClass}
              defaultValue={values?.currency ?? ""}
            >
              <option value="">{t("form.noCurrency")}</option>
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("form.commercialNotes")} name="commercialNotes" className="sm:col-span-2">
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

      <FormSection title={t("form.dates")} description={t("form.datesDescription")}>
        <Field label={t("common.effectiveDate")} name="effectiveDate">
          <Input
            id="effectiveDate"
            name="effectiveDate"
            type="date"
            defaultValue={values?.effectiveDate ?? ""}
          />
        </Field>

        <Field label={t("form.expiryDate")} name="expiryDate">
          <Input
            id="expiryDate"
            name="expiryDate"
            type="date"
            defaultValue={values?.expiryDate ?? ""}
          />
        </Field>

        <Field
          label={t("common.signedDate")}
          name="signedDate"
          hint={t("form.signedHint")}
        >
          <Input
            id="signedDate"
            name="signedDate"
            type="date"
            defaultValue={values?.signedDate ?? ""}
          />
        </Field>
      </FormSection>

      <FormSection title={t("form.renewal")} description={t("form.renewalDescription")}>
        <Field label={t("form.renewalType")} name="renewalType" required>
          <select
            id="renewalType"
            name="renewalType"
            className={selectClass}
            value={renewalType}
            onChange={(event) => setRenewalType(event.target.value)}
          >
            {RENEWAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {contractsLabel(t, "renewalType", type, renewalTypeLabels[type])}
              </option>
            ))}
          </select>
        </Field>

        {renews ? (
          <Field
            label={t("form.noticeDays")}
            name="renewalNoticeDays"
            hint={t("form.noticeDaysHint")}
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
          <Field label={t("form.renewalPeriod")} name="autoRenewalPeriodMonths" required>
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

      <FormSection title={t("form.legalTerms")} description={t("form.legalTermsDescription")}>
        <Field label={t("form.governingLaw")} name="governingLaw">
          <Input
            id="governingLaw"
            name="governingLaw"
            defaultValue={values?.governingLaw ?? ""}
            maxLength={200}
            placeholder={t("form.governingLawPlaceholder")}
          />
        </Field>

        <Field label={t("form.jurisdiction")} name="jurisdiction">
          <Input
            id="jurisdiction"
            name="jurisdiction"
            defaultValue={values?.jurisdiction ?? ""}
            maxLength={200}
            placeholder={t("form.jurisdictionPlaceholder")}
          />
        </Field>

        <Field label={t("common.summary")} name="summary" className="sm:col-span-2">
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
            label={t("form.legalNotes")}
            name="legalNotes"
            className="sm:col-span-2"
            hint={t("form.legalNotesHint")}
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
  const t = useContractsTranslations();
  return (
    <RecordForm
      action={action}
      module="contracts"
      cancelHref={cancelHref}
      submitLabel={t("common.saveChanges")}
      pendingLabel={t("common.saving")}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title={t("form.recordDetails")}
        description={t("form.recordDetailsDescription")}
      >
        <Field label={t("form.owner")} name="ownerMemberId" required>
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

        <Field label={t("common.summary")} name="summary" className="sm:col-span-2">
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
