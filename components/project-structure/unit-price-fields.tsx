"use client";

import * as React from "react";
import { reveal } from "@/components/forms/form-contract";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { moneyLabel } from "@/components/sales/unit-sales/commercial-status";
import { PutOnSaleTick, putOnSaleAfterPrice } from "@/components/sales/unit-sales/put-on-sale";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { compareDecimal, parseDecimalInput } from "@/lib/forms/decimal";
import { MONEY_RULE } from "@/lib/modules/finance/finance.fields";
import { PRICE_ENTRIES, priceFromRate, priceToSave, saleArea, savedPriceBox, switchPriceEntry, untouchedTotal, type PriceEntry, type PriceEntrySwitch, type SaleAreas } from "@/lib/modules/sales/units/unit-pricing.rules";
import { putOnSaleWithPrice, salesExpectedVersion } from "@/lib/modules/sales/units/unit-sales.rules";
import type { UnitCommercialStatus, UnitPriceBasis, UnitSalesDTO } from "@/lib/modules/sales/units/unit-sales.types";
import { cn } from "@/lib/utils/cn";
import { areaText, Field, failureMessage, numberText, structureApi } from "./structure-ui";

/**
 * The unit's asking price, typed in the New unit and Edit unit dialogs
 * (2026-11-09): per m² of the unit's sale area — the saleable area typed in
 * the dialog, else the gross area it works out — or as a total.
 *
 * It is the Sales Price dialog's price, saved the same way and through the same
 * door (`PATCH /api/project-units/:id/sales`, `project.unit.price.manage`),
 * after the unit itself is saved. Only the total is kept, on the basis of the
 * area used (saleable or gross; fixed without either); the rate is never stored.
 *
 * It opens on Per m², the way prices are set on the floor price list. A total
 * opened as its rate stands for that exact total until the person types in the
 * box or switches it: an area changed in the same dialog only moves the rate
 * shown, and nothing about the price is saved or offered (review 2026-11-10).
 * Once the person has typed a rate, the total follows area × rate, with the
 * saved total shown beside it.
 *
 * A price saved on a unit that is not for sale offers "Also put it on sale",
 * ticked by default, to somebody who may change the sale status, when the unit
 * can be offered (2026-11-09). The unit side panel uses the same section, fed
 * the sales record it has already read.
 */

type Saved = {
  askingPrice: string | null;
  currency: string | null;
  priceBasis: UnitPriceBasis;
  salesNotes: string | null;
  version: number;
  sold: boolean;
  areas: SaleAreas;
  defaultCurrency: string;
  status: UnitCommercialStatus;
  sellable: boolean;
  canManageStatus: boolean;
};

/**
 * What a save did to the price, and to the sale status when "Also put it on
 * sale" was ticked: `unchanged` sends nothing; a refusal keeps the server's
 * reason, and so does a unit that stayed off sale.
 */
export type PriceSaveResult = {
  price: "unchanged" | "saved" | "refused";
  message?: string;
  onSale?: "moved" | "stayed";
  onSaleMessage?: string;
};

type Load = "loading" | "ready" | "unavailable";

export type UnitPrice = {
  /** Whether the section shows at all: the right to set prices, and for a saved unit its sales could be read. */
  shown: boolean;
  /** Whether the person changed anything in it, for the unsaved-work guard. */
  touched: boolean;
  /** Whether the price can be saved as typed; says why on the field when not. Called before the unit is saved, so a bad price saves nothing. */
  check(): boolean;
  /**
   * Saves the price on the unit just saved, when it changed, and then puts the
   * unit on sale when that was ticked. Never throws: a refusal is a warning
   * toast (none when `quiet`), the unit stays saved.
   */
  save(unitId: string, unitCode: string, options?: { quiet?: boolean }): Promise<PriceSaveResult>;
  view: UnitPriceView;
};

type UnitPriceView = {
  load: Load;
  sold: boolean;
  entry: PriceEntry;
  text: string;
  error: { message: string } | null;
  currency: string | null;
  saved: string | null;
  /** The area a rate is typed against and which one it is: saleable, gross, or none (fixed). */
  area: string | null;
  basis: UnitPriceBasis;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setText: (text: string) => void;
  chooseEntry: (entry: PriceEntry) => void;
  /** The total the box gives now, or null while it cannot be worked out. */
  total: string | null;
  /** The rate typed, when it is one above 0. */
  rate: string | null;
  /** Whether "Also put it on sale" is offered for the price as typed, and whether it is ticked. */
  offersPutOnSale: boolean;
  putOnSale: boolean;
  setPutOnSale: (on: boolean) => void;
};

const INITIAL_ENTRY: PriceEntry = "PER_SQM";

function savedFrom(sales: UnitSalesDTO): Saved {
  return {
    askingPrice: sales.askingPrice,
    currency: sales.currency,
    priceBasis: sales.priceBasis,
    salesNotes: sales.salesNotes,
    version: sales.version,
    sold: sales.status === "SOLD",
    areas: { saleableArea: sales.saleableArea, grossArea: sales.grossArea },
    defaultCurrency: sales.defaults.currency,
    status: sales.status,
    sellable: sales.sellable,
    canManageStatus: sales.capabilities.canManageStatus,
  };
}

/** How the box opens on a saved price: on its rate when the unit has an area — standing for the exact total — else on the total. */
function openingOf(saved: Saved | null): { entry: PriceEntry; text: string; last: PriceEntrySwitch | null; convertedOn: string | null } {
  return savedPriceBox(saved?.askingPrice ?? null, saved ? saleArea(saved.areas).area : null, INITIAL_ENTRY);
}

export function useUnitPrice({
  unitId,
  enabled,
  areas,
  sales,
  canManageStatus = false,
}: {
  unitId?: string;
  enabled: boolean;
  areas: SaleAreas;
  /**
   * The unit's sales record when the caller has already read it (the side
   * panel); `null` when the reader may not see it. Left out, a saved unit's
   * record is read here.
   */
  sales?: UnitSalesDTO | null;
  /** For a unit not saved yet: whether the person may put it on sale. A saved unit's record says so itself. */
  canManageStatus?: boolean;
}): UnitPrice {
  const ts = useSalesTranslations();
  const t = useTranslations("projects");
  const toast = useToast();
  const given = sales !== undefined;
  const initialSaved = given && sales && sales.capabilities.canManagePrice ? savedFrom(sales) : null;
  const opening = openingOf(initialSaved);
  const [load, setLoad] = React.useState<Load>(!enabled ? "unavailable" : given ? (initialSaved ? "ready" : "unavailable") : unitId ? "loading" : "ready");
  const [saved, setSaved] = React.useState<Saved | null>(initialSaved);
  const [entryState, setEntry] = React.useState<PriceEntry>(opening.entry);
  const [textState, setTextState] = React.useState(opening.text);
  /** The last switch of the box, and the area it was made on. */
  const [lastState, setLast] = React.useState<PriceEntrySwitch | null>(opening.last);
  const [convertedOnState, setConvertedOn] = React.useState<string | null>(opening.convertedOn);
  /** Whether the person typed in the price box or switched it; until then it stands for the saved price. */
  const [boxTouched, setBoxTouched] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<{ message: string } | null>(null);
  const [putOnSale, setPutOnSale] = React.useState(true);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // A saved unit's price, notes and version come from Sales: the price is sent back with its notes and version.
  React.useEffect(() => {
    if (!enabled || !unitId || given) return;
    let live = true;
    structureApi<UnitSalesDTO>(`/api/project-units/${unitId}/sales`)
      .then((record) => {
        if (!live) return;
        if (!record.capabilities.canManagePrice) {
          setLoad("unavailable");
          return;
        }
        const next = savedFrom(record);
        setSaved(next);
        const opened = openingOf(next);
        setEntry(opened.entry);
        setTextState(opened.text);
        setLast(opened.last);
        setConvertedOn(opened.convertedOn);
        setLoad("ready");
      })
      .catch(() => live && setLoad("unavailable"));
    return () => {
      live = false;
    };
  }, [enabled, unitId, given]);

  React.useEffect(() => {
    if (!error || !inputRef.current) return;
    reveal(inputRef.current);
    inputRef.current.focus();
  }, [error]);

  const { area, basis } = saleArea(areas);
  // Untouched, the box is the saved price on the areas as they are now: an area typed in the same dialog
  // moves the rate shown and leaves the price as it was — it is neither re-priced nor offered for sale.
  const box = !boxTouched && saved ? savedPriceBox(saved.askingPrice, area, entryState) : { entry: entryState, text: textState, last: lastState, convertedOn: convertedOnState };
  const { entry, text, last, convertedOn } = box;
  const sameArea = convertedOn !== null && area !== null && compareDecimal(convertedOn, area) === 0;
  const perSqm = entry === "PER_SQM";
  const areaOk = area !== null;
  const rateRule = { label: ts("unitDialogs.ratePerSqm"), ...MONEY_RULE };
  const totalRule = { label: ts("unitDialogs.askingPrice"), ...MONEY_RULE };
  const typedRate = perSqm && text.trim() !== "" ? parseDecimalInput(text, rateRule) : null;
  const rate = typedRate?.ok && compareDecimal(typedRate.value, "0") > 0 ? typedRate.value : null;
  // A rate converted from the saved total, unedited and on the same area, is that total.
  const kept = perSqm && sameArea ? untouchedTotal(text, entry, last) : null;
  const typedTotal = !perSqm && text.trim() !== "" ? parseDecimalInput(text, totalRule) : null;
  const total = perSqm ? (rate !== null && areaOk ? (kept ?? priceFromRate(rate, area)) : null) : typedTotal?.ok ? typedTotal.value : null;
  const currency = saved ? (saved.currency ?? saved.defaultCurrency) : null;
  const sold = saved?.sold ?? false;
  const shown = load !== "unavailable";
  // A price that will be saved — one typed that differs from the saved one — on a unit not for sale offers to put it on sale.
  // A unit not saved yet is published and in use the moment it is created (b91e4312), so it can be.
  const savedPrice = saved?.askingPrice ?? null;
  const priceChanges = boxTouched && total !== null && (savedPrice === null || compareDecimal(total, savedPrice) !== 0);
  const offersPutOnSale =
    shown && load === "ready" && !sold && priceChanges && putOnSaleWithPrice(saved ? { canManageStatus: saved.canManageStatus, status: saved.status, sellable: saved.sellable } : { canManageStatus, status: "NOT_FOR_SALE", sellable: true });

  /** The person's first touch starts from the box as it reads now, the saved price on today's areas. */
  function touchBox() {
    if (boxTouched) return;
    setEntry(box.entry);
    setLast(box.last);
    setConvertedOn(box.convertedOn);
    setBoxTouched(true);
  }

  function setText(next: string) {
    touchBox();
    setTextState(numberText(next));
    setTouched(true);
    setError(null);
  }

  function chooseEntry(next: PriceEntry) {
    if (next === entry) return;
    // A switch made on another area no longer holds: convert afresh on this one.
    const switched = switchPriceEntry(text, area, entry, next, sameArea ? last : null);
    touchBox();
    setTextState(switched.text);
    setLast(switched.last);
    setConvertedOn(area);
    setEntry(next);
    setTouched(true);
    setError(null);
  }

  function check(): boolean {
    if (!shown || load !== "ready" || sold || text.trim() === "") return true;
    if (perSqm) {
      if (!typedRate?.ok || rate === null) {
        setError({ message: typedRate && !typedRate.ok ? typedRate.message : ts("unitDialogs.rateAboveZero") });
        return false;
      }
      if (!areaOk) {
        setError({ message: t("unitDialog.priceRateNeedsGross") });
        return false;
      }
      return true;
    }
    if (typedTotal && !typedTotal.ok) {
      setError({ message: typedTotal.message });
      return false;
    }
    return true;
  }

  async function save(id: string, code: string, options: { quiet?: boolean } = {}): Promise<PriceSaveResult> {
    if (!shown || load !== "ready" || sold) return { price: "unchanged" };
    // A box nobody touched is the saved price: an area changed beside it never re-prices the unit.
    if (saved && !boxTouched) return { price: "unchanged" };
    const typed = text.trim() === "" ? "" : perSqm ? (total ?? "") : (typedTotal?.ok ? typedTotal.value : text);
    if (!saved && typed === "") return { price: "unchanged" };
    const { askingPrice, priceBasis } = priceToSave(typed, currency ?? "", saved ?? { askingPrice: null, currency: null, priceBasis: "FIXED_UNIT_PRICE" }, areas);
    // Nothing changed: send nothing, so no price history is written.
    if (saved && askingPrice === (saved.askingPrice ?? "") && priceBasis === saved.priceBasis) return { price: "unchanged" };
    // Decided on what was typed before anything is sent.
    const moveOnSale = offersPutOnSale && putOnSale && askingPrice !== "";
    let version: number;
    try {
      const answer = await structureApi<{ version: number }>(`/api/project-units/${id}/sales`, {
        method: "PATCH",
        body: {
          askingPrice,
          priceBasis,
          ...(currency ? { currency } : {}),
          // The notes go back as they are: the same door saves them, and leaving them out would clear them.
          salesNotes: saved?.salesNotes ?? null,
          // A unit with no sales record yet is checked as one: a price somebody saved meanwhile is not overwritten.
          expectedVersion: salesExpectedVersion(saved?.version ?? 0),
        },
      });
      version = answer.version;
    } catch (failure) {
      const message = failureMessage(failure);
      if (!options.quiet) toast({ tone: "warning", title: t("unitDialog.priceNotSaved", { code }), description: message });
      return { price: "refused", message };
    }
    if (!moveOnSale) return { price: "saved" };
    const moved = await putOnSaleAfterPrice(id, version);
    if (moved.moved) {
      if (!options.quiet) toast({ tone: "success", title: ts("putOnSale.moved", { unit: code }) });
      return { price: "saved", onSale: "moved" };
    }
    if (!options.quiet) toast({ tone: "warning", title: ts("putOnSale.stayed", { unit: code }), description: moved.message });
    return { price: "saved", onSale: "stayed", onSaleMessage: moved.message };
  }

  return {
    shown,
    touched,
    check,
    save,
    view: {
      load,
      sold,
      entry,
      text,
      error,
      currency,
      saved: saved?.askingPrice ?? null,
      area,
      basis,
      inputRef,
      setText,
      chooseEntry,
      total,
      rate,
      offersPutOnSale,
      putOnSale,
      setPutOnSale: (on: boolean) => {
        setPutOnSale(on);
        setTouched(true);
      },
    },
  };
}

export function UnitPriceFields({ price, idPrefix = "unit", unitLabel }: { price: UnitPrice; idPrefix?: string; unitLabel?: string }) {
  const ts = useSalesTranslations();
  const t = useTranslations("projects");
  const locale = useLocale();
  if (!price.shown) return null;
  const { load, sold, entry, text, error, currency, saved, area, basis, inputRef, setText, chooseEntry, total, rate, offersPutOnSale, putOnSale, setPutOnSale } = price.view;
  const inputId = `${idPrefix}-asking-price`;
  const lineId = `${idPrefix}-price-line`;
  const perSqm = entry === "PER_SQM";
  const changed = saved !== null && total !== null && compareDecimal(total, saved) !== 0;

  return (
    <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0" data-testid="unit-price">
      <legend className="mb-2 text-meta font-semibold text-fg">{t("unitDialog.price")}</legend>
      {load === "loading" ? (
        <p className="text-meta text-fg-subtle">{t("unitDialog.priceLoading")}</p>
      ) : sold ? (
        <p className="text-meta text-fg-muted" data-testid="unit-price-sold">
          {t("unitDialog.priceSold", { price: moneyLabel(saved, currency, locale) })}
        </p>
      ) : (
        <>
          <div className="inline-flex gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5" role="radiogroup" aria-label={ts("unitDialogs.priceEntry")}>
            {PRICE_ENTRIES.map((value) => (
              <label
                key={value}
                className={cn(
                  "relative inline-flex cursor-pointer items-center rounded-md px-3 py-1.5 text-table font-medium text-fg-muted transition-colors hover:text-fg touch:min-h-11",
                  "has-[:checked]:bg-accent-soft has-[:checked]:text-accent-strong has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                )}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-price-entry`}
                  value={value}
                  className="sr-only"
                  checked={entry === value}
                  onChange={() => chooseEntry(value)}
                  data-testid={`unit-price-entry-${value === "TOTAL" ? "total" : "per-sqm"}`}
                />
                {value === "TOTAL" ? ts("unitDialogs.entryTotal") : ts("unitDialogs.entryPerSqm")}
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={perSqm ? rateLabel(ts, basis) : ts("unitDialogs.askingPrice")} htmlFor={inputId} error={error?.message}>
              <Input
                ref={inputRef}
                id={inputId}
                inputMode="decimal"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={perSqm ? ts("unitDialogs.ratePlaceholder") : ts("unitDialogs.totalPlaceholder")}
                aria-invalid={Boolean(error)}
                aria-describedby={lineId}
                data-testid="unit-asking-price"
              />
            </Field>
          </div>
          <p id={lineId} className="text-meta tabular-nums text-fg-muted" aria-live="polite" data-testid="unit-price-line">
            {perSqm
              ? area === null
                ? t("unitDialog.priceNeedsGross")
                : total === null || rate === null
                  ? ts("unitDialogs.perSqmFormula", { area: areaText(area, locale), kind: areaKind(ts, basis) })
                  : ts("unitDialogs.perSqmTotal", { area: areaText(area, locale), kind: areaKind(ts, basis), rate: moneyLabel(rate, currency, locale), total: moneyLabel(total, currency, locale) })
              : t("unitDialog.priceHint")}
            {changed ? <span className="text-fg-subtle"> · {t("unitDialog.priceWas", { total: moneyLabel(saved, currency, locale) })}</span> : null}
          </p>
          {perSqm ? <p className="text-meta text-fg-subtle">{t("unitDialog.priceHint")}</p> : null}
          {offersPutOnSale ? (
            <PutOnSaleTick
              checked={putOnSale}
              onChange={setPutOnSale}
              label={ts("putOnSale.one")}
              hint={unitLabel ? ts("putOnSale.oneHint", { unit: unitLabel }) : ts("putOnSale.newHint")}
              testId={`${idPrefix}-put-on-sale`}
            />
          ) : null}
        </>
      )}
    </fieldset>
  );
}

type SalesText = ReturnType<typeof useSalesTranslations>;

/** The rate field's name, saying which area it is per m² of (2026-11-09): saleable or gross. */
export function rateLabel(t: SalesText, basis: UnitPriceBasis): string {
  return basis === "SALEABLE_AREA" ? t("unitDialogs.ratePerSqmOf.SALEABLE_AREA") : basis === "GROSS_AREA" ? t("unitDialogs.ratePerSqmOf.GROSS_AREA") : t("unitDialogs.ratePerSqm");
}

/** "saleable" or "gross", for the line that works the total out. */
export function areaKind(t: SalesText, basis: UnitPriceBasis): string {
  return basis === "SALEABLE_AREA" ? t("unitDialogs.areaKind.SALEABLE_AREA") : t("unitDialogs.areaKind.GROSS_AREA");
}
