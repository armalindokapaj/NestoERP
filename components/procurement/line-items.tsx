"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { selectClass, useFieldErrors } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The line editor every priced document shares (PRD #19 §266).
 *
 * Lines post as `items[0][description]` and so on, because an HTML form has no
 * nested objects and a JSON blob in a hidden field is a thing nobody can debug
 * from the network tab.
 *
 * Row totals are shown as the person types, computed the same way the server
 * computes them — quantity × price, rounded at the line. It is a courtesy, not
 * the rule: the server recalculates every figure from the lines it receives
 * (PRD #19 §105).
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

function money(value: string | undefined, quantity: string): string {
  const price = Number.parseFloat((value ?? "").replace(",", "."));
  const count = Number.parseFloat(quantity.replace(",", "."));
  if (!Number.isFinite(price) || !Number.isFinite(count)) return "—";
  return (price * count).toFixed(2);
}

export function LineItemsEditor({
  initial,
  columns,
  categories,
  priceLabel = "Unit price",
  priceField = "unitPrice",
}: {
  initial?: LineValue[];
  columns: LineColumn[];
  categories?: { value: string; label: string }[];
  priceLabel?: string;
  priceField?: "unitPrice" | "estimatedUnitPrice";
}) {
  const [lines, setLines] = React.useState<LineValue[]>(
    initial && initial.length > 0 ? initial : [{ ...EMPTY }],
  );
  const errors = useFieldErrors();
  const lineError = errors.items?.[0];

  const showPrice = columns.includes("unitPrice") || columns.includes("estimatedUnitPrice");
  const showTax = columns.includes("taxRate");
  const showCategory = columns.includes("category") && (categories?.length ?? 0) > 0;

  function update(index: number, patch: Partial<LineValue>) {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  }

  return (
    <div className="space-y-3">
      {lineError ? <p className="text-meta text-danger-strong">{lineError}</p> : null}

      <div className="space-y-3">
        {lines.map((line, index) => (
          <div key={index} className="nesto-card space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="nesto-eyebrow text-fg-subtle">Line {index + 1}</p>
              {lines.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </div>

            {line.id ? (
              <input type="hidden" name={`items[${index}][id]`} value={line.id} />
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor={`items-${index}-description`}>Description</Label>
              <Input
                id={`items-${index}-description`}
                name={`items[${index}][description]`}
                value={line.description}
                onChange={(event) => update(index, { description: event.target.value })}
                required
                maxLength={400}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor={`items-${index}-quantity`}>Quantity</Label>
                <Input
                  id={`items-${index}-quantity`}
                  name={`items[${index}][quantity]`}
                  value={line.quantity}
                  onChange={(event) => update(index, { quantity: event.target.value })}
                  required
                  inputMode="decimal"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`items-${index}-unit`}>Unit</Label>
                <Input
                  id={`items-${index}-unit`}
                  name={`items[${index}][unit]`}
                  value={line.unit}
                  onChange={(event) => update(index, { unit: event.target.value })}
                  required
                  maxLength={24}
                  placeholder="each, m3, tonne…"
                />
              </div>

              {showPrice ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`items-${index}-price`}>{priceLabel}</Label>
                  <Input
                    id={`items-${index}-price`}
                    name={`items[${index}][${priceField}]`}
                    value={(priceField === "unitPrice" ? line.unitPrice : line.estimatedUnitPrice) ?? ""}
                    onChange={(event) =>
                      update(index, { [priceField]: event.target.value } as Partial<LineValue>)
                    }
                    inputMode="decimal"
                    required={priceField === "unitPrice"}
                  />
                </div>
              ) : null}

              {showTax ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`items-${index}-taxRate`}>Tax rate</Label>
                  <Input
                    id={`items-${index}-taxRate`}
                    name={`items[${index}][taxRate]`}
                    value={line.taxRate ?? "0"}
                    onChange={(event) => update(index, { taxRate: event.target.value })}
                    inputMode="decimal"
                    placeholder="0.2"
                  />
                </div>
              ) : null}

              {showCategory ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`items-${index}-category`}>Category</Label>
                  <select
                    id={`items-${index}-category`}
                    name={`items[${index}][category]`}
                    className={selectClass}
                    value={line.category ?? ""}
                    onChange={(event) => update(index, { category: event.target.value })}
                  >
                    <option value="">Not set</option>
                    {categories!.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            {showPrice ? (
              <p className="text-meta text-fg-subtle">
                Line total{" "}
                <span className="tabular-nums text-fg">
                  {money(
                    priceField === "unitPrice" ? line.unitPrice : line.estimatedUnitPrice,
                    line.quantity,
                  )}
                </span>{" "}
                before tax. The server recalculates every figure when you save.
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setLines((current) => [...current, { ...EMPTY }])}
      >
        <Plus aria-hidden="true" />
        Add line
      </Button>
    </div>
  );
}
