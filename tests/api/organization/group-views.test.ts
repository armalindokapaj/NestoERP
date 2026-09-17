import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { groupCompanies, groupFinance, groupPipeline } from "@/lib/modules/dashboard/dashboard.group";
import { getAccessPortfolio } from "@/lib/modules/organization/access-portfolio.service";
import { getDepartmentWorkspace, listGroupDepartments } from "@/lib/modules/organization/department.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * The group seen from one person (E-06 §16, §95, §108-§111, §143, §145, §146).
 *
 * The access portfolio names the companies, positions and projects a person
 * works with across the group, one account behind all of them. Department
 * workspaces show a head every branch and a local manager their own. Group
 * dashboard rows are computed one company at a time, so a company member sees
 * their company and a group head sees all five.
 */

let owner: UserContext;
let groupFinanceHead: UserContext;
let financeA: UserContext;
let meridianManager: UserContext;
let multiArchitect: UserContext;
let architectureHead: UserContext;

const DEMO_NAMES = ["Aurelia Construction", "Forma Engineering", "Meridian Developments", "Nova Hospitality Development", "Terra Infrastructure"];

beforeAll(async () => {
  owner = await loginAs("OWNER");
  groupFinanceHead = await loginAs("FINANCE");
  financeA = await loginAsEmail(DEMO_EMAIL.financeA);
  meridianManager = await loginAsEmail(DEMO_EMAIL.architectureManagerB);
  multiArchitect = await loginAsEmail(DEMO_EMAIL.multiCompany);
  architectureHead = await loginAsEmail(DEMO_EMAIL.architectureHead);
});

afterAll(async () => {
  await cleanupSessions();
});

describe("the access portfolio (§16, §95)", () => {
  it("gives the Head of Group Finance every company, the head position and Terra's manager position, on one account (§143, §145)", async () => {
    const portfolio = await getAccessPortfolio(groupFinanceHead);
    expect(portfolio.companies.map((company) => company.name).sort()).toEqual(DEMO_NAMES);
    expect(portfolio.companies.filter((company) => company.isCurrent)).toHaveLength(1);
    expect(portfolio.groupDepartments).toEqual([expect.objectContaining({ key: "finance", position: expect.objectContaining({ key: "GROUP_HEAD" }) })]);
    expect(portfolio.companyDepartments).toEqual([expect.objectContaining({ company: { id: COMPANY.c, name: "Terra Infrastructure" }, position: expect.objectContaining({ key: "COMPANY_MANAGER" }) })]);
    expect(await prisma.personProfile.count({ where: { user: { id: groupFinanceHead.userId } } })).toBe(1);
    expect(JSON.stringify(portfolio)).not.toContain("finance.invoice");
  });

  it("gives the architect in two companies those two companies and their two projects only (§146)", async () => {
    const portfolio = await getAccessPortfolio(multiArchitect);
    expect(portfolio.companies.map((company) => company.id).sort()).toEqual([COMPANY.a, COMPANY.d]);
    expect(portfolio.projects.map((project) => project.id).sort()).toEqual([PROJECT.a, PROJECT.d]);
    expect(portfolio.groupDepartments).toEqual([]);
  });

  it("keeps a local manager to their own company", async () => {
    const portfolio = await getAccessPortfolio(meridianManager);
    expect(portfolio.companies.map((company) => company.id)).toEqual([COMPANY.b]);
    expect(portfolio.companyDepartments.map((row) => row.company.id)).toEqual([COMPANY.b]);
  });
});

describe("departments (§11-§13, §65-§68)", () => {
  it("shows the Owner every group department with a branch in each of the five companies", async () => {
    const departments = await listGroupDepartments(owner);
    const finance = departments.find((department) => department.key === "finance")!;
    expect(finance.heads.map((head) => head.name)).toEqual(["Fiona Blake"]);
    expect(finance.branches.map((branch) => branch.company.name).sort()).toEqual(DEMO_NAMES);
    expect(finance.branches.find((branch) => branch.company.id === COMPANY.c)?.managers.map((manager) => manager.name)).toEqual(["Fiona Blake"]);
  });

  it("gives the head of a function its people in every company, with the projects they may be assigned to", async () => {
    const architecture = (await listGroupDepartments(architectureHead)).find((department) => department.key === "architecture")!;
    const workspace = await getDepartmentWorkspace(architectureHead, architecture.id);
    expect(workspace.reach).toBe("GROUP");
    const architectD = workspace.members!.find((member) => member.memberId === "member_architect_d")!;
    expect(architectD.projects.map((project) => project.projectId)).toContain(PROJECT.d);
    expect(architectD.canUnassign).toBe(true);
    expect(new Set(workspace.members!.map((member) => member.company.id)).size).toBeGreaterThan(1);
  });

  it("keeps a local manager to their own branch", async () => {
    const architecture = (await listGroupDepartments(meridianManager)).find((department) => department.key === "architecture")!;
    const workspace = await getDepartmentWorkspace(meridianManager, architecture.id);
    expect(workspace.reach).toBe("MANAGED");
    expect(workspace.branches.map((branch) => branch.company.id)).toEqual([COMPANY.b]);
    expect(workspace.members!.every((member) => member.company.id === COMPANY.b)).toBe(true);
  });

  it("shows Group IT the people behind each branch, and a head of another function none of them (§113)", async () => {
    const groupIt = await loginAs("GROUP_IT");
    const finance = (await listGroupDepartments(groupIt)).find((department) => department.key === "finance")!;
    const forIt = await getDepartmentWorkspace(groupIt, finance.id);
    expect(forIt.branches).toHaveLength(5);
    expect(forIt.members!.every((member) => member.assignable.length === 0 && !member.canUnassign)).toBe(true);

    const forHse = await getDepartmentWorkspace(await loginAs("HSE"), finance.id);
    expect(forHse.members).toBeNull();
  });
});

describe("group dashboards (§108, §109, §111)", () => {
  it("shows the Owner five companies with one active project each", async () => {
    const rows = await groupCompanies(owner);
    expect(rows.map((row) => row.title).sort()).toEqual(DEMO_NAMES);
    expect(rows.every((row) => row.subtitle?.startsWith("1 active project"))).toBe(true);
  });

  it("shows the Head of Group Finance all five companies' invoices, and an Aurelia accountant Aurelia's only (§109)", async () => {
    const head = await groupFinance(groupFinanceHead);
    expect(head.map((row) => row.title).sort()).toEqual(DEMO_NAMES);
    const meridian = head.find((row) => row.id === COMPANY.b)!;
    expect(meridian.subtitle).toMatch(/^1 awaiting approval/);

    const local = await groupFinance(financeA);
    expect(local.map((row) => row.id)).toEqual([COMPANY.a]);
  });

  it("shows the Head of Group Sales the pipeline company by company, never summed across currencies (§111)", async () => {
    const rows = await groupPipeline(await loginAsEmail(DEMO_EMAIL.salesHead));
    expect(rows.map((row) => row.title).sort()).toEqual(DEMO_NAMES);
    const terra = rows.find((row) => row.id === COMPANY.c)!;
    expect(terra.meta).toMatch(/\$.*·.*€|€.*·.*\$/);
  });
});
