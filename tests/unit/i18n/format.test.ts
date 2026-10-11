import { describe, expect, it } from "vitest";

import { albanianNumber, dateText, dayText, formatAmount, formatCurrency, formatDate, formatDateTime, formatNumber, monthName, numberText, relativeTimeText, weekdayName } from "@/lib/i18n/format";

/**
 * Dates and numbers in the reader's language (lib/i18n/format.ts).
 *
 * English must stay the `Intl` call each site made before, so it is compared
 * with that call here rather than with a spelling an ICU release may change.
 * Albanian comes from fixed tables and is compared with the text itself: it
 * must read the same in Node and in a browser that has no Albanian data.
 */
const NBSP = " ";

describe("numbers and money", () => {
  const cases: [number, Intl.NumberFormatOptions | undefined][] = [
    [1234567.891, undefined],
    [0, undefined],
    [-1234.5, { minimumFractionDigits: 2, maximumFractionDigits: 2 }],
    [1250000, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }],
    [1234.5, { style: "currency", currency: "ALL", minimumFractionDigits: 2, maximumFractionDigits: 2 }],
    [0.125, { style: "percent", maximumFractionDigits: 1 }],
  ];

  it("writes English exactly as the Intl call it replaces", () => {
    for (const [value, options] of cases) {
      expect(numberText(value, options, "en")).toBe(new Intl.NumberFormat("en-GB", options).format(value));
      expect(numberText(value, options, "en", "en")).toBe(new Intl.NumberFormat("en", options).format(value));
    }
    expect(formatCurrency(1250000, undefined, "en")).toBe("€1,250,000");
    expect(formatNumber(1234567.891, "en")).toBe("1,234,567.891");
    expect(formatAmount("1234.5", "EUR", "en")).toBe("€1,234.50");
  });

  it("writes Albanian from its own rules: spaces in threes from five digits, a decimal comma, the unit after the amount", () => {
    expect(formatNumber(1234567.891, "sq")).toBe(`1${NBSP}234${NBSP}567,891`);
    expect(formatNumber(1234, "sq")).toBe("1234");
    expect(formatNumber(12345, "sq")).toBe(`12${NBSP}345`);
    expect(formatCurrency(1250000, undefined, "sq")).toBe(`1${NBSP}250${NBSP}000${NBSP}€`);
    expect(formatAmount("1234.5", "EUR", "sq")).toBe(`1234,50${NBSP}€`);
    expect(formatAmount("1234.5", "ALL", "sq")).toBe(`1234,50${NBSP}Lekë`);
    expect(albanianNumber(-0.125, { style: "percent", maximumFractionDigits: 1 })).toBe("-12,5%");
    expect(albanianNumber(2500000, { notation: "compact", maximumFractionDigits: 1 })).toBe(`2,5${NBSP}mln`);
  });

  it("prices the public page the same on the server and in a browser without Albanian data", () => {
    const price = (cents: number) => numberText(cents / 100, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }, "sq", "en");
    expect(price(65000)).toBe(`650${NBSP}€`);
    expect(price(250000)).toBe(`2500${NBSP}€`);
    expect(price(1250000)).toBe(`12${NBSP}500${NBSP}€`);
  });

  it("keeps what it cannot read as it was given", () => {
    expect(formatAmount("n/a", "EUR", "sq")).toBe("n/a EUR");
  });
});

describe("dates", () => {
  // Local time on purpose: the helpers follow the runtime's clock, as the Intl calls they replace do.
  const morning = new Date(2026, 8, 7, 9, 5);

  it("writes English exactly as the Intl call it replaces", () => {
    expect(formatDate(morning, "en")).toBe(new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(morning));
    expect(formatDateTime(morning, "en")).toBe(new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(morning));
    const long: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
    expect(dateText(morning, long, "en")).toBe(new Intl.DateTimeFormat("en-GB", long).format(morning));
  });

  it("writes Albanian from its tables, on the 24-hour clock", () => {
    expect(formatDate(morning, "sq")).toBe("07 sht 2026");
    expect(formatDateTime(morning, "sq")).toBe("07 sht 2026, 09:05");
    expect(dateText(morning, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, "sq")).toBe("e hënë, 7 shtator 2026");
    expect(dateText(new Date(2026, 8, 7, 21, 5), { hour: "2-digit", minute: "2-digit" }, "sq")).toBe("21:05");
  });

  it("labels a calendar day in both languages", () => {
    expect(dayText("2026-09-14", "d MMM yyyy", "en")).toBe("14 Sep 2026");
    expect(dayText("2026-09-14", "d MMM yyyy", "sq")).toBe("14 sht 2026");
    expect(dayText("2026-09-14", "EEE d MMM", "en")).toBe("Mon 14 Sep");
    expect(dayText("2026-09-14", "EEE d MMM", "sq")).toBe("hën 14 sht");
    expect(dayText("2026-09-07", "EEEE d MMM yyyy", "sq")).toBe("e hënë 7 sht 2026");
    expect(dayText("2026-10-11", "MMMM yyyy", "sq")).toBe("tetor 2026");
  });

  it("names months and weekdays", () => {
    expect(Array.from({ length: 12 }, (_, index) => monthName(index + 1, "short", "sq"))).toEqual(["jan", "shk", "mar", "pri", "maj", "qer", "korr", "gush", "sht", "tet", "nën", "dhj"]);
    expect(Array.from({ length: 7 }, (_, index) => weekdayName(index + 1, "short", "sq"))).toEqual(["hën", "mar", "mër", "enj", "pre", "sht", "die"]);
    expect(monthName(9, "short", "en")).toBe("Sep");
    expect(weekdayName(1, "long", "en")).toBe("Monday");
  });
});

describe("relative time", () => {
  const now = new Date(2026, 9, 11, 12, 0, 0);
  const days = (count: number) => new Date(now.getTime() + count * 86_400_000);

  it("writes English exactly as Intl.RelativeTimeFormat does", () => {
    const english = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
    expect(relativeTimeText(days(-3), "en", now)).toBe(english.format(-3, "day"));
    expect(relativeTimeText(days(3), "en", now)).toBe(english.format(3, "day"));
    expect(relativeTimeText(days(-1), "en", now)).toBe("yesterday");
    expect(relativeTimeText(now, "en", now, { underAMinute: "just now" })).toBe("just now");
  });

  it("writes Albanian with its own plural forms", () => {
    expect(relativeTimeText(days(-3), "sq", now)).toBe("3 ditë më parë");
    expect(relativeTimeText(days(3), "sq", now)).toBe("pas 3 ditësh");
    expect(relativeTimeText(days(-1), "sq", now)).toBe("dje");
    expect(relativeTimeText(days(1), "sq", now)).toBe("nesër");
    expect(relativeTimeText(days(-7), "sq", now)).toBe("javën e kaluar");
    expect(relativeTimeText(now, "sq", now)).toBe("tani");
  });
});
