import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QUICK_CREATE_ACTIONS } from "@/config/quick-create";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { canOpenQuickCreate } from "@/lib/modules/quick-create/eligibility";
import { listAvailableActions, projectChoices, resolveLaunch } from "@/lib/modules/quick-create/quick-create.service";
import { listWorkspaces } from "@/lib/workspace/workspace.service";
import { cleanupSessions, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * Quick Create (Global Quick Create & Context-Aware Smart Actions PRD
 * §166-§193): only authorised actions, the Group company choice, safe context
 * prefill, and a launch that re-checks everything.
 */

const MULTI_A = "member_multicompany_a";
const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });
let finance: UserContext;
let viewer: UserContext;
let pm: UserContext;
let inGroup: UserContext;

beforeAll(async () => {
  [finance, viewer, pm] = await Promise.all((["FINANCE", "VIEWER", "PROJECT_MANAGER"] as const).map((role) => loginAs(role)));
  inGroup = await loginAsMembership(MULTI_A, { workspace: "GROUP" });
});
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

const keys = (menu: Awaited<ReturnType<typeof listAvailableActions>>) => menu.actions.map((action) => action.key);

describe("only authorised actions (§7, §33, §138, §145, §166, §170)", () => {
  it("offers exactly the actions whose module is on and whose create permission is held — never by sidebar or role name", async () => {
    for (const context of [finance, viewer, pm]) {
      const expected = QUICK_CREATE_ACTIONS.filter((action) => isModuleEnabled(context, action.moduleKey) && canAccessModule(context, action.moduleKey) && can(context, action.permission)).map((action) => action.key);
      expect(keys(await listAvailableActions(context))).toEqual(expected);
    }
  });

  it("gives Finance an invoice in its own company, and a read-only viewer none (§166, §170)", async () => {
    const menu = await listAvailableActions(finance);
    expect(keys(menu)).toContain("finance.invoice.create");
    expect(menu.workspace.company?.id).toBe(finance.companyId);
    const launch = await resolveLaunch(finance, { actionKey: "finance.invoice.create" });
    expect(launch).toMatchObject({ href: "/finance/invoices/new", switchWorkspace: false, company: { id: finance.companyId } });

    expect(keys(await listAvailableActions(viewer))).not.toContain("finance.invoice.create");
    await expect(resolveLaunch(viewer, { actionKey: "finance.invoice.create" })).rejects.toMatchObject(code("QUICK_CREATE_PERMISSION_CHANGED"));
  });

  it("revalidates at launch: a stale menu opens nothing once the module is off (§95-§98, §176, §177)", async () => {
    const off: UserContext = { ...finance, moduleAccess: { ...finance.moduleAccess, finance: { ...finance.moduleAccess.finance!, enabled: false } } };
    expect(keys(await listAvailableActions(off))).not.toContain("finance.invoice.create");
    await expect(resolveLaunch(off, { actionKey: "finance.invoice.create" })).rejects.toMatchObject(code("QUICK_CREATE_UNAVAILABLE"));
    await expect(resolveLaunch(finance, { actionKey: "no.such.action" })).rejects.toMatchObject(code("QUICK_CREATE_UNAVAILABLE"));
  });

  it("refuses to create in another company from a company workspace (§140, §175)", async () => {
    await expect(resolveLaunch(finance, { actionKey: "finance.invoice.create", companyId: "company_demo_b" })).rejects.toMatchObject(code("QUICK_CREATE_COMPANY_FORBIDDEN"));
  });
});

describe("the Group workspace (§13-§19, §69, §147, §167, §168, §178)", () => {
  it("lists only the companies where the person may create, and asks for one", async () => {
    const menu = await listAvailableActions(inGroup);
    const task = menu.actions.find((action) => action.key === "tasks.task.create");
    expect(task?.companies?.map((company) => company.id).sort()).toEqual(["company_demo_a", "company_demo_d"]);
    await expect(resolveLaunch(inGroup, { actionKey: "tasks.task.create" })).rejects.toMatchObject(code("QUICK_CREATE_COMPANY_REQUIRED"));
    await expect(resolveLaunch(inGroup, { actionKey: "tasks.task.create", companyId: "company_demo_b" })).rejects.toMatchObject(code("QUICK_CREATE_COMPANY_FORBIDDEN"));
  });

  it("launches into a real company — never the group — and enters it first", async () => {
    const launch = await resolveLaunch(inGroup, { actionKey: "tasks.task.create", companyId: "company_demo_d" });
    expect(launch).toMatchObject({ href: "/tasks/new", switchWorkspace: true, company: { id: "company_demo_d" } });
    expect(launch.company.id).not.toBe(inGroup.parentGroupId);
  });

  it("never prefills a Company D form from a Company A page (§72, §76, §174)", async () => {
    const launch = await resolveLaunch(inGroup, { actionKey: "tasks.task.create", companyId: "company_demo_d", pathname: `/projects/${PROJECT.a}` });
    expect(launch.href).toBe("/tasks/new");
  });
});

describe("safe context prefill (§21-§28, §171-§173)", () => {
  it("prefills the project from a project page, and names where it is creating", async () => {
    const menu = await listAvailableActions(pm, { pathname: `/projects/${PROJECT.a}` });
    expect(menu.context).toMatchObject({ recordType: "project", project: { id: PROJECT.a } });
    const launch = await resolveLaunch(pm, { actionKey: "tasks.task.create", pathname: `/projects/${PROJECT.a}` });
    expect(launch.href).toBe(`/tasks/new?projectId=${PROJECT.a}`);
    expect(launch.creatingIn).toContain("Riverside Residences");
  });

  it("links a task to the record it was raised from and inherits its project (§25, §120, §173)", async () => {
    const launch = await resolveLaunch(pm, { actionKey: "tasks.task.create", pathname: "/qaqc/ncrs/ncr_001" });
    const url = new URL(launch.href, "http://nesto.test");
    expect(url.pathname).toBe("/tasks/new");
    expect(Object.fromEntries(url.searchParams)).toEqual({ projectId: PROJECT.a, parentType: "non_conformance_report", parentId: "ncr_001" });
  });

  it("guesses nothing from an ambiguous or unreadable page (§22, §80)", async () => {
    expect((await listAvailableActions(pm, { pathname: "/dashboard" })).context).toBeNull();
    expect((await listAvailableActions(pm, { pathname: `/projects/${PROJECT.companyB}` })).context).toBeNull();
    expect((await resolveLaunch(pm, { actionKey: "tasks.task.create", pathname: `/projects/${PROJECT.companyB}` })).href).toBe("/tasks/new");
  });

  it("asks for a project where the flow lives under one, and refuses a project the person cannot open (§71, §111, §141, §152)", async () => {
    const menu = await listAvailableActions(pm);
    const log = menu.actions.find((action) => action.key === "projects.daily_log.create");
    if (!log) return; // The role cannot write daily logs here; nothing to ask.
    expect(log.needsProject).toBe(true);
    await expect(resolveLaunch(pm, { actionKey: log.key })).rejects.toMatchObject(code("QUICK_CREATE_PROJECT_REQUIRED"));
    await expect(resolveLaunch(pm, { actionKey: log.key, projectId: PROJECT.companyB })).rejects.toMatchObject(code("QUICK_CREATE_PROJECT_INVALID"));
    const choices = await projectChoices(pm, { actionKey: log.key });
    expect(choices.length).toBeGreaterThan(0);
    const launch = await resolveLaunch(pm, { actionKey: log.key, projectId: choices[0].id });
    expect(launch.href).toBe(`/projects/${choices[0].id}/daily-logs/new`);
  });
});

describe("the shell's trigger summary (NAV-01 QC-01, QC-02, Q05, Q06, A08)", () => {
  it("opens exactly when the server would draw a menu, with the menu's own context key", async () => {
    for (const context of [finance, viewer, pm, inGroup]) {
      const [{ quickCreate }, menu] = await Promise.all([listWorkspaces(context), listAvailableActions(context)]);
      expect(quickCreate.canOpen, context.role).toBe(menu.actions.length > 0);
      expect(quickCreate.contextKey, context.role).toBe(menu.contextKey);
    }
    expect((await listWorkspaces(viewer)).quickCreate.canOpen).toBe(false);
  });

  it("is keyed by identity and workspace, and never carries the session id", async () => {
    const keys = await Promise.all([finance, pm, inGroup].map(async (context) => (await listWorkspaces(context)).quickCreate.contextKey));
    expect(new Set(keys).size).toBe(3);
    for (const [index, context] of [finance, pm, inGroup].entries()) {
      expect(keys[index]).not.toContain(context.sessionId);
      expect(keys[index]).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
  });

  it("counts every company of the group, not the home company alone (Q06)", () => {
    // A home company that allows nothing, and another company that allows a task.
    const home: UserContext = { ...viewer, workspace: { ...viewer.workspace, scopeType: "GROUP", companyId: null } };
    expect(canOpenQuickCreate("GROUP", [home])).toBe(false);
    expect(canOpenQuickCreate("GROUP", [home, pm])).toBe(QUICK_CREATE_ACTIONS.some((action) => action.supportsGroupWorkspace && isModuleEnabled(pm, action.moduleKey) && canAccessModule(pm, action.moduleKey) && can(pm, action.permission)));
  });
});
