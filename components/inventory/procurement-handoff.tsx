"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/modules/status-badge";
import { useToast } from "@/components/ui/toast";
import { postFromGoodsReceiptAction } from "@/lib/actions/inventory";
import type {
  ItemOption,
  LocationOption,
  Option,
} from "@/lib/modules/inventory/inventory.options";
import { formatQuantity } from "./inventory-format";

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
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [mapping, setMapping] = React.useState<
    Record<string, { inventoryItemId: string; locationId: string }>
  >({});

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

  const acceptedLines = lines.filter(
    (line) => Number.parseFloat(line.acceptedQuantity) > 0,
  );

  if (acceptedLines.length === 0) {
    return (
      <p className="text-meta text-fg-subtle">
        Nothing on this delivery was accepted, so there is nothing to book into stock.
      </p>
    );
  }

  const available = warehouseId
    ? locations.filter((location) => location.warehouseId === warehouseId)
    : locations;

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await postFromGoodsReceiptAction(goodsReceiptId, formData);
      // A success redirects, so only a failure comes back here.
      if (!result.ok) toast({ title: result.error, tone: "danger" });
      else router.refresh();
    });
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
    <form action={submit} className="nesto-card space-y-4 p-5">
      <div>
        <h3 className="text-card font-semibold text-fg">
          Book {receiptNumber} into stock
        </h3>
        <p className="mt-1 text-meta text-fg-subtle">
          Only the accepted quantity crosses, and it cannot be changed here — Procurement decided
          it. This creates a draft receipt; posting it is a separate step.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="handoff-warehouse">Into warehouse</Label>
        <select
          id="handoff-warehouse"
          name="warehouseId"
          className={selectClass}
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
          required
        >
          <option value="">Choose a warehouse</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.value} value={warehouse.value}>
              {warehouse.label}
            </option>
          ))}
        </select>
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
                name={`lines[${index}][goodsReceiptItemId]`}
                value={line.goodsReceiptItemId}
              />

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`handoff-${index}-item`}>Inventory item</Label>
                  <select
                    id={`handoff-${index}-item`}
                    name={`lines[${index}][inventoryItemId]`}
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
                    name={`lines[${index}][locationId]`}
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
                  >
                    <option value="">Choose a location</option>
                    {available.map((location) => (
                      <option key={location.value} value={location.value}>
                        {location.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Booking…" : "Create draft receipt"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
