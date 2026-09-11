import { describe, expect, it } from "vitest";

import {
  businessDateString,
  countWorkingDays,
  isWorkingDay,
  leaveYearOf,
  rangesOverlap,
  toBusinessDate,
  workedMinutesBetween,
  workingDaysBetween,
} from "@/lib/modules/hr/hr.calendar";
import { calculateLeaveDays } from "@/lib/modules/hr/hr.date";

/**
 * Leave-day arithmetic (PRD #16 §77, §213–§215, §343).
 *
 * Calculation-critical: a working day counted differently in two places is how
 * a leave balance stops adding up.
 */
const date = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe("working days (PRD #16 §213, §214)", () => {
  it("counts Monday to Friday and nothing else", () => {
    // 2026-09-14 is a Monday, 2026-09-20 the Sunday after.
    expect(isWorkingDay(date("2026-09-14"))).toBe(true);
    expect(isWorkingDay(date("2026-09-18"))).toBe(true);
    expect(isWorkingDay(date("2026-09-19"))).toBe(false);
    expect(isWorkingDay(date("2026-09-20"))).toBe(false);
  });

  it("counts a full working week as five days", () => {
    expect(countWorkingDays(date("2026-09-14"), date("2026-09-18"))).toBe(5);
  });

  it("excludes the weekend inside a span of two weeks", () => {
    expect(countWorkingDays(date("2026-09-14"), date("2026-09-25"))).toBe(10);
  });

  it("counts a single working day as one, inclusive of both ends", () => {
    expect(countWorkingDays(date("2026-09-16"), date("2026-09-16"))).toBe(1);
  });

  it("counts a weekend-only range as nothing", () => {
    expect(countWorkingDays(date("2026-09-19"), date("2026-09-20"))).toBe(0);
  });

  it("counts a reversed range as nothing rather than a negative", () => {
    expect(countWorkingDays(date("2026-09-18"), date("2026-09-14"))).toBe(0);
  });

  it("does not model public holidays in V0.1 (PRD #16 §215)", () => {
    // 1 January 2026 is a Thursday, and a holiday in most of Europe. V0.1
    // deliberately counts it, rather than shipping a half-right calendar.
    expect(countWorkingDays(date("2026-01-01"), date("2026-01-01"))).toBe(1);
  });
});

describe("leave days as stored (PRD #16 §78)", () => {
  it("agrees exactly with the day count behind it", () => {
    expect(calculateLeaveDays(date("2026-09-14"), date("2026-09-18")).toString()).toBe("5");
  });

  it("records to two decimal places, for half days later", () => {
    expect(calculateLeaveDays(date("2026-09-14"), date("2026-09-18")).toFixed(2)).toBe("5.00");
  });
});

describe("working days in a range (PRD #16 §220)", () => {
  it("returns one date per working day, for writing attendance", () => {
    const days = workingDaysBetween(date("2026-09-14"), date("2026-09-20"));
    expect(days).toHaveLength(5);
    expect(days.map(businessDateString)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
  });

  it("agrees with the count used for the balance", () => {
    const from = date("2026-03-02");
    const to = date("2026-03-31");
    expect(workingDaysBetween(from, to)).toHaveLength(countWorkingDays(from, to));
  });
});

describe("business dates (PRD #16 §212)", () => {
  it("stores a calendar date at midday UTC, so no timezone shifts the day", () => {
    const stored = toBusinessDate(new Date("2026-09-14T23:30:00.000Z"));
    expect(stored.toISOString()).toBe("2026-09-14T12:00:00.000Z");
  });

  it("keeps the same day for an instant early in the morning", () => {
    const stored = toBusinessDate(new Date("2026-09-14T00:15:00.000Z"));
    expect(businessDateString(stored)).toBe("2026-09-14");
  });

  it("reads the leave year from the calendar year", () => {
    expect(leaveYearOf(date("2026-12-31"))).toBe(2026);
    expect(leaveYearOf(date("2027-01-01"))).toBe(2027);
  });
});

describe("worked minutes (PRD #16 §106)", () => {
  it("is the difference between check-in and check-out", () => {
    expect(
      workedMinutesBetween(
        new Date("2026-09-14T09:00:00.000Z"),
        new Date("2026-09-14T17:30:00.000Z"),
      ),
    ).toBe(510);
  });

  it("is unknown until both times exist", () => {
    expect(workedMinutesBetween(new Date("2026-09-14T09:00:00.000Z"), null)).toBeNull();
    expect(workedMinutesBetween(null, new Date("2026-09-14T17:00:00.000Z"))).toBeNull();
    expect(workedMinutesBetween(null, null)).toBeNull();
  });

  it("refuses to report a negative day", () => {
    expect(
      workedMinutesBetween(
        new Date("2026-09-14T17:00:00.000Z"),
        new Date("2026-09-14T09:00:00.000Z"),
      ),
    ).toBeNull();
  });
});

describe("overlapping ranges (PRD #16 §83)", () => {
  const a = { start: date("2026-09-14"), end: date("2026-09-18") };

  it("sees an overlap when one range starts inside the other", () => {
    expect(rangesOverlap(a.start, a.end, date("2026-09-17"), date("2026-09-22"))).toBe(true);
  });

  it("sees an overlap when one range is wholly inside the other", () => {
    expect(rangesOverlap(a.start, a.end, date("2026-09-15"), date("2026-09-16"))).toBe(true);
  });

  it("counts a single shared day as an overlap", () => {
    expect(rangesOverlap(a.start, a.end, date("2026-09-18"), date("2026-09-25"))).toBe(true);
  });

  it("sees no overlap when the ranges are adjacent but separate", () => {
    expect(rangesOverlap(a.start, a.end, date("2026-09-21"), date("2026-09-25"))).toBe(false);
  });
});
