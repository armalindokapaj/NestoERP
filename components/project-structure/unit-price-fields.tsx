"use client";

import * as React from "react";
import { reveal } from "@/components/forms/form-contract";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { moneyLabel } from "@/components/sales/unit-sales/commercial-status";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { compareDecimal, parseDecimalInput } from "@/lib/forms/decimal";
import { MONEY_RULE } from "@/lib/modules/finance/finance.fields";
import { hasGrossArea, PRICE_ENTRIES, priceFromRate, priceToSave, switchPriceEntry, untouchedTotal, type PriceEntry, type PriceEntrySwitch } from "@/lib/modules/sales/units/unit-pricing.rules";
import type { UnitPriceBasis, UnitSalesDTO } from "@/lib/modules/sales/units/unit-sales.types";
import { cn } from "@/lib/utils/cn";
import { areaText, Field, failureMessage, numberText, structureApi } from "./structure-ui";

/**
 * The unit's asking price, typed in the New unit and Edit unit dialogs
 * (2026-11-09): per m² of the gross area the dialog works out, or as a total.
 *
 * It is the Sales Price dialog's price, saved the same way and through the same
 * door (`PATCH /api/project-units/:id/sales`, `project.unit.price.manage`),
 * after the unit itself is saved. Only the total is kept, on the gross-area
 * basis (fixed without a gross area); the rate is never stored.
 *
 * It opens on Per m², the way prices are set on the floor price list. A total
 * opened as its rate stands for that exact total while the rate and the gross
 * area are left as they were; change the areas in the same dialog and the
 * total follows gross × rate, with the saved total shown beside it.
 */

type Saved = {
  askingPrice: string | null;
  currency: string | null;
  priceBasis: UnitPriceBasis;
  salesNotes: string | null;
  version: number;
  sold: boolean;
  grossArea: string | null;
  defaultCurrency: string;
};

type Load = "loading" | "ready" | "unavailable";

export type UnitPrice = {
  /** Whether the section shows at all: the right to set prices, and for a saved unit its sales could be read. */
  shown: boolean;
  /** Whether the person changed anything in it, for the unsaved-work guard. */
  touched: boolean;
  /** Whether the price can be saved as typed; says why on the field when not. Called before the unit is saved, so a bad price saves nothing. */
  check(): boolean;
  /** Saves the price on the unit just saved, when it changed. Never throws: a refusal is a warning toast, the unit stays saved. */
  save(unitId: string, unitCode: string): Promise<void>;
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
  grossArea: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setText: (text: string) => void;
  chooseEntry: (entry: PriceEntry) => void;
  /** The total the box gives now, or null while it cannot be worked out. */
  total: string | null;
  /** The rate typed, when it is one above 0. */
  rate: string | null;
};

const INITIAL_ENTRY: PriceEntry = "PER_SQM";

export function useUnitPrice({ unitId, enabled, grossArea }: { unitId?: string; enabled: boolean; grossArea: string | null }): UnitPrice {
  const ts = useSalesTranslations();
  const t = useTranslations("projects");
  const toast = useToast();
  const [load, setLoad] = React.useState<Load>(enabled && unitId ? "loading" : enabled ? "ready" : "unavailable");
  const [saved, setSaved] = React.useState<Saved | null>(null);
  const [entry, setEntry] = React.useState<PriceEntry>(INITIAL_ENTRY);
  const [text, setTextState] = React.useState("");
  /** The last switch of the box, and the gross area it was made on. */
  const [last, setLast] = React.useState<PriceEntrySwitch | null>(null);
  const [convertedOn, setConvertedOn] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<{ message: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // A saved unit's price, notes and version come from Sales: the price is sent back with its notes and version.
  React.useEffect(() => {
    if (!enabled || !unitId) return;
    let live = true;
    structureApi<UnitSalesDTO>(`/api/project-units/${unitId}/sales`)
      .then((sales) => {
        if (!live) return;
        if (!sales.capabilities.canManagePrice) {
          setLoad("unavailable");
          return;
        }
        const next: Saved = {
          askingPrice: sales.askingPrice,
          currency: sales.currency,
          priceBasis: sales.priceBasis,
          salesNotes: sales.salesNotes,
          version: sales.version,
          sold: sales.status === "SOLD",
          grossArea: sales.grossArea,
          defaultCurrency: sales.defaults.currency,
        };
        setSaved(next);
        if (next.askingPrice !== null && hasGrossArea(next.grossArea)) {
          // Opens on the rate; left as it is, it stands for the exact saved total.
          const switched = switchPriceEntry(next.askingPrice, next.grossArea, "TOTAL", "PER_SQM", null);
          setEntry("PER_SQM");
          setTextState(switched.text);
          setLast(switched.last);
          setConvertedOn(next.grossArea);
        } else if (next.askingPrice !== null) {
          setEntry("TOTAL");
          setTextState(next.askingPrice);
        }
        setLoad("ready");
      })
      .catch(() => live && setLoad("unavailable"));
    return () => {
      live = false;
    };
  }, [enabled, unitId]);

  React.useEffect(() => {
    if (!error || !inputRef.current) return;
    reveal(inputRef.current);
    inputRef.current.focus();
  }, [error]);

  const sameGross = convertedOn !== null && grossArea !== null && compareDecimal(convertedOn, grossArea) === 0;
  const perSqm = entry === "PER_SQM";
  const grossOk = hasGrossArea(grossArea);
  const rateRule = { label: ts("unitDialogs.ratePerSqm"), ...MONEY_RULE };
  const totalRule = { label: ts("unitDialogs.askingPrice"), ...MONEY_RULE };
  const typedRate = perSqm && text.trim() !== "" ? parseDecimalInput(text, rateRule) : null;
  const rate = typedRate?.ok && compareDecimal(typedRate.value, "0") > 0 ? typedRate.value : null;
  // A rate converted from the saved total, unedited and on the same gross area, is that total.
  const kept = perSqm && sameGross ? untouchedTotal(text, entry, last) : null;
  const typedTotal = !perSqm && text.trim() !== "" ? parseDecimalInput(text, totalRule) : null;
  const total = perSqm ? (rate !== null && grossOk ? (kept ?? priceFromRate(rate, grossArea)) : null) : typedTotal?.ok ? typedTotal.value : null;
  const currency = saved ? (saved.currency ?? saved.defaultCurrency) : null;
  const sold = saved?.sold ?? false;
  const shown = load !== "unavailable";

  function setText(next: string) {
    setTextState(numberText(next));
    setTouched(true);
    setError(null);
  }

  function chooseEntry(next: PriceEntry) {
    if (next === entry) return;
    // A switch made on another gross area no longer holds: convert afresh on this one.
    const switched = switchPriceEntry(text, grossArea, entry, next, sameGross ? last : null);
    setTextState(switched.text);
    setLast(switched.last);
    setConvertedOn(grossArea);
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
      if (!grossOk) {
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

  async function save(id: string, code: string): Promise<void> {
    if (!shown || load !== "ready" || sold) return;
    const typed = text.trim() === "" ? "" : perSqm ? (total ?? "") : (typedTotal?.ok ? typedTotal.value : text);
    if (!saved && typed === "") return;
    const { askingPrice, priceBasis } = priceToSave(typed, currency ?? "", saved ?? { askingPrice: null, currency: null, priceBasis: "FIXED_UNIT_PRICE" }, grossArea);
    // Nothing changed: send nothing, so no price history is written.
    if (saved && askingPrice === (saved.askingPrice ?? "") && priceBasis === saved.priceBasis) return;
    try {
      await structureApi(`/api/project-units/${id}/sales`, {
        method: "PATCH",
        body: {
          askingPrice,
          priceBasis,
          ...(currency ? { currency } : {}),
          // The notes go back as they are: the same door saves them, and leaving them out would clear them.
          salesNotes: saved?.salesNotes ?? null,
          ...(saved && saved.version > 0 ? { expectedVersion: saved.version } : {}),
        },
      });
    } catch (failure) {
      toast({ tone: "warning", title: t("unitDialog.priceNotSaved", { code }), description: failureMessage(failure) });
    }
  }

  return {
    shown,
    touched,
    check,
    save,
    view: { load, sold, entry, text, error, currency, saved: saved?.askingPrice ?? null, grossArea, inputRef, setText, chooseEntry, total, rate },
  };
}

export function UnitPriceFields({ price }: { price: UnitPrice }) {
  const ts = useSalesTranslations();
  const t = useTranslations("projects");
  const locale = useLocale();
  if (!price.shown) return null;
  const { load, sold, entry, text, error, currency, saved, grossArea, inputRef, setText, chooseEntry, total, rate } = price.view;
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
                  name="unit-price-entry"
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
            <Field label={perSqm ? ts("unitDialogs.ratePerSqm") : ts("unitDialogs.askingPrice")} htmlFor="unit-asking-price" error={error?.message}>
              <Input
                ref={inputRef}
                id="unit-asking-price"
                inputMode="decimal"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={perSqm ? ts("unitDialogs.ratePlaceholder") : ts("unitDialogs.totalPlaceholder")}
                aria-invalid={Boolean(error)}
                aria-describedby="unit-price-line"
                data-testid="unit-asking-price"
              />
            </Field>
          </div>
          <p id="unit-price-line" className="text-meta tabular-nums text-fg-muted" aria-live="polite" data-testid="unit-price-line">
            {perSqm
              ? !hasGrossArea(grossArea)
                ? t("unitDialog.priceNeedsGross")
                : total === null || rate === null
                  ? ts("unitDialogs.perSqmFormula", { area: areaText(grossArea, locale) })
                  : ts("unitDialogs.perSqmTotal", { area: areaText(grossArea, locale), rate: moneyLabel(rate, currency, locale), total: moneyLabel(total, currency, locale) })
              : t("unitDialog.priceHint")}
            {changed ? <span className="text-fg-subtle"> · {t("unitDialog.priceWas", { total: moneyLabel(saved, currency, locale) })}</span> : null}
          </p>
          {perSqm ? <p className="text-meta text-fg-subtle">{t("unitDialog.priceHint")}</p> : null}
        </>
      )}
    </fieldset>
  );
}
