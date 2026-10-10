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
import { useInventoryTranslations } from "./inventory-text";
import type { HeldBalance } from "./stock-lines";
import { DecimalCell } from "@/components/finance/line-rows";
import { isPositiveDecimal, previewDecimal, sumDecimal } from "@/lib/modules/finance/finance.decimal";
import { RATE_RULE } from "@/lib/modules/finance/finance.fields";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useInventoryTranslations();
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
    label: t("reservationForm.section"),
    onCommitted: () => {
      toast({ title: t("reservationForm.reserved"), tone: "success" });
    },
  });
  const { pending, fieldErrors: errors } = save;

  const [inventoryItemId, setItemId] = React.useState(defaults?.inventoryItemId ?? "");
  const [warehouseId, setWarehouseId] = React.useState(defaults?.warehouseId ?? "");
  const [locationId, setLocationId] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [quantityEdited, setQuantityEdited] = React.useState(false);
  const [errorSource, setErrorSource] = React.useState(errors);
  if (errorSource !== errors) {
    setErrorSource(errors);
    setQuantityEdited(false);
  }

  const item = options.items.find((option) => option.value === inventoryItemId);
  const held = balances.find(
    (row) => row.inventoryItemId === inventoryItemId && row.locationId === locationId,
  );

  // Exact, and only for a number the server would accept (AUD-09 §4, §7).
  const availableAfter = React.useMemo(() => {
    if (!held) return null;
    const asked = previewDecimal(quantity, 4);
    if (asked === null) return null;
    return sumDecimal([held.available, asked.startsWith("-") ? asked.slice(1) : `-${asked}`], 4);
  }, [held, quantity]);

  // A location belongs to the warehouse chosen; none is offered before one is
  // (AUD-09 §5, FV-08).
  const locations = warehouseId ? options.locations.filter((location) => location.warehouseId === warehouseId) : [];

  return (
    <FieldErrorProvider value={errors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
        <SaveMessages save={save} />

        <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-5 border-0 p-0">
          <FormSection
            title={t("reservationForm.section")}
            description={t("reservationForm.sectionDescription")}
          >
            <Field label={t("lines.item")} name="inventoryItemId" required>
              <FormSelect
                id="inventoryItemId"
                name="inventoryItemId"
                className={selectClass}
                value={inventoryItemId}
                onChange={(event) => setItemId(event.target.value)}
                required
              >
                <option value="">{options.items.length === 0 ? t("lines.noItems") : t("lines.chooseItem")}</option>
                {options.items.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FormSelect>
            </Field>

            <Field label={t("fields.project")} name="projectId" hint={t("reservationForm.projectHint")}>
              <FormSelect
                id="projectId"
                name="projectId"
                className={selectClass}
                defaultValue={defaults?.projectId ?? ""}
              >
                <option value="">{t("fields.notSet")}</option>
                {options.projects.map((project) => (
                  <option key={project.value} value={project.value}>
                    {project.label}
                  </option>
                ))}
              </FormSelect>
            </Field>

            <Field label={t("fields.warehouse")} name="warehouseId" required>
              <FormSelect
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
                <option value="">{t("fields.chooseWarehouse")}</option>
                {options.warehouses.map((warehouse) => (
                  <option key={warehouse.value} value={warehouse.value}>
                    {warehouse.label}
                  </option>
                ))}
              </FormSelect>
            </Field>

            <Field label={t("lines.location")} name="locationId" required>
              <FormSelect
                id="locationId"
                name="locationId"
                className={selectClass}
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                required
                disabled={!warehouseId}
              >
                <option value="">
                  {!warehouseId ? t("lines.chooseWarehouseFirst") : locations.length === 0 ? t("lines.noLocations") : t("lines.chooseLocation")}
                </option>
                {locations.map((location) => (
                  <option key={location.value} value={location.value}>
                    {location.label}
                  </option>
                ))}
              </FormSelect>
            </Field>

            <div className="sm:col-span-2">
              <DecimalCell
                id="quantity"
                name="quantity"
                label={t("lines.quantity")}
                markRequired
                unit={item?.unit}
                value={quantity}
                rule={{ label: t("lines.quantity"), ...RATE_RULE }}
                refine={(value) => (isPositiveDecimal(value) ? null : t("lines.quantityPositive"))}
                serverError={quantityEdited ? undefined : errors.quantity?.[0]}
                onChange={(value) => {
                  setQuantity(value);
                  setQuantityEdited(true);
                }}
              />
            </div>

            <Field label={t("fields.requiredBy")} name="requiredDate">
              <Input id="requiredDate" name="requiredDate" type="date" />
            </Field>

            <Field
              label={t("fields.expires")}
              name="expiresAt"
              hint={t("reservationForm.expiresHint")}
            >
              <Input id="expiresAt" name="expiresAt" type="date" />
            </Field>
          </FormSection>

          {held ? (
            <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
              <span className="tabular-nums text-fg">{formatQuantity(held.available)}</span>{" "}
              {t("reservationForm.availableBefore")}
              {availableAfter === null ? null : (
                <>
                  {", "}
                  <span
                    className={
                      availableAfter.startsWith("-")
                        ? "tabular-nums text-danger-strong"
                        : "tabular-nums text-fg"
                    }
                  >
                    {formatQuantity(availableAfter)}
                  </span>{" "}
                  {t("reservationForm.after")}
                </>
              )}
              {t("reservationForm.serverChecks")}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || Boolean(save.saved)}>
            {pending ? t("reservationForm.reserving") : t("reservationForm.submit")}
          </Button>
          {/* Guarded navigation: asks first while anything is unsaved (§4). */}
          <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)} disabled={pending}>
            {t("actions.cancel")}
          </Button>
          <UnsavedIndicator save={save} />
        </div>
      </form>
    </FieldErrorProvider>
  );
}
