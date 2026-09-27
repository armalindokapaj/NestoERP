"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { CellError, DecimalCell, useLineRows, useRowErrors } from "@/components/finance/line-rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compareDecimal, isPositiveDecimal, pricedLinePreview, sumDecimal } from "@/lib/modules/finance/finance.decimal";
import { RATE_RULE } from "@/lib/modules/finance/finance.fields";
import { MAX_LINE_ITEMS } from "@/lib/modules/finance/finance.form-data";

/**
 * The line editor every priced document shares (PRD #19 §266; AUD-09 §3, §7,
 * FV-06, FV-16).
 *
 * Rows keep a stable local id (`useLineRows`) and post as `items.0.description`
 * and so on — named by their position at submit, which is the canonical path
 * the server's errors come back under. Each error is put on the row that was
 * submitted at that position, so removing a row after a refused save cannot
 * move an error onto its neighbour. A saved line's id travels with it
 * (`items.0.id`), so what this editor does not show — its specification, the
 * request or quote line it came from — is kept by the server on an edit.
 *
 * Numbers use the shared decimal rule (`1,234` refused as ambiguous, `12,5`
 * read as 12.5) and are checked on blur with the server's own sentence. Row and
 * document totals are an exact preview in the server's order — quantity × price
 * rounded at the line, tax on the rounded subtotal (the tax rate here is a
 * fraction, 0.2 for twenty per cent). The server recalculates every figure from
 * the lines it receives (PRD #19 §105).
 */

export type LineColumn = "quantity" | "unit" | "estimatedUnitPrice" | "unitPrice" | "taxRate" | "category";

export type LineValue = {
  id?: string;
  description: string;
  quantity: string;
  unit: string;
  estimatedUnitPrice?: string;
  unitPrice?: string;
  taxRate?: string;
  category?: string;
  specification?: string;
};

const EMPTY: LineValue = {
  description: "",
  quantity: "1",
  unit: "each",
  estimatedUnitPrice: "",
  unitPrice: "",
  taxRate: "0",
  category: "",
};

const positiveQuantity = (value: string) => (isPositiveDecimal(value) ? null : "Quantity must be more than zero");
const fractionRate = (value: string) => (compareDecimal(value, "1") <= 0 ? null : "Tax rate is a fraction such as 0.2 and cannot exceed 1");

export function LineItemsEditor({
  initial,
  columns,
  categories,
  priceLabel = "Unit price",
  priceField = "unitPrice",
  currency,
}: {
  initial?: LineValue[];
  columns: LineColumn[];
  categories?: { value: string; label: string }[];
  priceLabel?: string;
  priceField?: "unitPrice" | "estimatedUnitPrice";
  /** Shown beside the price, when the document has one. */
  currency?: string;
}) {
  const instance = React.useId();
  const empty = React.useCallback((): LineValue => ({ ...EMPTY }), []);
  const { rows, add, remove, update, atLimit } = useLineRows(initial ?? [], empty, { max: MAX_LINE_ITEMS });
  const errors = useRowErrors(
    "items",
    rows.map((row) => row.rowId),
  );

  const showPrice = columns.includes("unitPrice") || columns.includes("estimatedUnitPrice");
  const showTax = columns.includes("taxRate");
  const showCategory = columns.includes("category") && (categories?.length ?? 0) > 0;

  function change(rowId: string, field: keyof LineValue, value: string) {
    update(rowId, { [field]: value } as Partial<LineValue>);
    errors.clear(rowId, field);
  }

  const previews = rows.map((row) => {
    const price = priceField === "unitPrice" ? row.unitPrice : row.estimatedUnitPrice;
    if (!price || price.trim() === "") return null;
    return pricedLinePreview({ quantity: row.quantity, unitPrice: price, taxRate: showTax ? row.taxRate || "0" : "0" }, true);
  });
  const allPriced = showPrice && previews.every((preview) => preview !== null);
  const documentTotal = allPriced ? sumDecimal(previews.map((preview) => preview!.totalAmount), 2) : null;
  const listErrorId = `${instance}-items-error`;

  return (
    <div className="space-y-3" aria-describedby={errors.list ? listErrorId : undefined}>
      <p className="text-meta text-fg-subtle">
        Quantities and prices take up to 4 decimals, e.g. 12.5 or 12,5.{showTax ? " Tax is a fraction: 0.2 is 20%." : ""}
      </p>
      <CellError id={listErrorId} message={errors.list} />

      <div className="space-y-3">
        {rows.map((row, index) => {
          const rowErrors = errors.forRow(row.rowId);
          const base = `${instance}-${row.rowId}`;
          const preview = previews[index];
          return (
            <div key={row.rowId} className="nesto-card space-y-3 p-4" data-line-row={row.rowId}>
              <div className="flex items-start justify-between gap-3">
                <p className="nesto-eyebrow text-fg-subtle">Line {index + 1}</p>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove line ${index + 1}${row.description ? `: ${row.description}` : ""}`}
                    onClick={() => remove(row.rowId)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              {row.id ? <input type="hidden" name={`items.${index}.id`} value={row.id} /> : null}

              <div className="space-y-1.5">
                <Label htmlFor={`${base}-description`}>Description</Label>
                <Input
                  id={`${base}-description`}
                  name={`items.${index}.description`}
                  value={row.description}
                  onChange={(event) => change(row.rowId, "description", event.target.value)}
                  required
                  minLength={2}
                  maxLength={400}
                  aria-invalid={rowErrors.description ? true : undefined}
                  aria-describedby={rowErrors.description ? `${base}-description-error` : undefined}
                />
                <CellError id={`${base}-description-error`} message={rowErrors.description} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DecimalCell
                  id={`${base}-quantity`}
                  name={`items.${index}.quantity`}
                  label="Quantity"
                  value={row.quantity}
                  rule={{ label: "Quantity", ...RATE_RULE }}
                  refine={positiveQuantity}
                  serverError={rowErrors.quantity}
                  onChange={(value) => change(row.rowId, "quantity", value)}
                />

                <div className="space-y-1.5">
                  <Label htmlFor={`${base}-unit`}>Unit</Label>
                  <Input
                    id={`${base}-unit`}
                    name={`items.${index}.unit`}
                    value={row.unit}
                    onChange={(event) => change(row.rowId, "unit", event.target.value)}
                    required
                    maxLength={24}
                    placeholder="each, m3, tonne…"
                    aria-invalid={rowErrors.unit ? true : undefined}
                    aria-describedby={rowErrors.unit ? `${base}-unit-error` : undefined}
                  />
                  <CellError id={`${base}-unit-error`} message={rowErrors.unit} />
                </div>

                {showPrice ? (
                  <DecimalCell
                    id={`${base}-price`}
                    name={`items.${index}.${priceField}`}
                    label={priceLabel}
                    unit={currency}
                    value={(priceField === "unitPrice" ? row.unitPrice : row.estimatedUnitPrice) ?? ""}
                    rule={{ label: priceLabel, ...RATE_RULE }}
                    required={priceField === "unitPrice"}
                    serverError={rowErrors[priceField]}
                    onChange={(value) => change(row.rowId, priceField, value)}
                  />
                ) : null}

                {showTax ? (
                  <DecimalCell
                    id={`${base}-taxRate`}
                    name={`items.${index}.taxRate`}
                    label="Tax rate"
                    unit="fraction"
                    value={row.taxRate ?? ""}
                    rule={{ label: "Tax rate", scale: 4, maxIntegerDigits: 1 }}
                    required={false}
                    refine={fractionRate}
                    serverError={rowErrors.taxRate}
                    onChange={(value) => change(row.rowId, "taxRate", value)}
                  />
                ) : null}

                {showCategory ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${base}-category`}>Category</Label>
                    <select
                      id={`${base}-category`}
                      name={`items.${index}.category`}
                      className={selectClass}
                      value={row.category ?? ""}
                      onChange={(event) => change(row.rowId, "category", event.target.value)}
                      aria-invalid={rowErrors.category ? true : undefined}
                      aria-describedby={rowErrors.category ? `${base}-category-error` : undefined}
                    >
                      <option value="">Not set</option>
                      {categories!.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <CellError id={`${base}-category-error`} message={rowErrors.category} />
                  </div>
                ) : null}
              </div>

              {showPrice ? (
                <p className="text-meta text-fg-subtle">
                  Line total (preview){" "}
                  <span className="tabular-nums text-fg">{preview ? preview.totalAmount : "—"}</span>
                  {showTax ? " including tax." : " before tax."}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={add} disabled={atLimit}>
          <Plus aria-hidden="true" />
          Add line
        </Button>
        {showPrice ? (
          <p className="text-table text-fg-muted">
            Total (preview){" "}
            <span className="font-semibold tabular-nums text-fg">
              {documentTotal ?? "—"}
              {documentTotal && currency ? ` ${currency}` : ""}
            </span>
          </p>
        ) : null}
      </div>
      {atLimit ? <p className="text-meta text-fg-subtle">A document can have at most {MAX_LINE_ITEMS} lines.</p> : null}
    </div>
  );
}
