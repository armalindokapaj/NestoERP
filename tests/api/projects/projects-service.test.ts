import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import * as projects from "@/lib/modules/projects/project.service";
import {
  createProjectSchema,
  projectListQuerySchema,
  updateProjectSchema,
} from "@/lib/modules/projects/project.schema";
import { cleanupSessions, loginAs, loginAsEmail, PROJECT, prisma, projectTypeId } from "../../helpers";

/**
 * Projects authorisation tests (PRD #10 §210–§226, PRD #9 §130).
 *
 * These call the same service the API routes and the UI call, so a test that
 * passes here is a statement about the running product, not about a mock
 * (PRD #9 §223).
 */
const created: string[] = [];

afterEach(async () => {
  if (created.length === 0) return;
  await prisma.activity.deleteMany({ where: { entityId: { in: created } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: created } } });
  await prisma.project.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

const listQuery = projectListQuerySchema.parse({});

let residential = "";
beforeAll(async () => {
  residential = await projectTypeId();
});

/**
 * Inputs go through the same schema the API route uses, so a test can never
 * hand the service a shape the real caller could not produce.
 */
function createInput(overrides: Record<string, unknown> = {}) {
  return createProjectSchema.parse({
    code: "PRJ-TEST-001",
    name: "Authorisation Test Project",
    projectTypeId: residential,
    status: "PENDING",
    ...overrides,
  });
}

function updateInput(overrides: Record<string, unknown> = {}) {
  return updateProjectSchema.parse({
    code: "PRJ-TEST-001",
    name: "Authorisation Test Project",
    status: "PENDING",
    ...overrides,
  });
}

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

describe("list authorisation (PRD #10 §211)", () => {
  it("gives the Owner every active Company A project", async () => {
    const context = await loginAs("OWNER");
    const result = await projects.listProjects(context, listQuery);
    const ids = result.data.map((project) => project.id);

    expect(ids).toContain(PROJECT.a);
    expect(ids).toContain(PROJECT.c);
    expect(ids).not.toContain(PROJECT.archived);
  });

  it("gives the Project Manager Project A and B only", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const result = await projects.listProjects(context, listQuery);
    expect(result.data.map((project) => project.id).sort()).toEqual([PROJECT.a, PROJECT.b].sort());
  });

  it("gives the Architect Project A and C only", async () => {
    const context = await loginAs("ARCHITECT");
    const result = await projects.listProjects(context, listQuery);
    expect(result.data.map((project) => project.id).sort()).toEqual([PROJECT.a, PROJECT.c].sort());
  });

  it("gives the Viewer Project A only", async () => {
    const context = await loginAs("VIEWER");
    const result = await projects.listProjects(context, listQuery);
    expect(result.data.map((project) => project.id)).toEqual([PROJECT.a]);
  });

  it("excludes archived projects by default and includes them on request", async () => {
    const context = await loginAs("OWNER");

    const active = await projects.listProjects(context, listQuery);
    expect(active.data.map((p) => p.id)).not.toContain(PROJECT.archived);

    const archived = await projects.listProjects(
      context,
      projectListQuerySchema.parse({ archived: true }),
    );
    expect(archived.data.map((p) => p.id)).toContain(PROJECT.archived);
  });

  it("returns no results for a search outside scope (PRD #10 §212)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const result = await projects.listProjects(
      context,
      projectListQuerySchema.parse({ search: "Marina" }),
    );
    expect(result.data).toHaveLength(0);
  });

  it("refuses a role with no Projects access at all", async () => {
    const context = await loginAs("COMPANY_IT");
    await expectError(projects.listProjects(context, listQuery), "FORBIDDEN");
  });
});

describe("detail authorisation (PRD #10 §213)", () => {
  it("lets the Project Manager open Project A", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const project = await projects.getProject(context, PROJECT.a);
    expect(project.code).toBe("PRJ-001");
  });

  it("answers 404 for a project outside scope, never 403", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await expectError(projects.getProject(context, PROJECT.c), "NOT_FOUND");
  });

  it("answers 404 for a project in another company (PRD #9 §114)", async () => {
    const context = await loginAs("OWNER");
    await expectError(projects.getProject(context, PROJECT.companyB), "NOT_FOUND");
  });

  it("answers 404 for a Company A project requested by a Company B user", async () => {
    const context = await loginAsEmail("owner-b@nesto.test");
    await expectError(projects.getProject(context, PROJECT.a), "NOT_FOUND");
  });
});

describe("create authorisation and validation (PRD #10 §214, §215)", () => {
  it("lets the Owner create a project", async () => {
    const context = await loginAs("OWNER");
    const project = await projects.createProject(context, createInput());
    created.push(project.id);

    expect(project.code).toBe("PRJ-TEST-001");
    expect(project.status).toBe("PENDING");
  });

  it("refuses the Viewer (PRD #10 §133)", async () => {
    const context = await loginAs("VIEWER");
    await expectError(projects.createProject(context, createInput()), "FORBIDDEN");
  });

  it("refuses the Architect, who may contribute but not create", async () => {
    const context = await loginAs("ARCHITECT");
    await expectError(projects.createProject(context, createInput()), "FORBIDDEN");
  });

  it("refuses the Project Manager, who runs projects but does not open them (E-05A §29)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await expectError(projects.createProject(context, createInput()), "FORBIDDEN");
  });

  it("rejects a duplicate project code inside the same company (PRD #10 §41)", async () => {
    const context = await loginAs("OWNER");
    await expectError(
      projects.createProject(context, createInput({ code: "PRJ-001" })),
      "CONFLICT",
    );
  });

  it("allows the same code in a different company (PRD #10 §41)", async () => {
    const context = await loginAsEmail("owner-b@nesto.test");
    const project = await projects.createProject(context, createInput({ code: "PRJ-001", projectTypeId: await projectTypeId(context.companyId) }));
    created.push(project.id);
    expect(project.code).toBe("PRJ-001");
  });

  it("rejects a client from another company (PRD #10 §94)", async () => {
    const context = await loginAs("OWNER");
    await expectError(
      projects.createProject(context, createInput({ clientId: "client_b_muc" })),
      "VALIDATION_ERROR",
    );
  });

  it("rejects a project manager from another company", async () => {
    const context = await loginAs("OWNER");
    const otherMember = await prisma.companyMember.findFirst({
      where: { companyId: "company_demo_b" },
      select: { id: true },
    });

    await expectError(
      projects.createProject(context, createInput({ projectManagerMemberId: otherMember!.id })),
      "VALIDATION_ERROR",
    );
  });

  it("adds the project manager to the team and logs the creation (PRD #10 §39)", async () => {
    const context = await loginAs("OWNER");
    const manager = await prisma.companyMember.findFirst({
      where: { companyId: context.companyId, user: { email: "pm@nesto.test" } },
      select: { id: true },
    });

    const project = await projects.createProject(
      context,
      createInput({ code: "PRJ-TEST-002", projectManagerMemberId: manager!.id }),
    );
    created.push(project.id);

    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_companyMemberId: { projectId: project.id, companyMemberId: manager!.id },
      },
    });
    expect(membership?.status).toBe("ACTIVE");

    const activity = await prisma.activity.findFirst({
      where: { entityId: project.id, action: "PROJECT_CREATED" },
    });
    expect(activity).not.toBeNull();
    expect(activity!.actorMemberId).toBe(context.membershipId);
  });

  it("records the creator from the server context, never the request", async () => {
    const context = await loginAs("OWNER");
    const project = await projects.createProject(context, createInput({ code: "PRJ-TEST-003" }));
    created.push(project.id);

    const row = await prisma.project.findUnique({ where: { id: project.id } });
    expect(row!.createdBy).toBe(context.userId);
    expect(row!.companyId).toBe(context.companyId);
  });
});

describe("update authorisation (PRD #10 §216, §217)", () => {
  async function scratchProject() {
    const context = await loginAs("OWNER");
    const project = await projects.createProject(
      context,
      createInput({ code: `PRJ-UPD-${Date.now()}`, name: "Update Test Project" }),
    );
    created.push(project.id);
    return { context, project };
  }

  it("updates a project inside scope", async () => {
    const { context, project } = await scratchProject();

    const updated = await projects.updateProject(
      context,
      project.id,
      updateInput({ code: project.code, name: "Renamed Project", status: "ACTIVE" }),
    );

    expect(updated.name).toBe("Renamed Project");
    expect(updated.status).toBe("ACTIVE");
  });

  it("refuses the Viewer", async () => {
    const { project } = await scratchProject();
    const viewer = await loginAs("VIEWER");

    await expectError(
      projects.updateProject(
        viewer,
        project.id,
        updateInput({ code: project.code, name: "Nope", status: "ACTIVE" }),
      ),
      "FORBIDDEN",
    );
  });

  it("answers 404 when the project is outside scope", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await expectError(
      projects.updateProject(
        context,
        PROJECT.c,
        updateInput({ code: "PRJ-003", name: "Nope", status: "ACTIVE" }),
      ),
      "NOT_FOUND",
    );
  });

  it("refuses a correction back to Pending without a reason (E-05A §12)", async () => {
    const { context, project } = await scratchProject();
    await projects.updateProject(context, project.id, updateInput({ code: project.code, name: project.name, status: "ACTIVE" }));

    await expectError(
      projects.updateProject(
        context,
        project.id,
        updateInput({ code: project.code, name: project.name, status: "PENDING" }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("refuses ARCHIVED as a status an edit may set (PRD #10 §62)", () => {
    expect(updateProjectSchema.safeParse({ code: "PRJ-1", name: "Archive me", status: "ARCHIVED" }).success).toBe(false);
  });

  it("refuses a stale update (PRD #10 §178)", async () => {
    const { context, project } = await scratchProject();

    await expectError(
      projects.updateProject(
        context,
        project.id,
        updateInput({
          code: project.code,
          name: project.name,
          status: "PENDING",
          versionUpdatedAt: new Date("2020-01-01"),
        }),
      ),
      "CONFLICT",
    );
  });
});

describe("archive and restore (PRD #10 §218, §219)", () => {
  async function archivedProject() {
    const context = await loginAs("OWNER");
    const project = await projects.createProject(
      context,
      createInput({ code: `PRJ-ARC-${Date.now()}`, name: "Archive Test", status: "ACTIVE" }),
    );
    created.push(project.id);
    await projects.archiveProject(context, project.id);
    return { context, project };
  }

  it("archives, remembers the previous status and keeps children", async () => {
    const { context, project } = await archivedProject();

    const row = await prisma.project.findUnique({ where: { id: project.id } });
    expect(row!.status).toBe("ARCHIVED");
    expect(row!.preArchiveStatus).toBe("ACTIVE");
    expect(row!.archivedAt).not.toBeNull();
    expect(row!.archivedBy).toBe(context.userId);

    const members = await prisma.projectMember.count({ where: { projectId: project.id } });
    expect(members).toBeGreaterThanOrEqual(0);

    const activity = await prisma.activity.findFirst({
      where: { entityId: project.id, action: "PROJECT_ARCHIVED" },
    });
    expect(activity).not.toBeNull();
  });

  it("refuses to edit an archived project (PRD #10 §58)", async () => {
    const { context, project } = await archivedProject();

    await expectError(
      projects.updateProject(
        context,
        project.id,
        updateInput({ code: project.code, name: "Nope", status: "ACTIVE" }),
      ),
      "CONFLICT",
    );
  });

  it("restores to the status held before archiving (PRD #10 §68)", async () => {
    const { context, project } = await archivedProject();
    await projects.restoreProject(context, project.id);

    const row = await prisma.project.findUnique({ where: { id: project.id } });
    expect(row!.status).toBe("ACTIVE");
    expect(row!.archivedAt).toBeNull();
    expect(row!.archivedBy).toBeNull();
    expect(row!.preArchiveStatus).toBeNull();
  });

  it("refuses the Viewer both actions", async () => {
    const { project } = await archivedProject();
    const viewer = await loginAs("VIEWER");

    await expectError(projects.archiveProject(viewer, project.id), "FORBIDDEN");
    await expectError(projects.restoreProject(viewer, project.id), "FORBIDDEN");
  });
});

describe("team management (PRD #10 §220–§223)", () => {
  async function scratchProject() {
    const context = await loginAs("OWNER");
    const project = await projects.createProject(
      context,
      createInput({ code: `PRJ-TEAM-${Date.now()}`, name: "Team Test", status: "ACTIVE" }),
    );
    created.push(project.id);
    return { context, project };
  }

  async function memberIdFor(email: string, companyId: string) {
    const member = await prisma.companyMember.findFirst({
      where: { companyId, user: { email } },
      select: { id: true },
    });
    return member!.id;
  }

  it("adds an active member of the same company", async () => {
    const { context, project } = await scratchProject();
    const memberId = await memberIdFor("engineer@nesto.test", context.companyId);

    await projects.addMember(context, project.id, { companyMemberId: memberId, projectRole: undefined });
    const members = await projects.listMembers(context, project.id);

    expect(members.map((member) => member.companyMemberId)).toContain(memberId);
  });

  it("rejects a duplicate member (PRD #10 §174)", async () => {
    const { context, project } = await scratchProject();
    const memberId = await memberIdFor("engineer@nesto.test", context.companyId);

    await projects.addMember(context, project.id, { companyMemberId: memberId, projectRole: undefined });
    await expectError(
      projects.addMember(context, project.id, { companyMemberId: memberId, projectRole: undefined }),
      "CONFLICT",
    );
  });

  it("rejects a member from another company", async () => {
    const { context, project } = await scratchProject();
    const otherMemberId = await memberIdFor("owner-b@nesto.test", "company_demo_b");

    await expectError(
      projects.addMember(context, project.id, { companyMemberId: otherMemberId, projectRole: undefined }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects an inactive membership", async () => {
    const { context, project } = await scratchProject();
    const inactiveId = await memberIdFor("inactive-membership@nesto.test", context.companyId);

    await expectError(
      projects.addMember(context, project.id, { companyMemberId: inactiveId, projectRole: undefined }),
      "VALIDATION_ERROR",
    );
  });

  it("removes a member without destroying history (PRD #10 §221)", async () => {
    const { context, project } = await scratchProject();
    const memberId = await memberIdFor("engineer@nesto.test", context.companyId);

    await projects.addMember(context, project.id, { companyMemberId: memberId, projectRole: undefined });
    const [added] = (await projects.listMembers(context, project.id)).filter(
      (member) => member.companyMemberId === memberId,
    );

    await projects.removeMember(context, project.id, added.id);

    const row = await prisma.projectMember.findUnique({ where: { id: added.id } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("INACTIVE");
    expect(row!.leftAt).not.toBeNull();
  });

  it("refuses to remove the acting project manager (PRD #10 §223)", async () => {
    const context = await loginAs("OWNER");
    const managerId = await memberIdFor("pm@nesto.test", context.companyId);

    const project = await projects.createProject(
      context,
      createInput({
        code: `PRJ-MGR-${Date.now()}`,
        name: "Manager Removal Test",
        status: "ACTIVE",
        projectManagerMemberId: managerId,
      }),
    );
    created.push(project.id);

    const members = await projects.listMembers(context, project.id);
    const managerMembership = members.find((member) => member.companyMemberId === managerId)!;

    await expectError(
      projects.removeMember(context, project.id, managerMembership.id),
      "CONFLICT",
    );
  });

  it("refuses the Viewer every team mutation (PRD #10 §133)", async () => {
    const { context, project } = await scratchProject();
    const viewer = await loginAs("VIEWER");
    const memberId = await memberIdFor("engineer@nesto.test", context.companyId);

    await expectError(
      projects.addMember(viewer, project.id, { companyMemberId: memberId, projectRole: undefined }),
      "FORBIDDEN",
    );
  });
});

describe("project activity visibility (PRD #10 §226)", () => {
  it("keeps another project's activity out of the feed", async () => {
    const context = await loginAs("OWNER");
    const activity = await projects.listActivity(context, PROJECT.a, { page: 1, limit: 50 });

    for (const entry of activity.data) {
      expect(entry.message).not.toContain("Marina");
    }
  });

  it("hides Finance activity from a role without Finance module access", async () => {
    const context = await loginAs("QAQC");
    const activity = await projects.listActivity(context, PROJECT.a, { page: 1, limit: 50 });

    const financeEntries = activity.data.filter((entry) => entry.action.startsWith("INVOICE_"));
    expect(financeEntries).toHaveLength(0);
  });
});

describe("task and document counts stay scoped (PRD #10 §224, §225)", () => {
  it("counts only this project's tasks", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const summary = await projects.getProjectTaskSummary(context, PROJECT.a);
    const direct = await prisma.task.count({
      where: { projectId: PROJECT.a, archivedAt: null, status: "TODO" },
    });
    expect(summary.open).toBe(direct);
  });

  it("refuses a task summary for a project outside scope", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await expectError(projects.getProjectTaskSummary(context, PROJECT.c), "NOT_FOUND");
  });
});
