"use client";

import { useCallback } from "react";

import { translateViewer } from "@/lib/3d/viewer/i18n";
import { useViewerStore } from "@/lib/3d/viewer/store";
import { formatPrice } from "@/lib/3d/viewer/utils";

/**
 * Rozaris' price formatter, widened for NESTO: a unit's price is in its own
 * currency (EUR and ALL convert to the chosen display currency as in Rozaris,
 * any other currency prints as is), and a null price — hidden from this reader
 * or not set — reads "Price on request".
 */
export function usePriceFormat() {
  const currency = useViewerStore((s) => s.currency);
  const rate = useViewerStore((s) => s.eurToAllRate);
  const locale = useViewerStore((s) => s.locale);

  return useCallback(
    (amount: number | null, opts: { compact?: boolean; currency?: string } = {}) => {
      if (amount == null) return translateViewer(locale, "projectDetail.priceOnRequest");
      const source = opts.currency ?? "EUR";
      if (source !== "EUR" && source !== "ALL") return formatPrice(amount, source, { compact: opts.compact, locale });
      const inEur = source === "ALL" ? amount / rate : amount;
      const value = currency === "ALL" ? Math.round(inEur * rate) : inEur;
      return formatPrice(value, currency, { compact: opts.compact, locale });
    },
    [currency, rate, locale]
  );
}
