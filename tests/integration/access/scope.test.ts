import { afterAll, describe, expect, it } from "vitest";

import {
  buildClientScopeWhere,
  buildDocumentScopeWhere,
  buildProjectScopeWhere,
  buildTaskScopeWhere,
  canAccessProject,
} from "@/lib/access/scope";
import { cleanupSessions, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Data-scope tests (PRD #9 §123, §158–§162).
 *
 * The seeded project membership matrix (PRD #9 §45) is what makes these
 * meaningful: a Project Manager must meet projects they may see *and* projects
 * they may not (PRD #9 §254).
 */
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function projectIdsFor(role: Parameters<typeof loginAs>[0]) {
  const context = await loginAs(role);
  const rows = await prisma.project.findMany({
    where: buildProjectScopeWhere(context),
    select: { id: true },
  });
  return rows.map((row) => row.id).sort();
}

describe("project scope (PRD #9 §45)", () => {
  it("gives the Project Manager Project A and B only", async () => {
    expect(await projectIdsFor("PROJECT_MANAGER")).toEqual([PROJECT.a, PROJECT.b].sort());
  });

  it("gives the Architect Project A and C only", async () => {
    expect(await projectIdsFor("ARCHITECT")).toEqual([PROJECT.a, PROJECT.c].sort());
  });

  it("gives the Engineer Project A and D only", async () => {
    expect(await projectIdsFor("ENGINEER")).toEqual([PROJECT.a, PROJECT.d].sort());
  });

  it("gives QA/QC Projects A, B and D", async () => {
    expect(await projectIdsFor("QAQC")).toEqual([PROJECT.a, PROJECT.b, PROJECT.d].sort());
  });

  it("gives HSE Projects A, B and D", async () => {
    expect(await projectIdsFor("HSE")).toEqual([PROJECT.a, PROJECT.b, PROJECT.d].sort());
  });

  it("gives the Viewer Project A only", async () => {
    expect(await projectIdsFor("VIEWER")).toEqual([PROJECT.a]);
  });

  it("gives the Owner every Company A project", async () => {
    const owned = await projectIdsFor("OWNER");
    expect(owned).toContain(PROJECT.a);
    expect(owned).toContain(PROJECT.c);
    expect(owned).toContain(PROJECT.e);
    expect(owned).toContain(PROJECT.archived);
    expect(owned).not.toContain(PROJECT.companyB);
  });

  it("gives Finance company-level project context (PRD #9 §48)", async () => {
    const visible = await projectIdsFor("FINANCE");
    expect(visible).toContain(PROJECT.c);
    expect(visible).toContain(PROJECT.d);
  });
});

describe("record-level project access (PRD #10 §113)", () => {
  it("lets the Project Manager open Project A", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    expect(await canAccessProject(context, PROJECT.a)).toBe(true);
  });

  it("refuses the Project Manager Project C", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    expect(await canAccessProject(context, PROJECT.c)).toBe(false);
  });

  it("refuses the Architect Project D", async () => {
    const context = await loginAs("ARCHITECT");
    expect(await canAccessProject(context, PROJECT.d)).toBe(false);
  });

  it("refuses the Owner a Company B project (PRD #9 §114)", async () => {
    const context = await loginAs("OWNER");
    expect(await canAccessProject(context, PROJECT.companyB)).toBe(false);
  });
});

describe("search must not leak (PRD #9 §169, PRD #10 §212)", () => {
  it("returns nothing when the Project Manager searches for Marina", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const rows = await prisma.project.findMany({
      where: {
        AND: [
          buildProjectScopeWhere(context),
          { name: { contains: "Marina", mode: "insensitive" } },
        ],
      },
    });
    expect(rows).toHaveLength(0);
  });

  it("returns only Project A and C when the Architect searches for Project", async () => {
    const context = await loginAs("ARCHITECT");
    const rows = await prisma.project.findMany({
      where: buildProjectScopeWhere(context),
      select: { id: true },
    });
    expect(rows.map((row) => row.id).sort()).toEqual([PROJECT.a, PROJECT.c].sort());
  });

  it("returns nothing when a Company A user searches for a Company B project (PRD #9 §237)", async () => {
    const context = await loginAs("OWNER");
    const rows = await prisma.project.findMany({
      where: {
        AND: [
          buildProjectScopeWhere(context),
          { name: { contains: "Munich Workspace Fitout", mode: "insensitive" } },
        ],
      },
    });
    expect(rows).toHaveLength(0);
  });

  it("returns nothing when a Company B user searches for a Company A project (PRD #9 §238)", async () => {
    const context = await loginAsEmail("owner-b@nesto.test");
    const rows = await prisma.project.findMany({
      where: {
        AND: [
          buildProjectScopeWhere(context),
          { name: { contains: "Riverside Residences", mode: "insensitive" } },
        ],
      },
    });
    expect(rows).toHaveLength(0);
  });
});

describe("task scope", () => {
  it("keeps the Architect out of Project D tasks", async () => {
    const context = await loginAs("ARCHITECT");
    const rows = await prisma.task.findMany({
      where: { AND: [buildTaskScopeWhere(context), { projectId: PROJECT.d }] },
    });
    expect(rows).toHaveLength(0);
  });

  it("gives the Architect their own personal task (PRD #9 §57)", async () => {
    const context = await loginAs("ARCHITECT");
    const rows = await prisma.task.findMany({
      where: { AND: [buildTaskScopeWhere(context), { projectId: null }] },
      select: { title: true },
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("gives the Owner company-wide tasks", async () => {
    const context = await loginAs("OWNER");
    const count = await prisma.task.count({ where: buildTaskScopeWhere(context) });
    expect(count).toBeGreaterThanOrEqual(36);
  });

  it("never returns a Company B task to a Company A user", async () => {
    const context = await loginAs("OWNER");
    const rows = await prisma.task.findMany({
      where: { AND: [buildTaskScopeWhere(context), { companyId: "company_demo_b" }] },
    });
    expect(rows).toHaveLength(0);
  });
});

describe("client scope (PRD #5 §36)", () => {
  it("reaches a scoped user's clients only through their projects", async () => {
    const context = await loginAs("ARCHITECT");
    const rows = await prisma.client.findMany({
      where: buildClientScopeWhere(context),
      select: { id: true },
    });

    // Architect works on Project A (ACME) and Project C (Meridian).
    expect(rows.map((row) => row.id).sort()).toEqual(["client_acme", "client_meridian"].sort());
  });

  it("gives Sales the whole company client list", async () => {
    const context = await loginAs("SALES");
    const count = await prisma.client.count({ where: buildClientScopeWhere(context) });
    expect(count).toBeGreaterThanOrEqual(12);
  });
});

describe("document scope (PRD #9 §173, PRD #8 §43)", () => {
  it("hides a Finance-context document from the Architect", async () => {
    const context = await loginAs("ARCHITECT");
    const rows = await prisma.document.findMany({
      where: {
        AND: [buildDocumentScopeWhere(context), { name: "Company Financial Summary.pdf" }],
      },
    });
    expect(rows).toHaveLength(0);
  });

  it("hides an HR-context document from the Project Manager", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const rows = await prisma.document.findMany({
      where: { AND: [buildDocumentScopeWhere(context), { name: "Employee HR Record.pdf" }] },
    });
    expect(rows).toHaveLength(0);
  });

  it("shows the Finance document to the Finance role", async () => {
    const context = await loginAs("FINANCE");
    const rows = await prisma.document.findMany({
      where: {
        AND: [buildDocumentScopeWhere(context), { name: "Company Financial Summary.pdf" }],
      },
    });
    expect(rows).toHaveLength(1);
  });

  it("keeps a project document behind that project's access", async () => {
    const context = await loginAs("VIEWER");
    const rows = await prisma.document.findMany({
      where: { AND: [buildDocumentScopeWhere(context), { projectId: PROJECT.c }] },
    });
    expect(rows).toHaveLength(0);
  });

  it("never returns a Company B document to a Company A user", async () => {
    const context = await loginAs("OWNER");
    const rows = await prisma.document.findMany({
      where: { AND: [buildDocumentScopeWhere(context), { companyId: "company_demo_b" }] },
    });
    expect(rows).toHaveLength(0);
  });
});
