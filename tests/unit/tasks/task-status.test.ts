import { describe, expect, it } from "vitest";

import {
  allowedTransitions,
  canTransitionTaskStatus,
  dayBounds,
  isDueToday,
  isTaskArchived,
  isTaskOverdue,
  REOPEN_STATUSES,
  startOfWeek,
} from "@/lib/modules/tasks/task.status";

/**
 * Task status rules (PRD #11 §65, §142, §191, §205).
 *
 * Pure logic, so no database is needed: the transition table and the derived
 * overdue rule are the two places a Tasks bug would hide.
 */
describe("status transitions (PRD #11 §65)", () => {
  it("allows the documented forward moves", () => {
    expect(canTransitionTaskStatus("TODO", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTaskStatus("TODO", "BLOCKED")).toBe(true);
    expect(canTransitionTaskStatus("TODO", "COMPLETED")).toBe(true);
    expect(canTransitionTaskStatus("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransitionTaskStatus("BLOCKED", "IN_PROGRESS")).toBe(true);
  });

  it("allows a completed task to reopen into either open status", () => {
    expect(canTransitionTaskStatus("COMPLETED", "TODO")).toBe(true);
    expect(canTransitionTaskStatus("COMPLETED", "IN_PROGRESS")).toBe(true);
    expect(REOPEN_STATUSES).toEqual(["TODO", "IN_PROGRESS"]);
  });

  it("treats a no-op transition as valid", () => {
    expect(canTransitionTaskStatus("BLOCKED", "BLOCKED")).toBe(true);
  });

  /** Archiving and restoring are dedicated endpoints (PRD #11 §61, §71, §117). */
  it("refuses to reach or leave ARCHIVED through an ordinary transition", () => {
    expect(canTransitionTaskStatus("TODO", "ARCHIVED")).toBe(false);
    expect(canTransitionTaskStatus("COMPLETED", "ARCHIVED")).toBe(false);
    expect(canTransitionTaskStatus("ARCHIVED", "TODO")).toBe(false);
    expect(canTransitionTaskStatus("ARCHIVED", "COMPLETED")).toBe(false);
    expect(allowedTransitions("ARCHIVED")).toEqual(["ARCHIVED"]);
  });

  it("refuses a blocked task to move straight back from completed to blocked", () => {
    expect(canTransitionTaskStatus("COMPLETED", "BLOCKED")).toBe(false);
  });
});

describe("archived detection (PRD #11 §72)", () => {
  it("is true for either the status or the timestamp", () => {
    expect(isTaskArchived({ status: "ARCHIVED", archivedAt: null })).toBe(true);
    expect(isTaskArchived({ status: "TODO", archivedAt: new Date() })).toBe(true);
    expect(isTaskArchived({ status: "TODO", archivedAt: null })).toBe(false);
  });
});

describe("overdue derivation (PRD #11 §142, §205)", () => {
  // Local times, because "due today" is a calendar-day question and the
  // boundaries follow the viewer's day, not UTC's (PRD #11 §143).
  const now = new Date("2026-09-11T12:00:00");
  const past = new Date("2026-09-01T12:00:00");
  const future = new Date("2026-09-30T12:00:00");

  it("is overdue when open work has passed its due date", () => {
    for (const status of ["TODO", "IN_PROGRESS", "BLOCKED"] as const) {
      expect(isTaskOverdue({ status, dueDate: past }, now)).toBe(true);
    }
  });

  it("is never overdue once the work is finished or filed away", () => {
    expect(isTaskOverdue({ status: "COMPLETED", dueDate: past }, now)).toBe(false);
    expect(isTaskOverdue({ status: "ARCHIVED", dueDate: past }, now)).toBe(false);
  });

  it("is never overdue without a due date, or before it", () => {
    expect(isTaskOverdue({ status: "TODO", dueDate: null }, now)).toBe(false);
    expect(isTaskOverdue({ status: "TODO", dueDate: future }, now)).toBe(false);
  });

  it("recognises work due today without treating it as overdue", () => {
    const later = new Date("2026-09-11T22:00:00");
    expect(isDueToday({ status: "TODO", dueDate: later }, now)).toBe(true);
    expect(isDueToday({ status: "COMPLETED", dueDate: later }, now)).toBe(false);
  });
});

describe("date bounds (PRD #11 §143, §144)", () => {
  it("bounds a day from midnight to midnight", () => {
    const { start, end } = dayBounds(new Date("2026-09-11T15:22:31.000Z"));
    expect(start.getHours()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("starts the week on Monday", () => {
    // 2026-09-11 is a Friday; the week starts on Monday the 7th.
    expect(startOfWeek(new Date("2026-09-11T15:00:00")).getDay()).toBe(1);
    // A Sunday belongs to the week that began the previous Monday.
    expect(startOfWeek(new Date("2026-09-13T15:00:00")).getDate()).toBe(7);
  });
});
