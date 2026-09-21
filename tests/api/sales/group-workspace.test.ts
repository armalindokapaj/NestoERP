import { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { isGroupRoute } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
import { resolveAllowedCompanies, resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import * as leads from "@/lib/modules/sales/leads/lead.service";
import { leadListQuerySchema } from "@/lib/modules/sales/leads/lead.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import { opportunityListQuerySchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import { winRate } from "@/lib/modules/sales/opportunities/opportunity.forecast";
import { getPipeline, getPipelineForWorkspace } from "@/lib/modules/sales/opportunities/pipeline.service";
import { attentionListForWorkspace, getSalesOverview, getSalesOverviewForWorkspace } from "@/lib/modules/sales/overview/overview.service";
import * as reports from "@/lib/modules/sales/reports/reports.service";
import { buildOpportunityUnionWhere } from "@/lib/modules/sales/sales.scope";
import { resolveSalesExperience } from "@/lib/modules/sales/sales.workspace";
import type { CurrencyTotal } from "@/lib/modules/sales/sales.types";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

// Only the cookie half of the resolver is stood in for (the security suite does
// the same): the context is still the real resolver's, from a real session row.
vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * Sales in the Group workspace (Workspace Context §37, §41, §45, §60, §72, §92).
 *
 * Real sessions, real resolver, real database. The Owner of the five-company
 * demo group reads Sales in all five; a plain Aurelia sales rep reads it in one.
 * A group view is each company's own answer put together, so the checks compare
 * it with what a sign-in into each company shows — and never let a company the
 * person may not read, or one that switched Sales off, into a row or a total.
 */

const PREFIX = "Vitest-WS";
const restore: Array<() => Promise<unknown>> = [];
const created = { opportunities: [] as string[], leads: [] as string[] };

afterEach(async () => {
  actAs(null);
  for (const undo of restore.splice(0).reverse()) await undo();
  if (created.opportunities.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: created.opportunities } } });
    await prisma.opportunity.deleteMany({ where: { id: { in: created.opportunities } } });
    created.opportunities.length = 0;
  }
  if (created.leads.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: created.leads } } });
    await prisma.lead.deleteMany({ where: { id: { in: created.leads } } });
    created.leads.length = 0;
  }
  await cleanupSessions();
});
afterAll(() => prisma.$disconnect());

const oppQuery = (over: Record<string, unknown> = {}) => opportunityListQuerySchema.parse({ limit: 100, ...over });
const leadQuery = (over: Record<string, unknown> = {}) => leadListQuerySchema.parse({ limit: 100, ...over });
const ownerGroup = () => loginAs("OWNER", { workspace: "GROUP" });
const dec = (value: string) => new Prisma.Decimal(value);

/** What each company's own page says: the person signing in to that company. */
async function ownSessions(group: UserContext, permission: "sales.opportunity.view" | "sales.lead.view" | "sales.view" | "sales.report.view" = "sales.view") {
  const contexts = await resolveWorkspaceContexts(group, { module: "sales", permission });
  return new Map(await Promise.all(contexts.map(async (context) => [context.companyId, await loginAsMembership(context.membershipId)] as const)));
}

async function switchSalesOff(companyId: string) {
  const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId, module: { key: "sales" } } });
  await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
  restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));
}

async function makeOpportunity(by: UserContext, over: { name: string; currency: string; value: string; ownerMemberId?: string; stage?: "PROSPECTING" | "PROPOSAL" }) {
  const row = await prisma.opportunity.create({
    data: {
      companyId: by.companyId,
      name: over.name,
      ownerMemberId: over.ownerMemberId ?? by.membershipId,
      createdByMemberId: by.membershipId,
      stage: over.stage ?? "PROSPECTING",
      estimatedValue: over.value,
      currency: over.currency,
    },
  });
  created.opportunities.push(row.id);
  return row;
}

async function makeLead(by: UserContext, name: string) {
  const row = await prisma.lead.create({
    data: { companyId: by.companyId, name, source: "REFERRAL", ownerMemberId: by.membershipId, createdByMemberId: by.membershipId },
  });
  created.leads.push(row.id);
  return row;
}

/** Totals by currency, so two figures compare without depending on order. */
const byCurrency = (totals: CurrencyTotal[]) => Object.fromEntries(totals.map((total) => [total.currency, { count: total.count, value: total.value, weighted: total.weightedValue }]));

/** The sum of several companies' totals, one entry per currency — never across currencies. */
function summed(lists: CurrencyTotal[][]) {
  const out = new Map<string, { count: number; value: Prisma.Decimal; weighted: Prisma.Decimal }>();
  for (const total of lists.flat()) {
    const entry = out.get(total.currency) ?? { count: 0, value: dec("0"), weighted: dec("0") };
    out.set(total.currency, { count: entry.count + total.count, value: entry.value.plus(total.value), weighted: entry.weighted.plus(total.weightedValue) });
  }
  return Object.fromEntries([...out].map(([currency, entry]) => [currency, { count: entry.count, value: entry.value.toFixed(2), weighted: entry.weighted.toFixed(2) }]));
}

async function companyOf(opportunityId: string) {
  return prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { companyId: true, company: { select: { name: true } } } });
}

describe("the registered group routes (§25, §85)", () => {
  it("names the five list routes of Sales and no record page, form or unaggregated section", () => {
    for (const path of ["/sales", "/sales/opportunities", "/sales/leads", "/sales/pipeline", "/sales/reports"]) {
      expect(isGroupRoute("sales", path)).toBe(true);
    }
    for (const path of ["/sales/proposals", "/sales/tasks", "/sales/opportunities/new", "/sales/opportunities/abc", "/sales/leads/abc/convert"]) {
      expect(isGroupRoute("sales", path)).toBe(false);
    }
  });
});

describe("opportunities in the Group workspace (§37, §45, §58)", () => {
  it("lists the deals of several companies, each row naming its own company", async () => {
    const group = await ownerGroup();
    expect(group.workspace.scopeType).toBe("GROUP");
    const result = await opportunities.listOpportunitiesForWorkspace(group, oppQuery());

    const rows = await prisma.opportunity.findMany({ where: { id: { in: result.data.map((row) => row.id) } }, select: { id: true, companyId: true, company: { select: { name: true } } } });
    const truth = new Map(rows.map((row) => [row.id, row]));
    expect(result.data.length).toBeGreaterThan(0);
    for (const row of result.data) {
      expect(row.company).toEqual({ id: truth.get(row.id)!.companyId, name: truth.get(row.id)!.company.name });
    }
    expect(new Set(result.data.map((row) => row.company!.id)).size).toBeGreaterThanOrEqual(2);
  });

  it("is exactly the union of what a sign-in into each company shows, in total and row by row", async () => {
    const group = await ownerGroup();
    const result = await opportunities.listOpportunitiesForWorkspace(group, oppQuery());

    const own = await ownSessions(group, "sales.opportunity.view");
    const ids = new Set<string>();
    let total = 0;
    for (const session of own.values()) {
      const page = await opportunities.listOpportunities(session, oppQuery());
      total += page.pagination.total;
      for (const row of page.data) ids.add(row.id);
    }
    expect(result.pagination.total).toBe(total);
    expect(new Set(result.data.map((row) => row.id))).toEqual(ids);
  });

  it("shows a company workspace only that company's deals, unlabelled", async () => {
    const owner = await loginAs("OWNER");
    expect(owner.workspace.scopeType).toBe("COMPANY");
    const result = await opportunities.listOpportunitiesForWorkspace(owner, oppQuery());

    const rows = await prisma.opportunity.findMany({ where: { id: { in: result.data.map((row) => row.id) } }, select: { companyId: true } });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.companyId))).toEqual(new Set([owner.companyId]));
    expect(result.data.every((row) => !("company" in row))).toBe(true);
    // The very same answer as the company list it always was.
    expect(result).toEqual(await opportunities.listOpportunities(owner, oppQuery()));
  });

  it("leaves out a company that switched Sales off, its rows and its options with it (§60, §92)", async () => {
    const before = await ownerGroup();
    const all = await resolveAllowedCompanies(before, { module: "sales", permission: "sales.opportunity.view" });
    expect(all).toContain(COMPANY.c);

    await switchSalesOff(COMPANY.c);
    const group = await ownerGroup();
    expect(await resolveAllowedCompanies(group, { module: "sales", permission: "sales.opportunity.view" })).not.toContain(COMPANY.c);

    const result = await opportunities.listOpportunitiesForWorkspace(group, oppQuery());
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.map((row) => row.company!.id)).not.toContain(COMPANY.c);
    const inC = await prisma.opportunity.count({ where: { companyId: COMPANY.c } });
    expect(inC).toBeGreaterThan(0);

    // Naming it in the filter changes nothing: it is not one of the companies read.
    const named = await opportunities.listOpportunitiesForWorkspace(group, oppQuery({ companyId: COMPANY.c }));
    expect(named.data.map((row) => row.id).sort()).toEqual(result.data.map((row) => row.id).sort());
    const options = await opportunities.opportunityFilterOptionsForWorkspace(group);
    expect(options.companies.map((company) => company.id)).not.toContain(COMPANY.c);
  });

  it("gives a person without group standing nothing beyond their own company", async () => {
    const rep = await loginAs("SALES", { workspace: "GROUP" });
    // No group standing: the request falls back to their company (§82), and the
    // list is that company's own, unlabelled.
    expect(rep.workspace.scopeType).toBe("COMPANY");
    const result = await opportunities.listOpportunitiesForWorkspace(rep, oppQuery());
    const rows = await prisma.opportunity.findMany({ where: { id: { in: result.data.map((row) => row.id) } }, select: { companyId: true } });
    expect(new Set(rows.map((row) => row.companyId))).toEqual(new Set([COMPANY.a]));
    expect(result.data.every((row) => !("company" in row))).toBe(true);
    expect(result).toEqual(await opportunities.listOpportunities(rep, oppQuery()));

    // Asking for another company, by filter, does not reach it.
    const asked = await opportunities.listOpportunitiesForWorkspace(rep, oppQuery({ companyId: COMPANY.b }));
    expect(asked).toEqual(result);
  });

  it("narrows to one company with the company filter, and only to one the person may read", async () => {
    const group = await ownerGroup();
    const everything = await opportunities.listOpportunitiesForWorkspace(group, oppQuery());

    const onlyB = await opportunities.listOpportunitiesForWorkspace(group, oppQuery({ companyId: COMPANY.b }));
    expect(onlyB.data.length).toBeGreaterThan(0);
    expect(onlyB.data.every((row) => row.company!.id === COMPANY.b)).toBe(true);
    expect(onlyB.pagination.total).toBe(everything.data.filter((row) => row.company!.id === COMPANY.b).length);

    // Another group's company, and one that does not exist: ignored, and nothing
    // says which of the two it was.
    for (const companyId of [COMPANY.tenant, "company_that_does_not_exist"]) {
      const ignored = await opportunities.listOpportunitiesForWorkspace(group, oppQuery({ companyId }));
      expect(ignored.data.map((row) => row.id).sort()).toEqual(everything.data.map((row) => row.id).sort());
      expect(ignored.data.every((row) => row.company!.id !== COMPANY.tenant)).toBe(true);
    }
  });

  it("offers the company filter every company read, and labels an owner or client with its company", async () => {
    const group = await ownerGroup();
    const options = await opportunities.opportunityFilterOptionsForWorkspace(group);
    const allowed = await resolveAllowedCompanies(group, { module: "sales", permission: "sales.opportunity.view" });
    expect(options.companies.map((company) => company.id).sort()).toEqual([...allowed].sort());
    expect(options.owners.length).toBeGreaterThan(0);
    expect(options.owners.every((owner) => Boolean(owner.company))).toBe(true);
    expect(options.clients.every((client) => Boolean(client.company))).toBe(true);

    // In a company there is no company filter to offer.
    const company = await opportunities.opportunityFilterOptionsForWorkspace(await loginAs("OWNER"));
    expect(company.companies).toEqual([]);
    expect(company.owners.every((owner) => owner.company === undefined)).toBe(true);
  });

  it("sorts and pages across companies in the database, never repeating or dropping a deal", async () => {
    const group = await ownerGroup();
    const whole = await opportunities.listOpportunitiesForWorkspace(group, oppQuery({ sort: "value-desc" }));
    const total = whole.pagination.total;
    expect(total).toBeGreaterThan(8);

    const seen: string[] = [];
    const values: number[] = [];
    for (let page = 1; page <= Math.ceil(total / 7); page += 1) {
      const result = await opportunities.listOpportunitiesForWorkspace(group, oppQuery({ sort: "value-desc", limit: 7, page }));
      expect(result.pagination.total).toBe(total);
      for (const row of result.data) {
        seen.push(row.id);
        values.push(Number.parseFloat(row.estimatedValue));
      }
    }
    expect(seen.length).toBe(total);
    expect(new Set(seen).size).toBe(total);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it("reads `mine` as the reader's own membership in each company, and no one else's", async () => {
    const group = await ownerGroup();
    const own = await resolveWorkspaceContexts(group, { module: "sales", permission: "sales.opportunity.view" });
    const inB = own.find((context) => context.companyId === COMPANY.b)!;
    const inC = own.find((context) => context.companyId === COMPANY.c)!;
    const inA = own.find((context) => context.companyId === COMPANY.a)!;
    const colleague = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.a, id: { not: inA.membershipId }, status: "ACTIVE" } });

    const mineB = await makeOpportunity(inB, { name: `${PREFIX} mine B`, currency: "EUR", value: "100.00" });
    const mineC = await makeOpportunity(inC, { name: `${PREFIX} mine C`, currency: "USD", value: "200.00" });
    const theirs = await makeOpportunity(inA, { name: `${PREFIX} colleague A`, currency: "EUR", value: "300.00", ownerMemberId: colleague.id });

    const search = await opportunities.listOpportunitiesForWorkspace(group, oppQuery({ search: PREFIX }));
    expect(search.data.map((row) => row.id).sort()).toEqual([mineB.id, mineC.id, theirs.id].sort());

    const mine = await opportunities.listOpportunitiesForWorkspace(group, oppQuery({ search: PREFIX, mine: true }));
    expect(mine.data.map((row) => row.id).sort()).toEqual([mineB.id, mineC.id].sort());
    expect(mine.data.map((row) => row.company!.id).sort()).toEqual([COMPANY.b, COMPANY.c]);
  });

  it("is the union of each company's own scope, and nothing at all when no company is read", async () => {
    const group = await ownerGroup();
    const contexts = await resolveWorkspaceContexts(group, { module: "sales", permission: "sales.opportunity.view" });
    const where = buildOpportunityUnionWhere(contexts);
    // One branch per company, each starting with its own company boundary.
    expect(where).toEqual({ OR: expect.any(Array) });
    for (const branch of (where as { OR: Array<{ companyId?: string }> }).OR) expect(branch.companyId).toBeDefined();
    expect(await prisma.opportunity.count({ where: buildOpportunityUnionWhere([]) })).toBe(0);
  });
});

describe("leads in the Group workspace (§37, §45)", () => {
  it("lists the leads of several companies, each row naming its company, and matches each company's own list", async () => {
    const group = await ownerGroup();
    const result = await leads.listLeadsForWorkspace(group, leadQuery());

    const rows = await prisma.lead.findMany({ where: { id: { in: result.data.map((row) => row.id) } }, select: { id: true, companyId: true, company: { select: { name: true } } } });
    const truth = new Map(rows.map((row) => [row.id, row]));
    for (const row of result.data) expect(row.company).toEqual({ id: truth.get(row.id)!.companyId, name: truth.get(row.id)!.company.name });
    expect(new Set(result.data.map((row) => row.company!.id)).size).toBeGreaterThanOrEqual(2);

    const ids = new Set<string>();
    let total = 0;
    for (const session of (await ownSessions(group, "sales.lead.view")).values()) {
      const page = await leads.listLeads(session, leadQuery());
      total += page.pagination.total;
      for (const row of page.data) ids.add(row.id);
    }
    expect(result.pagination.total).toBe(total);
    expect(new Set(result.data.map((row) => row.id))).toEqual(ids);
  });

  it("shows a company workspace only that company's leads, unlabelled", async () => {
    const owner = await loginAs("OWNER");
    const result = await leads.listLeadsForWorkspace(owner, leadQuery());
    const rows = await prisma.lead.findMany({ where: { id: { in: result.data.map((row) => row.id) } }, select: { companyId: true } });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.companyId))).toEqual(new Set([owner.companyId]));
    expect(result.data.every((row) => !("company" in row))).toBe(true);
    expect(result).toEqual(await leads.listLeads(owner, leadQuery()));
  });

  it("leaves out a company that switched Sales off", async () => {
    await switchSalesOff(COMPANY.c);
    const group = await ownerGroup();
    const result = await leads.listLeadsForWorkspace(group, leadQuery());
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.map((row) => row.company!.id)).not.toContain(COMPANY.c);
    expect(await prisma.lead.count({ where: { companyId: COMPANY.c } })).toBeGreaterThan(0);
  });

  it("gives a person without group standing only their own company, and narrows only within what is read", async () => {
    const rep = await loginAs("SALES", { workspace: "GROUP" });
    const own = await leads.listLeadsForWorkspace(rep, leadQuery());
    const rows = await prisma.lead.findMany({ where: { id: { in: own.data.map((row) => row.id) } }, select: { companyId: true } });
    expect(rows.every((row) => row.companyId === COMPANY.a)).toBe(true);
    expect(own.data.every((row) => !("company" in row))).toBe(true);

    const group = await ownerGroup();
    const everything = await leads.listLeadsForWorkspace(group, leadQuery());
    const onlyD = await leads.listLeadsForWorkspace(group, leadQuery({ companyId: COMPANY.d }));
    expect(onlyD.data.length).toBeGreaterThan(0);
    expect(onlyD.data.every((row) => row.company!.id === COMPANY.d)).toBe(true);
    const ignored = await leads.listLeadsForWorkspace(group, leadQuery({ companyId: COMPANY.tenant }));
    expect(ignored.data.map((row) => row.id).sort()).toEqual(everything.data.map((row) => row.id).sort());
  });

  it("reads `mine` as the reader's own membership in each company", async () => {
    const group = await ownerGroup();
    const own = await resolveWorkspaceContexts(group, { module: "sales", permission: "sales.lead.view" });
    const inB = own.find((context) => context.companyId === COMPANY.b)!;
    const inD = own.find((context) => context.companyId === COMPANY.d)!;
    const b = await makeLead(inB, `${PREFIX} lead B`);
    const d = await makeLead(inD, `${PREFIX} lead D`);
    const colleague = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.b, id: { not: inB.membershipId }, status: "ACTIVE" } });
    const other = await prisma.lead.create({ data: { companyId: COMPANY.b, name: `${PREFIX} lead colleague`, source: "REFERRAL", ownerMemberId: colleague.id, createdByMemberId: colleague.id } });
    created.leads.push(other.id);

    const mine = await leads.listLeadsForWorkspace(group, leadQuery({ search: PREFIX, mine: true }));
    expect(mine.data.map((row) => row.id).sort()).toEqual([b.id, d.id].sort());
    const all = await leads.listLeadsForWorkspace(group, leadQuery({ search: PREFIX }));
    expect(all.data.length).toBe(3);
  });
});

describe("the pipeline in the Group workspace (§37, §72)", () => {
  it("shows every stage across companies with a per-currency total, and never adds one currency to another", async () => {
    const group = await ownerGroup();
    const contexts = await resolveWorkspaceContexts(group, { module: "sales", permission: "sales.opportunity.view" });
    const at = (id: string) => contexts.find((context) => context.companyId === id)!;
    // Euro deals in two companies and dollar deals in two others, all in one stage.
    await makeOpportunity(at(COMPANY.a), { name: `${PREFIX} eur a`, currency: "EUR", value: "1000.00" });
    await makeOpportunity(at(COMPANY.b), { name: `${PREFIX} eur b`, currency: "EUR", value: "2000.00" });
    await makeOpportunity(at(COMPANY.c), { name: `${PREFIX} usd c`, currency: "USD", value: "500.00" });
    await makeOpportunity(at(COMPANY.d), { name: `${PREFIX} usd d`, currency: "USD", value: "700.00" });

    const board = await getPipelineForWorkspace(group);

    // One entry per currency, and the sum of each company's own board for that currency.
    const own = await ownSessions(group, "sales.opportunity.view");
    const boards = await Promise.all([...own.values()].map((session) => getPipeline(session)));
    expect(byCurrency(board.totals)).toEqual(summed(boards.map((entry) => entry.totals)));
    expect(Object.keys(byCurrency(board.totals)).sort()).toEqual(expect.arrayContaining(["EUR", "USD"]));
    expect(board.totals.length).toBe(new Set(board.totals.map((total) => total.currency)).size);

    for (const stage of board.stages) {
      const perCompany = boards.map((entry) => entry.stages.find((candidate) => candidate.stage === stage.stage)!);
      expect(stage.count).toBe(perCompany.reduce((sum, entry) => sum + entry.count, 0));
      expect(byCurrency(stage.totals)).toEqual(summed(perCompany.map((entry) => entry.totals)));
    }

    // A card names its company; the dollar deals are dollars, not euros converted.
    const prospecting = board.stages.find((stage) => stage.stage === "PROSPECTING")!;
    for (const card of prospecting.opportunities) expect(card.company).toBeDefined();
    const usd = prospecting.opportunities.filter((card) => card.currency === "USD").map((card) => card.company!.id);
    expect(usd).toEqual(expect.arrayContaining([COMPANY.c, COMPANY.d]));
    const eur = prospecting.totals.find((total) => total.currency === "EUR")!;
    const usdTotal = prospecting.totals.find((total) => total.currency === "USD")!;
    expect(dec(usdTotal.value).gte("1200.00")).toBe(true);
    expect(dec(eur.value).gte("3000.00")).toBe(true);
  });

  it("narrows with the company filter, and reads a company's own board as that company shows it", async () => {
    const group = await ownerGroup();
    const onlyB = await getPipelineForWorkspace(group, COMPANY.b);
    const own = await loginAsMembership((await resolveWorkspaceContexts(group, { module: "sales" })).find((context) => context.companyId === COMPANY.b)!.membershipId);
    const theirs = await getPipeline(own);
    expect(byCurrency(onlyB.totals)).toEqual(byCurrency(theirs.totals));
    for (const stage of onlyB.stages) expect(stage.opportunities.every((card) => card.company!.id === COMPANY.b)).toBe(true);

    const ignored = await getPipelineForWorkspace(group, COMPANY.tenant);
    expect(byCurrency(ignored.totals)).toEqual(byCurrency((await getPipelineForWorkspace(group)).totals));
  });

  it("leaves out a company that switched Sales off, and shows a company workspace its own board unchanged", async () => {
    await switchSalesOff(COMPANY.c);
    const group = await ownerGroup();
    const board = await getPipelineForWorkspace(group);
    for (const stage of board.stages) expect(stage.opportunities.every((card) => card.company!.id !== COMPANY.c)).toBe(true);

    const owner = await loginAs("OWNER");
    expect(await getPipelineForWorkspace(owner)).toEqual(await getPipeline(owner));
  });
});

describe("the overview in the Group workspace (§37, §45, §72)", () => {
  it("adds each company's own figures, per currency, and recomputes the win rate from the counts", async () => {
    const group = await ownerGroup();
    const contexts = await resolveWorkspaceContexts(group, { module: "sales", permission: "sales.opportunity.view" });
    await makeOpportunity(contexts.find((context) => context.companyId === COMPANY.a)!, { name: `${PREFIX} ov usd a`, currency: "USD", value: "900.00" });

    const overview = await getSalesOverviewForWorkspace(group);
    const own = [...(await ownSessions(group, "sales.view")).values()];
    const each = await Promise.all(own.map((session) => getSalesOverview(session)));

    expect(byCurrency(overview.openPipeline)).toEqual(summed(each.map((entry) => entry.openPipeline)));
    expect(Object.keys(byCurrency(overview.openPipeline))).toEqual(expect.arrayContaining(["EUR", "USD"]));
    expect(overview.openOpportunities).toBe(each.reduce((sum, entry) => sum + entry.openOpportunities, 0));
    expect(overview.newLeadsThisMonth).toBe(each.reduce((sum, entry) => sum + entry.newLeadsThisMonth, 0));
    expect(overview.qualifiedLeads).toBe(each.reduce((sum, entry) => sum + entry.qualifiedLeads, 0));
    expect(byCurrency(overview.expectedCloseThisMonth)).toEqual(summed(each.map((entry) => entry.expectedCloseThisMonth)));
    expect(overview.pendingProposalApprovals).toBe(each.reduce((sum, entry) => sum + entry.pendingProposalApprovals, 0));

  });

  it("labels every attention row with its company", async () => {
    const group = await ownerGroup();
    const attention = await attentionListForWorkspace(group);
    const rows = [...attention.overdueClose, ...attention.noNextStep, ...attention.inactiveOwners, ...attention.qualifiedLeads, ...attention.expiringProposals];
    for (const row of rows) expect(row.company).toBeDefined();
    expect(attention.noNextStep.length + attention.overdueClose.length + attention.qualifiedLeads.length).toBeGreaterThan(0);

    const owner = await loginAs("OWNER");
    const company = await attentionListForWorkspace(owner);
    for (const row of [...company.overdueClose, ...company.noNextStep, ...company.qualifiedLeads]) expect("company" in row).toBe(false);
  });

  it("shows a company workspace its own overview unchanged", async () => {
    const owner = await loginAs("OWNER");
    expect(await getSalesOverviewForWorkspace(owner)).toEqual(await getSalesOverview(owner));
  });
});

describe("the reports in the Group workspace (§41, §45, §72)", () => {
  const period = reports.defaultPeriod();

  it("aggregates the pipeline report across companies, per currency", async () => {
    const group = await ownerGroup();
    const contexts = await resolveWorkspaceContexts(group, { module: "sales", permission: "sales.opportunity.view" });
    await makeOpportunity(contexts.find((context) => context.companyId === COMPANY.b)!, { name: `${PREFIX} rep usd b`, currency: "USD", value: "400.00" });

    const rows = await reports.pipelineByStageForWorkspace(group);
    const own = [...(await ownSessions(group, "sales.report.view")).values()];
    const each = await Promise.all(own.map((session) => reports.pipelineByStage(session)));
    for (const row of rows) {
      const stage = each.map((company) => company.find((candidate) => candidate.stage === row.stage)?.totals ?? []);
      expect(byCurrency(row.totals)).toEqual(summed(stage));
    }
    expect(new Set(rows.flatMap((row) => row.totals.map((total) => total.currency)))).toEqual(new Set(["EUR", "USD"]));
  });

  it("recomputes win and loss over the whole group, and names each owner's company in the owner report", async () => {
    const group = await ownerGroup();
    const own = [...(await ownSessions(group, "sales.report.view")).values()];

    const groupWinLoss = await reports.winLossReportForWorkspace(group, period);
    const each = await Promise.all(own.map((session) => reports.winLossReport(session, period)));
    expect(groupWinLoss.wonCount).toBe(each.reduce((sum, entry) => sum + entry.wonCount, 0));
    expect(groupWinLoss.lostCount).toBe(each.reduce((sum, entry) => sum + entry.lostCount, 0));
    expect(byCurrency(groupWinLoss.won)).toEqual(summed(each.map((entry) => entry.won)));
    expect(byCurrency(groupWinLoss.lost)).toEqual(summed(each.map((entry) => entry.lost)));
    // Won over decided across the whole group, not an average of company rates.
    expect(groupWinLoss.winRate).toBe(winRate(groupWinLoss.wonCount, groupWinLoss.lostCount));

    const owners = await reports.ownerReportForWorkspace(group, period);
    expect(owners.length).toBeGreaterThan(0);
    for (const row of owners) expect(row.company).toBeDefined();
    const perCompany = (await Promise.all(own.map((session) => reports.ownerReport(session, period)))).flat();
    expect(owners.length).toBe(perCompany.length);
  });

  it("aggregates lead conversion, expected close, lost reasons and proposals over the group", async () => {
    const group = await ownerGroup();
    const own = [...(await ownSessions(group, "sales.report.view")).values()];

    const conversion = await reports.leadConversionReportForWorkspace(group, period);
    const conversions = await Promise.all(own.map((session) => reports.leadConversionReport(session, period)));
    expect(conversion.totalCreated).toBe(conversions.reduce((sum, entry) => sum + entry.totalCreated, 0));
    expect(conversion.converted).toBe(conversions.reduce((sum, entry) => sum + entry.converted, 0));

    const proposals = await reports.proposalReportForWorkspace(group, period);
    const each = (await Promise.all(own.map((session) => reports.proposalReport(session, period)))).flat();
    // One row per currency for the whole group: the dollar proposal sits beside the euro ones.
    expect(proposals.map((row) => row.currency).sort()).toEqual([...new Set(each.map((row) => row.currency))].sort());
    for (const row of proposals) {
      const same = each.filter((entry) => entry.currency === row.currency);
      expect(row.acceptedValue).toBe(same.reduce((sum, entry) => sum.plus(entry.acceptedValue), dec("0")).toFixed(2));
      expect(row.counts.SENT).toBe(same.reduce((sum, entry) => sum + entry.counts.SENT, 0));
    }

    const buckets = await reports.expectedCloseReportForWorkspace(group);
    const eachBuckets = await Promise.all(own.map((session) => reports.expectedCloseReport(session)));
    for (const bucket of buckets) {
      const same = eachBuckets.map((company) => company.find((candidate) => candidate.key === bucket.key)?.totals ?? []);
      expect(byCurrency(bucket.totals)).toEqual(summed(same));
    }
    const lost = await reports.lostReasonReportForWorkspace(group, period);
    expect(lost.reduce((sum, row) => sum + row.count, 0)).toBe(
      (await Promise.all(own.map((session) => reports.lostReasonReport(session, period)))).flat().reduce((sum, row) => sum + row.count, 0),
    );
  });

  it("leaves out a company that lets the reader open reports but not the records behind one", async () => {
    // Company C switches Sales off: none of the group's reports include it.
    await switchSalesOff(COMPANY.c);
    const group = await ownerGroup();
    const owners = await reports.ownerReportForWorkspace(group, period);
    for (const row of owners) expect(row.company!.id).not.toBe(COMPANY.c);
    const narrowed = await reports.ownerReportForWorkspace(group, period, COMPANY.tenant);
    expect(narrowed.length).toBe(owners.length);
  });

  it("shows a company workspace its own reports unchanged", async () => {
    const owner = await loginAs("OWNER");
    expect(await reports.pipelineByStageForWorkspace(owner)).toEqual(await reports.pipelineByStage(owner));
    expect(await reports.ownerReportForWorkspace(owner, period)).toEqual(await reports.ownerReport(owner, period));
    expect(await reports.proposalReportForWorkspace(owner, period)).toEqual(await reports.proposalReport(owner, period));
  });
});

describe("the module's sections (§25, §85)", () => {
  it("offers a group reader only the sections the group answers, and a company reader all of theirs", async () => {
    const group = await resolveSalesExperience(await ownerGroup());
    const keys = group.sections.map((section) => section.key);
    expect(keys).toEqual(expect.arrayContaining(["overview", "leads", "opportunities", "pipeline", "reports"]));
    expect(keys).not.toContain("proposals");
    expect(keys).not.toContain("tasks");
    expect(group.readOnly).toBe(true);
    expect(group.canCreate).toBe(false);

    const company = await resolveSalesExperience(await loginAs("OWNER"));
    expect(company.sections.map((section) => section.key)).toEqual(expect.arrayContaining(["proposals", "tasks"]));
  });
});

describe("the API routes (§14, §59, §85)", () => {
  async function get(handler: (request: Request) => Promise<Response>, path: string) {
    const response = await handler(new Request(`http://localhost${path}`));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- these five routes answer with different shapes (a list, a board, an overview); each assertion below names the fields it reads.
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  it("answers the five group reads in the Group workspace, labelled by company", async () => {
    actAs(await ownerGroup());
    const opportunitiesRoute = await import("@/app/api/sales/opportunities/route");
    const leadsRoute = await import("@/app/api/sales/leads/route");
    const overviewRoute = await import("@/app/api/sales/overview/route");
    const pipelineRoute = await import("@/app/api/sales/pipeline/route");
    const reportsRoute = await import("@/app/api/sales/reports/route");

    const opps = await get(opportunitiesRoute.GET, "/api/sales/opportunities?limit=100");
    expect(opps.status).toBe(200);
    expect(opps.body.data.length).toBeGreaterThan(0);
    expect(new Set(opps.body.data.map((row: { company: { id: string } }) => row.company.id)).size).toBeGreaterThanOrEqual(2);

    const onlyB = await get(opportunitiesRoute.GET, `/api/sales/opportunities?limit=100&company=${COMPANY.b}`);
    expect(onlyB.body.data.every((row: { company: { id: string } }) => row.company.id === COMPANY.b)).toBe(true);

    const leadRows = await get(leadsRoute.GET, "/api/sales/leads?limit=100");
    expect(leadRows.status).toBe(200);
    expect(leadRows.body.data.every((row: { company?: unknown }) => Boolean(row.company))).toBe(true);

    const overview = await get(overviewRoute.GET, "/api/sales/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.data.overview.openOpportunities).toBeGreaterThan(0);

    const board = await get(pipelineRoute.GET, "/api/sales/pipeline");
    expect(board.status).toBe(200);
    expect(board.body.data.stages.length).toBeGreaterThan(0);

    for (const report of ["pipeline", "expected-close", "win-loss", "by-owner", "lost-reasons", "lead-conversion", "proposals"]) {
      const result = await get(reportsRoute.GET, `/api/sales/reports?report=${report}`);
      expect(result.status, report).toBe(200);
    }
  });

  it("refuses every write, and every read nobody aggregated, in the Group workspace", async () => {
    actAs(await ownerGroup());
    const opportunitiesRoute = await import("@/app/api/sales/opportunities/route");
    const leadsRoute = await import("@/app/api/sales/leads/route");
    const proposalsRoute = await import("@/app/api/sales/proposals/route");
    const exportRoute = await import("@/app/api/sales/export/route");

    const refused = async (handler: (request: Request) => Promise<Response>, init?: RequestInit) => {
      const response = await handler(new Request("http://localhost/api/sales/x", init));
      return { status: response.status, code: ((await response.json()) as { error: { code: string } }).error.code };
    };
    const body = JSON.stringify({});
    expect(await refused(opportunitiesRoute.POST, { method: "POST", body })).toEqual({ status: 409, code: "WORKSPACE_COMPANY_REQUIRED" });
    expect(await refused(leadsRoute.POST, { method: "POST", body })).toEqual({ status: 409, code: "WORKSPACE_COMPANY_REQUIRED" });
    expect(await refused(proposalsRoute.GET)).toEqual({ status: 409, code: "WORKSPACE_COMPANY_REQUIRED" });
    expect(await refused(exportRoute.GET)).toEqual({ status: 409, code: "WORKSPACE_COMPANY_REQUIRED" });
  });

  it("answers a company workspace as it always did: its own company, unlabelled", async () => {
    actAs(await loginAs("OWNER"));
    const opportunitiesRoute = await import("@/app/api/sales/opportunities/route");
    const result = await get(opportunitiesRoute.GET, "/api/sales/opportunities?limit=100");
    expect(result.status).toBe(200);
    expect(result.body.data.length).toBeGreaterThan(0);
    expect(result.body.data.every((row: { company?: unknown }) => row.company === undefined)).toBe(true);
    const ids = result.body.data.map((row: { id: string }) => row.id);
    const rows = await prisma.opportunity.findMany({ where: { id: { in: ids } }, select: { companyId: true } });
    expect(new Set(rows.map((row) => row.companyId))).toEqual(new Set([COMPANY.a]));

    // The company filter is the group's: a company workspace does not honour it.
    const filtered = await get(opportunitiesRoute.GET, `/api/sales/opportunities?limit=100&company=${COMPANY.b}`);
    expect(filtered.body.data.map((row: { id: string }) => row.id).sort()).toEqual([...ids].sort());
    expect((await companyOf(ids[0])).companyId).toBe(COMPANY.a);
  });
});
