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
import { useFinanceTranslations } from "@/components/finance/finance-text";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { localToday } from "./local-date";
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import { PricedLineItems, type PricedLineValue } from "./line-items-field";

export type InvoiceFormValues = {
  invoiceNumber: string;
  clientId: string;
  projectId: string | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  notes: string | null;
  lineItems: PricedLineValue[];
};

/**
 * Create and edit an invoice (PRD #15 §56, §57).
 *
 * Choosing a project preselects its client, because an invoice must bill the
 * project's own client and the server refuses any other pairing (PRD #15 §50).
 * That is a convenience here; the rule lives in the service.
 *
 * Dependent fields (AUD-09 §5, FV-08): a project change keeps the client when
 * it is the project's own and otherwise sets it, saying so; a client change
 * keeps the project when it belongs to that client and otherwise clears it,
 * saying so. Nothing changes silently.
 *
 * A saved link the pickers no longer offer (an archived project or client) is
 * kept as an option labelled as such, so saving an edit does not quietly erase
 * it (FV-10); it is not offered on a new invoice.
 *
 * Dates are calendar dates (FV-07): the defaults are the company's today (from
 * the page) and today plus the payment terms, and the due date may not fall
 * before the issue date — the browser checks it, the server enforces it.
 */
export function InvoiceForm({
  action,
  clients,
  projects,
  values,
  autoNumbered,
  defaultTaxRate,
  defaultPaymentTermsDays,
  defaultCurrency = "EUR",
  today,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  clients: SelectOption[];
  projects: { value: string; label: string; clientId: string | null }[];
  values?: InvoiceFormValues;
  /** True when the company's scheme numbers invoices itself (PRD #24 §114). */
  autoNumbered: boolean;
  defaultTaxRate: string | null;
  defaultPaymentTermsDays: number;
  /** The company's base currency: the default for a new invoice. */
  defaultCurrency?: string;
  /** The company's calendar today (`companyToday`); the browser's local day when absent. */
  today?: string;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const t = useFinanceTranslations();
  const startDay = today ?? localToday();
  const [currency, setCurrency] = React.useState(values?.currency || defaultCurrency);
  const [clientId, setClientId] = React.useState(values?.clientId ?? "");
  const [projectId, setProjectId] = React.useState(values?.projectId ?? "");
  const [issueDate, setIssueDate] = React.useState(values?.issueDate || startDay);
  const [dueDate, setDueDate] = React.useState(
    values?.dueDate || addDays(values?.issueDate || startDay, defaultPaymentTermsDays),
  );
  const [linkNote, setLinkNote] = React.useState<string | null>(null);

  // A saved link the pickers no longer offer stays selectable on this record
  // only, so an edit never erases it by omission (FV-10).
  const projectOptions = React.useMemo(() => {
    const saved = values?.projectId;
    if (!saved || projects.some((project) => project.value === saved)) return projects;
    return [...projects, { value: saved, label: t("invoiceForm.currentProject"), clientId: values?.clientId ?? null }];
  }, [projects, values?.projectId, values?.clientId, t]);
  const clientOptions = React.useMemo(() => {
    const saved = values?.clientId;
    if (!saved || clients.some((client) => client.value === saved)) return clients;
    return [...clients, { value: saved, label: t("invoiceForm.currentClient") }];
  }, [clients, values?.clientId, t]);

  function onProjectChange(next: string) {
    setProjectId(next);
    const project = projectOptions.find((entry) => entry.value === next);
    if (project?.clientId && project.clientId !== clientId) {
      setClientId(project.clientId);
      const label = clientOptions.find((client) => client.value === project.clientId)?.label;
      setLinkNote(t("invoiceForm.clientSet", { client: label ?? t("invoiceForm.projectsClient") }));
    } else {
      setLinkNote(null);
    }
  }

  function onClientChange(next: string) {
    setClientId(next);
    const project = projectOptions.find((entry) => entry.value === projectId);
    if (project?.clientId && project.clientId !== next) {
      setProjectId("");
      setLinkNote(t("invoiceForm.projectCleared", { project: project.label }));
    } else {
      setLinkNote(null);
    }
  }

  const dueBeforeIssue = Boolean(issueDate && dueDate && dueDate < issueDate);

  return (
    <RecordForm
      action={action}
      module="finance"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection title={t("invoiceForm.details")} description={t("invoiceForm.detailsHint")}>
        {/*
          * Not asked for when the company numbers invoices automatically: the
          * service allocates under a row lock and would discard anything typed
          * here, and a field whose value is thrown away is worse than no field
          * (PRD #24 §114).
          */}
        {autoNumbered ? (
          <Field label={t("invoiceForm.number")} name="invoiceNumber">
            <p className="text-body text-fg-muted">
              {values?.invoiceNumber ?? t("invoiceForm.autoNumber")}
            </p>
          </Field>
        ) : (
          <Field label={t("invoiceForm.number")} name="invoiceNumber" required>
            <Input
              id="invoiceNumber"
              name="invoiceNumber"
              required
              maxLength={60}
              defaultValue={values?.invoiceNumber ?? ""}
              placeholder="INV-2026-015"
            />
          </Field>
        )}

        <Field label={t("invoiceForm.currency")} name="currency" required>
          <select
            id="currency"
            name="currency"
            className={selectClass}
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("invoiceForm.project")} name="projectId" hint={t("invoiceForm.projectHint")}>
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            value={projectId}
            aria-describedby={linkNote ? "invoice-link-note" : undefined}
            onChange={(event) => onProjectChange(event.target.value)}
          >
            <option value="">{t("invoiceForm.noProject")}</option>
            {projectOptions.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("invoiceForm.client")} name="clientId" required>
          <select
            id="clientId"
            name="clientId"
            className={selectClass}
            required
            value={clientId}
            aria-describedby={linkNote ? "invoice-link-note" : undefined}
            onChange={(event) => onClientChange(event.target.value)}
          >
            <option value="" disabled>
              {clientOptions.length === 0 ? t("invoiceForm.noClients") : t("invoiceForm.chooseClient")}
            </option>
            {clientOptions.map((client) => (
              <option key={client.value} value={client.value}>
                {client.label}
              </option>
            ))}
          </select>
        </Field>

        {linkNote ? (
          <p id="invoice-link-note" role="status" className="text-meta text-fg-muted sm:col-span-2">
            {linkNote}
          </p>
        ) : null}

        <Field label={t("invoiceForm.issueDate")} name="issueDate" required>
          <Input
            id="issueDate"
            name="issueDate"
            type="date"
            required
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
          />
        </Field>

        <Field
          label={t("invoiceForm.dueDate")}
          name="dueDate"
          required
          hint={
            dueBeforeIssue
              ? undefined
              : t("invoiceForm.dueHint", { days: defaultPaymentTermsDays })
          }
        >
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            required
            min={issueDate}
            value={dueDate}
            aria-invalid={dueBeforeIssue || undefined}
            aria-describedby={dueBeforeIssue ? "dueDate-order" : undefined}
            onChange={(event) => setDueDate(event.target.value)}
          />
          {dueBeforeIssue ? (
            <p id="dueDate-order" className="text-meta text-danger-strong">
              {t("invoiceForm.dueBeforeIssue")}
            </p>
          ) : null}
        </Field>
      </FormSection>

      <PricedLineItems
        currency={currency}
        defaultLines={values?.lineItems}
        defaultTaxRate={defaultTaxRate}
      />

      <FormSection title={t("invoiceForm.notes")} description={t("invoiceForm.notesHint")}>
        <Field label={t("invoiceForm.notes")} name="notes" className="sm:col-span-2">
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={values?.notes ?? ""}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
