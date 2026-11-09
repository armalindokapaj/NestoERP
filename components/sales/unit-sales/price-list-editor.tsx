"use client";

import * as React from "react";
import { Car, ChevronDown, RotateCcw } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { useLocale } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { areaText, failureMessage, isFailure, numberText, structureApi } from "@/components/project-structure/structure-ui";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { parseOptionalDecimal } from "@/lib/forms/decimal";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import { MONEY_RULE } from "@/lib/modules/finance/finance.fields";
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import { prevailingPrice, prevailingRate, priceFromRate, saleArea, saleRate } from "@/lib/modules/sales/units/unit-pricing.rules";
import type { PriceListDTO, PriceListSaveResult, PriceListUnitDTO } from "@/lib/modules/sales/units/unit-pricing.types";
import { saleStatusOf } from "@/lib/modules/sales/units/unit-sales.rules";
import { SALES_REASON_MAX, type UnitPriceBasis } from "@/lib/modules/sales/units/unit-sales.types";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { cn } from "@/lib/utils/cn";
import { CommercialStatusBadge, moneyLabel, perSqmLabel } from "./commercial-status";

/**
 * A project's price list (2026-11). A floor is priced at one rate per m² of
 * each unit's sale area — its saleable area when typed, else its gross area,
 * the rule every screen follows (2026-11-09) — and every parking space at one
 * price; either only fills in the units' own
 * prices, which stay editable one by one until Save sends the ones that
 * changed. A sold unit's price is frozen and never filled in. The server
 * decides again, keeps each change's history and refuses the whole save if
 * someone changed one of these units meanwhile.
 */

type Draft = { price: string; basis: UnitPriceBasis };
type Located = PriceListUnitDTO & { building: string; floor: string };

const PRICE_RULE = { label: "Price", ...MONEY_RULE };

function baseline(unit: PriceListUnitDTO): Draft {
  return { price: unit.askingPrice === null ? "" : shortMoney(unit.askingPrice), basis: unit.priceBasis };
}

/** "102444.00" → "102444"; cents stay when there are any. */
function shortMoney(value: string): string {
  return value.endsWith(".00") ? value.slice(0, -3) : value;
}

/** A canonical amount with exactly two decimals, on the string — a float would lose a 15-digit price. */
function twoDecimals(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${(fraction + "00").slice(0, 2)}`;
}

/** The typed price as the server will read it: null for empty, undefined when it is not a valid amount. */
function canonical(text: string): string | null | undefined {
  const parsed = parseOptionalDecimal(text, PRICE_RULE);
  if (!parsed.ok) return undefined;
  return parsed.value === null ? null : twoDecimals(parsed.value);
}

function isChanged(unit: PriceListUnitDTO, draft: Draft): boolean {
  const price = canonical(draft.price);
  if (price === undefined) return true;
  if (price !== unit.askingPrice) return true;
  return price !== null && draft.basis !== unit.priceBasis;
}

function units(list: PriceListDTO): Located[] {
  return list.buildings.flatMap((building) => building.floors.flatMap((floor) => floor.units.map((unit) => ({ ...unit, building: building.name, floor: floor.name }))));
}

function draftsOf(list: PriceListDTO): Record<string, Draft> {
  return Object.fromEntries(units(list).map((unit) => [unit.id, baseline(unit)]));
}

function mostUsedCurrency(list: PriceListDTO): string {
  const tally = new Map<string, number>();
  for (const unit of units(list)) if (unit.currency && unit.askingPrice !== null) tally.set(unit.currency, (tally.get(unit.currency) ?? 0) + 1);
  let best = list.baseCurrency;
  for (const [code, count] of tally) if (count > (tally.get(best) ?? 0)) best = code;
  return best;
}

export function PriceListEditor({ initial, canEditUnits = false }: { initial: PriceListDTO; canEditUnits?: boolean }) {
  const locale = useLocale();
  const t = useSalesTranslations();
  const toast = useToast();
  const [list, setList] = React.useState(initial);
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(() => draftsOf(initial));
  const [currency, setCurrency] = React.useState(() => mostUsedCurrency(initial));
  const all = React.useMemo(() => units(list), [list]);
  const [rates, setRates] = React.useState<Record<string, string>>({});
  const [parkingPrice, setParkingPrice] = React.useState("");
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  /** The floors whose rate skipped units with no area: their note links to those units, ticked, on Units (2026-11-09). */
  const [noArea, setNoArea] = React.useState<Record<string, boolean>>({});
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [problem, setProblem] = React.useState<{ message: string; reload: boolean } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [showParking, setShowParking] = React.useState(false);
  const running = React.useRef(false);

  const parking = all.filter((unit) => unit.category === "PARKING");
  const changed = all.filter((unit) => drafts[unit.id] && isChanged(unit, drafts[unit.id]!));
  const dirty = changed.length > 0;

  const editor = useUnsavedEditor({ module: "sales", saveKind: "save", label: () => t("priceList.title"), save: () => save() });
  const { setDirty, setSaving, setUnresolved, requestDismiss } = editor;
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);

  function setDraft(unitId: string, draft: Draft) {
    setDrafts((current) => ({ ...current, [unitId]: draft }));
    setErrors((current) => {
      if (!current[unitId]) return current;
      const next = { ...current };
      delete next[unitId];
      return next;
    });
  }

  function fill(targets: PriceListUnitDTO[], priceOf: (unit: PriceListUnitDTO) => Draft | null): number {
    let skipped = 0;
    const next: Record<string, Draft> = {};
    for (const unit of targets) {
      if (unit.status === "SOLD") continue;
      const draft = priceOf(unit);
      if (draft) next[unit.id] = draft;
      else skipped += 1;
    }
    setDrafts((current) => ({ ...current, ...next }));
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !(id in next))));
    return skipped;
  }

  function applyFloor(floorId: string, floorUnits: PriceListUnitDTO[]) {
    const parsed = parseOptionalDecimal(rates[floorId] ?? "", PRICE_RULE);
    if (!parsed.ok || parsed.value === null) {
      setNotes((current) => ({ ...current, [floorId]: parsed.ok ? t("priceList.noRate") : parsed.message }));
      return;
    }
    const rate = parsed.value;
    const skipped = fill(floorUnits, (unit) => {
      const sale = saleArea(unit);
      const price = priceFromRate(rate, sale.area);
      return price === null ? null : { price: shortMoney(price), basis: sale.basis };
    });
    setNotes((current) => ({ ...current, [floorId]: skipped ? t("priceList.skippedNoArea", { count: skipped }) : "" }));
    setNoArea((current) => ({ ...current, [floorId]: skipped > 0 }));
  }

  function applyParking() {
    const parsed = parseOptionalDecimal(parkingPrice, PRICE_RULE);
    if (!parsed.ok || parsed.value === null) {
      setNotes((current) => ({ ...current, parking: parsed.ok ? t("priceList.noParkingPrice") : parsed.message }));
      return;
    }
    const price = shortMoney(twoDecimals(parsed.value));
    fill(parking, () => ({ price, basis: "FIXED_UNIT_PRICE" }));
    setNotes((current) => ({ ...current, parking: "" }));
  }

  /** A price typed by hand: on the unit's sale area when it has one, else a fixed price; parking is always fixed. */
  function typed(unit: PriceListUnitDTO, text: string) {
    const basis: UnitPriceBasis = unit.category === "PARKING" ? "FIXED_UNIT_PRICE" : saleArea(unit).basis;
    setDraft(unit.id, { price: numberText(text), basis });
  }

  function reset(next: PriceListDTO, keepFrom?: { list: PriceListDTO; drafts: Record<string, Draft> }) {
    const fresh = draftsOf(next);
    if (keepFrom) {
      // A reload keeps what was typed for every unit nobody else changed meanwhile.
      const before = new Map(units(keepFrom.list).map((unit) => [unit.id, unit.version]));
      for (const unit of units(next)) if (before.get(unit.id) === unit.version && keepFrom.drafts[unit.id]) fresh[unit.id] = keepFrom.drafts[unit.id]!;
    }
    setList(next);
    setDrafts(fresh);
    setErrors({});
    setProblem(null);
  }

  async function reload() {
    try {
      const next = await structureApi<PriceListDTO>(`/api/projects/${list.projectId}/sales/prices`);
      reset(next, { list, drafts });
    } catch (error) {
      setProblem({ message: failureMessage(error, t("priceList.saveFailed")), reload: true });
    }
  }

  async function save(): Promise<SaveOutcome> {
    if (running.current) return { kind: "unknown" };
    const found: Record<string, string> = {};
    const prices = changed.map((unit) => {
      const draft = drafts[unit.id]!;
      const parsed = parseOptionalDecimal(draft.price, PRICE_RULE);
      if (!parsed.ok) found[unit.id] = parsed.message;
      return { unitId: unit.id, askingPrice: parsed.ok && parsed.value !== null ? twoDecimals(parsed.value) : null, priceBasis: draft.basis, expectedVersion: unit.version };
    });
    setErrors(found);
    if (parking.some((unit) => found[unit.id])) setShowParking(true);
    if (Object.keys(found).length) {
      setProblem({ message: t("priceList.invalid"), reload: false });
      return { kind: "invalid" };
    }
    if (!prices.length) return { kind: "committed" };
    running.current = true;
    setPending(true);
    setSaving(true);
    setProblem(null);
    try {
      const result = await structureApi<PriceListSaveResult>(`/api/projects/${list.projectId}/sales/prices`, { method: "PUT", body: { currency, reason, prices } });
      setUnresolved(false);
      reset(result.list);
      setReason("");
      setNotes({});
      setRates({});
      setParkingPrice("");
      setDirty(false);
      toast({ title: t("priceList.saved", { count: result.saved }), tone: "success" });
      return { kind: "committed" };
    } catch (error) {
      if (!isFailure(error) || error.status === 0) {
        // No answer: it may have saved. The values stay; a reload shows what is there.
        setUnresolved(true);
        setProblem({ message: OUTCOME_COPY.unknown, reload: true });
        return { kind: "unknown" };
      }
      const code = error.detailCode;
      const unit = typeof error.details.unitLabel === "string" ? error.details.unitLabel : typeof error.details.unitCode === "string" ? error.details.unitCode : "";
      if (code === "UNIT_SALES_STALE") setProblem({ message: t("priceList.stale"), reload: true });
      else if (code === "UNIT_SOLD") setProblem({ message: t("priceList.sold", { unit }), reload: true });
      else if (code === "PRICE_LIST_UNIT_NOT_FOUND") setProblem({ message: t("priceList.missingUnit"), reload: true });
      else setProblem({ message: failureMessage(error, t("priceList.saveFailed")), reload: false });
      if (code === "UNIT_SALES_STALE" || code === "UNIT_SOLD") return { kind: "conflict" };
      return { kind: error.status === 403 || error.status === 404 ? "refused" : "invalid" };
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
  }

  function discard() {
    void requestDismiss(() => {
      setDrafts(draftsOf(list));
      setErrors({});
      setNotes({});
      setProblem(null);
      setReason("");
    });
  }

  if (all.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="price-list-empty">
        {t("priceList.noUnits")}
      </p>
    );
  }

  const row = (unit: Located, options: { showLocation: boolean }) => {
    const draft = drafts[unit.id] ?? baseline(unit);
    const sold = unit.status === "SOLD";
    const unitChanged = isChanged(unit, draft);
    const price = canonical(draft.price);
    // Per m² of the sale area shown beside it, whatever basis the price was saved on — as every list shows it.
    const sale = saleArea(unit);
    const rate = price === undefined ? null : saleRate(unit, price);
    const area = sale.area;
    const inputId = `price-${unit.id}`;
    const undo = (className?: string) =>
      unitChanged && !sold ? (
        <Button variant="ghost" size="icon-sm" className={className} aria-label={t("priceList.undo", { unit: unit.label })} title={t("priceList.undo", { unit: unit.label })} onClick={() => setDraft(unit.id, baseline(unit))} disabled={pending}>
          <RotateCcw aria-hidden="true" />
        </Button>
      ) : null;
    return (
      <tr key={unit.id} className={cn("border-t border-line", CARD.row, unitChanged && "bg-accent-soft/40")} data-testid="price-row" data-unit-code={unit.unitCode} data-changed={unitChanged ? "true" : "false"}>
        <td className={cn("px-3 py-2 font-medium text-fg", CARD.code)}>{unit.label}</td>
        {options.showLocation ? (
          <td className={cn("px-3 py-2 text-fg-muted", CARD.location)}>
            {unit.building} · {floorName(unit.floor, locale)}
          </td>
        ) : (
          <td className={cn("px-3 py-2 text-fg-muted", CARD.type)}>{unitTypeName(unit.unitType, locale)}</td>
        )}
        {options.showLocation ? null : (
          <td className={cn("px-3 py-2 text-right tabular-nums text-fg-muted", CARD.area)} data-testid="price-area" data-basis={sale.basis}>
            {areaText(area, locale)}
            {area !== null ? <span className="block text-micro text-fg-subtle">{sale.basis === "SALEABLE_AREA" ? t("priceList.areaSaleable") : t("priceList.areaGross")}</span> : null}
          </td>
        )}
        <td className={cn("px-3 py-2", CARD.status)}>
          <CommercialStatusBadge status={saleStatusOf(unit.status, unit.askingPrice)} />
        </td>
        <td className={cn("px-3 py-2", CARD.price)}>
          {/* A phone's card names the field and shows the saved price beside it: its table heading is not drawn there. */}
          <span className="min-w-0 md:hidden">
            <span className="block text-meta font-medium text-fg-muted" aria-hidden="true">
              {t("priceList.price")} ({currency})
            </span>
            <span className="block text-meta tabular-nums text-fg-subtle">
              {unit.askingPrice === null ? t("priceList.notPriced") : t("priceList.savedPrice", { price: moneyLabel(unit.askingPrice, unit.currency, locale) })}
              {/* A sold unit has no field: its price per m² goes on this line. */}
              {sold && !options.showLocation ? ` · ${perSqmLabel(rate, currency, locale)}` : null}
            </span>
          </span>
          {sold ? (
            <span className="block text-right tabular-nums text-fg-muted max-md:hidden" title={t("priceList.soldLocked")}>
              {moneyLabel(unit.askingPrice, unit.currency, locale)}
            </span>
          ) : (
            <div className="flex items-start justify-end gap-1">
              <div className="flex flex-col items-end gap-0.5">
                <label htmlFor={inputId} className="sr-only">
                  {t("priceList.priceFor", { unit: unit.label })}
                </label>
                <Input
                  id={inputId}
                  inputMode="decimal"
                  className={cn("h-8 w-36 text-right tabular-nums max-md:w-32", errors[unit.id] && "border-danger")}
                  value={draft.price}
                  onChange={(event) => typed(unit, event.target.value)}
                  aria-invalid={errors[unit.id] ? true : undefined}
                  aria-describedby={errors[unit.id] ? `${inputId}-error` : undefined}
                  placeholder={!options.showLocation && area === null ? t("priceList.noArea") : undefined}
                  disabled={pending}
                  data-testid="price-input"
                />
                {errors[unit.id] ? (
                  <span id={`${inputId}-error`} className="text-meta text-danger-strong">
                    {errors[unit.id]}
                  </span>
                ) : null}
                {/* On a phone the typed price per m² sits under the field; from md it has its own column. */}
                {options.showLocation ? null : <span className="text-meta tabular-nums text-fg-subtle md:hidden">{perSqmLabel(rate, currency, locale)}</span>}
              </div>
              {/* On a phone Undo sits beside the field; the table's own column is not drawn there. */}
              {undo("md:hidden")}
            </div>
          )}
        </td>
        {options.showLocation ? null : <td className="px-3 py-2 text-right tabular-nums text-fg-muted max-md:hidden" data-testid="price-per-sqm">{perSqmLabel(rate, currency, locale)}</td>}
        <td className="w-10 px-1 py-2 text-right max-md:hidden">{undo()}</td>
      </tr>
    );
  };

  const pricedCount = (group: PriceListUnitDTO[]) => group.filter((unit) => canonical((drafts[unit.id] ?? baseline(unit)).price)).length;
  const parkingCurrent = prevailingPrice(parking);

  return (
    <div className="space-y-4 pb-24" data-testid="price-list">
      <section className="space-y-3 rounded-md border border-line bg-surface p-4">
        <p className="text-table text-fg-muted">{t("priceList.description")}</p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-meta font-medium text-fg-muted" htmlFor="price-list-currency">
              {t("priceList.currency")}
            </label>
            <FormSelect id="price-list-currency" className={cn(selectClass, "w-auto")} value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={pending}>
              {SUPPORTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </FormSelect>
          </div>
        </div>
      </section>

      {parking.length ? (
        <section className="rounded-md border border-line bg-surface" data-testid="price-parking">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 text-section font-semibold text-fg">
                <Car aria-hidden="true" className="size-4 text-fg-muted" />
                {t("priceList.parking")}
              </h2>
              <p className="text-meta text-fg-muted">
                {t("priceList.parkingCount", { count: parking.length })} · {t("priceList.priced", { priced: pricedCount(parking), total: parking.length })}
              </p>
            </div>
            <RateControl
              id="price-parking-rate"
              label={t("priceList.parkingPrice")}
              value={parkingPrice}
              placeholder={parkingCurrent ? shortMoney(parkingCurrent) : undefined}
              onChange={setParkingPrice}
              onApply={applyParking}
              applyLabel={t("priceList.applyParking")}
              suffix={currency}
              disabled={pending}
              note={notes.parking}
              testId="parking"
            />
          </header>
          <div className="border-b border-line px-4 py-2 last:border-b-0">
            <Button variant="ghost" size="sm" onClick={() => setShowParking((open) => !open)} aria-expanded={showParking} aria-controls="price-parking-spaces" data-testid="parking-toggle">
              <ChevronDown aria-hidden="true" className={cn("transition-transform", showParking && "rotate-180")} />
              {showParking ? t("priceList.hideSpaces") : t("priceList.showSpaces", { count: parking.length })}
            </Button>
          </div>
          {showParking ? (
            <div id="price-parking-spaces">
              <PriceTable columns={PARKING_COLUMNS} headings={[t("priceList.unit"), t("priceList.location"), t("priceList.status"), `${t("priceList.price")} (${currency})`]}>
                {parking.map((unit) => row(unit, { showLocation: true }))}
              </PriceTable>
            </div>
          ) : null}
        </section>
      ) : null}

      {list.buildings.map((building) => {
        const floors = building.floors.map((floor) => ({ ...floor, units: floor.units.filter((unit) => unit.category !== "PARKING") })).filter((floor) => floor.units.length > 0);
        if (!floors.length) return null;
        return (
          <section key={building.id} className="space-y-3" data-testid="price-building">
            {list.buildings.length > 1 ? <h2 className="text-section font-semibold text-fg">{building.name}</h2> : null}
            {floors.map((floor) => {
              const located = floor.units.map((unit) => ({ ...unit, building: building.name, floor: floor.name }));
              const current = prevailingRate(floor.units);
              const label = floorName(floor.name, locale);
              return (
                <div key={floor.id} className="rounded-md border border-line bg-surface" data-testid="price-floor" data-floor-name={floor.name}>
                  <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
                    <div>
                      <h3 className="text-table font-semibold text-fg">{label}</h3>
                      <p className="text-meta text-fg-muted">
                        {t("priceList.unitCount", { count: floor.units.length })} · {t("priceList.priced", { priced: pricedCount(floor.units), total: floor.units.length })}
                      </p>
                    </div>
                    <RateControl
                      id={`price-rate-${floor.id}`}
                      label={t("priceList.floorRateFor", { floor: label })}
                      visibleLabel={t("priceList.floorRate")}
                      value={rates[floor.id] ?? ""}
                      placeholder={current ? shortMoney(current) : undefined}
                      onChange={(value) => setRates((all) => ({ ...all, [floor.id]: value }))}
                      onApply={() => applyFloor(floor.id, floor.units)}
                      applyLabel={t("priceList.apply")}
                      applyHint={t("priceList.applyHint")}
                      suffix={`${currency}/m²`}
                      disabled={pending}
                      note={notes[floor.id]}
                      noteLink={noArea[floor.id] ? { href: `/projects/${list.projectId}/units?floor=${floor.id}&tick=no-area`, label: canEditUnits ? t("priceList.fillAreas") : t("priceList.showOnUnits") } : undefined}
                      testId="floor"
                    />
                  </header>
                  <PriceTable columns={FLOOR_COLUMNS} headings={[t("priceList.unit"), t("priceList.type"), t("priceList.area"), t("priceList.status"), `${t("priceList.price")} (${currency})`, t("priceList.perSqm")]}>
                    {located.map((unit) => row(unit, { showLocation: false }))}
                  </PriceTable>
                </div>
              );
            })}
          </section>
        );
      })}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-lg" data-testid="price-save-bar">
        <span className="text-table font-medium text-fg" data-testid="price-changed-count" aria-live="polite">
          {dirty ? t("priceList.changed", { count: changed.length }) : t("priceList.noChanges")}
        </span>
        <label htmlFor="price-list-reason" className="sr-only">
          {t("priceList.reason")}
        </label>
        <Input id="price-list-reason" className="h-8 min-w-0 flex-1 sm:max-w-xs" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={SALES_REASON_MAX} placeholder={`${t("priceList.reason")} — ${t("priceList.reasonPlaceholder")}`} disabled={pending || !dirty} />
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={discard} disabled={pending || !dirty}>
            {t("priceList.discard")}
          </Button>
          <Button onClick={() => void save()} disabled={pending || !dirty} data-testid="price-save">
            {pending ? t("priceList.saving") : t("priceList.save")}
          </Button>
        </div>
        {problem ? (
          <div role="alert" className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
            <span>{problem.message}</span>
            {problem.reload ? (
              <Button variant="secondary" size="sm" onClick={() => void reload()}>
                {t("priceList.reload")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RateControl({
  id,
  label,
  visibleLabel,
  value,
  placeholder,
  onChange,
  onApply,
  applyLabel,
  applyHint,
  suffix,
  disabled,
  note,
  noteLink,
  testId,
}: {
  id: string;
  label: string;
  visibleLabel?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onApply: () => void;
  applyLabel: string;
  applyHint?: string;
  suffix: string;
  disabled: boolean;
  note?: string;
  /** A way to fix what the note says: the skipped units, ticked, on the Units tab. */
  noteLink?: { href: string; label: string };
  testId: string;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-meta font-medium text-fg-muted">
            <span aria-hidden={visibleLabel ? true : undefined}>{visibleLabel ?? label}</span>
            {visibleLabel ? <span className="sr-only">{label}</span> : null}
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              id={id}
              inputMode="decimal"
              className="h-8 w-32 text-right tabular-nums"
              value={value}
              placeholder={placeholder}
              onChange={(event) => onChange(numberText(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onApply();
                }
              }}
              disabled={disabled}
              data-testid={`${testId}-rate-input`}
            />
            <span className="text-meta text-fg-subtle">{suffix}</span>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onApply} disabled={disabled} title={applyHint} data-testid={`${testId}-apply`}>
          {applyLabel}
        </Button>
      </div>
      {note ? (
        <p className="text-meta text-warning-strong" role="status">
          {note}
          {noteLink ? (
            <>
              {" "}
              <Link href={noteLink.href} className="font-medium underline underline-offset-2 hover:text-fg" data-testid={`${testId}-fix-link`}>
                {noteLink.label}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/*
 * Below md each unit is a card rather than a table row (mobile audit 2a): its
 * code and status on the first line, its type and sale area (a parking
 * space's location) under them, then its price field across the card with the
 * saved price beside it. The same cells and the same field, placed by CSS, so
 * nothing scrolls sideways; from md it is the table.
 */
const CARD = {
  row: "max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-3 max-md:gap-y-1 max-md:px-4 max-md:py-3",
  code: "max-md:col-start-1 max-md:row-start-1 max-md:p-0 max-md:text-body",
  status: "max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end max-md:p-0",
  type: "max-md:col-start-1 max-md:row-start-2 max-md:p-0 max-md:text-meta",
  area: "max-md:col-start-2 max-md:row-start-2 max-md:p-0 max-md:text-meta",
  location: "max-md:col-span-2 max-md:row-start-2 max-md:p-0 max-md:text-meta",
  price: "max-md:col-span-2 max-md:row-start-3 max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:p-0 max-md:pt-1",
};

/** Fixed widths, so every floor's columns line up under the one above. */
type Column = { width: string; numeric?: boolean };
const FLOOR_COLUMNS: Column[] = [{ width: "w-[14%]" }, { width: "w-[18%]" }, { width: "w-[12%]", numeric: true }, { width: "w-[16%]" }, { width: "w-[22%]", numeric: true }, { width: "w-[14%]", numeric: true }];
const PARKING_COLUMNS: Column[] = [{ width: "w-[14%]" }, { width: "w-[30%]" }, { width: "w-[16%]" }, { width: "w-[36%]", numeric: true }];

function PriceTable({ columns, headings, children }: { columns: Column[]; headings: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-table max-md:block md:min-w-[44rem]">
        <thead className="max-md:sr-only">
          <tr className="text-left text-meta text-fg-muted">
            {headings.map((heading, index) => (
              <th key={heading} scope="col" className={cn("px-3 py-2 font-medium", columns[index]?.width, columns[index]?.numeric && "text-right")}>
                {heading}
              </th>
            ))}
            <th scope="col" className="w-[4%] min-w-10">
              <span className="sr-only">—</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-md:block">{children}</tbody>
      </table>
    </div>
  );
}
