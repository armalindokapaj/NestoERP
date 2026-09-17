import { afterAll, describe, expect, it } from "vitest";

import {
  buildClientScopeWhere,
  buildProjectScopeWhere,
  buildTaskScopeWhere,
  canAccessProject,
} from "@/lib/access/scope";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * Data-scope tests (PRD #9 §123, §158–§162).
 *
 * The seeded project membership matrix (PRD #9 §45, E-06 §44) is what makes
 * these meaningful: a Project Manager must meet projects they may see *and*
 * projects they may not (PRD #9 §254). Each demo company has one project, so the
 * projects somebody may not see are their group siblings' and the fixture
 * tenant's: a session is in one company, and reaches another only by moving.
 */
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function projectIdsFor(role: Parameters<typeof loginAs>[0]) {
  return projectIdsIn(await loginAs(role));
}

async function projectIdsIn(context: Awaited<ReturnType<typeof loginAs>>) {
  const rows = await prisma.project.findMany({
    where: buildProjectScopeWhere(context),
    select: { id: true },
  });
  return rows.map((row) => row.id).sort();
}

describe("project scope (PRD #9 §45, E-06 §44)", () => {
  it("gives the Project Manager Project A only", async () => {
    expect(await projectIdsFor("PROJECT_MANAGER")).toEqual([PROJECT.a]);
  });

  it("gives the Architect Project A only", async () => {
    expect(await projectIdsFor("ARCHITECT")).toEqual([PROJECT.a]);
  });

  it("gives the Engineer Project A only", async () => {
    expect(await projectIdsFor("ENGINEER")).toEqual([PROJECT.a]);
  });

  it("gives QA/QC Project A in Aurelia and Project C in Terra, one company at a time", async () => {
    expect(await projectIdsFor("QAQC")).toEqual([PROJECT.a]);
    expect(await projectIdsIn(await loginAsMembership("member_qaqc__c"))).toEqual([PROJECT.c]);
  });

  it("gives HSE Project A in Aurelia and Project B in Meridian, one company at a time", async () => {
    expect(await projectIdsFor("HSE")).toEqual([PROJECT.a]);
    expect(await projectIdsIn(await loginAsMembership("member_hse__b"))).toEqual([PROJECT.b]);
  });

  it("gives the multi-company Architect Project A and Project D only (E-06 §146)", async () => {
    expect(await projectIdsIn(await loginAsMembership("member_multicompany_a"))).toEqual([PROJECT.a]);
    expect(await projectIdsIn(await loginAsMembership("member_multicompany_d"))).toEqual([PROJECT.d]);
  });

  it("gives the Viewer Project A only", async () => {
    expect(await projectIdsFor("VIEWER")).toEqual([PROJECT.a]);
  });

  it("gives the Owner every project of the company they are in, and no sibling's", async () => {
    const owned = await projectIdsFor("OWNER");
    expect(owned).toContain(PROJECT.a);
    expect(owned).not.toContain(PROJECT.b);
    expect(owned).not.toContain(PROJECT.e);
    expect(owned).not.toContain(PROJECT.companyB);

    // An Owner sees finished and archived projects as well.
    const works = await projectIdsIn(await loginAsEmail(DEMO_EMAIL.fixtureOwner));
    expect(works).toContain(PROJECT.f);
    expect(works).toContain(PROJECT.archived);
  });

  it("gives Finance company-level project context (PRD #9 §48)", async () => {
    // Neither is on Riverside's team.
    expect(await projectIdsFor("FINANCE")).toContain(PROJECT.a);
    expect(await projectIdsIn(await loginAsEmail(DEMO_EMAIL.financeA))).toContain(PROJECT.a);
  });
});

describe("record-level project access (PRD #10 §113)", () => {
  it("lets the Project Manager open Project A", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    expect(await canAccessProject(context, PROJECT.a)).toBe(true);
  });

  it("refuses the Project Manager a sibling company's Project C", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    expect(await canAccessProject(context, PROJECT.c)).toBe(false);
  });

  it("refuses the Architect Project D", async () => {
    const context = await loginAs("ARCHITECT");
    expect(await canAccessProject(context, PROJECT.d)).toBe(false);
  });

  it("refuses the multi-company Architect Project D while their session is in Aurelia", async () => {
    const context = await loginAsMembership("member_multicompany_a");
    expect(await canAccessProject(context, PROJECT.d)).toBe(false);
  });

  it("refuses the Owner the fixture tenant's project (PRD #9 §114)", async () => {
    const context = await loginAs("OWNER");
    expect(await canAccessProject(context, PROJECT.companyB)).toBe(false);
  });

  it("refuses the Owner a sibling company's project until the session moves there", async () => {
    const context = await loginAs("OWNER");
    expect(context.companyId).toBe(COMPANY.a);
    expect(await canAccessProject(context, PROJECT.b)).toBe(false);
    expect(await canAccessProject(await loginAsMembership("member_owner__b"), PROJECT.b)).toBe(true);
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

  it("returns only Project A when the Architect searches for Project", async () => {
    const context = await loginAs("ARCHITECT");
    const rows = await prisma.project.findMany({
      where: buildProjectScopeWhere(context),
      select: { id: true },
    });
    expect(rows.map((row) => row.id)).toEqual([PROJECT.a]);
  });

  it("returns nothing when the Owner in Aurelia searches for a sibling company's project", async () => {
    const context = await loginAs("OWNER");
    const rows = await prisma.project.findMany({
      where: {
        AND: [
          buildProjectScopeWhere(context),
          { name: { contains: "Central Office Tower", mode: "insensitive" } },
        ],
      },
    });
    expect(rows).toHaveLength(0);
  });

  it("returns nothing when a Company A user searches for the fixture tenant's project (PRD #9 §237)", async () => {
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

  it("returns nothing when the fixture tenant's Owner searches for a Company A project (PRD #9 §238)", async () => {
    const context = await loginAsEmail(DEMO_EMAIL.tenantOwner);
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
    expect(count).toBeGreaterThanOrEqual(20);
    expect(count).toBe(await prisma.task.count({ where: { companyId: COMPANY.a } }));
  });

  it("never returns another company's task to a Company A user", async () => {
    const context = await loginAs("OWNER");
    for (const companyId of [COMPANY.tenant, COMPANY.b]) {
      const rows = await prisma.task.findMany({
        where: { AND: [buildTaskScopeWhere(context), { companyId }] },
      });
      expect(rows, companyId).toHaveLength(0);
    }
  });
});

describe("client scope (PRD #5 §36)", () => {
  it("reaches a scoped user's clients only through their projects", async () => {
    const context = await loginAs("ARCHITECT");
    const rows = await prisma.client.findMany({
      where: buildClientScopeWhere(context),
      select: { id: true },
    });

    // Architect works on Project A (ACME) only; Aurelia has other clients.
    expect(rows.map((row) => row.id)).toEqual(["client_acme"]);
    expect(await prisma.client.count({ where: { companyId: COMPANY.a } })).toBeGreaterThan(1);
  });

  it("gives Sales the whole company client list", async () => {
    const context = await loginAs("SALES");
    const count = await prisma.client.count({ where: buildClientScopeWhere(context) });
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBe(await prisma.client.count({ where: { companyId: COMPANY.a } }));
  });
});

describe("document scope (PRD #9 §173, PRD #8 §43)", () => {
  it("hides a Finance-context document from the Architect", async () => {
    const context = await loginAs("ARCHITECT");
    const rows = await prisma.document.findMany({
      where: {
        AND: [await buildDocumentAccessWhere(context), { name: "Company Financial Summary.pdf" }],
      },
    });
    expect(rows).toHaveLength(0);
  });

  it("hides an HR-context document from the Project Manager", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const rows = await prisma.document.findMany({
      where: { AND: [await buildDocumentAccessWhere(context), { name: "Employee HR Record.pdf" }] },
    });
    expect(rows).toHaveLength(0);
  });

  it("shows the Finance document to the Finance role", async () => {
    const context = await loginAs("FINANCE");
    const rows = await prisma.document.findMany({
      where: {
        AND: [await buildDocumentAccessWhere(context), { name: "Company Financial Summary.pdf" }],
      },
    });
    expect(rows).toHaveLength(1);
  });

  it("keeps a project document behind that project's access", async () => {
    // On Forma's Marina team, but signed in to Aurelia.
    const context = await loginAsMembership("member_multicompany_a");
    expect(await prisma.document.count({ where: { projectId: PROJECT.d } })).toBeGreaterThan(0);
    const rows = await prisma.document.findMany({
      where: { AND: [await buildDocumentAccessWhere(context), { projectId: PROJECT.d }] },
    });
    expect(rows).toHaveLength(0);
  });

  it("never returns another company's document to a Company A user", async () => {
    const context = await loginAs("OWNER");
    for (const companyId of [COMPANY.tenant, COMPANY.b]) {
      const rows = await prisma.document.findMany({
        where: { AND: [await buildDocumentAccessWhere(context), { companyId }] },
      });
      expect(rows, companyId).toHaveLength(0);
    }
  });
});
