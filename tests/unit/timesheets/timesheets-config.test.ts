import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/role-defaults";
import { MEMBERSHIP_ROLE_KEYS, ROLE_KEYS } from "@/config/roles";
import { instantFromLocal } from "@/lib/modules/calendar/calendar.time";
import { deadlineDescription, lastDueWeek, submissionDeadline } from "@/lib/modules/timesheets/timesheet.deadline";
import { buildRows, summarise } from "@/lib/modules/timesheets/timesheet.service";
import { formatHoursCompact, formatMinutes, isoWeekday, parseDuration, weekLabel, weekStartOf } from "@/lib/modules/timesheets/timesheet.time";
import type { TimesheetSettingsDTO, WorkLogDTO } from "@/lib/modules/timesheets/timesheet.types";
import { settingsSchema, workLogInputSchema } from "@/lib/modules/timesheets/timesheet.schema";

/**
 * Timesheet rules that need no database (PRD #42 §11-§18, §33-§36, §101,
 * §128-§143, §192, §205, §247).
 */

const SETTINGS: TimesheetSettingsDTO = {
  weekStartsOn: 1,
  standardDailyMinutes: 480,
  standardWeeklyMinutes: 2400,
  incrementMinutes: 15,
  enforceIncrement: false,
  backdateDays: 14,
  submitDay: null,
  submitTime: null,
  descriptionsRequired: false,
  membersSetBillable: true,
  timezone: "Europe/Tirane",
};

function entry(overrides: Partial<WorkLogDTO>): WorkLogDTO {
  return {
    id: Math.random().toString(36).slice(2),
    workDate: "2026-09-07",
    workType: "PROJECT_WORK",
    minutes: 60,
    description: null,
    billable: true,
    overtimeFlag: false,
    project: { id: "p1", name: "Riverside", code: "PRJ-001" },
    task: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("durations (§16-§18, §205)", () => {
  it("reads hours, decimal hours, clock time and minutes as whole minutes", () => {
    expect(parseDuration("2")).toBe(120);
    expect(parseDuration("2.5")).toBe(150);
    expect(parseDuration("2,5")).toBe(150);
    expect(parseDuration("2:30")).toBe(150);
    expect(parseDuration("150m")).toBe(150);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("45min")).toBe(45);
  });

  it("refuses what is not a whole number of minutes, or not a duration at all", () => {
    expect(parseDuration("2.33")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });

  it("formats minutes without floats", () => {
    expect(formatMinutes(0)).toBe("0h");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(480)).toBe("8h");
    expect(formatMinutes(510)).toBe("8h 30m");
    expect(formatHoursCompact(450)).toBe("7.5h");
  });

  it("refuses entries shorter than five minutes or longer than a day", () => {
    const base = { workDate: "2026-09-07", workType: "INTERNAL", minutes: 60 };
    expect(workLogInputSchema.safeParse({ ...base, minutes: 4 }).success).toBe(false);
    expect(workLogInputSchema.safeParse({ ...base, minutes: 1441 }).success).toBe(false);
    expect(workLogInputSchema.safeParse({ ...base, minutes: 60.5 }).success).toBe(false);
    expect(workLogInputSchema.safeParse(base).success).toBe(true);
  });
});

describe("weeks (§11, §12)", () => {
  it("starts the week on the company's day", () => {
    expect(isoWeekday("2026-09-13")).toBe(7);
    expect(weekStartOf("2026-09-13", 1)).toBe("2026-09-07");
    expect(weekStartOf("2026-09-13", 7)).toBe("2026-09-13");
    expect(weekStartOf("2026-09-12", 7)).toBe("2026-09-06");
    expect(weekLabel("2026-09-07")).toBe("7–13 Sep 2026");
  });
});

describe("totals and rows (§32-§36, §43, §192)", () => {
  it("adds up billable, internal and overtime, and lowers the expected week for leave", () => {
    const logs = [
      entry({ minutes: 1500 }),
      entry({ minutes: 600, billable: false, project: null, workType: "INTERNAL" }),
      entry({ minutes: 400, overtimeFlag: true }),
    ];
    const totals = summarise(logs, SETTINGS, 1);
    expect(totals.totalMinutes).toBe(2500);
    expect(totals.billableMinutes).toBe(1900);
    expect(totals.nonBillableMinutes).toBe(600);
    expect(totals.internalMinutes).toBe(600);
    expect(totals.overtimeMinutes).toBe(100);
    expect(totals.overtimeFlaggedMinutes).toBe(400);
    expect(totals.expectedMinutes).toBe(1920);
    expect(totals.projects[0]).toMatchObject({ name: "Riverside", minutes: 1900 });
  });

  it("groups entries into project rows first, then internal work", () => {
    const rows = buildRows([
      entry({ workType: "INTERNAL", project: null, minutes: 30 }),
      entry({ minutes: 60, workDate: "2026-09-07" }),
      entry({ minutes: 90, workDate: "2026-09-07" }),
      entry({ minutes: 45, workDate: "2026-09-08" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].project?.name).toBe("Riverside");
    expect(rows[0].days["2026-09-07"]).toMatchObject({ minutes: 150 });
    expect(rows[0].days["2026-09-07"].logIds).toHaveLength(2);
    expect(rows[0].totalMinutes).toBe(195);
    expect(rows[1].workType).toBe("INTERNAL");
  });
});

describe("submission deadline (§101, §213)", () => {
  it("exists only when the company sets both a day and a time", () => {
    expect(submissionDeadline("2026-09-07", SETTINGS)).toBeNull();
    expect(lastDueWeek(new Date(), SETTINGS)).toBeNull();
    expect(settingsSchema.safeParse({ ...SETTINGS, submitDay: 1, submitTime: null }).success).toBe(false);
  });

  it("falls on the week's own Friday, or the Monday after it", () => {
    const friday = submissionDeadline("2026-09-07", { ...SETTINGS, submitDay: 5, submitTime: "17:00" })!;
    expect(friday.date).toBe("2026-09-11");
    expect(friday.instant.toISOString()).toBe(instantFromLocal("2026-09-11", "17:00", "Europe/Tirane").toISOString());
    const monday = submissionDeadline("2026-09-07", { ...SETTINGS, submitDay: 1, submitTime: "12:00" })!;
    expect(monday.date).toBe("2026-09-14");
    expect(deadlineDescription({ submitDay: 1, submitTime: "12:00" })).toBe("Monday 12:00");
  });

  it("names the latest week whose deadline has passed", () => {
    const settings = { ...SETTINGS, submitDay: 1, submitTime: "12:00" };
    expect(lastDueWeek(instantFromLocal("2026-09-14", "11:00", "Europe/Tirane"), settings)).toBe("2026-08-31");
    expect(lastDueWeek(instantFromLocal("2026-09-14", "13:00", "Europe/Tirane"), settings)).toBe("2026-09-07");
  });
});

describe("timesheet permissions by role (§128-§143)", () => {
  it("lets everybody in a company but the Viewer log and submit their own time", () => {
    for (const role of MEMBERSHIP_ROLE_KEYS) {
      const held = new Set(permissionsForRole(role));
      expect(held.has("timesheet.submit_own"), role).toBe(role !== "VIEWER");
      expect(held.has("timesheet.view_own"), role).toBe(role !== "VIEWER");
    }
  });

  it("gives approval to managers, reopening only to HR and the Owner, and project hours to Finance", () => {
    const has = (role: (typeof ROLE_KEYS)[number], permission: string) => (permissionsForRole(role) as readonly string[]).includes(permission);
    expect(has("PROJECT_MANAGER", "timesheet.approve")).toBe(true);
    expect(has("ENGINEER", "timesheet.approve")).toBe(false);
    expect(has("HR", "timesheet.reopen")).toBe(true);
    expect(has("OWNER", "timesheet.reopen")).toBe(true);
    expect(has("PROJECT_MANAGER", "timesheet.reopen")).toBe(false);
    expect(has("FINANCE", "timesheet.project.view")).toBe(true);
    expect(has("FINANCE", "timesheet.team.view")).toBe(false);
  });
});
