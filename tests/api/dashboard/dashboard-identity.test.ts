import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dashboardForRole, dashboards, groupDashboardFor } from "@/config/dashboards";
import { kpis as kpiRegistry } from "@/config/kpis";
import { moduleList } from "@/config/modules";
import type { PositionLevel, RoleKey } from "@/config/roles";
import { getUserContext } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { planDashboard, type DashboardPlan } from "@/lib/modules/dashboard/dashboard.service";
import { cleanupSessions, COMPANY, loginAsMembership, prisma } from "../../helpers";

/**
 * Whose dashboard each identity gets (AUD-06 §6, RP-19).
 *
 * Resolved the way the dashboard page resolves it: the page's own
 * `getUserContext()` → `resolveUserContext()` → the session the browser's
 * Auth.js cookie names → the real resolver, with a stale `nesto.dev-role=QAQC`
 * cookie in the browser — the role override C-01 removed, and the cookie that
 * once put a QA/QC dashboard in front of the Group Owner. Only the two cookie
 * reads are simulated; the session rows, memberships, roles and modules are
 * the database's.
 *
 * The oracle is written down here, from the seed's facts — which role and
 * position each person holds — and mapped through `config/dashboards.ts`, the
 * one declaration of which layout a role gets. It is never the context the
 * service was handed: a test that asked the context for its role and then
 * checked the service used it would pass with the wrong role.
 */

const browser = vi.hoisted(() => ({
  user: null as null | { id: string; username: string; sessionId: string },
  cookies: new Map<string, string>(),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => (browser.user ? { user: browser.user } : null) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (browser.cookies.has(name) ? { name, value: browser.cookies.get(name) } : undefined),
    has: (name: string) => browser.cookies.has(name),
    getAll: () => [...browser.cookies].map(([name, value]) => ({ name, value })),
  }),
  headers: async () => new Headers(),
}));

const STALE_ROLE_COOKIE = "nesto.dev-role";
const restore: Array<() => Promise<unknown>> = [];

beforeEach(() => {
  browser.user = null;
  browser.cookies.clear();
  // Always present: whatever it once did, it must now do nothing.
  browser.cookies.set(STALE_ROLE_COOKIE, "QAQC");
});

afterEach(async () => {
  for (const undo of restore.splice(0).reverse()) await undo();
  await cleanupSessions();
});

afterAll(() => prisma.$disconnect());

type Workspace = "COMPANY" | "GROUP";

/**
 * Signs the browser in to one membership, in one workspace, and resolves the
 * context as the dashboard page does. `expect` is the workspace the resolver
 * must grant: a company-only employee asking for the group stays in the company.
 */
async function pageAs(membershipId: string, workspace: Workspace): Promise<UserContext> {
  const session = await loginAsMembership(membershipId, { workspace });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { id: true, username: true } });
  browser.user = { id: user.id, username: user.username, sessionId: session.sessionId };
  const context = await getUserContext();
  if (!context) throw new Error(`${membershipId} does not resolve`);
  expect(browser.cookies.get(STALE_ROLE_COOKIE)).toBe("QAQC");
  return context;
}

/** The layout config/dashboards.ts assigns a role held with a position, in each workspace. */
function layoutFor(role: RoleKey, position: PositionLevel, workspace: Workspace) {
  return workspace === "GROUP" ? groupDashboardFor(role, position) : dashboardForRole(role, position);
}

/** A KPI link's destination module: the one whose route the href starts with. */
function moduleOfHref(href: string) {
  const path = href.split("?")[0];
  return moduleList
    .filter((definition) => path === definition.route || path.startsWith(`${definition.route}/`))
    .sort((a, b) => b.route.length - a.route.length)[0];
}

/** May this reader open the module a link leads to: switched on and its entry permission held. */
function opens(context: UserContext, href: string): boolean {
  const destination = moduleOfHref(href);
  if (!destination) return false;
  return context.enabledModules.includes(destination.key) && context.permissions.includes(destination.permission);
}

/**
 * Every KPI planned is in the layout, and authorized for the reader: in a
 * company, by the company's context; in the group, by at least one company the
 * person may enter. Its link leads somewhere the same reader may open.
 */
async function expectAuthorizedKpis(context: UserContext, plan: DashboardPlan, layoutKpis: string[]) {
  const readers = context.workspace.scopeType === "GROUP" ? await resolveGroupContexts(context) : [context];
  expect(readers.length).toBeGreaterThan(0);
  for (const kpi of plan.kpis) {
    expect(layoutKpis, `${kpi.key} is not in the reader's layout`).toContain(kpi.key);
    const definition = kpiRegistry[kpi.key];
    const grantedBy = readers.filter((reader) => reader.enabledModules.includes(definition.module) && reader.permissions.includes(definition.permission));
    expect(grantedBy.length, `${kpi.key} is granted by none of the reader's companies`).toBeGreaterThan(0);
    if (definition.href) expect(grantedBy.some((reader) => opens(reader, definition.href!)), `${kpi.key} links to ${definition.href}, which the reader cannot open`).toBe(true);
  }
}

/* -------------------------------------------------------------------------- */
/* The representative identities                                               */
/* -------------------------------------------------------------------------- */

type Identity = {
  name: string;
  membershipId: string;
  /** From the seed: the role on the membership and the position it is held with. */
  role: RoleKey;
  position: PositionLevel;
  /** Whether the resolver grants the Group workspace (group standing, or several companies). */
  group: boolean;
  /** KPIs this identity must never be shown, in either workspace — independent of the layout. */
  never: string[];
};

const FINANCE_KPIS = ["receivables", "overdueValue", "invoicedValue", "groupPortfolioValue"];

const IDENTITIES: Identity[] = [
  { name: "Group Owner", membershipId: "member_owner", role: "OWNER", position: "GROUP_HEAD", group: true, never: [] },
  { name: "Group Finance head", membershipId: "member_finance", role: "FINANCE", position: "GROUP_HEAD", group: true, never: ["openQualityCount", "openNcrCount", "openIncidentCount"] },
  { name: "Group Architecture head", membershipId: "member_architecture_manager", role: "ARCHITECT", position: "GROUP_HEAD", group: true, never: ["receivables", "overdueValue", "invoicedValue"] },
  { name: "Project Manager", membershipId: "member_pm", role: "PROJECT_MANAGER", position: "MEMBER", group: false, never: ["receivables", "overdueValue", "invoicedValue", "pipelineValue"] },
  { name: "Group HSE head", membershipId: "member_hse", role: "HSE", position: "GROUP_HEAD", group: true, never: ["receivables", "overdueValue", "invoicedValue"] },
  { name: "Group QA/QC head", membershipId: "member_qaqc", role: "QAQC", position: "GROUP_HEAD", group: true, never: ["receivables", "overdueValue", "invoicedValue"] },
  { name: "Viewer", membershipId: "member_viewer", role: "VIEWER", position: "MEMBER", group: false, never: [...FINANCE_KPIS, "pipelineValue", "headcount"] },
  // Architect in Aurelia and in Forma, heading nothing: the group is open to them, the group's figures are not.
  { name: "multi-company Architect", membershipId: "member_multicompany_a", role: "ARCHITECT", position: "MEMBER", group: true, never: [...FINANCE_KPIS, "groupCompanyCount"] },
];

describe("each identity's dashboard is its own, in both workspaces, with a stale role cookie present (RP-19)", () => {
  for (const identity of IDENTITIES) {
    for (const workspace of ["COMPANY", "GROUP"] as const) {
      it(`${identity.name} — ${workspace === "GROUP" ? "Group" : "Company"} workspace`, async () => {
        const context = await pageAs(identity.membershipId, workspace);
        const granted: Workspace = workspace === "GROUP" && identity.group ? "GROUP" : "COMPANY";
        expect(context.workspace.scopeType).toBe(granted);
        // The identity is the membership's, whatever the cookie says.
        expect({ role: context.role, position: context.position }).toEqual({ role: identity.role, position: identity.position });

        const plan = await planDashboard(context);
        const layout = layoutFor(identity.role, identity.position, granted);
        expect(plan.focus).toBe(layout.focus);
        if (identity.role !== "QAQC") expect(plan.focus).not.toBe(dashboards.QAQC.focus);
        await expectAuthorizedKpis(context, plan, layout.kpis);
        for (const key of identity.never) expect(plan.kpis.map((kpi) => kpi.key), `${identity.name} was shown ${key}`).not.toContain(key);
        // Creating a record needs a company: the group has no quick actions, and a read-only role none anywhere.
        if (granted === "GROUP" || identity.role === "VIEWER") expect(plan.quickActions).toEqual([]);
      });
    }
  }

  it("gives the Owner the group's figures in the group and none of them in a company (positive and negative control)", async () => {
    const inGroup = await planDashboard(await pageAs("member_owner", "GROUP"));
    expect(inGroup.kpis.map((kpi) => kpi.key)).toEqual(expect.arrayContaining(["groupCompanyCount", "groupActiveProjects", "groupEmployees", "groupPortfolioValue"]));
    const inCompany = await planDashboard(await pageAs("member_owner", "COMPANY"));
    // Every Owner KPI is a group figure, which a company workspace never shows.
    expect(inCompany.kpis).toEqual([]);
    expect(inCompany.focus).toBe(dashboards.OWNER.focus);
  });
});

/* -------------------------------------------------------------------------- */
/* The anchor: roles that differ across companies                              */
/* -------------------------------------------------------------------------- */

/**
 * A session in the Group workspace still sits on one membership — its anchor —
 * and until AUD-06 the Group dashboard took that membership's role. Nobody in
 * the seed holds different roles in different companies, so the case is made
 * here, for the test only: one of the person's memberships given the QA/QC
 * role, then restored.
 */
async function giveRole(membershipId: string, key: RoleKey): Promise<void> {
  const before = await prisma.companyMember.findUniqueOrThrow({ where: { id: membershipId }, select: { roleId: true } });
  const role = await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } });
  await prisma.companyMember.update({ where: { id: membershipId }, data: { roleId: role.id } });
  restore.push(() => prisma.companyMember.update({ where: { id: membershipId }, data: { roleId: before.roleId } }));
}

describe("the Group dashboard follows the person's group position, not the session's anchor (RP-19)", () => {
  it("shows the Group Owner the Owner dashboard from a company where they are only QA/QC", async () => {
    await giveRole("member_owner__c", "QAQC");

    // The company workspace of that company is that membership's: QA/QC (C-01 §6).
    const companyC = await pageAs("member_owner__c", "COMPANY");
    expect(companyC).toMatchObject({ companyId: COMPANY.c, role: "QAQC", position: "MEMBER" });
    expect((await planDashboard(companyC)).focus).toBe(dashboards.QAQC.focus);

    // The group is the Owner's, from either anchor.
    const anchoredInC = await pageAs("member_owner__c", "GROUP");
    const anchoredInA = await pageAs("member_owner", "GROUP");
    expect(anchoredInC.workspace.scopeType).toBe("GROUP");
    expect(anchoredInC.role).toBe("QAQC");
    const fromC = await planDashboard(anchoredInC);
    const fromA = await planDashboard(anchoredInA);
    expect(fromC.focus).toBe(dashboards.OWNER.focus);
    expect(fromA.focus).toBe(dashboards.OWNER.focus);
    expect(fromC.kpis.map((kpi) => kpi.key)).toEqual(fromA.kpis.map((kpi) => kpi.key));
    expect(fromC.widgets.map((widget) => widget.key)).toEqual(fromA.widgets.map((widget) => widget.key));
    await expectAuthorizedKpis(anchoredInC, fromC, groupDashboardFor("OWNER", "GROUP_HEAD").kpis);
  });

  it("shows the Group Finance head the Finance dashboard in the group from either anchor", async () => {
    await giveRole("member_finance__b", "QAQC");

    const companyB = await pageAs("member_finance__b", "COMPANY");
    expect(companyB).toMatchObject({ companyId: COMPANY.b, role: "QAQC", position: "MEMBER" });
    expect((await planDashboard(companyB)).focus).toBe(dashboards.QAQC.focus);
    // Company A is still Finance there.
    expect((await planDashboard(await pageAs("member_finance", "COMPANY"))).focus).toBe(dashboards.FINANCE.focus);

    const fromB = await planDashboard(await pageAs("member_finance__b", "GROUP"));
    const fromA = await planDashboard(await pageAs("member_finance", "GROUP"));
    expect(fromB.focus).toBe(groupDashboardFor("FINANCE", "GROUP_HEAD").focus);
    expect(fromA.focus).toBe(groupDashboardFor("FINANCE", "GROUP_HEAD").focus);
    expect(fromB.focus).not.toBe(dashboards.QAQC.focus);
    expect(fromB.kpis.map((kpi) => kpi.key)).toEqual(fromA.kpis.map((kpi) => kpi.key));
    expect(fromB.widgets.map((widget) => widget.key)).toEqual(fromA.widgets.map((widget) => widget.key));
  });

  it("changes nothing for somebody whose companies agree: the anchor and the group position are the same person", async () => {
    // Positive control for the rule above: an unchanged Finance head reads Finance from B too.
    const fromB = await planDashboard(await pageAs("member_finance__b", "GROUP"));
    expect(fromB.focus).toBe(dashboards.FINANCE.focus);
  });
});
