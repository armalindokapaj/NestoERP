import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS, type RoleKey } from "@/config/roles";
import { dateLabel, displayDateOf, earliestAfter, isDelayed, overdueDaysOf, targetDateOf, varianceDaysOf, varianceLabel, type DatedMilestone } from "@/lib/modules/project-planning/planning.dates";
import { topologicalOrder, wouldCreateCycle } from "@/lib/modules/project-planning/planning.graph";
import { baselineMovable, milestoneCapabilities, planningCapabilities } from "@/lib/modules/project-planning/planning.permissions";
import { baselineSchema, completeMilestoneSchema, createMilestoneSchema, createPhaseSchema, dependencySchema, quickUpdateSchema, reopenMilestoneSchema } from "@/lib/modules/project-planning/planning.schema";
import { PLANNING_TEMPLATES } from "@/lib/modules/project-planning/planning.template-catalog";
import { MILESTONE_TYPES } from "@/lib/modules/project-planning/planning.types";
import type { UserContext } from "@/lib/context/types";

/**
 * Planning rules that need no database (PRD #44 §15-§20, §33-§37, §44-§46,
 * §77-§95, §133-§135, §197-§203, §279).
 */

const has = (role: RoleKey, permission: string) => (permissionsForRole(role) as readonly string[]).includes(permission);
const milestone = (overrides: Partial<DatedMilestone>): DatedMilestone => ({ status: "IN_PROGRESS", baselineDate: null, plannedDate: null, forecastDate: null, actualDate: null, ...overrides });

describe("planning permissions by role (§80-§95)", () => {
  it("makes the project manager, the CEO and the Owner the plan's keepers and everybody else on the project a reader", () => {
    for (const permission of ["project_planning.phase.create", "project_planning.milestone.create", "project_planning.milestone.complete", "project_planning.milestone.reopen", "project_planning.baseline.manage", "project_planning.dependencies.manage", "project_planning.blockers.manage"]) {
      expect(has("PROJECT_MANAGER", permission), permission).toBe(true);
      expect(has("OWNER", permission), permission).toBe(true);
      // The CEO runs the company's projects (user, 2026-09-29).
      expect(has("CEO", permission), permission).toBe(true);
    }
    for (const role of ["ARCHITECT", "ENGINEER", "FINANCE", "LEGAL", "SALES", "PROCUREMENT", "INVENTORY", "QAQC", "HSE", "VIEWER"] as const) {
      expect(has(role, "project_planning.view"), role).toBe(true);
      expect(permissionsForRole(role).filter((permission) => permission.startsWith("project_planning.")), role).toEqual(["project_planning.view"]);
    }
    for (const role of ["PLATFORM_ADMIN", "GROUP_IT", "HR"] as const) expect(permissionsForRole(role).filter((permission) => permission.startsWith("project_planning.")), role).toEqual([]);
  });

  it("keeps the company's planning authority with the Owner", () => {
    expect(ROLE_KEYS.filter((role) => has(role, "project_planning.settings.manage"))).toEqual(["OWNER"]);
    for (const role of ROLE_KEYS) {
      if (has(role, "project_planning.milestone.reopen")) expect(has(role, "project_planning.milestone.complete"), role).toBe(true);
    }
  });

  it("moves a locked baseline only with the planning authority, and closes an archived project's plan", () => {
    const context = (permissions: string[]) => ({ permissions, moduleAccess: { projects: { enabled: true, accessLevel: "MANAGE", scope: "PROJECT" } } }) as unknown as UserContext;
    const pm = context(permissionsForRole("PROJECT_MANAGER"));
    const owner = context(permissionsForRole("OWNER"));
    expect(baselineMovable(pm, { baselineLocked: false })).toBe(true);
    expect(baselineMovable(pm, { baselineLocked: true })).toBe(false);
    expect(baselineMovable(owner, { baselineLocked: true })).toBe(true);
    const archived = planningCapabilities(pm, { archived: true, baselineLocked: false });
    expect(Object.values(archived).some(Boolean)).toBe(false);
    const completed = milestoneCapabilities(pm, { archived: false, baselineLocked: false }, "COMPLETED", false);
    expect(completed.canComplete).toBe(false);
    expect(completed.canReopen).toBe(true);
  });
});

describe("dates, variance and delay (§15-§20, §44-§46, §279)", () => {
  it("shows the actual date, else the forecast, planned or baseline date", () => {
    expect(displayDateOf(milestone({ baselineDate: "2026-10-20", plannedDate: "2026-10-22", forecastDate: "2026-10-30", actualDate: "2026-10-31" }))).toBe("2026-10-31");
    expect(displayDateOf(milestone({ baselineDate: "2026-10-20", plannedDate: "2026-10-22" }))).toBe("2026-10-22");
    expect(targetDateOf({ baselineDate: "2026-10-20", plannedDate: null, forecastDate: null })).toBe("2026-10-20");
  });

  it("measures variance from the baseline: forecast while open, actual once complete", () => {
    expect(varianceDaysOf(milestone({ baselineDate: "2026-10-20", forecastDate: "2026-10-30" }))).toBe(10);
    expect(varianceDaysOf(milestone({ baselineDate: "2026-10-20", plannedDate: "2026-10-17" }))).toBe(-3);
    expect(varianceDaysOf(milestone({ status: "COMPLETED", baselineDate: "2026-10-20", forecastDate: "2026-11-30", actualDate: "2026-10-20" }))).toBe(0);
    expect(varianceDaysOf(milestone({ forecastDate: "2026-10-30" }))).toBeNull();
    expect([varianceLabel(12), varianceLabel(-3), varianceLabel(0), varianceLabel(1)]).toEqual(["+12 days", "-3 days", "On baseline", "+1 day"]);
  });

  it("derives delay from the date whatever the status says, and never for a closed milestone", () => {
    const late = milestone({ status: "NOT_STARTED", forecastDate: "2026-09-09" });
    expect(isDelayed(late, "2026-09-14")).toBe(true);
    expect(overdueDaysOf(late, "2026-09-14")).toBe(5);
    expect(isDelayed(milestone({ forecastDate: "2026-09-14" }), "2026-09-14")).toBe(false);
    expect(isDelayed({ ...late, status: "COMPLETED" }, "2026-09-14")).toBe(false);
    expect(isDelayed({ ...late, status: "CANCELLED" }, "2026-09-14")).toBe(false);
  });

  it("suggests a successor's earliest forecast from its predecessors and their lag, ignoring cancelled ones", () => {
    expect(earliestAfter([{ ...milestone({ forecastDate: "2026-10-30" }), lagDays: 7 }, { ...milestone({ status: "COMPLETED", actualDate: "2026-10-01", forecastDate: "2026-11-30" }), lagDays: 0 }])).toBe("2026-11-06");
    expect(earliestAfter([{ ...milestone({ status: "CANCELLED", forecastDate: "2027-01-01" }), lagDays: 0 }])).toBeNull();
    expect(dateLabel("2026-10-30")).toBe("30 Oct 2026");
  });
});

describe("dependencies (§33-§37)", () => {
  const edges = [
    { predecessorId: "a", successorId: "b" },
    { predecessorId: "b", successorId: "c" },
    { predecessorId: "c", successorId: "d" },
  ];

  it("refuses self-dependencies and every edge that would close a loop", () => {
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "d", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "c", "b")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "d")).toBe(false);
    expect(wouldCreateCycle(edges, "x", "a")).toBe(false);
  });

  it("handles long chains without recursion and orders predecessors first", () => {
    const chain = Array.from({ length: 5_000 }, (_, index) => ({ predecessorId: `m${index}`, successorId: `m${index + 1}` }));
    expect(wouldCreateCycle(chain, "m5000", "m0")).toBe(true);
    expect(topologicalOrder(["d", "c", "b", "a"], edges)).toEqual(["a", "b", "c", "d"]);
  });

  it("supports finish-to-start with non-negative whole-day lag only", () => {
    expect(dependencySchema.parse({ predecessorMilestoneId: "m1" })).toEqual({ predecessorMilestoneId: "m1", lagDays: 0 });
    expect(dependencySchema.safeParse({ predecessorMilestoneId: "m1", lagDays: -1 }).success).toBe(false);
    expect(dependencySchema.safeParse({ predecessorMilestoneId: "m1", lagDays: 1.5 }).success).toBe(false);
  });
});

describe("validation (§197-§203)", () => {
  it("keeps progress between 0 and 100 and phase ends after their starts", () => {
    expect(createMilestoneSchema.safeParse({ name: "Roof", progressPercent: 101 }).success).toBe(false);
    expect(createMilestoneSchema.parse({ name: "Roof" })).toMatchObject({ milestoneType: "OTHER", critical: false, externallyCommitted: false, baselineDate: null });
    expect(createPhaseSchema.safeParse({ name: "Envelope", plannedStartDate: "2026-10-01", plannedEndDate: "2026-09-01" }).success).toBe(false);
    expect(createPhaseSchema.safeParse({ name: "Envelope", plannedStartDate: "2026-09-01", plannedEndDate: "2026-10-01" }).success).toBe(true);
  });

  it("asks a reopen for its reason and never completes through a quick update", () => {
    expect(reopenMilestoneSchema.safeParse({ expectedVersion: 2, reason: " " }).success).toBe(false);
    expect(quickUpdateSchema.safeParse({ expectedVersion: 2, status: "COMPLETED" }).success).toBe(false);
    expect(completeMilestoneSchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2, actualDate: null, completionNote: null });
    expect(baselineSchema.safeParse({ expectedVersion: 2, newBaselineDate: "30/10/2026" }).success).toBe(false);
  });
});

describe("templates (§133-§137)", () => {
  it("offers the four starting plans with unique keys and dependencies that point inside the template", () => {
    expect(PLANNING_TEMPLATES.map((template) => template.key)).toEqual(["residential", "commercial", "fit-out", "infrastructure"]);
    expect(PLANNING_TEMPLATES[0].phases.map((phase) => phase.name)).toEqual(["Pre-Construction", "Design", "Procurement", "Substructure", "Superstructure", "Envelope", "MEP", "Fit-Out", "External Works", "Commissioning", "Handover"]);
    for (const template of PLANNING_TEMPLATES) {
      const milestones = template.phases.flatMap((phase) => phase.milestones);
      const keys = milestones.map((entry) => entry.key);
      expect(new Set(keys).size, template.key).toBe(keys.length);
      const edges = milestones.flatMap((entry) => (entry.after ?? []).map((after) => ({ predecessorId: after, successorId: entry.key })));
      for (const edge of edges) expect(keys, `${template.key}: ${edge.predecessorId}`).toContain(edge.predecessorId);
      expect(topologicalOrder(keys, edges)).toHaveLength(keys.length);
      for (const entry of milestones) expect(MILESTONE_TYPES).toContain(entry.type);
    }
  });
});
