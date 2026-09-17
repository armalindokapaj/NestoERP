import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import {
  createProjectType,
  deleteProjectType,
  listProjectTypes,
  projectTypeChoices,
  reorderProjectTypes,
  updateProjectType,
} from "@/lib/modules/projects/project-type.service";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, prisma } from "../../helpers";

/**
 * A company's own project types (E-05A §30, §62).
 *
 * The list is company configuration: the Owner and the CEO keep it, nobody
 * else does, and nothing in it ever reaches across a company. A type in use is
 * retired rather than deleted.
 */

const COMPANY_A = COMPANY.a;
const TENANT = COMPANY.tenant;

const tempTypes: string[] = [];
const tempProjects: string[] = [];
let originalOrder: Array<{ id: string; sortOrder: number }> = [];

afterEach(async () => {
  if (tempProjects.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: tempProjects } } });
    tempProjects.length = 0;
  }
  if (tempTypes.length > 0) {
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: tempTypes } } });
    await prisma.projectType.deleteMany({ where: { id: { in: tempTypes } } });
    tempTypes.length = 0;
  }
  for (const row of originalOrder) {
    await prisma.projectType.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } });
  }
  originalOrder = [];
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function expectError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
}

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

describe("who keeps the list", () => {
  it("lets the Owner and the CEO read it, with how many projects use each type", async () => {
    for (const role of ["OWNER", "CEO"] as const) {
      const types = await listProjectTypes(await loginAs(role));
      expect(types.map((type) => type.name)).toEqual(expect.arrayContaining(["Residential", "Commercial", "Hospital", "Other"]));
      expect(types.find((type) => type.name === "Mixed use")?.projectCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("refuses everybody else, the Project Manager included", async () => {
    for (const role of ["PROJECT_MANAGER", "ARCHITECT", "GROUP_IT", "VIEWER"] as const) {
      const context = await loginAs(role);
      await expectError(listProjectTypes(context), "FORBIDDEN");
      await expectError(createProjectType(context, { name: unique("Nope") }), "FORBIDDEN");
    }
  });
});

describe("keeping the list", () => {
  it("adds, renames, retires and brings back a type, audited each time", async () => {
    const ceo = await loginAs("CEO");
    const created = await createProjectType(ceo, { name: unique("Education") });
    tempTypes.push(created.id);
    expect(created).toMatchObject({ isActive: true, projectCount: 0 });
    expect(created.sortOrder).toBe(Math.max(...(await listProjectTypes(ceo)).map((type) => type.sortOrder)));

    const renamed = await updateProjectType(ceo, created.id, { name: `${created.name} & Research` });
    expect(renamed.name).toBe(`${created.name} & Research`);

    const retired = await updateProjectType(ceo, created.id, { isActive: false });
    expect(retired.isActive).toBe(false);
    expect((await projectTypeChoices(ceo)).map((choice) => choice.value)).not.toContain(created.id);
    // The project that already has it keeps seeing it on its form.
    expect(await projectTypeChoices(ceo, created.id)).toContainEqual({ value: created.id, label: `${renamed.name} (retired)` });

    expect((await updateProjectType(ceo, created.id, { isActive: true })).isActive).toBe(true);

    const actions = await prisma.auditEvent.findMany({ where: { entityId: created.id }, select: { actionKey: true } });
    expect(actions.map((row) => row.actionKey).sort()).toEqual(["PROJECT_TYPE_CREATED", "PROJECT_TYPE_UPDATED", "PROJECT_TYPE_UPDATED", "PROJECT_TYPE_UPDATED"]);
  });

  it("keeps names unique in a company whatever their case, and lets another company use the same name", async () => {
    const owner = await loginAs("OWNER");
    await expectError(createProjectType(owner, { name: "residential" }), "CONFLICT");

    const name = unique("Shared");
    const inA = await createProjectType(owner, { name });
    tempTypes.push(inA.id);
    const inB = await createProjectType(await loginAsMembership("member_owner_b"), { name });
    tempTypes.push(inB.id);
    expect(inB.id).not.toBe(inA.id);

    const hotel = (await listProjectTypes(owner)).find((type) => type.name === "Hotel")!;
    await expectError(updateProjectType(owner, hotel.id, { name: "HOSPITAL" }), "CONFLICT");
    // Changing only the case of its own name is not a clash.
    const recased = await updateProjectType(owner, inA.id, { name: name.toUpperCase() });
    expect(recased.name).toBe(name.toUpperCase());
  });

  it("deletes only a type no project uses", async () => {
    const owner = await loginAs("OWNER");
    const unused = await createProjectType(owner, { name: unique("Unused") });
    tempTypes.push(unused.id);
    await deleteProjectType(owner, unused.id);
    expect(await prisma.projectType.count({ where: { id: unused.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityId: unused.id, actionKey: "PROJECT_TYPE_DELETED" } })).toBe(1);

    const used = await createProjectType(owner, { name: unique("Used") });
    tempTypes.push(used.id);
    const project = await prisma.project.create({
      data: { companyId: COMPANY_A, code: `PT-${Date.now().toString(36)}`, name: "Typed project", projectTypeId: used.id, createdBy: "test" },
    });
    tempProjects.push(project.id);
    await expectError(deleteProjectType(owner, used.id), "CONFLICT");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).projectTypeId).toBe(used.id);
  });

  it("orders the list only from the company's whole list, once each", async () => {
    const owner = await loginAs("OWNER");
    const before = await listProjectTypes(owner);
    originalOrder = before.map((type) => ({ id: type.id, sortOrder: type.sortOrder }));

    const reversed = [...before].reverse().map((type) => type.id);
    const after = await reorderProjectTypes(owner, reversed);
    expect(after.map((type) => type.id)).toEqual(reversed);
    expect((await projectTypeChoices(owner)).map((choice) => choice.value)).toEqual(after.filter((type) => type.isActive).map((type) => type.id));

    await expectError(reorderProjectTypes(owner, reversed.slice(1)), "VALIDATION_ERROR");
    await expectError(reorderProjectTypes(owner, [...reversed.slice(1), reversed[1]!]), "VALIDATION_ERROR");
    const foreign = await prisma.projectType.findFirstOrThrow({ where: { companyId: TENANT }, select: { id: true } });
    await expectError(reorderProjectTypes(owner, [...reversed.slice(1), foreign.id]), "VALIDATION_ERROR");
  });
});

describe("company isolation", () => {
  it("answers another company's type as not found, and never offers it", async () => {
    const owner = await loginAs("OWNER");
    // The fixture tenant, and a group sibling the Owner also belongs to: the session's company decides.
    for (const companyId of [TENANT, COMPANY.b]) {
      const foreign = await prisma.projectType.findFirstOrThrow({ where: { companyId, name: "Hotel" }, select: { id: true } });

      await expectError(updateProjectType(owner, foreign.id, { name: "Taken over" }), "NOT_FOUND");
      await expectError(deleteProjectType(owner, foreign.id), "NOT_FOUND");
      expect((await projectTypeChoices(owner)).map((choice) => choice.value)).not.toContain(foreign.id);
      expect((await prisma.projectType.findUniqueOrThrow({ where: { id: foreign.id } })).name).toBe("Hotel");
    }
  });
});
