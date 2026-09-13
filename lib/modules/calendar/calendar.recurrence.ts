import { addLocalDays, daysBetween, instantFromLocal, localDate, localTime, localWeekday, startOfLocalDay } from "./calendar.time";
import type { RecurrenceFrequency, RecurrenceInput, Weekday } from "./calendar.types";

/**
 * Recurrence for Calendar-owned events (PRD #39 §76-§80).
 *
 * The stored rule is an RRULE subset — FREQ, INTERVAL, BYDAY (weekly only),
 * COUNT, UNTIL — and occurrences are never stored: a series is expanded only
 * inside the range somebody asked for, with a hard ceiling on how many steps
 * one expansion may take (PRD #39 §78, §79).
 *
 * A series repeats in local wall-clock time in the zone it was planned in, so
 * the Monday 09:00 site meeting is at 09:00 on both sides of a daylight-saving
 * change. `UNTIL` is a local date, inclusive.
 *
 * V0.1 edits apply to the entire series (PRD #39 §80); single-occurrence
 * exceptions are not supported and the interface says so.
 */

export const FREQUENCIES: RecurrenceFrequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
export const WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export const MAX_INTERVAL = 99;
export const MAX_COUNT = 730;
/** Steps one expansion may take before it stops, whatever the rule says. */
const MAX_STEPS = 20_000;

export class RecurrenceError extends Error {}

export function serializeRecurrence(input: RecurrenceInput): string {
  const parts = [`FREQ=${input.frequency}`, `INTERVAL=${input.interval}`];
  if (input.byDay?.length) parts.push(`BYDAY=${orderedDays(input.byDay).join(",")}`);
  if (input.count) parts.push(`COUNT=${input.count}`);
  if (input.until) parts.push(`UNTIL=${input.until.replaceAll("-", "")}`);
  return parts.join(";");
}

export function parseRecurrence(rule: string): RecurrenceInput {
  const fields = new Map<string, string>();
  for (const part of rule.split(";")) {
    const [key, value] = part.split("=");
    if (!key || value === undefined || fields.has(key)) throw new RecurrenceError("Malformed recurrence rule");
    fields.set(key.toUpperCase(), value.toUpperCase());
  }
  for (const key of fields.keys()) {
    if (!["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL"].includes(key)) throw new RecurrenceError(`Unsupported recurrence field ${key}`);
  }

  const frequency = fields.get("FREQ") as RecurrenceFrequency | undefined;
  if (!frequency || !FREQUENCIES.includes(frequency)) throw new RecurrenceError("Unsupported frequency");

  const interval = Number(fields.get("INTERVAL") ?? "1");
  const input: RecurrenceInput = { frequency, interval };

  const byDay = fields.get("BYDAY");
  if (byDay) input.byDay = byDay.split(",") as Weekday[];
  const count = fields.get("COUNT");
  if (count) input.count = Number(count);
  const until = fields.get("UNTIL");
  if (until) {
    if (!/^\d{8}$/.test(until)) throw new RecurrenceError("UNTIL must be a date");
    input.until = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  }

  const problem = recurrenceProblem(input);
  if (problem) throw new RecurrenceError(problem);
  return input;
}

/** Why a rule is not acceptable, or null. Shared by the schema and the parser. */
export function recurrenceProblem(input: RecurrenceInput, startDate?: string): string | null {
  if (!FREQUENCIES.includes(input.frequency)) return "Choose how often the event repeats.";
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > MAX_INTERVAL) {
    return `Repeat every 1 to ${MAX_INTERVAL} periods.`;
  }
  if (input.byDay?.length) {
    if (input.frequency !== "WEEKLY") return "Days of the week apply only to a weekly series.";
    if (input.byDay.some((day) => !WEEKDAYS.includes(day))) return "Unknown day of the week.";
  }
  if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_COUNT)) {
    return `A series can have at most ${MAX_COUNT} occurrences.`;
  }
  if (input.count !== undefined && input.until) return "End a series by date or by count, not both.";
  if (input.until && startDate && input.until < startDate) return "The series cannot end before it starts.";
  return null;
}

export type SeriesShape = {
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  timezone: string;
};

export type Occurrence = { startsAt: Date; endsAt: Date };

/**
 * Occurrences of a series that overlap `range`, oldest first.
 *
 * `limit` bounds the result; the step ceiling bounds the work. A series that
 * started years ago with no COUNT is jumped forward rather than walked.
 */
export function expandRecurrence(
  series: SeriesShape,
  rule: RecurrenceInput,
  range: { from: Date; to: Date },
  limit = 500,
): Occurrence[] {
  const zone = series.timezone;
  const startDate = localDate(series.startsAt, zone);
  const startTime = localTime(series.startsAt, zone);
  const spanDays = series.allDay && series.endsAt ? Math.max(1, daysBetween(startDate, localDate(series.endsAt, zone))) : 1;
  const durationMs = series.endsAt ? series.endsAt.getTime() - series.startsAt.getTime() : 0;

  const at = (date: string): Occurrence => {
    if (series.allDay) {
      return { startsAt: startOfLocalDay(date, zone), endsAt: startOfLocalDay(addLocalDays(date, spanDays), zone) };
    }
    const startsAt = instantFromLocal(date, startTime, zone);
    return { startsAt, endsAt: new Date(startsAt.getTime() + durationMs) };
  };

  const rangeFirstDate = addLocalDays(localDate(range.from, zone), -spanDays - 1);
  const occurrences: Occurrence[] = [];
  let produced = 0;
  let steps = 0;

  const accept = (date: string): "stop" | "continue" => {
    if (date < startDate) return "continue";
    if (rule.until && date > rule.until) return "stop";
    produced += 1;
    if (rule.count !== undefined && produced > rule.count) return "stop";
    const occurrence = at(date);
    if (occurrence.startsAt.getTime() >= range.to.getTime()) return "stop";
    if (occurrence.endsAt.getTime() > range.from.getTime() || (durationMs === 0 && !series.allDay && occurrence.startsAt.getTime() >= range.from.getTime())) {
      occurrences.push(occurrence);
      if (occurrences.length >= limit) return "stop";
    }
    return "continue";
  };

  // Without a COUNT, whole periods before the range can be skipped: they could
  // not produce a visible occurrence and nothing needs counting.
  const skip = rule.count === undefined && rangeFirstDate > startDate;

  switch (rule.frequency) {
    case "DAILY": {
      let k = skip ? Math.max(0, Math.floor(daysBetween(startDate, rangeFirstDate) / rule.interval)) : 0;
      while (steps++ < MAX_STEPS) {
        if (accept(addLocalDays(startDate, k * rule.interval)) === "stop") break;
        k += 1;
      }
      break;
    }
    case "WEEKLY": {
      const startWeekday = localWeekday(series.startsAt, zone);
      const weekStart = addLocalDays(startDate, -(startWeekday - 1));
      const days = orderedDays(rule.byDay?.length ? rule.byDay : [WEEKDAYS[startWeekday - 1]]);
      let week = skip ? Math.max(0, Math.floor(daysBetween(weekStart, rangeFirstDate) / 7 / rule.interval)) : 0;
      outer: while (steps < MAX_STEPS) {
        const monday = addLocalDays(weekStart, week * 7 * rule.interval);
        for (const day of days) {
          steps += 1;
          if (accept(addLocalDays(monday, WEEKDAYS.indexOf(day))) === "stop") break outer;
        }
        week += 1;
      }
      break;
    }
    case "MONTHLY":
    case "YEARLY": {
      const [y, m, d] = startDate.split("-").map(Number);
      const monthsPerStep = rule.frequency === "MONTHLY" ? rule.interval : rule.interval * 12;
      let k = 0;
      if (skip) {
        const [ry, rm] = rangeFirstDate.split("-").map(Number);
        k = Math.max(0, Math.floor(((ry - y) * 12 + (rm - m)) / monthsPerStep) - 1);
      }
      while (steps++ < MAX_STEPS) {
        const total = m - 1 + k * monthsPerStep;
        const year = y + Math.floor(total / 12);
        const month = (total % 12) + 1;
        const candidate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        // The 31st does not exist every month and 29 February not every year:
        // those periods have no occurrence, rather than one on another day.
        const valid = new Date(Date.UTC(year, month - 1, d)).getUTCMonth() === month - 1;
        if (valid && accept(candidate) === "stop") break;
        if (!valid && rule.until && candidate > rule.until) break;
        k += 1;
      }
      break;
    }
  }

  return occurrences;
}

/**
 * The instant after which a series produces nothing, or null for an open
 * series. Stored on the row so a range query can skip ended series by index.
 */
export function seriesEndsAt(series: SeriesShape, rule: RecurrenceInput): Date | null {
  if (rule.until) {
    const lastDayEnd = startOfLocalDay(addLocalDays(rule.until, 1), series.timezone);
    const duration = series.endsAt ? series.endsAt.getTime() - series.startsAt.getTime() : 0;
    return new Date(lastDayEnd.getTime() + duration);
  }
  if (rule.count !== undefined) {
    const all = expandRecurrence(series, rule, { from: series.startsAt, to: new Date(8.64e15) }, rule.count);
    const last = all.at(-1);
    return last ? last.endsAt : series.endsAt ?? series.startsAt;
  }
  return null;
}

function orderedDays(days: Weekday[]): Weekday[] {
  return [...new Set(days)].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
}
