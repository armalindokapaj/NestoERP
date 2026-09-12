"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { selectClass, useFieldErrors } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ItemOption,
  LocationOption,
} from "@/lib/modules/inventory/inventory.options";
import { formatQuantity } from "./inventory-format";

/**
 * The line editor every stock document shares (PRD #20 §313, §315, §317).
 *
 * Lines post as `lines[0][inventoryItemId]` and so on, because an HTML form has
 * no nested objects and a JSON blob in a hidden field is a thing nobody can
 * debug from the network tab.
 *
 * What is already in a location is shown as the person picks it — on hand,
 * available, and for an adjustment the figure it would become. That is a
 * courtesy, not the rule: the server re-reads the balance under a row lock
 * before it posts anything, so a stale number here changes nothing
 * (PRD #20 §336).
 */

export type StockLineVariant = "simple" | "transfer" | "adjustment";

export type StockLineValue = {
  id?: string;
  inventoryItemId: string;
  locationId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantity?: string;
  quantityDelta?: string;
  notes?: string;
};

export type HeldBalance = {
  inventoryItemId: string;
  locationId: string;
  onHand: string;
  available: string;
};

const EMPTY: StockLineValue = {
  inventoryItemId: "",
  locationId: "",
  fromLocationId: "",
  toLocationId: "",
  quantity: "",
  quantityDelta: "",
  notes: "",
};

function resultingOnHand(onHand: string | undefined, delta: string): string | null {
  if (onHand === undefined) return null;
  const current = Number.parseFloat(onHand);
  const change = Number.parseFloat(delta.replace(",", "."));
  if (!Number.isFinite(current) || !Number.isFinite(change)) return null;
  return (current + change).toFixed(4);
}

export function StockLinesEditor({
  variant = "simple",
  initial,
  items,
  locations,
  balances = [],
  /** Limits the location pickers to one warehouse, once the form knows which. */
  warehouseId,
  fromWarehouseId,
  toWarehouseId,
}: {
  variant?: StockLineVariant;
  initial?: StockLineValue[];
  items: ItemOption[];
  locations: LocationOption[];
  balances?: HeldBalance[];
  warehouseId?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
}) {
  const [lines, setLines] = React.useState<StockLineValue[]>(
    initial && initial.length > 0 ? initial : [{ ...EMPTY }],
  );
  const errors = useFieldErrors();
  const lineError = errors.lines?.[0];

  const balanceKey = React.useMemo(() => {
    const map = new Map<string, HeldBalance>();
    for (const row of balances) map.set(`${row.inventoryItemId}:${row.locationId}`, row);
    return map;
  }, [balances]);

  function update(index: number, patch: Partial<StockLineValue>) {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  }

  function locationsFor(scope: string | undefined) {
    return scope ? locations.filter((location) => location.warehouseId === scope) : locations;
  }

  const sourceLocations = locationsFor(variant === "transfer" ? fromWarehouseId : warehouseId);
  const destinationLocations = locationsFor(toWarehouseId);

  return (
    <div className="space-y-3">
      {lineError ? <p className="text-meta text-danger-strong">{lineError}</p> : null}

      <div className="space-y-3">
        {lines.map((line, index) => {
          const item = items.find((option) => option.value === line.inventoryItemId);
          const held = balanceKey.get(
            `${line.inventoryItemId}:${variant === "transfer" ? line.fromLocationId : line.locationId}`,
          );

          return (
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
                <input type="hidden" name={`lines[${index}][id]`} value={line.id} />
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor={`lines-${index}-item`}>Item</Label>
                <select
                  id={`lines-${index}-item`}
                  name={`lines[${index}][inventoryItemId]`}
                  className={selectClass}
                  value={line.inventoryItemId}
                  onChange={(event) => update(index, { inventoryItemId: event.target.value })}
                  required
                >
                  <option value="">Choose an item</option>
                  {items.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {variant === "transfer" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor={`lines-${index}-from`}>From location</Label>
                      <select
                        id={`lines-${index}-from`}
                        name={`lines[${index}][fromLocationId]`}
                        className={selectClass}
                        value={line.fromLocationId ?? ""}
                        onChange={(event) => update(index, { fromLocationId: event.target.value })}
                        required
                      >
                        <option value="">Choose a location</option>
                        {sourceLocations.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`lines-${index}-to`}>To location</Label>
                      <select
                        id={`lines-${index}-to`}
                        name={`lines[${index}][toLocationId]`}
                        className={selectClass}
                        value={line.toLocationId ?? ""}
                        onChange={(event) => update(index, { toLocationId: event.target.value })}
                        required
                      >
                        <option value="">Choose a location</option>
                        {destinationLocations.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor={`lines-${index}-location`}>Location</Label>
                    <select
                      id={`lines-${index}-location`}
                      name={`lines[${index}][locationId]`}
                      className={selectClass}
                      value={line.locationId ?? ""}
                      onChange={(event) => update(index, { locationId: event.target.value })}
                      required
                    >
                      <option value="">Choose a location</option>
                      {sourceLocations.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {variant === "adjustment" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`lines-${index}-delta`}>Change</Label>
                    <Input
                      id={`lines-${index}-delta`}
                      name={`lines[${index}][quantityDelta]`}
                      value={line.quantityDelta ?? ""}
                      onChange={(event) => update(index, { quantityDelta: event.target.value })}
                      inputMode="decimal"
                      required
                      placeholder="-2.5 writes stock off"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor={`lines-${index}-quantity`}>
                      Quantity{item ? ` (${item.unit})` : ""}
                    </Label>
                    <Input
                      id={`lines-${index}-quantity`}
                      name={`lines[${index}][quantity]`}
                      value={line.quantity ?? ""}
                      onChange={(event) => update(index, { quantity: event.target.value })}
                      inputMode="decimal"
                      required
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`lines-${index}-notes`}>Note</Label>
                <Input
                  id={`lines-${index}-notes`}
                  name={`lines[${index}][notes]`}
                  value={line.notes ?? ""}
                  onChange={(event) => update(index, { notes: event.target.value })}
                  maxLength={500}
                />
              </div>

              {held ? (
                <p className="text-meta text-fg-subtle">
                  <span className="tabular-nums text-fg">{formatQuantity(held.onHand)}</span> on
                  hand here,{" "}
                  <span className="tabular-nums text-fg">{formatQuantity(held.available)}</span>{" "}
                  available
                  {variant === "adjustment" && line.quantityDelta
                    ? (() => {
                        const result = resultingOnHand(held.onHand, line.quantityDelta);
                        return result === null ? null : (
                          <>
                            {" · would become "}
                            <span className="tabular-nums text-fg">
                              {formatQuantity(result)}
                            </span>
                          </>
                        );
                      })()
                    : null}
                  . The server checks again when you post.
                </p>
              ) : line.inventoryItemId && (line.locationId || line.fromLocationId) ? (
                <p className="text-meta text-fg-subtle">
                  Nothing is recorded in this location yet.
                </p>
              ) : null}
            </div>
          );
        })}
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
