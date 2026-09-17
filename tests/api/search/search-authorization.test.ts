import { afterAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { buildInvoiceScopeWhere } from "@/lib/modules/finance/finance.scope";
import { buildOpportunityScopeWhere } from "@/lib/modules/sales/sales.scope";
import { buildTeamScopeWhere } from "@/lib/modules/team/team.scope";
import { clampLimit, globalSearch, LIMIT_PER_PROVIDER, TOTAL_LIMIT } from "@/lib/core/search/search.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Search applies the module's own scope (PRD #26 §22, §29, PRD #47 §175).
 *
 * The invoice, opportunity and team providers filtered on company alone, so a
 * reader scoped to their own projects could type a number or a name and find
 * a record — its title, its client — that their list screen hides. The limits
 * came straight from the query string. Each test picks a record out of the
 * reader's scope from the scope builder itself, so it keeps meaning something
 * whatever the seed looks like.
 */

/** Aurelia has one project and the Project Manager is on it; this second one, and its invoice, they are not on. */
const ELSEWHERE = { project: "test47_search_elsewhere", invoice: "test47_search_invoice" } as const;

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { id: ELSEWHERE.invoice } });
  await prisma.project.deleteMany({ where: { id: ELSEWHERE.project } });
  await cleanupSessions();
  await prisma.$disconnect();
});

const ids = async (context: UserContext, text: string, module: string) =>
  (await globalSearch(context, text, { moduleKeys: [module], limitPerProvider: 20 })).results.map((row) => row.entityId);

describe("scoped providers (PRD #47 §175)", () => {
  it("finds an opportunity outside a project-scoped seller's pipeline for the Owner only", async () => {
    const [owner, pm] = await Promise.all([loginAs("OWNER"), loginAs("PROJECT_MANAGER")]);
    const outside = await prisma.opportunity.findFirst({
      where: { companyId: pm.companyId, archivedAt: null, NOT: buildOpportunityScopeWhere(pm) },
      select: { id: true, name: true },
    });
    expect(outside, "the seed must hold an opportunity outside the Project Manager's sales scope").not.toBeNull();

    expect(await ids(owner, outside!.name, "sales")).toContain(outside!.id);
    expect(await ids(pm, outside!.name, "sales")).not.toContain(outside!.id);
  });

  it("finds an invoice only inside the reader's finance scope", async () => {
    const owner = await loginAs("OWNER");
    const pm = await loginAs("PROJECT_MANAGER");
    // A project-scoped finance reader: the Project Manager's own scope, with the invoice grant added.
    const scoped: UserContext = { ...pm, permissions: [...pm.permissions, "finance.invoice.view"] };
    await prisma.project.create({ data: { id: ELSEWHERE.project, companyId: pm.companyId, code: "T47-ELSE", name: "Search Elsewhere", status: "ACTIVE", projectManagerMemberId: owner.membershipId, createdBy: "test" } });
    await prisma.invoice.create({
      data: { id: ELSEWHERE.invoice, companyId: pm.companyId, invoiceNumber: "INV-T47-001", clientId: "client_acme", projectId: ELSEWHERE.project, issueDate: new Date(), dueDate: new Date(), currency: "EUR", subtotal: "100.00", taxAmount: "0.00", totalAmount: "100.00", status: "SENT", createdByMemberId: pm.membershipId },
    });
    const [outside, inside] = await Promise.all([
      prisma.invoice.findFirst({ where: { companyId: pm.companyId, archivedAt: null, projectId: { not: null }, NOT: buildInvoiceScopeWhere(scoped) }, select: { id: true, invoiceNumber: true } }),
      prisma.invoice.findFirst({ where: { AND: [buildInvoiceScopeWhere(scoped), { archivedAt: null }] }, select: { id: true, invoiceNumber: true } }),
    ]);
    expect(outside, "the seed must hold an invoice on a project the Project Manager is not on").not.toBeNull();
    expect(inside, "the seed must hold an invoice on the Project Manager's projects").not.toBeNull();

    expect(await ids(owner, outside!.invoiceNumber, "finance")).toContain(outside!.id);
    expect(await ids(scoped, outside!.invoiceNumber, "finance")).not.toContain(outside!.id);
    expect(await ids(scoped, inside!.invoiceNumber, "finance")).toContain(inside!.id);
  });

  it("finds only the colleagues the Team directory would list", async () => {
    const [owner, viewer] = await Promise.all([loginAs("OWNER"), loginAs("VIEWER")]);
    const outside = await prisma.companyMember.findFirst({
      where: { companyId: viewer.companyId, status: "ACTIVE", NOT: buildTeamScopeWhere(viewer) },
      select: { id: true, user: { select: { lastName: true } } },
    });
    expect(outside, "the seed must hold a member outside the Viewer's team scope").not.toBeNull();

    expect(await ids(owner, outside!.user.lastName, "team")).toContain(outside!.id);
    expect(await ids(viewer, outside!.user.lastName, "team")).not.toContain(outside!.id);
  });
});

describe("limits are clamped on the server (PRD #26 §104, PRD #47 §175)", () => {
  it("clamps, truncates and defaults whatever the query string says", () => {
    expect(clampLimit("100000", LIMIT_PER_PROVIDER)).toBe(20);
    expect(clampLimit("0", LIMIT_PER_PROVIDER)).toBe(1);
    expect(clampLimit("-5", TOTAL_LIMIT)).toBe(1);
    expect(clampLimit("7.9", LIMIT_PER_PROVIDER)).toBe(7);
    expect(clampLimit("abc", LIMIT_PER_PROVIDER)).toBe(5);
    expect(clampLimit(null, TOTAL_LIMIT)).toBe(20);
    expect(clampLimit(undefined, TOTAL_LIMIT)).toBe(20);
    expect(clampLimit("", TOTAL_LIMIT)).toBe(20);
    expect(clampLimit(Number.POSITIVE_INFINITY, TOTAL_LIMIT)).toBe(20);
    expect(clampLimit("1e9", TOTAL_LIMIT)).toBe(50);
  });

  it("never returns more than the caps however large the request", async () => {
    const owner = await loginAs("OWNER");
    const huge = await globalSearch(owner, "in", { limitPerProvider: "100000", totalLimit: "100000" });
    expect(huge.results.length).toBeLessThanOrEqual(TOTAL_LIMIT.max);
    const byModule = new Map<string, number>();
    for (const row of huge.results) byModule.set(`${row.moduleKey}:${row.entityType}`, (byModule.get(`${row.moduleKey}:${row.entityType}`) ?? 0) + 1);
    expect(Math.max(0, ...byModule.values())).toBeLessThanOrEqual(LIMIT_PER_PROVIDER.max);

    const junk = await globalSearch(owner, "in", { limitPerProvider: "abc", totalLimit: "abc" });
    expect(junk.results.length).toBeLessThanOrEqual(TOTAL_LIMIT.fallback);
  });
});
