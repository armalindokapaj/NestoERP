import { afterAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { createProjectSchema, updateProjectSchema } from "@/lib/modules/projects/project.schema";
import * as projects from "@/lib/modules/projects/project.service";
import { cleanupSessions, loginAs, prisma, projectTypeId } from "../../helpers";

/**
 * API contract tests (PRD #6 §122, PRD #10 §158).
 *
 * The point of these is narrow and important: a request body must never be able
 * to change who the caller is, which company they are in, or what they may do.
 */
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("privilege claims in a request body are inert", () => {
  it("ignores role, createdBy and archive fields on create", async () => {
    const context = await loginAs("OWNER");

    const input = createProjectSchema.parse({
      code: `PRJ-CONTRACT-${Date.now().toString().slice(-6)}`,
      name: "Contract Test",
      projectTypeId: await projectTypeId(),
      status: "PENDING",
      // Everything below is what an attacker would try.
      role: "OWNER",
      createdBy: "user_viewer",
      archivedAt: new Date().toISOString(),
    });

    const project = await projects.createProject(context, input);

    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.companyId).toBe(context.companyId);
    expect(row.createdBy).toBe(context.userId);
    expect(row.archivedAt).toBeNull();

    await prisma.activity.deleteMany({ where: { entityId: project.id } });
    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
  });

  it("refuses a companyId the caller may not create in, and creates nothing (E-05A §39)", async () => {
    const context = await loginAs("OWNER");
    const code = `PRJ-CONTRACT-B-${Date.now().toString().slice(-6)}`;

    const input = createProjectSchema.parse({ code, name: "Contract Test in B", companyId: "company_demo_b", projectTypeId: await projectTypeId("company_demo_b") });

    await expect(projects.createProject(context, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.project.count({ where: { code } })).toBe(0);
  });

  it("ignores archive fields on update", async () => {
    const context = await loginAs("OWNER");

    // A scratch project, not a seeded one: an update sends the whole record,
    // so testing against Project A would rewrite the fixture the scope tests
    // depend on (PRD #9 §126).
    const created = await projects.createProject(
      context,
      createProjectSchema.parse({
        code: `PRJ-CONTRACT-U-${Date.now().toString().slice(-6)}`,
        name: "Contract Update Test",
        projectTypeId: await projectTypeId(),
        status: "ACTIVE",
      }),
    );

    try {
      await projects.updateProject(
        context,
        created.id,
        updateProjectSchema.parse({
          code: created.code,
          name: created.name,
          status: "ACTIVE",
          archivedAt: new Date().toISOString(),
          archivedBy: "user_viewer",
          companyId: "company_demo_b",
        }),
      );

      const row = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.archivedAt).toBeNull();
      expect(row.archivedBy).toBeNull();
      expect(row.companyId).toBe(context.companyId);
      expect(row.updatedBy).toBe(context.userId);
    } finally {
      await prisma.activity.deleteMany({ where: { entityId: created.id } });
      await prisma.projectMember.deleteMany({ where: { projectId: created.id } });
      await prisma.project.delete({ where: { id: created.id } });
    }
  });
});

describe("error codes carry the right status (PRD #7 §152)", () => {
  it("maps each failure to its HTTP status", () => {
    expect(new AccessError("UNAUTHENTICATED").status).toBe(401);
    expect(new AccessError("FORBIDDEN").status).toBe(403);
    expect(new AccessError("MODULE_UNAVAILABLE").status).toBe(403);
    expect(new AccessError("NOT_FOUND").status).toBe(404);
    expect(new AccessError("CONFLICT").status).toBe(409);
    expect(new AccessError("VALIDATION_ERROR").status).toBe(422);
    expect(new AccessError("INTERNAL_ERROR").status).toBe(500);
  });

  it("never leaks implementation detail in a message (PRD #7 §149)", () => {
    for (const code of ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"] as const) {
      const message = new AccessError(code).message;

      expect(message).not.toMatch(/prisma|sql|select |where |stack/i);
      // No permission keys — a refusal must not name the grant it wanted
      // (PRD #5 §98). Sentence-ending full stops are fine; `finance.view` is
      // not.
      expect(message).not.toMatch(/[a-z]+\.[a-z_]+/);
    }
  });
});
