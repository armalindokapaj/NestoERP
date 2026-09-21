import { afterAll, describe, expect, it } from "vitest";

import { getGroupDashboard, groupIdentity } from "@/lib/modules/dashboard/dashboard.group";
import { resolveDashboard } from "@/lib/modules/dashboard/dashboard.service";
import { loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * The group's executive dashboard (D-01 §25-§36, §66, §79-§85, §97, §106).
 *
 * Run against the ARMAAR demo tenant the seed builds beside the five-company
 * demo, in the Group workspace. Every figure must be what the database holds, computed company by
 * company as the reader; a reader who works in one company's view gets nothing
 * group-wide; nothing crosses from one group into the other.
 */

const ARMAAR = "armaar_group";
const OWNER = "owner@armaar-demo.test";
const GROUP_FINANCE = "finance@armaar-demo.test";
const COMPANY_FINANCE = "bci.finance@armaar-demo.test";
/** The group's dashboard is the Group workspace's (Workspace Context §18). */
const GROUP = { workspace: "GROUP" } as const;

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the Owner's view of the group (§26-§36)", () => {
  it("names the group and derives every figure from the database (§27, §28, §70)", async () => {
    const owner = await loginAsEmail(OWNER, GROUP);
    const view = await getGroupDashboard(owner);

    expect(view.group).toMatchObject({ name: "ARMAAR GROUP", legalName: "ARMAAR GROUP sh.p.k.", registrationNumber: "M01517007J", city: "Tirana", isDemo: true });
    const companies = await prisma.company.groupBy({ by: ["status"], where: { parentGroupId: ARMAAR }, _count: { _all: true } });
    const total = companies.reduce((sum, row) => sum + row._count._all, 0);
    expect(view.figures.companies?.value).toBe(String(total));
    expect(view.figures.companies?.hint).toBe(`${companies.find((row) => row.status === "ACTIVE")!._count._all} active · ${companies.find((row) => row.status === "SUSPENDED")!._count._all} suspended`);

    const active = await prisma.project.count({ where: { company: { parentGroupId: ARMAAR }, status: "ACTIVE", archivedAt: null } });
    expect(view.figures.activeProjects?.value).toBe(String(active));
    // Everybody employed, with a login or without one — most of a site workforce never signs in (E-04 §4).
    const employed = await prisma.employeeProfile.count({ where: { company: { parentGroupId: ARMAAR, status: "ACTIVE" }, employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } } });
    expect(view.figures.employees?.value).toBe(String(employed));
    // The portfolio's value is its approved budgets, said to be synthetic in a demo tenant (§29).
    expect(view.figures.portfolioValue?.value).toMatch(/^€[\d.]+M$/);
    expect(view.figures.portfolioValue?.hint).toMatch(/synthetic demo figure/);
  });

  it("counts an external company once, however many roles it plays (§45, §99)", async () => {
    const owner = await loginAsEmail(OWNER, GROUP);
    const suppliers = await prisma.supplier.findMany({ where: { company: { parentGroupId: ARMAAR }, status: "ACTIVE" }, select: { taxId: true } });
    const contractors = await prisma.contractorProfile.findMany({ where: { company: { parentGroupId: ARMAAR } }, select: { vatNumber: true } });
    // AlbaBuild supplies BCI and IDEAL, and builds Tirana Lake's frame: three records, one company.
    expect(suppliers.filter((row) => row.taxId === "X90000001A")).toHaveLength(2);
    expect(contractors.filter((row) => row.vatNumber === "X90000001A")).toHaveLength(1);

    const clientCompanies = await prisma.client.findMany({ where: { company: { parentGroupId: ARMAAR }, type: { in: ["COMPANY", "PUBLIC_ENTITY"] }, status: "ACTIVE" }, select: { name: true } });
    const expected = new Set([...suppliers.map((row) => row.taxId), ...contractors.map((row) => row.vatNumber), ...clientCompanies.map((row) => row.name.toLowerCase().replace(/[^a-z0-9]/g, ""))].map((key) => (key ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")));
    expect((await getGroupDashboard(owner)).figures.externalCompanies?.value).toBe(String(expected.size));
  });

  it("shows the key projects with their progress from the plan, flagship first (§17, §19, §31)", async () => {
    const owner = await loginAsEmail(OWNER, GROUP);
    const { keyProjects } = await getGroupDashboard(owner);
    expect(keyProjects.map((project) => project.name)).toEqual(expect.arrayContaining(["Tirana Lake", "United Towers", "Gran Melia", "Square 21"]));
    const lake = keyProjects[0]!;
    expect(lake).toMatchObject({ name: "Tirana Lake", company: "BUILDING CONSTRUCTION INVEST", location: "Tirana, Albania", status: "ACTIVE", progress: 62 });
    expect(lake.tags).toEqual(expect.arrayContaining(["Mixed use", "Residential", "Commercial"]));
    expect(lake.coverUrl).toMatch(/^\/api\/projects\/armaar_prj_tirana_lake\/cover/);
    expect(keyProjects.find((project) => project.name === "Square 21")).toMatchObject({ status: "FINISHED", progress: 100 });
  });

  it("charts the portfolio by status and type, departments by their people, and lists what is next (§32-§36)", async () => {
    const owner = await loginAsEmail(OWNER, GROUP);
    const view = await getGroupDashboard(owner);
    const projects = await prisma.project.findMany({ where: { company: { parentGroupId: ARMAAR }, archivedAt: null }, select: { status: true } });
    expect(view.portfolio.reduce((sum, row) => sum + row.value, 0)).toBe(projects.length);
    expect(view.portfolio.find((row) => row.label === "ACTIVE")?.value).toBe(projects.filter((row) => row.status === "ACTIVE").length);
    expect(view.projectTypes.reduce((sum, row) => sum + row.value, 0)).toBe(projects.length);

    const engineering = await prisma.departmentAssignment.findMany({ where: { groupDepartmentId: `${ARMAAR}:engineering`, positionLevel: "MEMBER", status: "ACTIVE", company: { is: { status: "ACTIVE" } } }, distinct: ["userId"], select: { userId: true } });
    expect(view.departments.find((row) => row.label === "Engineering")?.value).toBe(engineering.length);
    expect(view.milestones.length).toBeGreaterThan(0);
    expect(view.activity.length).toBeGreaterThan(0);
  });
});

describe("who sees the group (§65, §66, §85, §106)", () => {
  it("gives a company-only reader nothing group-wide — not the banner, not the figures, not the endpoint", async () => {
    const reader = await loginAsEmail(COMPANY_FINANCE);
    expect(await groupIdentity(reader)).toBeNull();
    await expect(getGroupDashboard(reader)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const dashboard = await resolveDashboard(reader);
    expect(dashboard.kpis.map((kpi) => kpi.definition.key).filter((key) => key.startsWith("group"))).toEqual([]);
    expect(dashboard.widgets.map((widget) => widget.definition.key)).not.toContain("keyProjects");
  });

  it("gives a group head the group through their own function's reads: Finance's value, not HR's people", async () => {
    const head = await loginAsEmail(GROUP_FINANCE, GROUP);
    const view = await getGroupDashboard(head);
    expect(view.figures.portfolioValue?.value).toMatch(/^€/);
    expect(view.figures.employees).toBeNull();
    const dashboard = await resolveDashboard(head);
    expect(dashboard.kpis.map((kpi) => kpi.definition.key)).not.toContain("groupEmployees");
  });

  it("keeps each group's figures inside it (§75, §106)", async () => {
    const armaar = await getGroupDashboard(await loginAsEmail(OWNER, GROUP));
    const demo = await getGroupDashboard(await loginAs("OWNER", GROUP));
    expect(demo.group).toMatchObject({ name: expect.not.stringContaining("ARMAAR"), isDemo: false });
    expect(demo.figures.companies?.value).toBe("5");

    const demoCompanies = new Set((await prisma.company.findMany({ where: { parentGroupId: { not: ARMAAR } }, select: { name: true } })).map((row) => row.name));
    const armaarCompanies = new Set((await prisma.company.findMany({ where: { parentGroupId: ARMAAR }, select: { name: true } })).map((row) => row.name));
    expect(armaar.companies.every((row) => armaarCompanies.has(row.title))).toBe(true);
    expect(demo.companies.some((row) => armaarCompanies.has(row.title))).toBe(false);
    expect(armaar.keyProjects.every((project) => armaarCompanies.has(project.company))).toBe(true);
    expect(armaar.activity.every((row) => row.context && armaarCompanies.has(row.context) && !demoCompanies.has(row.context))).toBe(true);
  });
});
