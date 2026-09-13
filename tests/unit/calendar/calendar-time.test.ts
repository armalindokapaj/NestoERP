import { describe, expect, it } from "vitest";

import { expandRecurrence, parseRecurrence, recurrenceProblem, serializeRecurrence, seriesEndsAt } from "@/lib/modules/calendar/calendar.recurrence";
import {
  addLocalDays,
  allDaySpan,
  businessDate,
  instantFromLocal,
  localDate,
  localTime,
  startOfLocalDay,
} from "@/lib/modules/calendar/calendar.time";

/**
 * Calendar time and recurrence (PRD #39 §72-§79, §183-§186).
 *
 * Tirana and Berlin share a zone; UTC is the control. 2026 changes clocks on
 * 29 March (02:00 → 03:00) and 25 October (03:00 → 02:00).
 */

const ZONES = ["Europe/Tirane", "Europe/Berlin", "UTC"] as const;

describe("timezones (§183)", () => {
  it("stores UTC and reads the same wall-clock time back in every zone", () => {
    for (const zone of ZONES) {
      const instant = instantFromLocal("2026-09-14", "09:30", zone);
      expect(localDate(instant, zone)).toBe("2026-09-14");
      expect(localTime(instant, zone)).toBe("09:30");
    }
    expect(instantFromLocal("2026-09-14", "09:30", "Europe/Tirane").toISOString()).toBe("2026-09-14T07:30:00.000Z");
    expect(instantFromLocal("2026-01-14", "09:30", "Europe/Tirane").toISOString()).toBe("2026-01-14T08:30:00.000Z");
    expect(instantFromLocal("2026-09-14", "09:30", "UTC").toISOString()).toBe("2026-09-14T09:30:00.000Z");
  });
});

describe("daylight saving (§184)", () => {
  it("moves a time that does not exist in spring forward, never backward", () => {
    const skipped = instantFromLocal("2026-03-29", "02:30", "Europe/Tirane");
    expect(localTime(skipped, "Europe/Tirane")).toBe("03:30");
  });

  it("resolves the repeated autumn hour to one instant", () => {
    const repeated = instantFromLocal("2026-10-25", "02:30", "Europe/Berlin");
    expect(localDate(repeated, "Europe/Berlin")).toBe("2026-10-25");
    expect(localTime(repeated, "Europe/Berlin")).toBe("02:30");
  });

  it("keeps a local day 23 hours long in spring and 25 in autumn", () => {
    const spring = allDaySpan("2026-03-29", "2026-03-29", "Europe/Tirane");
    expect((spring.endsAt.getTime() - spring.startsAt.getTime()) / 3_600_000).toBe(23);
    const autumn = allDaySpan("2026-10-25", "2026-10-25", "Europe/Tirane");
    expect((autumn.endsAt.getTime() - autumn.startsAt.getTime()) / 3_600_000).toBe(25);
  });
});

describe("all-day dates (§185)", () => {
  it("never shifts a day between UTC and the company zone", () => {
    for (const zone of ZONES) {
      const start = startOfLocalDay("2026-12-31", zone);
      expect(localDate(start, zone)).toBe("2026-12-31");
      expect(localDate(new Date(start.getTime() + 86_399_000), zone)).toBe("2026-12-31");
    }
    // A business date kept at midday UTC is its own calendar day.
    expect(businessDate(new Date("2026-09-14T12:00:00Z"))).toBe("2026-09-14");
    expect(addLocalDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addLocalDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("recurrence (§76-§79, §186)", () => {
  const zone = "Europe/Tirane";
  const timed = (date: string, time = "09:00", minutes = 60) => {
    const startsAt = instantFromLocal(date, time, zone);
    return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000), allDay: false, timezone: zone };
  };
  const range = (from: string, to: string) => ({ from: startOfLocalDay(from, zone), to: startOfLocalDay(to, zone) });
  const days = (occurrences: { startsAt: Date }[]) => occurrences.map((o) => `${localDate(o.startsAt, zone)} ${localTime(o.startsAt, zone)}`);

  it("round-trips the stored rule", () => {
    const rule = { frequency: "WEEKLY" as const, interval: 2, byDay: ["WE" as const, "MO" as const], until: "2026-12-31" };
    expect(serializeRecurrence(rule)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231");
    expect(parseRecurrence(serializeRecurrence(rule))).toEqual({ ...rule, byDay: ["MO", "WE"] });
  });

  it("refuses rules outside the V0.1 subset", () => {
    expect(() => parseRecurrence("FREQ=HOURLY")).toThrow();
    expect(() => parseRecurrence("FREQ=DAILY;BYSETPOS=1")).toThrow();
    expect(recurrenceProblem({ frequency: "DAILY", interval: 0 })).not.toBeNull();
    expect(recurrenceProblem({ frequency: "DAILY", interval: 1, count: 5000 })).not.toBeNull();
    expect(recurrenceProblem({ frequency: "DAILY", interval: 1, byDay: ["MO"] })).not.toBeNull();
    expect(recurrenceProblem({ frequency: "DAILY", interval: 1, until: "2026-01-01" }, "2026-02-01")).not.toBeNull();
  });

  it("repeats daily and clips to the range", () => {
    const occurrences = expandRecurrence(timed("2026-09-01"), { frequency: "DAILY", interval: 1 }, range("2026-09-10", "2026-09-13"));
    expect(days(occurrences)).toEqual(["2026-09-10 09:00", "2026-09-11 09:00", "2026-09-12 09:00"]);
  });

  it("repeats weekly on chosen days, every other week", () => {
    const occurrences = expandRecurrence(
      timed("2026-09-07"),
      { frequency: "WEEKLY", interval: 2, byDay: ["MO", "TH"] },
      range("2026-09-07", "2026-09-28"),
    );
    expect(days(occurrences)).toEqual(["2026-09-07 09:00", "2026-09-10 09:00", "2026-09-21 09:00", "2026-09-24 09:00"]);
  });

  it("keeps a weekly 09:00 at 09:00 across the autumn clock change", () => {
    const occurrences = expandRecurrence(timed("2026-10-19"), { frequency: "WEEKLY", interval: 1 }, range("2026-10-19", "2026-11-03"));
    expect(days(occurrences)).toEqual(["2026-10-19 09:00", "2026-10-26 09:00", "2026-11-02 09:00"]);
    expect(occurrences[0].startsAt.toISOString()).toBe("2026-10-19T07:00:00.000Z");
    expect(occurrences[1].startsAt.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  it("skips months without the day rather than moving it", () => {
    const occurrences = expandRecurrence(timed("2026-01-31"), { frequency: "MONTHLY", interval: 1 }, range("2026-01-01", "2026-06-01"));
    expect(days(occurrences)).toEqual(["2026-01-31 09:00", "2026-03-31 09:00", "2026-05-31 09:00"]);
  });

  it("repeats yearly, and only in leap years for 29 February", () => {
    const occurrences = expandRecurrence(timed("2028-02-29"), { frequency: "YEARLY", interval: 1 }, range("2028-01-01", "2036-12-31"));
    expect(days(occurrences)).toEqual(["2028-02-29 09:00", "2032-02-29 09:00", "2036-02-29 09:00"]);
  });

  it("stops at UNTIL (inclusive) and at COUNT", () => {
    const until = expandRecurrence(timed("2026-09-01"), { frequency: "DAILY", interval: 1, until: "2026-09-03" }, range("2026-08-01", "2026-12-01"));
    expect(days(until)).toEqual(["2026-09-01 09:00", "2026-09-02 09:00", "2026-09-03 09:00"]);
    const counted = expandRecurrence(timed("2026-09-01"), { frequency: "WEEKLY", interval: 1, count: 3 }, range("2026-09-10", "2026-12-01"));
    // Two occurrences fall before the range; COUNT still counts them.
    expect(days(counted)).toEqual(["2026-09-15 09:00"]);
    expect(seriesEndsAt(timed("2026-09-01"), { frequency: "WEEKLY", interval: 1, count: 3 })?.toISOString()).toBe(
      instantFromLocal("2026-09-15", "10:00", zone).toISOString(),
    );
    expect(seriesEndsAt(timed("2026-09-01"), { frequency: "DAILY", interval: 1 })).toBeNull();
  });

  it("jumps an old open series forward instead of walking it, and bounds the result", () => {
    const occurrences = expandRecurrence(timed("2000-01-03"), { frequency: "DAILY", interval: 1 }, range("2026-09-14", "2026-09-16"));
    expect(days(occurrences)).toEqual(["2026-09-14 09:00", "2026-09-15 09:00"]);
    const bounded = expandRecurrence(timed("2026-01-01"), { frequency: "DAILY", interval: 1 }, range("2026-01-01", "2027-01-01"), 10);
    expect(bounded).toHaveLength(10);
  });

  it("repeats all-day events by local date", () => {
    const series = { ...allDaySpan("2026-12-24", "2026-12-25", zone), allDay: true, timezone: zone };
    const occurrences = expandRecurrence(series, { frequency: "YEARLY", interval: 1 }, range("2027-12-01", "2028-01-01"));
    expect(occurrences.map((o) => [localDate(o.startsAt, zone), localDate(new Date(o.endsAt.getTime() - 1), zone)])).toEqual([
      ["2027-12-24", "2027-12-25"],
    ]);
  });
});
