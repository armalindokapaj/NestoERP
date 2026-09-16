import { afterAll, afterEach, describe, expect, it } from "vitest";

import { loadRecentActivity } from "@/lib/modules/dashboard/dashboard.activity";
import { lowStockRows, resolveDashboard } from "@/lib/modules/dashboard/dashboard.service";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * Dashboard authorization (PRD #47 §59, §175).
 *
 * A dashboard widget is a list or a count, and a count is data: it may only
 * include what the reader could open on the module's own page. These tests
 * pin the three places the 2026-09 audit found saying more than that — the
 * company-wide activity feed, stock counted from stores the reader cannot see,
 * and invoiced totals shown to a role refused the invoices.
 */

const COMPANY = "company_demo_a";
const MARK = "DASHAUTHZ";
const activityIds: string[] = [];
const itemIds: string[] = [];

afterEach(async () => {
  await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
  await prisma.inventoryBalance.deleteMany({ where: { inventoryItemId: { in: itemIds } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
  activityIds.length = 0;
  itemIds.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/**
 * An activity row dated a few minutes ahead, so it is the newest thing in the
 * feed however many rows other suites write meanwhile.
 */
async function activity(module: string, entityType: string, entityId: string, action: string) {
  const row = await prisma.activity.create({
    data: {
      companyId: COMPANY,
      module,
      entityType,
      entityId,
      action,
      message: `${MARK} ${module}/${entityType}/${entityId}`,
      actorMemberId: "member_owner",
      createdAt: new Date(Date.now() + 5 * 60_000),
    },
    select: { id: true, message: true },
  });
  activityIds.push(row.id);
  return row.message!;
}

describe("recent activity shows only what the reader could open (PRD #47 §59, §175)", () => {
  it("keeps HR pay and sick leave, Finance payments and out-of-scope projects out of other roles' feeds", async () => {
    const compensation = await activity("hr", "Compensation", "member_engineer", "HR_COMPENSATION_RECORDED");
    const sickLeave = await activity("hr", "LeaveRequest", "leave_002", "HR_LEAVE_APPROVED");
    const payment = await activity("finance", "Payment", "payment_in_001", "FINANCE_PAYMENT_RECORDED");
    const ownProject = await activity("projects", "Project", PROJECT.a, "PROJECT_UPDATED");
    const otherProject = await activity("projects", "Project", PROJECT.c, "PROJECT_UPDATED");
    const teamEvent = await activity("team", "CompanyMember", "member_engineer", "MEMBER_UPDATED");
    // An entity no module vouches for is never shown on trust.
    const unknown = await activity("projects", "SomethingElse", PROJECT.a, "PROJECT_UPDATED");

    const [owner, it, pm, hr, viewer] = await Promise.all([
      loginAs("OWNER"),
      loginAs("COMPANY_IT"),
      loginAs("PROJECT_MANAGER"),
      loginAs("HR"),
      loginAs("VIEWER"),
    ]);
    const feed = async (context: typeof owner) => (await loadRecentActivity(context)).map((row) => row.message);

    // The Owner may open every one of these records.
    expect(await feed(owner)).toEqual(expect.arrayContaining([compensation, sickLeave, payment, ownProject, otherProject, teamEvent]));
    expect(await feed(owner)).not.toContain(unknown);

    // Company IT: the directory's history, none of HR's or Finance's or Projects'.
    const itFeed = await feed(it);
    expect(itFeed).toContain(teamEvent);
    for (const hidden of [compensation, sickLeave, payment, ownProject, otherProject, unknown]) expect(itFeed).not.toContain(hidden);

    // The Project Manager: their own project, not somebody else's, and no payments or pay.
    const pmFeed = await feed(pm);
    expect(pmFeed).toContain(ownProject);
    for (const hidden of [compensation, sickLeave, payment, otherProject, unknown]) expect(pmFeed).not.toContain(hidden);

    // HR reads pay and leave history, never Finance's.
    const hrFeed = await feed(hr);
    expect(hrFeed).toEqual(expect.arrayContaining([compensation, sickLeave]));
    expect(hrFeed).not.toContain(payment);

    // The Viewer sees none of it.
    const viewerFeed = await feed(viewer);
    for (const hidden of [compensation, sickLeave, payment, otherProject, unknown]) expect(viewerFeed).not.toContain(hidden);
  });

  it("drops pay events written against the employee record for a reader without the compensation grant", async () => {
    const payOnProfile = await activity("hr", "EmployeeProfile", "member_engineer", "HR_COMPENSATION_RECORDED");
    const owner = await loginAs("OWNER");
    const ownerFeed = (await loadRecentActivity(owner)).map((row) => row.message);
    expect(ownerFeed).toContain(payOnProfile);

    const withoutPay = { ...owner, permissions: owner.permissions.filter((permission) => permission !== "hr.compensation.view") };
    expect((await loadRecentActivity(withoutPay)).map((row) => row.message)).not.toContain(payOnProfile);
  });
});

describe("low stock counts only the stock the reader can see (PRD #20 §246, PRD #47 §175)", () => {
  it("does not add stock held in another project's store to a project-scoped reader's figure", async () => {
    const item = await prisma.inventoryItem.create({
      data: { companyId: COMPANY, sku: `${MARK}-${Date.now()}`, name: `${MARK} item`, category: "MATERIAL", baseUnit: "pcs", reorderPoint: 10, createdByMemberId: "member_owner" },
      select: { id: true },
    });
    itemIds.push(item.id);
    // Two on the Project Manager's site, a hundred in the Marina store they cannot open.
    await prisma.inventoryBalance.createMany({
      data: [
        { companyId: COMPANY, inventoryItemId: item.id, warehouseId: "wh_riverside", locationId: "loc_riverside_main", onHandQuantity: 2, availableQuantity: 2 },
        { companyId: COMPANY, inventoryItemId: item.id, warehouseId: "wh_marina", locationId: "loc_marina_main", onHandQuantity: 100, availableQuantity: 100 },
      ],
    });

    const [owner, pm] = await Promise.all([loginAs("OWNER"), loginAs("PROJECT_MANAGER")]);
    expect((await lowStockRows(owner)).some((row) => row.id === item.id)).toBe(false);
    const pmRow = (await lowStockRows(pm)).find((row) => row.id === item.id);
    expect(pmRow?.onHand).toBe(2);
  });
});

describe("project financials without the invoice grant (PRD #47 §59)", () => {
  it("shows the Project Manager budgets, never invoiced value, and keeps invoiced value for Finance", async () => {
    const [pm, finance] = await Promise.all([loginAs("PROJECT_MANAGER"), loginAs("FINANCE")]);
    expect(pm.permissions).not.toContain("finance.invoice.view");

    const widget = async (context: typeof pm) => {
      const dashboard = await resolveDashboard(context);
      const found = dashboard.widgets.find((row) => row.definition.key === "projectBudgets");
      expect(found, "projectBudgets must be on this role's dashboard").toBeDefined();
      expect(found!.payload.kind).toBe("list");
      return found!.payload.kind === "list" ? found!.payload.items : [];
    };

    const pmItems = await widget(pm);
    expect(pmItems.length).toBeGreaterThan(0);
    expect(pmItems.every((item) => item.meta?.startsWith("Budget "))).toBe(true);
    expect(pmItems.map((item) => item.id).every((id) => id === PROJECT.a || id === PROJECT.b)).toBe(true);

    const financeItems = await widget(finance);
    expect(financeItems.length).toBeGreaterThan(0);
    expect(financeItems.some((item) => item.meta?.startsWith("Budget "))).toBe(false);
  });
});
