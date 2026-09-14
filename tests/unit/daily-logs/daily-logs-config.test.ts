import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS, type RoleKey } from "@/config/roles";
import { minutesBetween } from "@/lib/modules/daily-logs/daily-log.entries";
import { hasExif, stripJpegMetadata } from "@/lib/modules/daily-logs/daily-log.exif";
import { requiredDays } from "@/lib/modules/daily-logs/daily-log.reports";
import { SECTION_SCHEMAS, projectSettingsSchema, reasonSchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { dateLabel, longDateLabel, previousWorkingDay } from "@/lib/modules/daily-logs/daily-log.time";

/**
 * Daily log rules that need no database (PRD #43 §16-§19, §83, §104-§106,
 * §126-§144, §186-§189).
 */

const has = (role: RoleKey, permission: string) => (permissionsForRole(role) as readonly string[]).includes(permission);

describe("daily log permissions by role (§129-§144)", () => {
  it("lets field authors write, managers review and lock, and keeps office roles out", () => {
    expect(has("ENGINEER", "daily_log.create")).toBe(true);
    expect(has("ENGINEER", "daily_log.submit")).toBe(true);
    expect(has("ENGINEER", "daily_log.review")).toBe(false);
    expect(has("PROJECT_MANAGER", "daily_log.review")).toBe(true);
    expect(has("PROJECT_MANAGER", "daily_log.lock")).toBe(true);
    expect(has("PROJECT_MANAGER", "daily_log.correct_locked")).toBe(true);
    expect(has("PROJECT_MANAGER", "daily_log.settings.manage")).toBe(false);
    expect(has("OWNER", "daily_log.settings.manage")).toBe(true);
    for (const role of ["ADMIN", "COMPANY_IT", "HR", "FINANCE", "LEGAL", "SALES"] as const) expect(has(role, "daily_log.view"), role).toBe(false);
    expect(has("CEO", "daily_log.view")).toBe(true);
    expect(has("CEO", "daily_log.edit")).toBe(false);
  });

  it("gives specialist roles their own sections and nothing else", () => {
    expect(has("QAQC", "daily_log.qaqc.manage")).toBe(true);
    expect(has("QAQC", "daily_log.workforce.manage")).toBe(false);
    expect(has("HSE", "daily_log.hse.manage")).toBe(true);
    expect(has("HSE", "daily_log.delay.manage")).toBe(false);
    expect(has("PROCUREMENT", "daily_log.delivery.manage")).toBe(true);
    expect(has("PROCUREMENT", "daily_log.create")).toBe(false);
    expect(has("ARCHITECT", "daily_log.instruction.manage")).toBe(true);
    expect(has("ARCHITECT", "daily_log.create")).toBe(false);
    const viewer = permissionsForRole("VIEWER").filter((permission) => permission.startsWith("daily_log."));
    expect(viewer).toEqual(["daily_log.view"]);
    for (const role of ROLE_KEYS) {
      if (has(role, "daily_log.lock")) expect(has(role, "daily_log.review"), role).toBe(true);
    }
  });
});

describe("site photos lose their location (§83)", () => {
  const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...Array(20).fill(0x47)];
  const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
  const scan = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9];
  const jpeg = new Uint8Array([0xff, 0xd8, ...segment(0xe0, jfif), ...segment(0xe1, exif), ...segment(0xed, [1, 2, 3]), ...segment(0xdb, [9, 9]), ...scan]);

  it("removes EXIF, XMP and IPTC segments and keeps every image byte", () => {
    expect(hasExif(jpeg)).toBe(true);
    const stripped = stripJpegMetadata(jpeg);
    expect(hasExif(stripped)).toBe(false);
    expect([...stripped]).toEqual([0xff, 0xd8, ...segment(0xe0, jfif), ...segment(0xdb, [9, 9]), ...scan]);
  });

  it("leaves anything that is not a well-formed JPEG untouched", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(stripJpegMetadata(png)).toBe(png);
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 0x01]);
    expect(stripJpegMetadata(truncated)).toBe(truncated);
  });
});

describe("site days (§16-§19, §104-§106, §250)", () => {
  it("counts only a project's working days inside its life", () => {
    const days = requiredDays({ from: "2026-09-07", to: "2026-09-20", workingDays: [1, 2, 3, 4, 5], startDate: new Date("2026-09-09T12:00:00Z"), endDate: new Date("2026-09-15T12:00:00Z") });
    expect(days).toEqual(["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15"]);
  });

  it("finds the last working day before today, skipping the weekend", () => {
    expect(previousWorkingDay("2026-09-14", [1, 2, 3, 4, 5])).toBe("2026-09-11");
    expect(previousWorkingDay("2026-09-15", [1, 2, 3, 4, 5])).toBe("2026-09-14");
    expect(previousWorkingDay("2026-09-14", [1, 2, 3, 4, 5, 6])).toBe("2026-09-12");
  });

  it("labels dates the same way everywhere", () => {
    expect(dateLabel("2026-09-14")).toBe("14 Sep 2026");
    expect(longDateLabel("2026-09-14")).toBe("Monday 14 Sep 2026");
    expect(minutesBetween("07:30", "09:15")).toBe(105);
  });
});

describe("entry validation (§186-§189)", () => {
  it("keeps headcount, progress and times honest", () => {
    expect(SECTION_SCHEMAS.workforce.safeParse({ organizationName: "Crew", headcount: 0 }).success).toBe(false);
    expect(SECTION_SCHEMAS.workforce.safeParse({ organizationName: "Crew", headcount: 2.5 }).success).toBe(false);
    expect(SECTION_SCHEMAS.activities.safeParse({ title: "Pour", progressPercent: 101 }).success).toBe(false);
    expect(SECTION_SCHEMAS.visitors.safeParse({ name: "Visitor", arrivedTime: "10:00", departedTime: "09:59" }).success).toBe(false);
    expect(SECTION_SCHEMAS.delays.safeParse({ category: "WEATHER", title: "Rain", startedTime: "10:00", endedTime: "11:00" }).success).toBe(true);
    expect(SECTION_SCHEMAS.weather.safeParse({ observedTime: "25:00" }).success).toBe(false);
    expect(reasonSchema.safeParse({ expectedVersion: 2, reason: "  " }).success).toBe(false);
    expect(projectSettingsSchema.parse({ logsRequired: true, reviewerMemberId: null, workingDays: [5, 1, 1, 3] }).workingDays).toEqual([1, 3, 5]);
  });
});
