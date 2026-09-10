import { describe, expect, it } from "vitest";

import {
  createProjectSchema,
  projectListQuerySchema,
  updateProjectSchema,
} from "@/lib/modules/projects/project.schema";
import {
  allowedTransitions,
  canTransitionProjectStatus,
  daysRemaining,
  formatDaysRemaining,
  getProjectScheduleStatus,
} from "@/lib/modules/projects/project.status";
import { parseProjectListQuery } from "@/lib/modules/projects/project.query";

const valid = {
  code: "PRJ-100",
  name: "Harbor Offices",
  status: "DRAFT",
};

describe("createProjectSchema (PRD #10 §33–§38)", () => {
  it("accepts the minimum required fields", () => {
    expect(createProjectSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing name", () => {
    const result = createProjectSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a one-character name", () => {
    expect(createProjectSchema.safeParse({ ...valid, name: "A" }).success).toBe(false);
  });

  it("rejects a missing code", () => {
    expect(createProjectSchema.safeParse({ ...valid, code: "" }).success).toBe(false);
  });

  it("rejects a name beyond 160 characters", () => {
    expect(createProjectSchema.safeParse({ ...valid, name: "x".repeat(161) }).success).toBe(false);
  });

  it("rejects an end date before the start date", () => {
    const result = createProjectSchema.safeParse({
      ...valid,
      startDate: "2026-06-01",
      endDate: "2026-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/on or after/i);
    }
  });

  it("accepts equal start and end dates", () => {
    const result = createProjectSchema.safeParse({
      ...valid,
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });
    expect(result.success).toBe(true);
  });

  it("refuses ARCHIVED as a settable status (PRD #10 §62)", () => {
    expect(createProjectSchema.safeParse({ ...valid, status: "ARCHIVED" }).success).toBe(false);
  });

  it("has no field for companyId or createdBy (PRD #10 §110)", () => {
    const result = createProjectSchema.parse({ ...valid, companyId: "other", createdBy: "someone" });
    expect(result).not.toHaveProperty("companyId");
    expect(result).not.toHaveProperty("createdBy");
  });
});

describe("updateProjectSchema", () => {
  it("never accepts archive fields through a general update (PRD #10 §111)", () => {
    const result = updateProjectSchema.parse({
      ...valid,
      archivedAt: new Date().toISOString(),
      archivedBy: "someone",
    });
    expect(result).not.toHaveProperty("archivedAt");
    expect(result).not.toHaveProperty("archivedBy");
  });
});

describe("project list query (PRD #10 §195)", () => {
  it("rejects a negative page and falls back to the first", () => {
    expect(parseProjectListQuery({ page: "-3" }).page).toBe(1);
  });

  it("caps the limit at 100", () => {
    expect(parseProjectListQuery({ limit: "5000" }).limit).toBe(100);
  });

  it("drops an unknown sort key", () => {
    expect(parseProjectListQuery({ sort: "; DROP TABLE projects" }).sort).toBe("updated-desc");
  });

  it("drops an unknown status", () => {
    expect(parseProjectListQuery({ status: "NOT_A_STATUS" }).status).toBeUndefined();
  });

  it("keeps known statuses only", () => {
    expect(parseProjectListQuery({ status: "ACTIVE,NOPE,ON_HOLD" }).status).toEqual([
      "ACTIVE",
      "ON_HOLD",
    ]);
  });

  it("refuses a limit above the ceiling through the schema too", () => {
    expect(projectListQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });
});

describe("project status transitions (PRD #10 §61, §62)", () => {
  it("allows the documented transitions", () => {
    expect(canTransitionProjectStatus("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransitionProjectStatus("ACTIVE", "ON_HOLD")).toBe(true);
    expect(canTransitionProjectStatus("ON_HOLD", "COMPLETED")).toBe(true);
    expect(canTransitionProjectStatus("COMPLETED", "ACTIVE")).toBe(true);
  });

  it("refuses to leave ARCHIVED through a normal update", () => {
    expect(canTransitionProjectStatus("ARCHIVED", "ACTIVE")).toBe(false);
    expect(canTransitionProjectStatus("ARCHIVED", "DRAFT")).toBe(false);
    expect(allowedTransitions("ARCHIVED")).toEqual(["ARCHIVED"]);
  });

  it("refuses a jump from DRAFT straight to COMPLETED", () => {
    expect(canTransitionProjectStatus("DRAFT", "COMPLETED")).toBe(false);
  });

  it("treats a no-op transition as valid", () => {
    expect(canTransitionProjectStatus("ACTIVE", "ACTIVE")).toBe(true);
  });
});

describe("schedule derivation (PRD #10 §49, §50)", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("reports a project past its end date as overdue", () => {
    const status = getProjectScheduleStatus(
      { status: "ACTIVE", startDate: new Date("2026-01-01"), endDate: new Date("2026-05-01") },
      now,
    );
    expect(status).toBe("OVERDUE");
  });

  it("reports a future project as upcoming", () => {
    const status = getProjectScheduleStatus(
      { status: "ACTIVE", startDate: new Date("2026-09-01"), endDate: new Date("2027-01-01") },
      now,
    );
    expect(status).toBe("UPCOMING");
  });

  it("reports a project with no dates as not scheduled", () => {
    expect(
      getProjectScheduleStatus({ status: "DRAFT", startDate: null, endDate: null }, now),
    ).toBe("NOT_SCHEDULED");
  });

  it("lets a completed project outrank an overdue end date", () => {
    expect(
      getProjectScheduleStatus(
        { status: "COMPLETED", startDate: new Date("2026-01-01"), endDate: new Date("2026-05-01") },
        now,
      ),
    ).toBe("COMPLETED");
  });

  it("counts days remaining and overdue", () => {
    expect(daysRemaining(new Date("2026-06-25T12:00:00Z"), now)).toBe(10);
    expect(daysRemaining(new Date("2026-06-05T12:00:00Z"), now)).toBe(-10);
    expect(daysRemaining(null, now)).toBeNull();
  });

  it("describes the count in words", () => {
    expect(formatDaysRemaining(1)).toBe("1 day remaining");
    expect(formatDaysRemaining(0)).toBe("Due today");
    expect(formatDaysRemaining(-2)).toBe("2 days overdue");
    expect(formatDaysRemaining(null)).toBe("No end date");
  });
});

describe("empty form fields (the shape a browser actually submits)", () => {
  it("treats an untouched optional select as absent, not invalid", () => {
    // An unset `<select>` posts "", which must not fail enum validation —
    // otherwise the whole form is refused because a dropdown was left alone.
    const result = createProjectSchema.safeParse({
      ...valid,
      priority: "",
      clientId: "",
      projectManagerMemberId: "",
      description: "",
      startDate: "",
      endDate: "",
      address: "",
      city: "",
      country: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBeUndefined();
      expect(result.data.clientId).toBeUndefined();
      expect(result.data.startDate).toBeUndefined();
    }
  });

  it("still rejects a priority that is not a real value", () => {
    expect(createProjectSchema.safeParse({ ...valid, priority: "URGENT" }).success).toBe(false);
  });

  it("accepts an update with no concurrency stamp", () => {
    const result = updateProjectSchema.safeParse({ ...valid, versionUpdatedAt: "" });
    expect(result.success).toBe(true);
  });
});
