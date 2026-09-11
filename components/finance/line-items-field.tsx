"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/forms/record-form";
import { formatAmount } from "@/lib/modules/finance/finance.currency";

/**
 * The priced line-item editor (PRD #15 §322, PRD #17 §409).
 *
 * Shared by invoices and proposals, because they are the same editor: the same
 * four fields, the same arithmetic, the same field names. Two copies would be
 * two chances for a proposal's preview and an invoice's preview to disagree
 * about the same numbers (PRD #17 §111).
 *
 * Rows are named `lineItems[0].description` and so on, which is how a plain
 * HTML form expresses a list — so the form still submits without JavaScript,
 * and the server reads it by index.
 *
 * The running total is a *preview*. The server recalculates every figure from
 * quantity, unit price and tax rate before anything is stored, so what is shown
 * here can be convenient without being authoritative (PRD #15 §52).
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

export function PricedLineItems({
  currency,
  defaultLines,
  defaultTaxRate,
}: {
  currency: string;
  defaultLines?: PricedLineValue[];
  defaultTaxRate?: string | null;
}) {
  const [lines, setLines] = React.useState<PricedLineValue[]>(
    defaultLines && defaultLines.length > 0
      ? defaultLines
      : [{ ...EMPTY_LINE, taxRate: defaultTaxRate ?? EMPTY_LINE.taxRate }],
  );

  function update(index: number, field: keyof PricedLineValue, value: string) {
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, [field]: value } : line,
      ),
    );
  }

  const preview = lines.reduce(
    (totals, line) => {
      const subtotal = round2(toNumber(line.quantity) * toNumber(line.unitPrice));
      const tax = round2((subtotal * toNumber(line.taxRate)) / 100);
      return {
        subtotal: round2(totals.subtotal + subtotal),
        tax: round2(totals.tax + tax),
        total: round2(totals.total + subtotal + tax),
      };
    },
    { subtotal: 0, tax: 0, total: 0 },
  );

  return (
    <section className="nesto-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-card font-semibold text-fg">Line items</h2>
          <p className="mt-1 text-meta text-fg-subtle">
            Totals are recalculated by the server when you save.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setLines((current) => [
              ...current,
              { ...EMPTY_LINE, taxRate: defaultTaxRate ?? EMPTY_LINE.taxRate },
            ])
          }
        >
          <Plus aria-hidden="true" />
          Add line
        </Button>
      </div>

      <ul className="mt-4 space-y-3">
        {lines.map((line, index) => (
          <li key={index} className="rounded-md border border-line p-3">
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="space-y-1.5 sm:col-span-5">
                <Label htmlFor={`line-${index}-description`}>Description</Label>
                <Input
                  id={`line-${index}-description`}
                  name={`lineItems[${index}].description`}
                  value={line.description}
                  maxLength={500}
                  onChange={(event) => update(index, "description", event.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`line-${index}-quantity`}>Quantity</Label>
                <Input
                  id={`line-${index}-quantity`}
                  name={`lineItems[${index}].quantity`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => update(index, "quantity", event.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`line-${index}-unitPrice`}>Unit price</Label>
                <Input
                  id={`line-${index}-unitPrice`}
                  name={`lineItems[${index}].unitPrice`}
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(event) => update(index, "unitPrice", event.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`line-${index}-taxRate`}>Tax %</Label>
                <Input
                  id={`line-${index}-taxRate`}
                  name={`lineItems[${index}].taxRate`}
                  inputMode="decimal"
                  value={line.taxRate}
                  onChange={(event) => update(index, "taxRate", event.target.value)}
                  required
                />
              </div>

              <div className="flex items-end sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove line ${index + 1}`}
                  // The last line is never removable: a priced document with
                  // no lines has no total, and the server refuses it anyway.
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((_, position) => position !== index))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>

            <p className="mt-2 text-right text-meta text-fg-subtle">
              Line total{" "}
              {formatAmount(
                round2(
                  round2(toNumber(line.quantity) * toNumber(line.unitPrice)) *
                    (1 + toNumber(line.taxRate) / 100),
                ).toFixed(2),
                currency,
              )}
            </p>
          </li>
        ))}
      </ul>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-table">
        <Row label="Subtotal" value={formatAmount(preview.subtotal.toFixed(2), currency)} />
        <Row label="Tax" value={formatAmount(preview.tax.toFixed(2), currency)} />
        <Row
          label="Total"
          value={formatAmount(preview.total.toFixed(2), currency)}
          emphasis
        />
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
  const [lines, setLines] = React.useState<BudgetLineValue[]>(
    defaultLines && defaultLines.length > 0
      ? defaultLines
      : [{ category: "SUBCONTRACTOR", description: "", plannedAmount: "0" }],
  );

  function update(index: number, field: keyof BudgetLineValue, value: string) {
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, [field]: value } : line,
      ),
    );
  }

  const total = lines.reduce((sum, line) => round2(sum + toNumber(line.plannedAmount)), 0);

  return (
    <section className="nesto-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-card font-semibold text-fg">Budget lines</h2>
          <p className="mt-1 text-meta text-fg-subtle">
            The budget total is the sum of these lines, calculated by the server.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setLines((current) => [
              ...current,
              { category: "SUBCONTRACTOR", description: "", plannedAmount: "0" },
            ])
          }
        >
          <Plus aria-hidden="true" />
          Add line
        </Button>
      </div>

      <ul className="mt-4 space-y-3">
        {lines.map((line, index) => (
          <li key={index} className="rounded-md border border-line p-3">
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor={`budget-${index}-category`}>Category</Label>
                <select
                  id={`budget-${index}-category`}
                  name={`lineItems[${index}].category`}
                  className={selectClass}
                  value={line.category}
                  onChange={(event) => update(index, "category", event.target.value)}
                >
                  {BUDGET_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 sm:col-span-5">
                <Label htmlFor={`budget-${index}-description`}>Description</Label>
                <Input
                  id={`budget-${index}-description`}
                  name={`lineItems[${index}].description`}
                  value={line.description}
                  maxLength={500}
                  onChange={(event) => update(index, "description", event.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor={`budget-${index}-plannedAmount`}>Planned amount</Label>
                <Input
                  id={`budget-${index}-plannedAmount`}
                  name={`lineItems[${index}].plannedAmount`}
                  inputMode="decimal"
                  value={line.plannedAmount}
                  onChange={(event) => update(index, "plannedAmount", event.target.value)}
                  required
                />
              </div>

              <div className="flex items-end sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove budget line ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((_, position) => position !== index))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-table">
        <Row label="Budget total" value={formatAmount(total.toFixed(2), currency)} emphasis />
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

/** Preview arithmetic only — never the stored figure (PRD #15 §52). */
function toNumber(value: string): number {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
