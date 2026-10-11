import type { Locale } from "./config";

/**
 * Dates, times, relative times, numbers and money in the reader's language.
 *
 * English is the `Intl` call each helper already makes, argument for argument,
 * so its output does not move by a byte. Albanian is written from the tables
 * below and never through `Intl`: Chrome ships no Albanian locale data
 * (`Intl.DateTimeFormat.supportedLocalesOf(["sq"])` is `[]` there and every
 * `Intl.*("sq")` answers in the browser's own language), so anything `Intl`
 * writes for "sq" differs between the server and the browser — a hydration
 * error on the page and English numbers for an Albanian reader.
 *
 * Pure and client-safe: no ambient state. The reader's locale is always an
 * argument.
 */

/** A no-break space, written as an escape so that no editor quietly turns it into a plain one. */
const NBSP = "\u00a0";

/* -------------------------------------------------------------------------- */
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

type Names = {
  monthShort: readonly string[];
  monthLong: readonly string[];
  /** Monday first. */
  weekdayShort: readonly string[];
  weekdayLong: readonly string[];
  weekdayNarrow: readonly string[];
};

/**
 * English here is the spelling the hand-written labels already use ("Sep", not
 * en-GB's "Sept"): timesheets, daily logs, planning, announcements.
 * Albanian is CLDR 48's, as Node, Safari and Firefox print it.
 */
export const DATE_NAMES: Record<Locale, Names> = {
  en: {
    monthShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    monthLong: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    weekdayShort: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    weekdayLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    weekdayNarrow: ["M", "T", "W", "T", "F", "S", "S"],
  },
  sq: {
    monthShort: ["jan", "shk", "mar", "pri", "maj", "qer", "korr", "gush", "sht", "tet", "nën", "dhj"],
    monthLong: ["janar", "shkurt", "mars", "prill", "maj", "qershor", "korrik", "gusht", "shtator", "tetor", "nëntor", "dhjetor"],
    weekdayShort: ["hën", "mar", "mër", "enj", "pre", "sht", "die"],
    weekdayLong: ["e hënë", "e martë", "e mërkurë", "e enjte", "e premte", "e shtunë", "e diel"],
    weekdayNarrow: ["h", "m", "m", "e", "p", "sh", "d"],
  },
};

const names = (locale: Locale): Names => DATE_NAMES[locale === "sq" ? "sq" : "en"];

/** `month` is 1–12. */
export function monthName(month: number, width: "short" | "long", locale: Locale): string {
  return (width === "long" ? names(locale).monthLong : names(locale).monthShort)[month - 1] ?? "";
}

/** `isoWeekday` is 1 (Monday) – 7 (Sunday). */
export function weekdayName(isoWeekday: number, width: "short" | "long" | "narrow", locale: Locale): string {
  const table = width === "long" ? names(locale).weekdayLong : width === "narrow" ? names(locale).weekdayNarrow : names(locale).weekdayShort;
  return table[isoWeekday - 1] ?? "";
}

/* -------------------------------------------------------------------------- */
/* Calendar parts                                                              */
/* -------------------------------------------------------------------------- */

export type CalendarParts = { year: number; month: number; day: number; weekday: number; hour: number; minute: number };

const pad = (value: number) => String(value).padStart(2, "0");

function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

const zoned = new Map<string, Intl.DateTimeFormat>();

/**
 * What the calendar and the clock read at an instant: in `timeZone`, or — as
 * `Intl.DateTimeFormat` without a zone does — in the runtime's own zone.
 * Only numbers are taken from `Intl`, and those are the same in every engine.
 */
export function calendarParts(value: Date, timeZone?: string): CalendarParts {
  if (!timeZone) {
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate(), weekday: isoWeekday(value.getFullYear(), value.getMonth() + 1, value.getDate()), hour: value.getHours(), minute: value.getMinutes() };
  }
  let format = zoned.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    zoned.set(timeZone, format);
  }
  const read: Record<string, number> = {};
  for (const part of format.formatToParts(value)) if (part.type !== "literal") read[part.type] = Number(part.value);
  return { year: read.year, month: read.month, day: read.day, weekday: isoWeekday(read.year, read.month, read.day), hour: read.hour % 24, minute: read.minute };
}

/** A local calendar day, "2026-09-14", as parts. No instant and no zone are involved. */
export function dayParts(date: string): CalendarParts {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day, weekday: isoWeekday(year, month, day), hour: 0, minute: 0 };
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

type DateShape = Pick<Intl.DateTimeFormatOptions, "weekday" | "day" | "month" | "year" | "hour" | "minute" | "dateStyle" | "timeStyle">;

function fields(options: Intl.DateTimeFormatOptions): DateShape {
  const shape: DateShape = { weekday: options.weekday, day: options.day, month: options.month, year: options.year, hour: options.hour, minute: options.minute };
  if (options.dateStyle === "full") Object.assign(shape, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (options.dateStyle === "long") Object.assign(shape, { day: "numeric", month: "long", year: "numeric" });
  if (options.dateStyle === "medium") Object.assign(shape, { day: "numeric", month: "short", year: "numeric" });
  if (options.dateStyle === "short") Object.assign(shape, { day: "numeric", month: "numeric", year: "2-digit" });
  if (options.timeStyle) Object.assign(shape, { hour: "2-digit", minute: "2-digit" });
  // `Intl` with no field at all means the plain numeric date.
  if (!shape.weekday && !shape.day && !shape.month && !shape.year && !shape.hour && !shape.minute) Object.assign(shape, { day: "numeric", month: "numeric", year: "numeric" });
  return shape;
}

/** The Albanian date for a set of parts, in the shape the `Intl` options ask for. */
export function albanianDate(parts: CalendarParts, options: Intl.DateTimeFormatOptions): string {
  const shape = fields(options);
  const day = shape.day ? (shape.day === "2-digit" ? pad(parts.day) : String(parts.day)) : "";
  const year = shape.year ? (shape.year === "2-digit" ? pad(parts.year % 100) : String(parts.year)) : "";
  let date: string;
  if (shape.month === "numeric" || shape.month === "2-digit") {
    // 7.9.2026 — all numbers, dots between them.
    const month = shape.month === "2-digit" ? pad(parts.month) : String(parts.month);
    date = [day, month, year].filter(Boolean).join(".");
  } else {
    const month = shape.month ? monthName(parts.month, shape.month === "long" ? "long" : "short", "sq") : "";
    date = [day, month, year].filter(Boolean).join(" ");
  }
  const weekday = shape.weekday ? weekdayName(parts.weekday, shape.weekday === "long" ? "long" : shape.weekday === "narrow" ? "narrow" : "short", "sq") : "";
  const dated = weekday && date ? `${weekday}, ${date}` : weekday || date;
  // Always the 24-hour clock: CLDR's Albanian default is "9:05 p.d.", which nobody writes on a schedule.
  const time = shape.hour ? `${pad(parts.hour)}:${pad(parts.minute)}` : "";
  return dated && time ? `${dated}, ${time}` : dated || time;
}

/**
 * An instant written the way `new Intl.DateTimeFormat(englishTag, options)`
 * writes it — which is exactly what English still does — and in Albanian from
 * the tables. `options.timeZone` is honoured in both.
 */
export function dateText(value: Date | string | number, options: Intl.DateTimeFormatOptions, locale: Locale, englishTag = "en-GB"): string {
  const date = value instanceof Date ? value : new Date(value);
  if (locale !== "sq") return new Intl.DateTimeFormat(englishTag, options).format(date);
  return albanianDate(calendarParts(date, options.timeZone), options);
}

export type DayShape = "d MMM yyyy" | "d MMM" | "EEE d MMM" | "EEEE d MMM yyyy" | "MMM yyyy" | "MMMM yyyy" | "EEEE d MMMM";

/**
 * A local calendar day ("2026-09-14") as a label. This is the form the
 * spelled-out helpers already use, so English is unchanged: "14 Sep 2026".
 * Albanian: "14 sht 2026", "hën 14 sht", "e hënë 14 sht 2026".
 */
export function dayText(date: string, shape: DayShape, locale: Locale): string {
  const parts = dayParts(date);
  const short = monthName(parts.month, "short", locale);
  const long = monthName(parts.month, "long", locale);
  switch (shape) {
    case "d MMM yyyy": return `${parts.day} ${short} ${parts.year}`;
    case "d MMM": return `${parts.day} ${short}`;
    case "EEE d MMM": return `${weekdayName(parts.weekday, "short", locale)} ${parts.day} ${short}`;
    case "EEEE d MMM yyyy": return `${weekdayName(parts.weekday, "long", locale)} ${parts.day} ${short} ${parts.year}`;
    case "MMM yyyy": return `${short} ${parts.year}`;
    case "MMMM yyyy": return `${long} ${parts.year}`;
    case "EEEE d MMMM": return `${weekdayName(parts.weekday, "long", locale)} ${parts.day} ${long}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Relative time                                                               */
/* -------------------------------------------------------------------------- */

type Unit = "year" | "month" | "week" | "day" | "hour" | "minute";

const UNITS: ReadonlyArray<readonly [Unit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** [one, other] — Albanian has the two plural forms `Intl.PluralRules("sq")` names. */
const SQ_AGO: Record<Unit, readonly [string, string]> = {
  minute: ["{n} minutë më parë", "{n} minuta më parë"],
  hour: ["{n} orë më parë", "{n} orë më parë"],
  day: ["{n} ditë më parë", "{n} ditë më parë"],
  week: ["{n} javë më parë", "{n} javë më parë"],
  month: ["{n} muaj më parë", "{n} muaj më parë"],
  year: ["{n} vit më parë", "{n} vjet më parë"],
};
const SQ_IN: Record<Unit, readonly [string, string]> = {
  minute: ["pas {n} minute", "pas {n} minutash"],
  hour: ["pas {n} ore", "pas {n} orësh"],
  day: ["pas {n} dite", "pas {n} ditësh"],
  week: ["pas {n} jave", "pas {n} javësh"],
  month: ["pas {n} muaji", "pas {n} muajsh"],
  year: ["pas {n} viti", "pas {n} vjetësh"],
};
/** The words `numeric: "auto"` uses instead of "1 … ago" / "in 1 …". */
const SQ_WORD: Partial<Record<Unit, { last: string; next: string }>> = {
  day: { last: "dje", next: "nesër" },
  week: { last: "javën e kaluar", next: "javën e ardhshme" },
  month: { last: "muajin e kaluar", next: "muajin e ardhshëm" },
  year: { last: "vjet", next: "mot" },
};
const SQ_NOW = "tani";

/**
 * "3 days ago" / "in 3 days" / "yesterday" — the two helpers that exist today
 * (lib/utils/format.ts and lib/activity/client.ts) round the same way; they
 * differ in the English tag and in what under a minute says.
 *   formatRelativeTime: englishTag "en-GB", underAMinute "just now"
 *   activity relativeTime: englishTag "en", underAMinute undefined (Intl's "now")
 */
export function relativeTimeText(value: Date | string | number, locale: Locale, now: Date | number = Date.now(), english: { tag?: string; underAMinute?: string } = {}): string {
  const at = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const seconds = Math.round((at - (now instanceof Date ? now.getTime() : now)) / 1000);
  if (locale !== "sq") {
    const formatter = new Intl.RelativeTimeFormat(english.tag ?? "en-GB", { numeric: "auto" });
    for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
    return english.underAMinute ?? formatter.format(0, "second");
  }
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) < size) continue;
    const count = Math.round(seconds / size);
    const n = Math.abs(count);
    const word = SQ_WORD[unit];
    if (n === 1 && word) return count < 0 ? word.last : word.next;
    const [one, other] = count < 0 ? SQ_AGO[unit] : SQ_IN[unit];
    return (n === 1 ? one : other).replace("{n}", String(n));
  }
  return SQ_NOW;
}

/* -------------------------------------------------------------------------- */
/* Numbers and money                                                           */
/* -------------------------------------------------------------------------- */

/** What follows an amount in Albanian. A currency not listed keeps its ISO code. */
const SQ_CURRENCY: Record<string, string> = { EUR: "€", ALL: "Lekë", USD: "US$", GBP: "£" };
const SQ_COMPACT: ReadonlyArray<readonly [number, string]> = [
  [1e9, "mld"],
  [1e6, "mln"],
  [1e3, "mijë"],
];

/** Digits with their rounding from a fixed ASCII formatter: "1234567.50". Never from the "sq" locale. */
function plainDigits(value: number, minimumFractionDigits: number | undefined, maximumFractionDigits: number | undefined): string {
  return new Intl.NumberFormat("en-US", { useGrouping: false, minimumFractionDigits, maximumFractionDigits }).format(Math.abs(value));
}

/** "1 234 567,5": no-break spaces in threes, a decimal comma. Four digits stay together, as CLDR has it for Albanian. */
function albanianDigits(plain: string): string {
  const [whole, fraction] = plain.split(".");
  const grouped = whole.length >= 5 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) : whole;
  return fraction ? `${grouped},${fraction}` : grouped;
}

export function albanianNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  const sign = value < 0 && !Object.is(Math.abs(value), 0) ? "-" : "";
  const currency = options.style === "currency" ? String(options.currency) : null;
  const symbol = currency ? (SQ_CURRENCY[currency] ?? currency) : null;
  if (options.notation === "compact") {
    const digits = (size: number) => plainDigits(value / size, options.minimumFractionDigits ?? 0, options.maximumFractionDigits ?? 0);
    let at = SQ_COMPACT.findIndex(([size]) => Math.abs(value) >= size);
    // 999 999.995 rounds to "1000" thousands: say it in the next unit up, as "1 mln".
    if (at > 0 && Number(digits(SQ_COMPACT[at][0])) >= 1000) at -= 1;
    else if (at === -1 && Number(digits(1)) >= 1000) at = SQ_COMPACT.length - 1;
    const scale = at === -1 ? null : SQ_COMPACT[at];
    const body = albanianDigits(digits(scale ? scale[0] : 1));
    return `${sign}${body}${scale ? `${NBSP}${scale[1]}` : ""}${symbol ? `${NBSP}${symbol}` : ""}`;
  }
  if (options.style === "percent") {
    return `${sign}${albanianDigits(plainDigits(value * 100, options.minimumFractionDigits ?? 0, options.maximumFractionDigits ?? 0))}%`;
  }
  let minimum = options.minimumFractionDigits;
  let maximum = options.maximumFractionDigits;
  if (currency) {
    // Money shows cents unless the caller says otherwise; never the currency's own default, which differs between ICU versions (ALL, RSD).
    if (minimum === undefined) minimum = maximum === undefined ? 2 : Math.min(2, maximum);
    if (maximum === undefined) maximum = Math.max(2, minimum);
  }
  const body = albanianDigits(plainDigits(value, minimum, maximum));
  return `${sign}${body}${symbol ? `${NBSP}${symbol}` : ""}`;
}

/** A number the way `new Intl.NumberFormat(englishTag, options)` writes it; Albanian from the rules above. */
export function numberText(value: number, options: Intl.NumberFormatOptions | undefined, locale: Locale, englishTag = "en-GB"): string {
  if (locale !== "sq") return new Intl.NumberFormat(englishTag, options).format(value);
  return albanianNumber(value, options);
}

/* -------------------------------------------------------------------------- */
/* The helpers lib/utils/format.ts exports today, now told who is reading      */
/* -------------------------------------------------------------------------- */

const asDate = (value: Date | string) => (typeof value === "string" ? new Date(value) : value);

/** "07 Sept 2026" · "07 sht 2026" */
export function formatDate(value: Date | string, locale: Locale): string {
  return dateText(asDate(value), { day: "2-digit", month: "short", year: "numeric" }, locale);
}

/** "07 Sept 2026, 09:05" · "07 sht 2026, 09:05" */
export function formatDateTime(value: Date | string, locale: Locale): string {
  return dateText(asDate(value), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }, locale);
}

/** "in 3 days" / "2 weeks ago" · "pas 3 ditësh" / "2 javë më parë" */
export function formatRelativeTime(value: Date | string, locale: Locale, now: Date = new Date()): string {
  return relativeTimeText(asDate(value), locale, now, { tag: "en-GB", underAMinute: "just now" });
}

/** "€1,250,000" · "1 250 000 €" */
export function formatCurrency(value: number, currency: string | undefined, locale: Locale): string {
  return numberText(value, { style: "currency", currency: currency ?? "EUR", maximumFractionDigits: 0 }, locale);
}

export function formatNumber(value: number, locale: Locale): string {
  return numberText(value, undefined, locale);
}

/** lib/modules/finance/finance.currency.ts: "€1,234.50" · "1234,50 €" */
export function formatAmount(amount: string, currency: string, locale: Locale): string {
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return numberText(value, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }, locale);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Every formatter bound to one reader, for `getFormatters()` / `useFormatters()`. Two objects exist, one per language. */
export type Formatters = ReturnType<typeof bind>;
function bind(locale: Locale) {
  return {
    locale,
    formatDate: (value: Date | string) => formatDate(value, locale),
    formatDateTime: (value: Date | string) => formatDateTime(value, locale),
    formatRelativeTime: (value: Date | string, now?: Date) => formatRelativeTime(value, locale, now),
    formatCurrency: (value: number, currency?: string) => formatCurrency(value, currency, locale),
    formatNumber: (value: number) => formatNumber(value, locale),
    formatAmount: (amount: string, currency: string) => formatAmount(amount, currency, locale),
    dateText: (value: Date | string | number, options: Intl.DateTimeFormatOptions) => dateText(value, options, locale),
    dayText: (date: string, shape: DayShape) => dayText(date, shape, locale),
    numberText: (value: number, options?: Intl.NumberFormatOptions) => numberText(value, options, locale),
  };
}
const bound: Partial<Record<Locale, Formatters>> = {};
export function createFormatters(locale: Locale): Formatters {
  return (bound[locale] ??= bind(locale));
}
