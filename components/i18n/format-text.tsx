"use client";

import * as React from "react";

import { useLocale } from "@/components/i18n/i18n-provider";
import { dateText, dayText, type DayShape } from "@/lib/i18n/format";
import { formatAmount } from "@/lib/modules/finance/finance.currency";

/**
 * Dates and amounts in the reader's language, for components that render on
 * both the server and the client and so can neither await nor call hooks.
 */

/** A local calendar day ("2026-09-14"): "14 Sep 2026" · "14 sht 2026". */
export function DayText({ date, shape = "d MMM yyyy" }: { date: string; shape?: DayShape }) {
  return <>{dayText(date, shape, useLocale())}</>;
}

/** An instant, written the way `Intl.DateTimeFormat(options)` would write it. */
export function DateText({ value, options }: { value: Date | string | number; options: Intl.DateTimeFormatOptions }) {
  return <>{dateText(value, options, useLocale())}</>;
}

/** A decimal-string amount with its currency: "€1,234.50" · "1234,50 €". */
export function AmountText({ amount, currency }: { amount: string; currency: string }) {
  return <>{formatAmount(amount, currency, useLocale())}</>;
}
