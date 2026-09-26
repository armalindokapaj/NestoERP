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
 */
export function InvoiceForm({
  action,
  clients,
  projects,
  values,
  autoNumbered,
  defaultTaxRate,
  defaultPaymentTermsDays,
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
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [currency, setCurrency] = React.useState(values?.currency ?? "EUR");
  const [clientId, setClientId] = React.useState(values?.clientId ?? "");
  const [projectId, setProjectId] = React.useState(values?.projectId ?? "");
  const [issueDate, setIssueDate] = React.useState(values?.issueDate ?? today());
  const [dueDate, setDueDate] = React.useState(
    values?.dueDate ?? addDays(today(), defaultPaymentTermsDays),
  );

  function onProjectChange(next: string) {
    setProjectId(next);
    const project = projects.find((entry) => entry.value === next);
    if (project?.clientId) setClientId(project.clientId);
  }

  return (
    <RecordForm
      action={action}
      module="finance"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection title="Invoice details" description="Who is being billed, and for what.">
        {/*
          * Not asked for when the company numbers invoices automatically: the
          * service allocates under a row lock and would discard anything typed
          * here, and a field whose value is thrown away is worse than no field
          * (PRD #24 §114).
          */}
        {autoNumbered ? (
          <Field label="Invoice number" name="invoiceNumber">
            <p className="text-body text-fg-muted">
              {values?.invoiceNumber ?? "Allocated automatically when the invoice is saved."}
            </p>
          </Field>
        ) : (
          <Field label="Invoice number" name="invoiceNumber" required>
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

        <Field label="Currency" name="currency" required>
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

        <Field label="Project" name="projectId" hint="Optional. Selecting one fixes the client.">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            value={projectId}
            onChange={(event) => onProjectChange(event.target.value)}
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Client" name="clientId" required>
          <select
            id="clientId"
            name="clientId"
            className={selectClass}
            required
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="" disabled>
              Choose a client
            </option>
            {clients.map((client) => (
              <option key={client.value} value={client.value}>
                {client.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Issue date" name="issueDate" required>
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
          label="Due date"
          name="dueDate"
          required
          hint={`Default terms: ${defaultPaymentTermsDays} days.`}
        >
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            required
            min={issueDate}
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>
      </FormSection>

      <PricedLineItems
        currency={currency}
        defaultLines={values?.lineItems}
        defaultTaxRate={defaultTaxRate}
      />

      <FormSection title="Notes" description="Shown on the invoice record, not on a document.">
        <Field label="Notes" name="notes" className="sm:col-span-2">
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
