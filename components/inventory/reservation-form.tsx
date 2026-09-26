"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import {
  Field,
  FieldErrorProvider,
  FormSection,
  selectClass,
} from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { createReservationAction } from "@/lib/actions/inventory";
import type { DocumentFormOptions } from "@/lib/modules/inventory/inventory.options";
import { formatQuantity } from "./inventory-format";
import type { HeldBalance } from "./stock-lines";

/**
 * Reserve stock for a project (PRD #20 §158, §319).
 *
 * Available before and after is shown as the person types, because "reserve 5
 * tonnes" means nothing without knowing what is left. The figure is a courtesy:
 * the server re-reads the balance under a row lock and refuses to oversubscribe,
 * whatever this page believed (PRD #20 §159, §284).
 */
export function ReservationForm({
  options,
  balances,
  defaults,
  cancelHref,
}: {
  options: DocumentFormOptions;
  balances: HeldBalance[];
  defaults?: { inventoryItemId?: string; warehouseId?: string; projectId?: string };
  cancelHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  // AUD-03 §3, §6: a normal save opens the reservations list; Save and
  // continue leaves the destination to the departure.
  const save = useEditorSave({
    formRef,
    action: async (formData: FormData) => {
      const result = await createReservationAction(formData);
      return result.ok ? { ...result, redirectTo: "/inventory/reservations" } : result;
    },
    module: "inventory",
    saveKind: "create",
    label: "Reservation",
    onCommitted: (result) => {
      toast({ title: result?.message ?? "Stock reserved.", tone: "success" });
    },
  });
  const { pending, fieldErrors: errors } = save;

  const [inventoryItemId, setItemId] = React.useState(defaults?.inventoryItemId ?? "");
  const [warehouseId, setWarehouseId] = React.useState(defaults?.warehouseId ?? "");
  const [locationId, setLocationId] = React.useState("");
  const [quantity, setQuantity] = React.useState("");

  const item = options.items.find((option) => option.value === inventoryItemId);
  const held = balances.find(
    (row) => row.inventoryItemId === inventoryItemId && row.locationId === locationId,
  );

  const availableAfter = React.useMemo(() => {
    if (!held) return null;
    const before = Number.parseFloat(held.available);
    const asked = Number.parseFloat(quantity.replace(",", "."));
    if (!Number.isFinite(before) || !Number.isFinite(asked)) return null;
    return (before - asked).toFixed(4);
  }, [held, quantity]);

  const locations = warehouseId
    ? options.locations.filter((location) => location.warehouseId === warehouseId)
    : options.locations;

  return (
    <FieldErrorProvider value={errors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
        <SaveMessages save={save} />

        <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-5 border-0 p-0">
          <FormSection
            title="Reservation"
            description="Holds quantity back from available without moving anything. The material stays exactly where it is."
          >
            <Field label="Item" name="inventoryItemId" required>
              <select
                id="inventoryItemId"
                name="inventoryItemId"
                className={selectClass}
                value={inventoryItemId}
                onChange={(event) => setItemId(event.target.value)}
                required
              >
                <option value="">Choose an item</option>
                {options.items.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Project" name="projectId" hint="Leave blank to hold it generally.">
              <select
                id="projectId"
                name="projectId"
                className={selectClass}
                defaultValue={defaults?.projectId ?? ""}
              >
                <option value="">Not set</option>
                {options.projects.map((project) => (
                  <option key={project.value} value={project.value}>
                    {project.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Warehouse" name="warehouseId" required>
              <select
                id="warehouseId"
                name="warehouseId"
                className={selectClass}
                value={warehouseId}
                onChange={(event) => {
                  setWarehouseId(event.target.value);
                  setLocationId("");
                }}
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

            <Field label="Location" name="locationId" required>
              <select
                id="locationId"
                name="locationId"
                className={selectClass}
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                required
              >
                <option value="">Choose a location</option>
                {locations.map((location) => (
                  <option key={location.value} value={location.value}>
                    {location.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={`Quantity${item ? ` (${item.unit})` : ""}`}
              name="quantity"
              required
              className="sm:col-span-2"
            >
              <Input
                id="quantity"
                name="quantity"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="decimal"
                required
              />
            </Field>

            <Field label="Required by" name="requiredDate">
              <Input id="requiredDate" name="requiredDate" type="date" />
            </Field>

            <Field
              label="Expires"
              name="expiresAt"
              hint="After this date the reservation can be released in bulk."
            >
              <Input id="expiresAt" name="expiresAt" type="date" />
            </Field>
          </FormSection>

          {held ? (
            <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
              <span className="tabular-nums text-fg">{formatQuantity(held.available)}</span> available
              here before this reservation
              {availableAfter === null ? null : (
                <>
                  {", "}
                  <span
                    className={
                      Number.parseFloat(availableAfter) < 0
                        ? "tabular-nums text-danger-strong"
                        : "tabular-nums text-fg"
                    }
                  >
                    {formatQuantity(availableAfter)}
                  </span>{" "}
                  after
                </>
              )}
              . The server checks again when you save.
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || Boolean(save.saved)}>
            {pending ? "Reserving…" : "Reserve stock"}
          </Button>
          {/* Guarded navigation: asks first while anything is unsaved (§4). */}
          <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)} disabled={pending}>
            Cancel
          </Button>
          <UnsavedIndicator save={save} />
        </div>
      </form>
    </FieldErrorProvider>
  );
}
