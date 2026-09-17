import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { createUnitTypeSchema, updateUnitTypeSchema } from "@/lib/modules/project-structure/structure.schema";
import { getProjectStructure } from "@/lib/modules/project-structure/structure.service";
import { createUnitType, deleteUnitType, listUnitTypes, reorderUnitTypes, updateUnitType } from "@/lib/modules/project-structure/unit-type.service";
import { cleanupSessions, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * A company's own unit types (E-05B §20, §21, §74, §116).
 *
 * The same shape as the project types beside them: the Owner and Admin keep
 * the list, nobody else does, and nothing in it reaches across a company. A
 * type units use is retired rather than deleted, so no unit loses its type.
 */

const COMPANY_A = "company_demo_a";
const COMPANY_B = "company_demo_b";
const DEFAULT_CODES = ["APARTMENT", "PENTHOUSE", "VILLA", "OFFICE", "SHOP", "PARKING", "GARAGE", "STORAGE", "LAND", "OTHER"];

let owner: UserContext;
let admin: UserContext;
let ownerB: UserContext;
let startedAt: Date;
const tempTypes: string[] = [];
let originalOrder: Array<{ id: string; sortOrder: number; updatedBy: string | null }> = [];

beforeAll(async () => {
  startedAt = new Date();
  [owner, admin] = await Promise.all([loginAs("OWNER"), loginAs("ADMIN")]);
  ownerB = await loginAsMembership("member_owner_b");
});

afterEach(async () => {
  if (tempTypes.length > 0) {
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: tempTypes } } });
    await prisma.projectUnitType.deleteMany({ where: { id: { in: tempTypes } } });
    tempTypes.length = 0;
  }
  for (const row of originalOrder) {
    await prisma.projectUnitType.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder, updatedBy: row.updatedBy } });
  }
  originalOrder = [];
  await prisma.auditEvent.deleteMany({ where: { actionKey: "PROJECT_UNIT_TYPES_REORDERED", entityId: { in: [COMPANY_A, COMPANY_B] }, occurredAt: { gte: startedAt } } });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function expectError(promise: Promise<unknown>, code: string, detail?: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  if (detail) expect((error as AccessError).details).toMatchObject({ code: detail });
}

async function create(context: UserContext, input: Record<string, unknown>) {
  const created = await createUnitType(context, createUnitTypeSchema.parse(input));
  tempTypes.push(created.id);
  return created;
}

const update = (context: UserContext, id: string, input: Record<string, unknown>) => updateUnitType(context, id, updateUnitTypeSchema.parse(input));
const seeded = (companyId: string, code: string) => prisma.projectUnitType.findFirstOrThrow({ where: { companyId, code } });

describe("who keeps the list", () => {
  it("lets the Owner and an Admin read it, with how many units use each type", async () => {
    for (const context of [owner, admin]) {
      const types = await listUnitTypes(context);
      expect(types.map((type) => type.code)).toEqual(expect.arrayContaining(DEFAULT_CODES));
      expect(types.find((type) => type.code === "APARTMENT")).toMatchObject({ name: "Apartment", category: "RESIDENTIAL", isActive: true });
      expect(types.find((type) => type.code === "APARTMENT")?.unitCount).toBeGreaterThanOrEqual(96);
      expect(types.find((type) => type.code === "PARKING")?.unitCount).toBeGreaterThanOrEqual(18);
    }
  });

  it("refuses everybody else, the Project Manager and the Architect included", async () => {
    const apartment = await seeded(COMPANY_A, "APARTMENT");
    for (const role of ["PROJECT_MANAGER", "ARCHITECT", "ENGINEER", "SALES", "CEO", "VIEWER"] as const) {
      const context = await loginAs(role);
      await expectError(listUnitTypes(context), "FORBIDDEN");
      await expectError(createUnitType(context, createUnitTypeSchema.parse({ name: "Nope", category: "OTHER" })), "FORBIDDEN");
      await expectError(update(context, apartment.id, { name: "Flat" }), "FORBIDDEN");
      await expectError(reorderUnitTypes(context, [apartment.id]), "FORBIDDEN");
      await expectError(deleteUnitType(context, apartment.id), "FORBIDDEN");
    }
    expect(await seeded(COMPANY_A, "APARTMENT")).toEqual(apartment);
    expect(await prisma.projectUnitType.count({ where: { companyId: COMPANY_A, name: "Nope" } })).toBe(0);
  });
});

describe("keeping the list", () => {
  it("adds a type with a code from its name, at the end of the list", async () => {
    const created = await create(admin, { name: "Café Kiosk", category: "COMMERCIAL" });
    expect(created).toMatchObject({ name: "Café Kiosk", code: "CAFE_KIOSK", category: "COMMERCIAL", isActive: true, unitCount: 0 });
    expect(created.sortOrder).toBe(Math.max(...(await listUnitTypes(admin)).map((type) => type.sortOrder)));
    const typed = await create(admin, { name: "Sky Villa", code: "sky_villa_1", category: "RESIDENTIAL" });
    expect(typed.code).toBe("SKY_VILLA_1");
    expect(createUnitTypeSchema.safeParse({ name: "Bad code", code: "SKY-VILLA", category: "RESIDENTIAL" }).success).toBe(false);
    expect(createUnitTypeSchema.safeParse({ name: "No category" }).success).toBe(false);

    const [event] = await prisma.auditEvent.findMany({ where: { entityId: created.id, actionKey: "PROJECT_UNIT_TYPE_CREATED" } });
    expect(event.afterJson).toEqual({ name: "Café Kiosk", code: "CAFE_KIOSK", category: "COMMERCIAL", isActive: true });
  });

  it("renames, recodes, recategorises, retires and brings back a type, audited each time", async () => {
    const created = await create(owner, { name: "Sky Villa", category: "RESIDENTIAL" });
    expect((await update(owner, created.id, { name: "Sky Villa Deluxe" })).name).toBe("Sky Villa Deluxe");
    expect((await update(owner, created.id, { code: "sky_villa_dx" })).code).toBe("SKY_VILLA_DX");
    expect((await update(owner, created.id, { category: "OTHER" })).category).toBe("OTHER");
    const retired = await update(owner, created.id, { isActive: false });
    expect(retired.isActive).toBe(false);
    // Retired types stay listed for the units that keep them, marked as retired.
    expect((await getProjectStructure(owner, PROJECT.a)).unitTypes).toContainEqual({ id: created.id, name: "Sky Villa Deluxe", code: "SKY_VILLA_DX", category: "OTHER", isActive: false });
    expect((await update(owner, created.id, { isActive: true })).isActive).toBe(true);
    // Saving what is already there is not a change.
    await update(owner, created.id, { name: "Sky Villa Deluxe", isActive: true });

    const events = await prisma.auditEvent.findMany({ where: { entityId: created.id, actionKey: "PROJECT_UNIT_TYPE_UPDATED" }, orderBy: { occurredAt: "asc" } });
    expect(events.map((event) => event.changesJson)).toEqual([
      { name: { before: "Sky Villa", after: "Sky Villa Deluxe" } },
      { code: { before: "SKY_VILLA", after: "SKY_VILLA_DX" } },
      { category: { before: "RESIDENTIAL", after: "OTHER" } },
      { isActive: { before: true, after: false } },
      { isActive: { before: false, after: true } },
    ]);
  });

  it("keeps names unique in a company whatever their case and codes unique too, and lets another company use both", async () => {
    await expectError(createUnitType(owner, createUnitTypeSchema.parse({ name: "apartment", category: "RESIDENTIAL" })), "CONFLICT", "UNIT_TYPE_NAME_TAKEN");
    await expectError(createUnitType(owner, createUnitTypeSchema.parse({ name: "Flat", code: "apartment", category: "RESIDENTIAL" })), "CONFLICT", "UNIT_TYPE_CODE_TAKEN");
    // A name that folds to a taken code is still a clash, even with no code typed.
    await expectError(createUnitType(owner, createUnitTypeSchema.parse({ name: "Parking!", category: "PARKING" })), "CONFLICT", "UNIT_TYPE_CODE_TAKEN");

    const inA = await create(owner, { name: "Loft Studio", code: "LOFT_STUDIO", category: "RESIDENTIAL" });
    const inB = await create(ownerB, { name: "Loft Studio", code: "LOFT_STUDIO", category: "RESIDENTIAL" });
    expect(inB.id).not.toBe(inA.id);

    await expectError(update(owner, inA.id, { name: "VILLA" }), "CONFLICT", "UNIT_TYPE_NAME_TAKEN");
    await expectError(update(owner, inA.id, { code: "villa" }), "CONFLICT", "UNIT_TYPE_CODE_TAKEN");
    // Changing only the case of its own name is not a clash.
    expect((await update(owner, inA.id, { name: "LOFT STUDIO" })).name).toBe("LOFT STUDIO");
    expect(await seeded(COMPANY_A, "VILLA")).toMatchObject({ name: "Villa" });
  });

  it("orders the list only from the company's whole list, once each", async () => {
    const before = await listUnitTypes(owner);
    originalOrder = (await prisma.projectUnitType.findMany({ where: { companyId: COMPANY_A }, select: { id: true, sortOrder: true, updatedBy: true } })).map((row) => ({ ...row }));

    const reversed = [...before].reverse().map((type) => type.id);
    const after = await reorderUnitTypes(owner, reversed);
    expect(after.map((type) => type.id)).toEqual(reversed);
    expect(after.map((type) => type.sortOrder)).toEqual(reversed.map((_, index) => index + 1));
    // The structure's type choices follow the company's order.
    expect((await getProjectStructure(owner, PROJECT.a)).unitTypes.map((type) => type.id)).toEqual(reversed);
    expect(await prisma.auditEvent.count({ where: { actionKey: "PROJECT_UNIT_TYPES_REORDERED", entityId: COMPANY_A, occurredAt: { gte: startedAt } } })).toBe(1);

    await expectError(reorderUnitTypes(owner, reversed.slice(1)), "VALIDATION_ERROR");
    await expectError(reorderUnitTypes(owner, [...reversed.slice(1), reversed[1]!]), "VALIDATION_ERROR");
    const foreign = await seeded(COMPANY_B, "OFFICE");
    await expectError(reorderUnitTypes(owner, [...reversed.slice(1), foreign.id]), "VALIDATION_ERROR");
    expect((await listUnitTypes(owner)).map((type) => type.id)).toEqual(reversed);
  });

  it("deletes only a type no unit uses", async () => {
    const unused = await create(owner, { name: "Kiosk", category: "COMMERCIAL" });
    await deleteUnitType(owner, unused.id);
    expect(await prisma.projectUnitType.count({ where: { id: unused.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityId: unused.id, actionKey: "PROJECT_UNIT_TYPE_DELETED" } })).toBe(1);
    await expectError(deleteUnitType(owner, unused.id), "NOT_FOUND");

    const apartment = await seeded(COMPANY_A, "APARTMENT");
    await expectError(deleteUnitType(owner, apartment.id), "CONFLICT");
    expect(await prisma.projectUnitType.findUniqueOrThrow({ where: { id: apartment.id } })).toEqual(apartment);
  });
});

describe("company isolation", () => {
  it("answers another company's type as not found, and never lists it", async () => {
    const foreign = await seeded(COMPANY_B, "OFFICE");
    await expectError(update(owner, foreign.id, { name: "Taken over" }), "NOT_FOUND");
    await expectError(update(owner, foreign.id, { isActive: false }), "NOT_FOUND");
    await expectError(deleteUnitType(owner, foreign.id), "NOT_FOUND");
    expect((await listUnitTypes(owner)).map((type) => type.id)).not.toContain(foreign.id);
    expect((await getProjectStructure(owner, PROJECT.a)).unitTypes.map((type) => type.id)).not.toContain(foreign.id);
    expect(await prisma.projectUnitType.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);

    const listB = await listUnitTypes(ownerB);
    expect(listB.map((type) => type.code)).toEqual(expect.arrayContaining(DEFAULT_CODES));
    expect(listB.find((type) => type.code === "OFFICE")?.unitCount).toBeGreaterThanOrEqual(3);
    expect(listB.find((type) => type.code === "APARTMENT")?.unitCount).toBe(0);
  });
});
