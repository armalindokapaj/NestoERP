"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/forms/record-form";
import { formatAmount } from "@/lib/modules/finance/finance.currency";
import {
  isPositiveDecimal,
  pricedLinePreview,
  previewDecimal,
  sumDecimal,
  compareDecimal,
} from "@/lib/modules/finance/finance.decimal";
import { MONEY_RULE, RATE_RULE, TAX_RATE_RULE } from "@/lib/modules/finance/finance.fields";
import { MAX_LINE_ITEMS } from "@/lib/modules/finance/finance.form-data";
import { CellError, DecimalCell, RemovedLineNotice, useLineRows, useRowErrors } from "./line-rows";

/**
 * The priced line-item editor (PRD #15 §322, PRD #17 §409; AUD-09 §7, FV-16).
 *
 * Shared by invoices and proposals, because they are the same editor: the same
 * four fields, the same arithmetic, the same field names. Two copies would be
 * two chances for a proposal's preview and an invoice's preview to disagree
 * about the same numbers (PRD #17 §111).
 *
 * Rows keep a local id (`useLineRows`); inputs are named by their position at
 * submit in the canonical path (`lineItems.0.description`), which a plain HTML
 * form still submits and the server reads by index. The server's per-line
 * errors come back under those paths and are put on the row that was
 * submitted there, whatever happens to the rows afterwards.
 *
 * The running total is a *preview*, in exact decimal arithmetic and in the
 * server's own order (line subtotal rounded, tax on the rounded subtotal): what
 * is shown agrees with what will be stored, but the server recalculates every
 * figure before anything is stored (PRD #15 §52, AUD-01).
 *
 * Below the desktop width each line is a stacked, labelled card (AUD-04 §5,
 * MW-08, D-02-04): "Line N" and its remove control on top, the description
 * full width, then quantity, unit price, tax and the line's total two or four
 * to a row — wide enough to show a 4-decimal price or a 7-digit amount. The
 * twelve-column row returns at `lg`, where a column is wide enough for it.
 * Removing a line is announced and can be undone (D-02-06).
 */

export type PricedLineValue = {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};

const EMPTY_LINE: PricedLineValue = {
  description: "",
  quantity: "1",
  unitPrice: "0",
  taxRate: "20",
};

const positiveQuantity = (value: string) => (isPositiveDecimal(value) ? null : "Quantity must be greater than zero");
const taxRateInRange = (value: string) => (compareDecimal(value, "100") <= 0 ? null : "Tax rate must be between 0 and 100");

export function PricedLineItems({
  currency,
  defaultLines,
  defaultTaxRate,
}: {
  currency: string;
  defaultLines?: PricedLineValue[];
  defaultTaxRate?: string | null;
}) {
  const instance = React.useId();
  const empty = React.useCallback(
    () => ({ ...EMPTY_LINE, taxRate: defaultTaxRate ?? EMPTY_LINE.taxRate }),
    [defaultTaxRate],
  );
  const { rows, add, remove, update, atLimit, removed, undo, dismissRemoved } = useLineRows(defaultLines ?? [], empty, { max: MAX_LINE_ITEMS });
  const errors = useRowErrors(
    "lineItems",
    rows.map((row) => row.rowId),
  );

  function change(rowId: string, field: keyof PricedLineValue, value: string) {
    update(rowId, { [field]: value } as Partial<PricedLineValue>);
    errors.clear(rowId, field);
  }

  const previews = rows.map((row) => pricedLinePreview(row));
  const complete = previews.every((preview) => preview !== null);
  const totals = complete
    ? {
        subtotal: sumDecimal(previews.map((preview) => preview!.subtotal), 2),
        tax: sumDecimal(previews.map((preview) => preview!.taxAmount), 2),
        total: sumDecimal(previews.map((preview) => preview!.totalAmount), 2),
      }
    : null;
  const listErrorId = `${instance}-lines-error`;

  return (
    <section className="nesto-card p-5" aria-describedby={errors.list ? listErrorId : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-card font-semibold text-fg">Line items</h2>
          <p className="mt-1 text-meta text-fg-subtle">
            Quantity and unit price up to 4 decimals, e.g. 12.5 or 12,5. Totals are a preview; the server recalculates them when you save.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={add} disabled={atLimit}>
          <Plus aria-hidden="true" />
          Add line
        </Button>
      </div>
      {atLimit ? <p className="mt-2 text-meta text-fg-subtle">A document can have at most {MAX_LINE_ITEMS} lines.</p> : null}
      <CellError id={listErrorId} message={errors.list} />

      <RemovedLineNotice removed={removed} label={removed?.row.description || undefined} onUndo={undo} onDismiss={dismissRemoved} />

      <ul className="mt-4 space-y-3">
        {rows.map((row, index) => {
          const rowErrors = errors.forRow(row.rowId);
          const base = `${instance}-${row.rowId}`;
          const preview = previews[index];
          const lineTotal = preview ? formatAmount(preview.totalAmount, currency) : "—";
          const removeButton = () => (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove line ${index + 1}${row.description ? `: ${row.description}` : ""}`}
              // The last line is never removable: a priced document with
              // no lines has no total, and the server refuses it anyway.
              disabled={rows.length === 1}
              onClick={() => remove(row.rowId)}
            >
              <Trash2 />
            </Button>
          );
          return (
            <li key={row.rowId} className="rounded-md border border-line p-3" data-line-row={row.rowId}>
              {/* The row's own header below lg: which line this is, and its remove control beside it. */}
              <div className="mb-2 flex items-center justify-between gap-2 lg:hidden">
                <span className="text-table font-medium text-fg">Line {index + 1}</span>
                {removeButton()}
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-12">
                <div className="col-span-2 space-y-1.5 md:col-span-4 lg:col-span-5">
                  <Label htmlFor={`${base}-description`}>Description</Label>
                  <Input
                    id={`${base}-description`}
                    name={`lineItems.${index}.description`}
                    value={row.description}
                    maxLength={500}
                    required
                    aria-invalid={rowErrors.description ? true : undefined}
                    aria-describedby={rowErrors.description ? `${base}-description-error` : undefined}
                    onChange={(event) => change(row.rowId, "description", event.target.value)}
                  />
                  <CellError id={`${base}-description-error`} message={rowErrors.description} />
                </div>

                <DecimalCell
                  className="min-w-0 lg:col-span-2"
                  id={`${base}-quantity`}
                  name={`lineItems.${index}.quantity`}
                  label="Quantity"
                  value={row.quantity}
                  rule={{ label: "Quantity", ...RATE_RULE }}
                  refine={positiveQuantity}
                  serverError={rowErrors.quantity}
                  onChange={(value) => change(row.rowId, "quantity", value)}
                />

                <DecimalCell
                  className="min-w-0 lg:col-span-2"
                  id={`${base}-unitPrice`}
                  name={`lineItems.${index}.unitPrice`}
                  label="Unit price"
                  unit={currency}
                  value={row.unitPrice}
                  rule={{ label: "Unit price", ...RATE_RULE }}
                  serverError={rowErrors.unitPrice}
                  onChange={(value) => change(row.rowId, "unitPrice", value)}
                />

                <DecimalCell
                  className="min-w-0 lg:col-span-2"
                  id={`${base}-taxRate`}
                  name={`lineItems.${index}.taxRate`}
                  label="Tax"
                  unit="%"
                  value={row.taxRate}
                  rule={{ label: "Tax rate", ...TAX_RATE_RULE }}
                  refine={taxRateInRange}
                  serverError={rowErrors.taxRate}
                  onChange={(value) => change(row.rowId, "taxRate", value)}
                />

                {/* Below lg the line total takes the fourth cell, labelled, beside what it adds up. */}
                <div className="min-w-0 space-y-1.5 lg:hidden">
                  <p className="text-table font-medium text-fg">Line total</p>
                  <p className="flex h-10 items-center text-table tabular-nums text-fg" data-testid="line-total">
                    <span className="sr-only">Preview: </span>
                    {lineTotal}
                  </p>
                </div>

                <div className="hidden items-end lg:col-span-1 lg:flex">{removeButton()}</div>
              </div>

              <p className="mt-2 hidden text-right text-meta text-fg-subtle lg:block">
                Line total (preview) {lineTotal}
              </p>
            </li>
          );
        })}
      </ul>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-table" aria-label="Totals preview">
        <Row label="Subtotal" value={totals ? formatAmount(totals.subtotal, currency) : "—"} />
        <Row label="Tax" value={totals ? formatAmount(totals.tax, currency) : "—"} />
        <Row label="Total (preview)" value={totals ? formatAmount(totals.total, currency) : "—"} emphasis />
      </dl>
    </section>
  );
}

export type BudgetLineValue = {
  category: string;
  description: string;
  plannedAmount: string;
};

const BUDGET_CATEGORIES = [
  "LABOR",
  "MATERIALS",
  "EQUIPMENT",
  "SUBCONTRACTOR",
  "SERVICES",
  "TRAVEL",
  "ADMINISTRATION",
  "OTHER",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  LABOR: "Labour",
  MATERIALS: "Materials",
  EQUIPMENT: "Equipment",
  SUBCONTRACTOR: "Subcontractor",
  SERVICES: "Services",
  TRAVEL: "Travel",
  ADMINISTRATION: "Administration",
  OTHER: "Other",
};

export function BudgetLineItems({
  currency,
  defaultLines,
}: {
  currency: string;
  defaultLines?: BudgetLineValue[];
}) {
  const instance = React.useId();
  const empty = React.useCallback(
    (): BudgetLineValue => ({ category: "SUBCONTRACTOR", description: "", plannedAmount: "0" }),
    [],
  );
  const { rows, add, remove, update, atLimit, removed, undo, dismissRemoved } = useLineRows(defaultLines ?? [], empty, { max: MAX_LINE_ITEMS });
  const errors = useRowErrors(
    "lineItems",
    rows.map((row) => row.rowId),
  );

  function change(rowId: string, field: keyof BudgetLineValue, value: string) {
    update(rowId, { [field]: value } as Partial<BudgetLineValue>);
    errors.clear(rowId, field);
  }

  const amounts = rows.map((row) => previewDecimal(row.plannedAmount, 2));
  const total = amounts.every((amount) => amount !== null) ? sumDecimal(amounts as string[], 2) : null;
  const listErrorId = `${instance}-lines-error`;

  return (
    <section className="nesto-card p-5" aria-describedby={errors.list ? listErrorId : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-card font-semibold text-fg">Budget lines</h2>
          <p className="mt-1 text-meta text-fg-subtle">
            The budget total is the sum of these lines, calculated by the server. At least one line needs an amount above zero.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={add} disabled={atLimit}>
          <Plus aria-hidden="true" />
          Add line
        </Button>
      </div>
      {atLimit ? <p className="mt-2 text-meta text-fg-subtle">A budget can have at most {MAX_LINE_ITEMS} lines.</p> : null}
      <CellError id={listErrorId} message={errors.list} />

      <RemovedLineNotice removed={removed} noun="Budget line" label={removed?.row.description || undefined} onUndo={undo} onDismiss={dismissRemoved} />

      <ul className="mt-4 space-y-3">
        {rows.map((row, index) => {
          const rowErrors = errors.forRow(row.rowId);
          const base = `${instance}-${row.rowId}`;
          const removeButton = () => (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove budget line ${index + 1}${row.description ? `: ${row.description}` : ""}`}
              disabled={rows.length === 1}
              onClick={() => remove(row.rowId)}
            >
              <Trash2 />
            </Button>
          );
          return (
            <li key={row.rowId} className="rounded-md border border-line p-3" data-line-row={row.rowId}>
              {/* On a phone the remove control sits in the line's header, not alone under its last field (AUD-04 §5, D-02-06). */}
              <div className="mb-2 flex items-center justify-between gap-2 sm:hidden">
                <span className="text-table font-medium text-fg">Line {index + 1}</span>
                {removeButton()}
              </div>
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor={`${base}-category`}>Category</Label>
                  <select
                    id={`${base}-category`}
                    name={`lineItems.${index}.category`}
                    className={selectClass}
                    value={row.category}
                    aria-invalid={rowErrors.category ? true : undefined}
                    aria-describedby={rowErrors.category ? `${base}-category-error` : undefined}
                    onChange={(event) => change(row.rowId, "category", event.target.value)}
                  >
                    {BUDGET_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                  <CellError id={`${base}-category-error`} message={rowErrors.category} />
                </div>

                <div className="space-y-1.5 sm:col-span-5">
                  <Label htmlFor={`${base}-description`}>Description</Label>
                  <Input
                    id={`${base}-description`}
                    name={`lineItems.${index}.description`}
                    value={row.description}
                    maxLength={500}
                    required
                    aria-invalid={rowErrors.description ? true : undefined}
                    aria-describedby={rowErrors.description ? `${base}-description-error` : undefined}
                    onChange={(event) => change(row.rowId, "description", event.target.value)}
                  />
                  <CellError id={`${base}-description-error`} message={rowErrors.description} />
                </div>

                <DecimalCell
                  className="sm:col-span-3"
                  id={`${base}-plannedAmount`}
                  name={`lineItems.${index}.plannedAmount`}
                  label="Planned amount"
                  unit={currency}
                  value={row.plannedAmount}
                  rule={{ label: "Planned amount", ...MONEY_RULE }}
                  serverError={rowErrors.plannedAmount}
                  onChange={(value) => change(row.rowId, "plannedAmount", value)}
                />

                <div className="hidden items-end sm:col-span-1 sm:flex">{removeButton()}</div>
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-table" aria-label="Total preview">
        <Row label="Budget total (preview)" value={total ? formatAmount(total, currency) : "—"} emphasis />
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={emphasis ? "font-semibold tabular-nums text-fg" : "tabular-nums text-fg"}>
        {value}
      </dd>
    </div>
  );
}
