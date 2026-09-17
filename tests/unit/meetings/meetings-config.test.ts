import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/role-defaults";
import { MEMBERSHIP_ROLE_KEYS, ROLE_KEYS } from "@/config/roles";
import { planOccurrences } from "@/lib/modules/meetings/meeting.service";
import { isSafeMeetingUrl } from "@/lib/modules/meetings/meeting.schema";
import { AGENDA_TEMPLATES, decisionLabel, defaultVisibilityFor } from "@/lib/modules/meetings/meeting.types";
import { instantFromLocal } from "@/lib/modules/calendar/calendar.time";

/**
 * Meetings configuration (PRD #40 §38, §88, §139-§154, §205, §224-§226, §238).
 */
describe("meeting permissions by role (§139-§154)", () => {
  it("lets every company role but the Viewer create meetings, and every one read them", () => {
    for (const role of MEMBERSHIP_ROLE_KEYS) {
      const held = new Set(permissionsForRole(role));
      expect(held.has("meeting.view"), role).toBe(true);
      expect(held.has("meeting.create"), role).toBe(role !== "VIEWER");
    }
  });

  it("keeps reopening final minutes and managing any meeting to the Owner and the CEO", () => {
    const managers = ROLE_KEYS.filter((role) => permissionsForRole(role).includes("meeting.minutes.reopen"));
    expect([...managers].sort()).toEqual(["CEO", "OWNER"]);
    for (const role of ROLE_KEYS) {
      expect(permissionsForRole(role).includes("meeting.manage"), role).toBe(managers.includes(role));
    }
  });

  it("gives the Viewer nothing that changes a meeting", () => {
    const viewer = permissionsForRole("VIEWER").filter((permission) => permission.startsWith("meeting."));
    expect([...viewer].sort()).toEqual(["meeting.document.view", "meeting.view"]);
  });
});

describe("online links (§238)", () => {
  it("accepts https only, without credentials", () => {
    expect(isSafeMeetingUrl("https://meet.example.com/abc?pwd=1")).toBe(true);
    for (const bad of ["http://meet.example.com", "javascript:alert(1)", "data:text/html,x", "https://a:b@example.com", "ftp://x", "//example.com", ""]) {
      expect(isSafeMeetingUrl(bad), bad).toBe(false);
    }
  });
});

describe("defaults and labels (§38, §88, §214)", () => {
  it("suggests the project team for a project meeting and the invitees otherwise", () => {
    expect(defaultVisibilityFor("COORDINATION", true)).toBe("PROJECT");
    expect(defaultVisibilityFor("MANAGEMENT", true)).toBe("PARTICIPANTS");
    expect(defaultVisibilityFor("INTERNAL", false)).toBe("PARTICIPANTS");
  });

  it("numbers decisions D-01 onwards and ships the seven templates", () => {
    expect(decisionLabel(3)).toBe("D-03");
    expect(decisionLabel(12)).toBe("D-12");
    expect(AGENDA_TEMPLATES.map((template) => template.label)).toEqual(["General", "Project Coordination", "Site Meeting", "Design Review", "QA/QC", "HSE", "Management"]);
    expect(AGENDA_TEMPLATES.find((template) => template.key === "project-coordination")!.items.map((item) => item.title)).toEqual([
      "Previous action items",
      "Design status",
      "Site progress",
      "Procurement",
      "QA/QC",
      "HSE",
      "Risks / blockers",
      "Decisions required",
      "New actions",
    ]);
  });
});

describe("series planning (§224-§226)", () => {
  const zone = "Europe/Tirane";
  const first = { startsAt: instantFromLocal("2026-10-19", "09:30", zone), endsAt: instantFromLocal("2026-10-19", "10:30", zone), timezone: zone };

  it("numbers weekly occurrences from zero and keeps the wall clock across the autumn clock change", () => {
    const occurrences = planOccurrences(first, { frequency: "WEEKLY", interval: 1 }, new Date(first.startsAt.getTime() + 22 * 86_400_000));
    expect(occurrences.map((row) => row.occurrenceIndex)).toEqual([0, 1, 2, 3]);
    const clock = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    expect(occurrences.map((row) => clock(row.startsAt))).toEqual(["09:30", "09:30", "09:30", "09:30"]);
    expect(occurrences.every((row) => row.endsAt.getTime() - row.startsAt.getTime() === 3_600_000)).toBe(true);
  });

  it("stops at the horizon and at the series' own end", () => {
    const horizon = new Date(first.startsAt.getTime() + 90 * 86_400_000);
    expect(planOccurrences(first, { frequency: "DAILY", interval: 1 }, horizon)).toHaveLength(90);
    expect(planOccurrences(first, { frequency: "DAILY", interval: 1, count: 5 }, horizon)).toHaveLength(5);
    expect(planOccurrences(first, { frequency: "MONTHLY", interval: 1, until: "2026-12-31" }, new Date("2027-12-31T00:00:00Z"))).toHaveLength(3);
  });
});
