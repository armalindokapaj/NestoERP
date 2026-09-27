"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { PackagePlus } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/modules/status-badge";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { postFromGoodsReceiptAction } from "@/lib/actions/inventory";
import type {
  ItemOption,
  LocationOption,
  Option,
} from "@/lib/modules/inventory/inventory.options";
import { formatQuantity } from "./inventory-format";
import { CellError } from "@/components/finance/line-rows";
import { isPositiveDecimal } from "@/lib/modules/finance/finance.decimal";

/**
 * Book an accepted Procurement delivery into stock (PRD #20 §11, §309, §310).
 *
 * Procurement stays the authority on what was accepted; this form does not let
 * anybody change those figures, only say which inventory item and location each
 * accepted line lands in. Rejected quantity is not offered at all — it went back
 * on the lorry (PRD #20 §90, §457).
 *
 * Posting it here creates a *draft* receipt. Committing it to the stock ledger
 * is a separate, confirmed act on the receipt itself, because putting material
 * on a shelf and recording that you did are different decisions (PRD #20 §281).
 */
export type HandoffLine = {
  goodsReceiptItemId: string;
  description: string;
  unit: string;
  acceptedQuantity: string;
};

export function ProcurementHandoff({
  goodsReceiptId,
  receiptNumber,
  lines,
  items,
  warehouses,
  locations,
  existing,
}: {
  goodsReceiptId: string;
  receiptNumber: string;
  lines: HandoffLine[];
  items: ItemOption[];
  warehouses: Option[];
  locations: LocationOption[];
  existing: { id: string; receiptNumber: string; status: string } | null;
}) {
  const [open, setOpen] = React.useState(false);

  if (existing) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-meta text-fg-subtle">
        Booked into stock as{" "}
        <Link
          href={`/inventory/receipts/${existing.id}`}
          className="font-medium text-accent-strong hover:underline"
        >
          {existing.receiptNumber}
        </Link>
        <StatusBadge status={existing.status} />
      </p>
    );
  }

  const acceptedLines = lines.filter((line) => isPositiveDecimal(line.acceptedQuantity));

  if (acceptedLines.length === 0) {
    return (
      <p className="text-meta text-fg-subtle">
        Nothing on this delivery was accepted, so there is nothing to book into stock.
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <PackagePlus aria-hidden="true" />
        Book into stock
      </Button>
    );
  }

  return (
    <HandoffForm
      goodsReceiptId={goodsReceiptId}
      receiptNumber={receiptNumber}
      acceptedLines={acceptedLines}
      items={items}
      warehouses={warehouses}
      locations={locations}
      onClose={() => setOpen(false)}
    />
  );
}

/**
 * The open mapping form. Its choices live here, so they go with it: Cancel
 * asks first while anything is chosen, and discarding closes it (AUD-03 §3).
 * A committed hand-off opens the draft receipt it created.
 */
function HandoffForm({
  goodsReceiptId,
  receiptNumber,
  acceptedLines,
  items,
  warehouses,
  locations,
  onClose,
}: {
  goodsReceiptId: string;
  receiptNumber: string;
  acceptedLines: HandoffLine[];
  items: ItemOption[];
  warehouses: Option[];
  locations: LocationOption[];
  onClose: () => void;
}) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [mapping, setMapping] = React.useState<
    Record<string, { inventoryItemId: string; locationId: string }>
  >({});
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => postFromGoodsReceiptAction(goodsReceiptId, formData),
    module: "inventory",
    saveKind: "create",
    label: `Stock booking for ${receiptNumber}`,
  });
  const { pending, fieldErrors } = save;
  const [cleared, setCleared] = React.useState(false);

  // Locations follow the warehouse (AUD-09 §5, FV-08): none before one is
  // chosen, and a warehouse change clears the ones it no longer holds, saying so.
  const available = warehouseId ? locations.filter((location) => location.warehouseId === warehouseId) : [];

  function chooseWarehouse(next: string) {
    setWarehouseId(next);
    const inside = new Set(locations.filter((location) => location.warehouseId === next).map((location) => location.value));
    const outside = Object.values(mapping).some((value) => value.locationId && !inside.has(value.locationId));
    if (outside) {
      setMapping(
        Object.fromEntries(
          Object.entries(mapping).map(([key, value]) => [key, value.locationId && !inside.has(value.locationId) ? { ...value, locationId: "" } : value]),
        ),
      );
    }
    setCleared(outside);
  }

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="nesto-card space-y-4 p-5">
      <div>
        <h3 className="text-card font-semibold text-fg">
          Book {receiptNumber} into stock
        </h3>
        <p className="mt-1 text-meta text-fg-subtle">
          Only the accepted quantity crosses, and it cannot be changed here — Procurement decided
          it. This creates a draft receipt; posting it is a separate step.
        </p>
      </div>

      <SaveMessages save={save} />

      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <div className="space-y-1.5">
          <Label htmlFor="handoff-warehouse">Into warehouse</Label>
          <select
            id="handoff-warehouse"
            name="warehouseId"
            className={selectClass}
            value={warehouseId}
            onChange={(event) => chooseWarehouse(event.target.value)}
            required
            aria-invalid={fieldErrors.warehouseId ? true : undefined}
            aria-describedby={fieldErrors.warehouseId ? "handoff-warehouse-error" : undefined}
          >
            <option value="">Choose a warehouse</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.value} value={warehouse.value}>
                {warehouse.label}
              </option>
            ))}
          </select>
          <CellError id="handoff-warehouse-error" message={fieldErrors.warehouseId?.[0]} />
          {cleared ? (
            <p role="status" className="text-meta text-warning-strong">
              Locations from the previous warehouse were cleared. Choose them again.
            </p>
          ) : null}
        </div>

        <ul className="space-y-3">
          {acceptedLines.map((line, index) => {
            const current = mapping[line.goodsReceiptItemId] ?? {
              inventoryItemId: "",
              locationId: "",
            };

            return (
              <li key={line.goodsReceiptItemId} className="rounded-md border border-line p-4">
                <p className="text-table font-medium text-fg">{line.description}</p>
                <p className="text-meta text-fg-subtle">
                  Accepted{" "}
                  <span className="tabular-nums text-fg">
                    {formatQuantity(line.acceptedQuantity)} {line.unit}
                  </span>
                </p>

                <input
                  type="hidden"
                  name={`lines.${index}.goodsReceiptItemId`}
                  value={line.goodsReceiptItemId}
                />

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`handoff-${index}-item`}>Inventory item</Label>
                    <select
                      id={`handoff-${index}-item`}
                      name={`lines.${index}.inventoryItemId`}
                      className={selectClass}
                      value={current.inventoryItemId}
                      onChange={(event) =>
                        setMapping((previous) => ({
                          ...previous,
                          [line.goodsReceiptItemId]: {
                            ...current,
                            inventoryItemId: event.target.value,
                          },
                        }))
                      }
                    >
                      <option value="">Do not book this line</option>
                      {items.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`handoff-${index}-location`}>Location</Label>
                    <select
                      id={`handoff-${index}-location`}
                      name={`lines.${index}.locationId`}
                      className={selectClass}
                      value={current.locationId}
                      onChange={(event) =>
                        setMapping((previous) => ({
                          ...previous,
                          [line.goodsReceiptItemId]: {
                            ...current,
                            locationId: event.target.value,
                          },
                        }))
                      }
                      disabled={!warehouseId}
                      aria-invalid={fieldErrors[`lines.${index}.locationId`] ? true : undefined}
                      aria-describedby={fieldErrors[`lines.${index}.locationId`] ? `handoff-${index}-location-error` : undefined}
                    >
                      <option value="">{warehouseId ? "Choose a location" : "Choose a warehouse first"}</option>
                      {available.map((location) => (
                        <option key={location.value} value={location.value}>
                          {location.label}
                        </option>
                      ))}
                    </select>
                    <CellError id={`handoff-${index}-location-error`} message={fieldErrors[`lines.${index}.locationId`]?.[0]} />
                  </div>
                </div>
                <CellError id={`handoff-${index}-error`} message={fieldErrors[`lines.${index}.goodsReceiptItemId`]?.[0]} />
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || Boolean(save.saved)}>
          {pending ? "Booking…" : "Create draft receipt"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => void save.editor.requestDismiss(onClose)}
        >
          Cancel
        </Button>
        <UnsavedIndicator save={save} />
      </div>
    </form>
  );
}
