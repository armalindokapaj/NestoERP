import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { createBuildingSchema, createFloorSchema, createUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import { createBuilding } from "@/lib/modules/project-structure/structure.buildings";
import { createFloor } from "@/lib/modules/project-structure/structure.floors";
import { createUnit } from "@/lib/modules/project-structure/structure.units";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 — the unit editor's contract over its route, against the real
 * database (§4; FV-04, FV-05, FV-06, FV-09, FV-22). A throwaway site in
 * company A; the `project_units` row is the oracle.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { PATCH } = await import("@/app/api/project-units/[unitId]/route");

const SITE = "aud09b_units";
let pm: UserContext;
let floorId = "";
let apartment = "";

async function removeSite() {
  const trail = (
    await Promise.all([
      prisma.projectUnit.findMany({ where: { projectId: SITE }, select: { id: true } }),
      prisma.projectFloor.findMany({ where: { projectId: SITE }, select: { id: true } }),
      prisma.projectBuilding.findMany({ where: { projectId: SITE }, select: { id: true } }),
    ])
  )
    .flat()
    .map((row) => row.id);
  await prisma.projectUnit.deleteMany({ where: { projectId: SITE } });
  await prisma.projectFloor.deleteMany({ where: { projectId: SITE } });
  await prisma.projectBuilding.deleteMany({ where: { projectId: SITE } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...trail, SITE] } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [...trail, SITE] } } });
  await prisma.projectMember.deleteMany({ where: { projectId: SITE } });
  await prisma.project.deleteMany({ where: { id: SITE } });
}

beforeAll(async () => {
  pm = await loginAs("PROJECT_MANAGER");
  await removeSite();
  await prisma.project.create({ data: { id: SITE, companyId: COMPANY.a, code: "AUD09B-UNITS", name: "AUD-09 units", status: "ACTIVE", projectManagerMemberId: "member_pm", createdBy: "test" } });
  await prisma.projectMember.create({ data: { companyId: COMPANY.a, projectId: SITE, companyMemberId: "member_pm", status: "ACTIVE" } });
  const building = await createBuilding(pm, SITE, createBuildingSchema.parse({ name: "AUD09B Tower", code: null }));
  floorId = (await createFloor(pm, building.id, createFloorSchema.parse({ number: 1, name: "Level 1", levelType: "STANDARD" }))).id;
  apartment = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY.a, code: "APARTMENT" }, select: { id: true } })).id;
});

afterEach(async () => {
  actAs(null);
  const units = await prisma.projectUnit.findMany({ where: { projectId: SITE }, select: { id: true } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: units.map((row) => row.id) } } });
  await prisma.projectUnit.deleteMany({ where: { projectId: SITE } });
});

afterAll(async () => {
  await removeSite();
  await cleanupSessions();
  await prisma.$disconnect();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function patch(unitId: string, body: unknown) {
  const response = await PATCH(
    new Request(`http://localhost/api/project-units/${unitId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ unitId }) },
  );
  return { status: response.status, body: (await response.json()) as Json };
}

async function fullUnit(code = "A-101") {
  return createUnit(
    pm,
    floorId,
    createUnitSchema.parse({
      unitCode: code,
      name: "Corner apartment",
      unitTypeId: apartment,
      position: "CORNER",
      orientation: "S",
      internalArea: "84.50",
      saleableArea: "92.25",
      balconyArea: "7.10",
      rooms: 4,
      bedrooms: 2,
      bathrooms: 2,
      description: "Two balconies",
    }),
  );
}

describe("unit edits keep what they do not send (FV-05)", () => {
  it("a PATCH with the required fields only keeps every area, count and note", async () => {
    const unit = await fullUnit();
    actAs(pm);

    const saved = await patch(unit.id, { unitCode: "A-101", unitTypeId: apartment, isActive: true, expectedVersion: unit.version });
    expect(saved.status).toBe(200);
    // Before AUD-09 each absent area, count and note became null.
    const row = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(row).toMatchObject({ name: "Corner apartment", position: "CORNER", orientation: "S", rooms: 4, bedrooms: 2, bathrooms: 2, description: "Two balconies" });
    expect([row.internalArea?.toFixed(2), row.saleableArea?.toFixed(2), row.balconyArea?.toFixed(2)]).toEqual(["84.50", "92.25", "7.10"]);

    // `null` and `""` clear, on purpose; zero is zero, not empty.
    expect((await patch(unit.id, { unitCode: "A-101", unitTypeId: apartment, isActive: true, expectedVersion: unit.version + 1, balconyArea: "", bathrooms: 0, description: null })).status).toBe(200);
    const cleared = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(cleared).toMatchObject({ balconyArea: null, bathrooms: 0, description: null, bedrooms: 2 });
    expect(cleared.internalArea?.toFixed(2)).toBe("84.50");
  });

  it("refuses malformed numbers on their field instead of clearing them (FV-06)", async () => {
    const unit = await fullUnit("A-102");
    actAs(pm);
    const base = { unitCode: "A-102", unitTypeId: apartment, isActive: true, expectedVersion: unit.version };
    for (const [body, field] of [
      // What the editor now sends for text that is not a number (it used to send NaN, i.e. null).
      [{ rooms: "abc" }, "rooms"],
      [{ bedrooms: 1.5 }, "bedrooms"],
      [{ bathrooms: -1 }, "bathrooms"],
      [{ internalArea: "84.505" }, "internalArea"],
      [{ internalArea: "1,234" }, "internalArea"],
      [{ saleableArea: "-3" }, "saleableArea"],
    ] as const) {
      const refused = await patch(unit.id, { ...base, ...body });
      expect(refused.status, JSON.stringify(body)).toBe(422);
      expect(refused.body.error.details, JSON.stringify(body)).toHaveProperty(field);
    }
    const row = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(row).toMatchObject({ version: unit.version, rooms: 4, bedrooms: 2, bathrooms: 2 });
    expect(row.internalArea?.toFixed(2)).toBe("84.50");

    // A forged unit type from another company is refused on its field.
    const foreignType = await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY.b }, select: { id: true } });
    const forged = await patch(unit.id, { ...base, unitTypeId: foreignType.id });
    expect(forged.status).toBe(422);
    expect(forged.body.error.details).toHaveProperty("unitTypeId");
  });
});
