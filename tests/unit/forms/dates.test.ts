import { describe, expect, it } from "vitest";

import {
  compareDateOnly,
  dateOnlyFromUtc,
  dateOnlyToUtc,
  dateOrderError,
  isDateOnly,
  isRealCalendarDate,
  parseDateOnly,
  parseOptionalDateOnly,
  todayInTimeZone,
} from "@/lib/forms/dates";
import { calendarDate, optionalDate, patchDate, requiredDate } from "@/lib/modules/shared/fields";

/**
 * FV-07: date-only values stay calendar dates (AUD-09 §4). The clock is fixed
 * in every "today" case; the boundaries are Tirane's midnight and its daylight
 * saving switches (last Sunday of March and of October).
 */

describe("a calendar date is a real day", () => {
  it("knows leap years and month lengths", () => {
    expect(isRealCalendarDate(2024, 2, 29)).toBe(true);
    expect(isRealCalendarDate(2026, 2, 29)).toBe(false);
    expect(isRealCalendarDate(2000, 2, 29)).toBe(true);
    expect(isRealCalendarDate(1900, 2, 29)).toBe(false);
    expect(isRealCalendarDate(2026, 4, 31)).toBe(false);
    expect(isRealCalendarDate(2026, 12, 31)).toBe(true);
    expect(isRealCalendarDate(2026, 13, 1)).toBe(false);
    expect(isRealCalendarDate(2026, 0, 1)).toBe(false);
  });

  it("refuses impossible and malformed dates, each with its own code", () => {
    expect(parseDateOnly("2026-02-30")).toMatchObject({ ok: false, code: "DATE_IMPOSSIBLE" });
    expect(parseDateOnly("2026-04-31")).toMatchObject({ ok: false, code: "DATE_IMPOSSIBLE" });
    expect(parseDateOnly("2026-13-01")).toMatchObject({ ok: false, code: "DATE_IMPOSSIBLE" });
    expect(parseDateOnly("2026-9-7")).toMatchObject({ ok: false, code: "DATE_MALFORMED" });
    expect(parseDateOnly("27/09/2026")).toMatchObject({ ok: false, code: "DATE_MALFORMED" });
    expect(parseDateOnly("2026-09-27T00:00:00Z")).toMatchObject({ ok: false, code: "DATE_MALFORMED" });
    expect(parseDateOnly("")).toMatchObject({ ok: false, code: "DATE_REQUIRED" });
    // A typo in the year is out of range, not a date in the year 20266.
    expect(parseDateOnly("1899-12-31")).toMatchObject({ ok: false, code: "DATE_OUT_OF_RANGE" });
    expect(parseDateOnly("2200-01-01")).toMatchObject({ ok: false, code: "DATE_OUT_OF_RANGE" });
    expect(parseDateOnly("2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
    expect(parseDateOnly(" 2024-02-29 ")).toEqual({ ok: true, value: "2024-02-29" });
    expect(parseOptionalDateOnly("")).toEqual({ ok: true, value: null });
    expect(isDateOnly("2026-02-29")).toBe(false);
  });

  it("becomes that day's UTC midnight and back, whatever the process time zone", () => {
    expect(dateOnlyToUtc("2026-03-29").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(dateOnlyToUtc("2026-10-25").toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(dateOnlyFromUtc(new Date("2026-12-31T00:00:00.000Z"))).toBe("2026-12-31");
    expect(() => dateOnlyToUtc("2026-02-30")).toThrow(RangeError);
  });
});

describe("today is somebody's today (fixed clock)", () => {
  it("is still yesterday in UTC when Tirane has passed midnight (winter, UTC+1)", () => {
    const now = new Date("2026-01-14T23:30:00.000Z");
    expect(todayInTimeZone("Europe/Tirane", now)).toBe("2026-01-15");
    expect(todayInTimeZone("UTC", now)).toBe("2026-01-14");
  });

  it("follows daylight saving (summer, UTC+2) at both switches", () => {
    // 29 March 2026 01:00 UTC = 03:00 CEST, just after the spring switch.
    expect(todayInTimeZone("Europe/Tirane", new Date("2026-03-28T22:59:59.000Z"))).toBe("2026-03-28");
    expect(todayInTimeZone("Europe/Tirane", new Date("2026-03-28T23:00:00.000Z"))).toBe("2026-03-29");
    // In summer the day turns at 22:00 UTC.
    expect(todayInTimeZone("Europe/Tirane", new Date("2026-07-01T21:59:59.000Z"))).toBe("2026-07-01");
    expect(todayInTimeZone("Europe/Tirane", new Date("2026-07-01T22:00:00.000Z"))).toBe("2026-07-02");
    // 25 October 2026: back to UTC+1 at 01:00 UTC; the day turns at 23:00 UTC again after it.
    expect(todayInTimeZone("Europe/Tirane", new Date("2026-10-25T22:59:59.000Z"))).toBe("2026-10-25");
    expect(todayInTimeZone("Europe/Tirane", new Date("2026-10-25T23:00:00.000Z"))).toBe("2026-10-26");
  });
});

describe("cross-field order", () => {
  it("refuses an end before its start, and allows the same day", () => {
    expect(dateOrderError("2026-09-27", "2026-09-26")).toBe("Due date must be on or after the start date.");
    expect(dateOrderError("2026-09-27", "2026-09-27")).toBeNull();
    expect(dateOrderError("2026-09-27", null)).toBeNull();
    expect(dateOrderError("2026-02-30", "2026-01-01")).toBeNull();
    expect(dateOrderError("2026-01-01", "2025-12-31", { start: "the start", end: "End" })).toBe("End must be on or after the start.");
    expect(compareDateOnly("2026-01-02", "2025-12-31")).toBe(1);
  });
});

describe("the shared schema fields keep the calendar date (FV-07)", () => {
  it("refuses 30 February instead of storing 2 March", () => {
    expect(optionalDate.safeParse("2026-02-30").success).toBe(false);
    expect(requiredDate.safeParse("2026-02-30").success).toBe(false);
    expect(patchDate.safeParse("2026-04-31").success).toBe(false);
  });

  it("stores a date-only value at its UTC midnight, padded or not", () => {
    expect((optionalDate.parse("2026-09-27") as Date).toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect((optionalDate.parse("2026-9-7") as Date).toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect((requiredDate.parse("2024-02-29") as Date).toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(optionalDate.parse("")).toBeUndefined();
    expect(optionalDate.parse(undefined)).toBeUndefined();
  });

  it("still reads a full timestamp or a Date as it did", () => {
    expect((optionalDate.parse("2026-09-27T10:15:00.000Z") as Date).toISOString()).toBe("2026-09-27T10:15:00.000Z");
    const date = new Date("2026-01-01T12:00:00.000Z");
    expect(optionalDate.parse(date)).toEqual(date);
  });

  it("keeps omitted, cleared and set apart on a partial update (FV-05)", () => {
    expect(patchDate.parse(undefined)).toBeUndefined();
    expect(patchDate.parse("")).toBeNull();
    expect(patchDate.parse(null)).toBeNull();
    expect((patchDate.parse("2026-09-27") as Date).toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("calendarDate refuses timestamps and impossible days", () => {
    const schema = calendarDate("Issue date");
    expect(schema.parse("2026-09-27").toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(schema.safeParse("2026-09-27T00:00:00Z").success).toBe(false);
    const impossible = schema.safeParse("2026-02-29");
    expect(impossible.success).toBe(false);
    expect(impossible.error?.issues[0]?.message).toBe("Issue date 2026-02-29 is not a real date. Check the day and the month.");
  });
});
