import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { createMilestone } from "@/lib/modules/project-planning/planning.milestones";
import { createPhase } from "@/lib/modules/project-planning/planning.phases";
import { createMilestoneSchema, createPhaseSchema } from "@/lib/modules/project-planning/planning.schema";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 — the phase form's contract over its route, against the real
 * database (§4; FV-04, FV-05, FV-07, FV-09, FV-22). A throwaway site in
 * company A keeps the seeded plan untouched; the `project_phases` row is the
 * oracle.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { PATCH } = await import("@/app/api/project-phases/[phaseId]/route");
const { PATCH: PATCH_MILESTONE } = await import("@/app/api/project-milestones/[milestoneId]/route");

const SITE = "aud09b_plan";
let pm: UserContext;

async function removeMilestones() {
  const milestones = await prisma.projectMilestone.findMany({ where: { projectId: SITE }, select: { id: true } });
  const ids = milestones.map((row) => row.id);
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.projectMilestone.deleteMany({ where: { id: { in: ids } } });
}

async function removeSite() {
  await removeMilestones();
  const phases = await prisma.projectPhase.findMany({ where: { projectId: SITE }, select: { id: true } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [...phases.map((row) => row.id), SITE] } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: SITE } });
  await prisma.projectPhase.deleteMany({ where: { projectId: SITE } });
  await prisma.projectMember.deleteMany({ where: { projectId: SITE } });
  await prisma.project.deleteMany({ where: { id: SITE } });
}

beforeAll(async () => {
  pm = await loginAs("PROJECT_MANAGER");
  await removeSite();
  await prisma.project.create({ data: { id: SITE, companyId: COMPANY.a, code: "AUD09B-PLAN", name: "AUD-09 plan", status: "ACTIVE", projectManagerMemberId: "member_pm", createdBy: "test" } });
  await prisma.projectMember.createMany({ data: ["member_pm", "member_qaqc"].map((companyMemberId) => ({ companyId: COMPANY.a, projectId: SITE, companyMemberId, status: "ACTIVE" as const })) });
});

afterEach(async () => {
  actAs(null);
  await removeMilestones();
  const phases = await prisma.projectPhase.findMany({ where: { projectId: SITE }, select: { id: true } });
  await prisma.activity.deleteMany({ where: { entityId: { in: phases.map((row) => row.id) } } });
  await prisma.projectPhase.deleteMany({ where: { projectId: SITE } });
});

afterAll(async () => {
  await removeSite();
  await cleanupSessions();
  await prisma.$disconnect();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function patch(phaseId: string, body: unknown) {
  const response = await PATCH(
    new Request(`http://localhost/api/project-phases/${phaseId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ phaseId }) },
  );
  return { status: response.status, body: (await response.json()) as Json };
}

async function fullPhase() {
  return createPhase(
    pm,
    SITE,
    createPhaseSchema.parse({
      name: "Superstructure",
      description: "Frame and slabs",
      status: "IN_PROGRESS",
      progressPercent: 40,
      ownerMemberId: "member_qaqc",
      plannedStartDate: "2031-03-01",
      plannedEndDate: "2031-09-30",
      forecastStartDate: "2031-03-15",
      forecastEndDate: "2031-10-15",
    }),
  );
}

describe("phase edits are partial updates (FV-05)", () => {
  it("a PATCH naming only the name keeps the status, progress, owner and dates", async () => {
    const phase = await fullPhase();
    const before = await prisma.projectPhase.findUniqueOrThrow({ where: { id: phase.id } });
    actAs(pm);

    expect((await patch(phase.id, { expectedVersion: phase.version, name: "Superstructure and core" })).status).toBe(200);
    // Before AUD-09 the status fell back to Not started and the rest was erased.
    const after = await prisma.projectPhase.findUniqueOrThrow({ where: { id: phase.id } });
    expect(after).toMatchObject({
      name: "Superstructure and core",
      description: "Frame and slabs",
      status: "IN_PROGRESS",
      ownerMemberId: "member_qaqc",
      plannedStartDate: before.plannedStartDate,
      plannedEndDate: before.plannedEndDate,
      forecastStartDate: before.forecastStartDate,
      forecastEndDate: before.forecastEndDate,
      version: phase.version + 1,
    });
    expect(after.progressPercent?.toString()).toBe("40");

    // `null` clears, on purpose.
    expect((await patch(phase.id, { expectedVersion: phase.version + 1, ownerMemberId: null, forecastEndDate: null })).status).toBe(200);
    expect(await prisma.projectPhase.findUniqueOrThrow({ where: { id: phase.id } })).toMatchObject({ ownerMemberId: null, forecastEndDate: null, status: "IN_PROGRESS", forecastStartDate: before.forecastStartDate });
  });

  it("an end before the saved start is refused on the end, and bad values on their fields", async () => {
    const phase = await fullPhase();
    actAs(pm);

    const backwards = await patch(phase.id, { expectedVersion: phase.version, plannedEndDate: "2031-02-28" });
    expect(backwards.status).toBe(422);
    expect(backwards.body.error.details).toEqual({ plannedEndDate: ["The end is before the start."] });

    for (const [body, field] of [
      [{ plannedStartDate: "2031-02-30" }, "plannedStartDate"],
      [{ progressPercent: 101 }, "progressPercent"],
      [{ status: "FINISHED_ISH" }, "status"],
      [{ name: "" }, "name"],
      [{ actualStartDate: "2031-05-02", actualEndDate: "2031-05-01" }, "actualEndDate"],
    ] as const) {
      const refused = await patch(phase.id, { expectedVersion: phase.version, ...body });
      expect(refused.status, JSON.stringify(body)).toBe(422);
      expect(refused.body.error.details, JSON.stringify(body)).toHaveProperty(field);
    }

    // A forged owner — another company's member — is refused too.
    const forged = await patch(phase.id, { expectedVersion: phase.version, ownerMemberId: "member_owner__b" });
    expect(forged.status).toBe(422);
    expect((await prisma.projectPhase.findUniqueOrThrow({ where: { id: phase.id } })).version).toBe(phase.version);

    // Positive control: an end on the saved start day is allowed.
    expect((await patch(phase.id, { expectedVersion: phase.version, plannedEndDate: "2031-03-01" })).status).toBe(200);
  });
});

describe("milestone edits are partial updates (FV-05)", () => {
  it("a PATCH naming only the forecast keeps the description, owner, planned date, progress and flags", async () => {
    const created = await createMilestone(
      pm,
      SITE,
      createMilestoneSchema.parse({ name: "Topping out", description: "Roof slab poured", milestoneType: "CONSTRUCTION", ownerMemberId: "member_qaqc", plannedDate: "2031-08-01", forecastDate: "2031-08-10", progressPercent: 25, critical: true }),
    );
    actAs(pm);
    const response = await PATCH_MILESTONE(
      new Request(`http://localhost/api/project-milestones/${created.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: created.version, forecastDate: "2031-08-20", forecastReason: "Crane downtime" }) }),
      { params: Promise.resolve({ milestoneId: created.id }) },
    );
    expect(response.status).toBe(200);
    const row = await prisma.projectMilestone.findUniqueOrThrow({ where: { id: created.id } });
    // Before AUD-09 this request was refused for the missing name, type, status and flags;
    // a request that repeated only those erased the description, owner, dates and progress.
    expect(row).toMatchObject({ name: "Topping out", description: "Roof slab poured", milestoneType: "CONSTRUCTION", ownerMemberId: "member_qaqc", critical: true, status: "NOT_STARTED" });
    expect(row.progressPercent?.toString()).toBe("25");
    expect(row.forecastDate?.toISOString().slice(0, 10)).toBe("2031-08-20");
    expect(row.plannedDate?.toISOString().slice(0, 10)).toBe("2031-08-01");
    expect(await prisma.activity.count({ where: { entityId: created.id, action: "MILESTONE_FORECAST_CHANGED" } })).toBe(1);
  });
});
