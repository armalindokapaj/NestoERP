"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { CellError, DecimalCell, RemovedLineNotice, useLineRows, useRowErrors } from "@/components/finance/line-rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ItemOption,
  LocationOption,
} from "@/lib/modules/inventory/inventory.options";
import { isPositiveDecimal, isZeroDecimal, previewDecimal, sumDecimal } from "@/lib/modules/finance/finance.decimal";
import { RATE_RULE } from "@/lib/modules/finance/finance.fields";
import { MAX_LINE_ITEMS } from "@/lib/modules/finance/finance.form-data";
import { formatQuantity } from "./inventory-format";
import { useInventoryTranslations } from "./inventory-text";

/**
 * The line editor every stock document shares (PRD #20 §313, §315, §317).
 *
 * Lines post as `lines.0.inventoryItemId` and so on — named by their position at
 * submit, the canonical path the server's errors come back under — and keep a
 * stable local id, so an error is put on the row it was about even after rows
 * are removed (AUD-09 §3, §7, FV-16). A line's location depends on the chosen
 * warehouse (FV-08). Numbers use the shared decimal rule.
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

/** On hand after a signed change, exactly (AUD-09 §7): a preview, never a decision. */
function resultingOnHand(onHand: string | undefined, delta: string): string | null {
  if (onHand === undefined) return null;
  const change = previewDecimal(delta, 4);
  if (change === null) return null;
  return sumDecimal([onHand, change], 4);
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
  const t = useInventoryTranslations();
  const positiveQuantity = (value: string) => (isPositiveDecimal(value) ? null : t("lines.quantityPositive"));
  const nonZeroDelta = (value: string) => (isZeroDecimal(value) ? t("lines.deltaNonZero") : null);
  const instance = React.useId();
  const empty = React.useCallback((): StockLineValue => ({ ...EMPTY }), []);
  const { rows, add, remove, update, atLimit, removed, undo, dismissRemoved } = useLineRows(initial ?? [], empty, { max: MAX_LINE_ITEMS });
  const errors = useRowErrors(
    "lines",
    rows.map((row) => row.rowId),
  );
  const [cleared, setCleared] = React.useState<string | null>(null);

  const balanceKey = React.useMemo(() => {
    const map = new Map<string, HeldBalance>();
    for (const row of balances) map.set(`${row.inventoryItemId}:${row.locationId}`, row);
    return map;
  }, [balances]);

  function change(rowId: string, patch: Partial<StockLineValue>) {
    update(rowId, patch);
    for (const field of Object.keys(patch)) errors.clear(rowId, field);
  }

  const sourceScope = variant === "transfer" ? fromWarehouseId : warehouseId;
  const sourceLocations = React.useMemo(
    () => (sourceScope ? locations.filter((location) => location.warehouseId === sourceScope) : []),
    [locations, sourceScope],
  );
  const destinationLocations = React.useMemo(
    () => (toWarehouseId ? locations.filter((location) => location.warehouseId === toWarehouseId) : []),
    [locations, toWarehouseId],
  );

  /*
   * A warehouse change (AUD-09 §5, FV-08): a line's location that is still in
   * the chosen warehouse is kept; one that is not is cleared, and the form says
   * so — never silently, and never by picking the first location instead.
   */
  const scopes = `${sourceScope ?? ""}|${toWarehouseId ?? ""}`;
  const previousScopes = React.useRef(scopes);
  React.useEffect(() => {
    if (previousScopes.current === scopes) return;
    previousScopes.current = scopes;
    const inSource = new Set(sourceLocations.map((location) => location.value));
    const inDestination = new Set(destinationLocations.map((location) => location.value));
    let count = 0;
    for (const row of rows) {
      const patch: Partial<StockLineValue> = {};
      if (variant === "transfer") {
        if (row.fromLocationId && !inSource.has(row.fromLocationId)) patch.fromLocationId = "";
        if (row.toLocationId && !inDestination.has(row.toLocationId)) patch.toLocationId = "";
      } else if (row.locationId && !inSource.has(row.locationId)) {
        patch.locationId = "";
      }
      if (Object.keys(patch).length > 0) {
        count += 1;
        update(row.rowId, patch);
      }
    }
    setCleared(count > 0 ? t("lines.locationCleared", { count }) : null);
    // Only a change of warehouse runs this; typing in a line does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopes]);

  const listErrorId = `${instance}-lines-error`;

  return (
    <div className="space-y-3" aria-describedby={errors.list ? listErrorId : undefined}>
      <p className="text-meta text-fg-subtle">{t("lines.decimalsHint")}</p>
      <CellError id={listErrorId} message={errors.list} />
      {cleared ? (
        <p role="status" className="text-meta text-warning-strong">
          {cleared}
        </p>
      ) : null}

      <div className="space-y-3">
        {rows.map((line, index) => {
          const item = items.find((option) => option.value === line.inventoryItemId);
          const held = balanceKey.get(
            `${line.inventoryItemId}:${variant === "transfer" ? line.fromLocationId : line.locationId}`,
          );
          const rowErrors = errors.forRow(line.rowId);
          const base = `${instance}-${line.rowId}`;
          const described = (field: string) => (rowErrors[field] ? `${base}-${field}-error` : undefined);

          return (
            <div key={line.rowId} className="nesto-card space-y-3 p-4" data-line-row={line.rowId}>
              <div className="flex items-start justify-between gap-3">
                <p className="nesto-eyebrow text-fg-subtle">{t("lines.line", { number: index + 1 })}</p>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${t("lines.removeLine", { number: index + 1 })}${item ? `: ${item.label}` : ""}`}
                    onClick={() => remove(line.rowId)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              {line.id ? <input type="hidden" name={`lines.${index}.id`} value={line.id} /> : null}

              <div className="space-y-1.5">
                <Label htmlFor={`${base}-item`}>{t("lines.item")}</Label>
                <select
                  id={`${base}-item`}
                  name={`lines.${index}.inventoryItemId`}
                  className={selectClass}
                  value={line.inventoryItemId}
                  onChange={(event) => change(line.rowId, { inventoryItemId: event.target.value })}
                  required
                  aria-invalid={rowErrors.inventoryItemId ? true : undefined}
                  aria-describedby={described("inventoryItemId")}
                >
                  <option value="">{items.length === 0 ? t("lines.noItems") : t("lines.chooseItem")}</option>
                  {items.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <CellError id={`${base}-inventoryItemId-error`} message={rowErrors.inventoryItemId} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {variant === "transfer" ? (
                  <>
                    <LocationSelect
                      id={`${base}-fromLocationId`}
                      name={`lines.${index}.fromLocationId`}
                      label={t("lines.fromLocation")}
                      value={line.fromLocationId ?? ""}
                      options={sourceLocations}
                      scopeChosen={Boolean(fromWarehouseId)}
                      error={rowErrors.fromLocationId}
                      onChange={(value) => change(line.rowId, { fromLocationId: value })}
                    />
                    <LocationSelect
                      id={`${base}-toLocationId`}
                      name={`lines.${index}.toLocationId`}
                      label={t("lines.toLocation")}
                      value={line.toLocationId ?? ""}
                      options={destinationLocations}
                      scopeChosen={Boolean(toWarehouseId)}
                      error={rowErrors.toLocationId}
                      onChange={(value) => change(line.rowId, { toLocationId: value })}
                    />
                  </>
                ) : (
                  <LocationSelect
                    id={`${base}-locationId`}
                    name={`lines.${index}.locationId`}
                    label={t("lines.location")}
                    value={line.locationId ?? ""}
                    options={sourceLocations}
                    scopeChosen={Boolean(warehouseId)}
                    error={rowErrors.locationId}
                    onChange={(value) => change(line.rowId, { locationId: value })}
                  />
                )}

                {variant === "adjustment" ? (
                  <DecimalCell
                    id={`${base}-quantityDelta`}
                    name={`lines.${index}.quantityDelta`}
                    label={t("lines.change")}
                    unit={item?.unit}
                    value={line.quantityDelta ?? ""}
                    rule={{ label: t("lines.adjustment"), ...RATE_RULE, allowNegative: true }}
                    refine={nonZeroDelta}
                    serverError={rowErrors.quantityDelta}
                    onChange={(value) => change(line.rowId, { quantityDelta: value })}
                  />
                ) : (
                  <DecimalCell
                    id={`${base}-quantity`}
                    name={`lines.${index}.quantity`}
                    label={t("lines.quantity")}
                    unit={item?.unit}
                    value={line.quantity ?? ""}
                    rule={{ label: t("lines.quantity"), ...RATE_RULE }}
                    refine={positiveQuantity}
                    serverError={rowErrors.quantity}
                    onChange={(value) => change(line.rowId, { quantity: value })}
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${base}-notes`}>{t("lines.note")}</Label>
                <Input
                  id={`${base}-notes`}
                  name={`lines.${index}.notes`}
                  value={line.notes ?? ""}
                  onChange={(event) => change(line.rowId, { notes: event.target.value })}
                  maxLength={500}
                  aria-invalid={rowErrors.notes ? true : undefined}
                  aria-describedby={described("notes")}
                />
                <CellError id={`${base}-notes-error`} message={rowErrors.notes} />
              </div>

              {held ? (
                <p className="text-meta text-fg-subtle">
                  <span className="tabular-nums text-fg">{formatQuantity(held.onHand)}</span>{" "}
                  {t("lines.onHandHere")}{" "}
                  <span className="tabular-nums text-fg">{formatQuantity(held.available)}</span>{" "}
                  {t("lines.available")}
                  {variant === "adjustment" && line.quantityDelta
                    ? (() => {
                        const result = resultingOnHand(held.onHand, line.quantityDelta);
                        return result === null ? null : (
                          <>
                            {` · ${t("lines.wouldBecome")} `}
                            <span className="tabular-nums text-fg">
                              {formatQuantity(result)}
                            </span>
                          </>
                        );
                      })()
                    : null}
                  {t("lines.serverChecks")}
                </p>
              ) : line.inventoryItemId && (line.locationId || line.fromLocationId) ? (
                <p className="text-meta text-fg-subtle">
                  {t("lines.nothingHere")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* A mis-tapped remove on a phone is announced and can be undone, as on finance lines (AUD-04 §6, MW-08). */}
      <RemovedLineNotice removed={removed} label={items.find((option) => option.value === removed?.row.inventoryItemId)?.label} onUndo={undo} onDismiss={dismissRemoved} />

      <Button type="button" variant="secondary" size="sm" onClick={add} disabled={atLimit}>
        <Plus aria-hidden="true" />
        {t("lines.addLine")}
      </Button>
      {atLimit ? <p className="text-meta text-fg-subtle">{t("lines.atLimit", { max: MAX_LINE_ITEMS })}</p> : null}
    </div>
  );
}

/**
 * A location picker that depends on a warehouse (AUD-09 §5, FV-08): "Choose a
 * warehouse first" while none is chosen, "No locations" when the warehouse has
 * none — distinct states, and never an automatic first choice.
 */
function LocationSelect({
  id,
  name,
  label,
  value,
  options,
  scopeChosen,
  error,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: LocationOption[];
  scopeChosen: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const t = useInventoryTranslations();
  const placeholder = !scopeChosen ? t("lines.chooseWarehouseFirst") : options.length === 0 ? t("lines.noLocations") : t("lines.chooseLocation");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        disabled={!scopeChosen}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <CellError id={`${id}-error`} message={error} />
    </div>
  );
}
