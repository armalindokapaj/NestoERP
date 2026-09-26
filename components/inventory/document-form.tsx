"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentFormOptions } from "@/lib/modules/inventory/inventory.options";
import {
  ADJUSTMENT_REASONS,
  adjustmentReasonLabels,
} from "@/lib/modules/inventory/inventory.status";
import { StockLinesEditor, type HeldBalance, type StockLineValue } from "./stock-lines";

/**
 * The five stock-document forms (PRD #20 §309–§318).
 *
 * They share one component because they are the same act with different
 * directions: a header saying where and when, then lines saying what and how
 * much. Only the header fields and the line variant differ.
 *
 * Nothing here posts anything. Every form saves a draft, and posting is a
 * separate, confirmed action on the record page — writing a delivery note down
 * and committing it to the ledger are different acts, often by different
 * people (PRD #20 §281).
 */

export type DocumentKind = "receipts" | "issues" | "returns" | "transfers" | "adjustments";

export type DocumentFormValues = {
  warehouseId?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  projectId?: string;
  issuedToMemberId?: string;
  requestedByMemberId?: string;
  returnedByMemberId?: string;
  reason?: string;
  date?: string;
  notes?: string;
  lines?: StockLineValue[];
};

const DATE_FIELD: Record<DocumentKind, string> = {
  receipts: "receiptDate",
  issues: "issueDate",
  returns: "returnDate",
  transfers: "transferDate",
  adjustments: "adjustmentDate",
};

const DATE_LABEL: Record<DocumentKind, string> = {
  receipts: "Received on",
  issues: "Issued on",
  returns: "Returned on",
  transfers: "Transferred on",
  adjustments: "Adjusted on",
};

const HEADER: Record<DocumentKind, { title: string; description: string }> = {
  receipts: {
    title: "Receipt",
    description: "Material arriving into stock. Save it as a draft, then post it to commit it.",
  },
  issues: {
    title: "Issue",
    description: "Material leaving stock for a project or for general use.",
  },
  returns: {
    title: "Return",
    description: "Unused material coming back from a project into stock.",
  },
  transfers: {
    title: "Transfer",
    description:
      "Material moving between locations. The company holds the same total either way.",
  },
  adjustments: {
    title: "Adjustment",
    description:
      "A correction to what the company believes it holds, without anything physically moving.",
  },
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DocumentForm({
  kind,
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  options,
  balances,
}: {
  kind: DocumentKind;
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: DocumentFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  options: DocumentFormOptions;
  balances: HeldBalance[];
}) {
  const [warehouseId, setWarehouseId] = React.useState(values?.warehouseId ?? "");
  const [fromWarehouseId, setFromWarehouseId] = React.useState(values?.fromWarehouseId ?? "");
  const [toWarehouseId, setToWarehouseId] = React.useState(values?.toWarehouseId ?? "");

  const header = HEADER[kind];
  const variant =
    kind === "transfers" ? "transfer" : kind === "adjustments" ? "adjustment" : "simple";

  return (
    <RecordForm
      action={action}
      module="inventory"
      // "Save draft" on a new document creates it (AUD-03 §3).
      saveKind={versionUpdatedAt ? "save" : "create"}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection title={header.title} description={header.description}>
        {kind === "transfers" ? (
          <>
            <Field label="From warehouse" name="fromWarehouseId" required>
              <select
                id="fromWarehouseId"
                name="fromWarehouseId"
                className={selectClass}
                value={fromWarehouseId}
                onChange={(event) => setFromWarehouseId(event.target.value)}
                required
              >
                <option value="">Choose a warehouse</option>
                {options.warehouses.map((warehouse) => (
                  <option key={warehouse.value} value={warehouse.value}>
                    {warehouse.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="To warehouse" name="toWarehouseId" required>
              <select
                id="toWarehouseId"
                name="toWarehouseId"
                className={selectClass}
                value={toWarehouseId}
                onChange={(event) => setToWarehouseId(event.target.value)}
                required
              >
                <option value="">Choose a warehouse</option>
                {options.warehouses.map((warehouse) => (
                  <option key={warehouse.value} value={warehouse.value}>
                    {warehouse.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <Field
            label={kind === "returns" ? "Back into warehouse" : "Warehouse"}
            name="warehouseId"
            required
          >
            <select
              id="warehouseId"
              name="warehouseId"
              className={selectClass}
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              required
            >
              <option value="">Choose a warehouse</option>
              {options.warehouses.map((warehouse) => (
                <option key={warehouse.value} value={warehouse.value}>
                  {warehouse.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label={DATE_LABEL[kind]} name={DATE_FIELD[kind]} required>
          <Input
            id={DATE_FIELD[kind]}
            name={DATE_FIELD[kind]}
            type="date"
            defaultValue={values?.date ?? today()}
            required
          />
        </Field>

        {kind === "issues" ? (
          <>
            <Field
              label="Project"
              name="projectId"
              hint="Leave blank for a general issue not charged to a project."
            >
              <select
                id="projectId"
                name="projectId"
                className={selectClass}
                defaultValue={values?.projectId ?? ""}
              >
                <option value="">General issue</option>
                {options.projects.map((project) => (
                  <option key={project.value} value={project.value}>
                    {project.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Issued to" name="issuedToMemberId">
              <select
                id="issuedToMemberId"
                name="issuedToMemberId"
                className={selectClass}
                defaultValue={values?.issuedToMemberId ?? ""}
              >
                <option value="">Not recorded</option>
                {options.members.map((member) => (
                  <option key={member.value} value={member.value}>
                    {member.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Requested by" name="requestedByMemberId">
              <select
                id="requestedByMemberId"
                name="requestedByMemberId"
                className={selectClass}
                defaultValue={values?.requestedByMemberId ?? ""}
              >
                <option value="">Not recorded</option>
                {options.members.map((member) => (
                  <option key={member.value} value={member.value}>
                    {member.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}

        {kind === "returns" ? (
          <>
            <Field label="From project" name="projectId" required>
              <select
                id="projectId"
                name="projectId"
                className={selectClass}
                defaultValue={values?.projectId ?? ""}
                required
              >
                <option value="">Choose a project</option>
                {options.projects.map((project) => (
                  <option key={project.value} value={project.value}>
                    {project.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Returned by" name="returnedByMemberId">
              <select
                id="returnedByMemberId"
                name="returnedByMemberId"
                className={selectClass}
                defaultValue={values?.returnedByMemberId ?? ""}
              >
                <option value="">Not recorded</option>
                {options.members.map((member) => (
                  <option key={member.value} value={member.value}>
                    {member.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}

        {kind === "adjustments" ? (
          <Field
            label="Reason"
            name="reason"
            required
            hint="An opening balance is the one reason allowed to create stock from nothing."
          >
            <select
              id="reason"
              name="reason"
              className={selectClass}
              defaultValue={values?.reason ?? "PHYSICAL_COUNT"}
              required
            >
              {ADJUSTMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {adjustmentReasonLabels[reason]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Notes" name="notes" className="sm:col-span-2">
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={values?.notes ?? ""}
            maxLength={2000}
          />
        </Field>
      </FormSection>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Lines</h2>
        <p className="mt-1 text-meta text-fg-subtle">
          {kind === "adjustments"
            ? "A negative change writes stock off. Nothing moves until you post."
            : "Each line is one item in one location. Nothing moves until you post."}
        </p>
        <div className="mt-4">
          <StockLinesEditor
            variant={variant}
            initial={values?.lines}
            items={options.items}
            locations={options.locations}
            balances={balances}
            warehouseId={warehouseId || undefined}
            fromWarehouseId={fromWarehouseId || undefined}
            toWarehouseId={toWarehouseId || undefined}
          />
        </div>
      </section>
    </RecordForm>
  );
}
