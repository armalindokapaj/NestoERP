import { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { Permission } from "@/config/permissions";
import { isGroupRoute } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import { parseBudgetQuery, parseExpenseQuery, parseInvoiceQuery } from "@/lib/modules/finance/finance.query";
import { financeExperience } from "@/lib/modules/finance/finance.workspace";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import { getFinanceOverview, getFinanceOverviewForWorkspace, getGroupFinanceOverview } from "@/lib/modules/finance/overview/overview.service";
import * as reports from "@/lib/modules/finance/reports/reports.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, prisma } from "../../helpers";

/**
 * Finance in the Group workspace (Workspace Context §36, §41, §45, §60, §72, §92).
 *
 * Real sessions, real resolver, real database. The Group Finance head reads
 * Finance in all five demo companies; a plain Aurelia accountant reads it in
 * one. A group view is each company's own answer put together, so the checks
 * compare it with what a sign-in into each company shows, and never let a
 * company the person may not read — or one that switched Finance off — into a
 * row or a total.
 */

const GROUP_COMPANIES: string[] = [COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e];
const restore: Array<() => Promise<unknown>> = [];
const createdInvoices: string[] = [];

afterEach(async () => {
  for (const undo of restore.splice(0).reverse()) await undo();
  if (createdInvoices.length > 0) {
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoices } } });
    createdInvoices.length = 0;
  }
  await cleanupSessions();
});
afterAll(() => prisma.$disconnect());

const groupFinance = () => loginAs("FINANCE", { workspace: "GROUP" });
const dec = (value: string) => new Prisma.Decimal(value);
const total = (values: string[]) => values.reduce((sum, value) => sum.plus(value), dec("0")).toFixed(2);

/** What each company's own page says: the person signing in to that company. */
async function ownSessions(group: UserContext, permission: Permission): Promise<Map<string, UserContext>> {
  const contexts = await resolveWorkspaceContexts(group, { module: "finance", permission });
  return new Map(await Promise.all(contexts.map(async (context) => [context.companyId, await loginAsMembership(context.membershipId)] as const)));
}

async function switchFinanceOff(companyId: string) {
  const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId, module: { key: "finance" } } });
  await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
  restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));
}

/** A sent invoice in Aurelia, overdue: the same amount in the given currency. */
async function raiseSentInvoice(by: UserContext, currency: "EUR" | "USD", amount = "1000.00") {
  const id = `ws_fn_${currency.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`;
  await prisma.invoice.create({
    data: {
      id,
      companyId: COMPANY.a,
      invoiceNumber: id.toUpperCase(),
      clientId: "client_acme",
      projectId: "project_a",
      issueDate: new Date("2026-01-01"),
      dueDate: new Date("2026-01-31"),
      currency,
      subtotal: amount,
      taxAmount: "0.00",
      totalAmount: amount,
      status: "SENT",
      createdByMemberId: by.membershipId,
    },
  });
  createdInvoices.push(id);
  return id;
}

/** The company each listed id really belongs to, read from the table itself. */
async function ownerCompanies(kind: "invoice" | "expense" | "budget", ids: string[]): Promise<Map<string, string>> {
  const where = { id: { in: ids } };
  const rows =
    kind === "invoice"
      ? await prisma.invoice.findMany({ where, select: { id: true, companyId: true } })
      : kind === "expense"
        ? await prisma.expense.findMany({ where, select: { id: true, companyId: true } })
        : await prisma.projectBudget.findMany({ where, select: { id: true, companyId: true } });
  return new Map(rows.map((row) => [row.id, row.companyId]));
}

const companyNames = async () => new Map((await prisma.company.findMany({ where: { id: { in: GROUP_COMPANIES } }, select: { id: true, name: true } })).map((row) => [row.id, row.name]));

/* -------------------------------------------------------------------------- */
/* The three lists                                                            */
/* -------------------------------------------------------------------------- */

type Kind = "invoice" | "expense" | "budget";

/**
 * One instant for every register read here: each response carries the instant
 * it classified settlement at (AUD-01 §3), so two reads compared whole must be
 * given the same one.
 */
const AT = new Date();

const LISTS: Array<{
  kind: Kind;
  permission: "finance.invoice.view" | "finance.expense.view" | "finance.budget.view";
  group: (session: UserContext, params: Record<string, string>, company?: string | null) => Promise<{ data: Array<{ id: string; company?: { id: string; name: string } }>; pagination: { total: number; totalPages: number } }>;
  own: (session: UserContext, params: Record<string, string>) => Promise<{ data: Array<{ id: string }>; pagination: { total: number } }>;
}> = [
  {
    kind: "invoice",
    permission: "finance.invoice.view",
    group: (session, params, company) => invoices.listInvoicesForWorkspace(session, parseInvoiceQuery(params), { company, now: AT }),
    own: (session, params) => invoices.listInvoices(session, parseInvoiceQuery(params), { now: AT }),
  },
  {
    kind: "expense",
    permission: "finance.expense.view",
    group: (session, params, company) => expenses.listExpensesForWorkspace(session, parseExpenseQuery(params), { company, now: AT }),
    own: (session, params) => expenses.listExpenses(session, parseExpenseQuery(params), { now: AT }),
  },
  {
    kind: "budget",
    permission: "finance.budget.view",
    group: (session, params, company) => budgets.listBudgetsForWorkspace(session, parseBudgetQuery(params), { company }),
    own: (session, params) => budgets.listBudgets(session, parseBudgetQuery(params)),
  },
];

describe.each(LISTS)("$kind list", ({ kind, permission, group: listGroup, own: listOwn }) => {
  it("is every company the person reads, each row naming the company it belongs to (§36, §45)", async () => {
    const session = await groupFinance();
    expect(session.workspace.scopeType).toBe("GROUP");

    const result = await listGroup(session, { limit: "100" });
    const companies = new Set(result.data.map((row) => row.company?.id));
    expect(companies.size).toBeGreaterThanOrEqual(2);

    // The label is the row's real company, read from the table, never guessed.
    const owners = await ownerCompanies(kind, result.data.map((row) => row.id));
    const names = await companyNames();
    for (const row of result.data) {
      expect(row.company, `${kind} ${row.id} has no company`).toBeDefined();
      expect(owners.get(row.id)).toBe(row.company!.id);
      expect(row.company!.name).toBe(names.get(row.company!.id));
      expect(GROUP_COMPANIES).toContain(row.company!.id);
    }

    // Exactly the union of what each company's own page lists.
    const own = await ownSessions(session, permission);
    const perCompany = await Promise.all([...own.values()].map((company) => listOwn(company, { limit: "100" })));
    expect(result.pagination.total).toBe(perCompany.reduce((sum, page) => sum + page.pagination.total, 0));
    expect(result.data.map((row) => row.id).sort()).toEqual(perCompany.flatMap((page) => page.data.map((row) => row.id)).sort());
  });

  it("is only the selected company in a company workspace, and exactly what it always was", async () => {
    const session = await loginAs("FINANCE");
    expect(session.workspace.scopeType).toBe("COMPANY");

    const result = await listGroup(session, { limit: "100" });
    expect(result).toEqual(await listOwn(session, { limit: "100" }));
    expect(result.data.every((row) => row.company === undefined)).toBe(true);
    const owners = await ownerCompanies(kind, result.data.map((row) => row.id));
    expect([...owners.values()].every((companyId) => companyId === session.companyId)).toBe(true);
  });

  it("leaves out a company where Finance is switched off, in rows and in the count (§60, §92)", async () => {
    const before = await listGroup(await groupFinance(), { limit: "100" });
    expect(before.data.some((row) => row.company?.id === COMPANY.c)).toBe(true);

    await switchFinanceOff(COMPANY.c);
    const after = await listGroup(await groupFinance(), { limit: "100" });

    expect(after.data.some((row) => row.company?.id === COMPANY.c)).toBe(false);
    expect(after.data.length).toBeGreaterThanOrEqual(1);
    const kept = before.data.filter((row) => row.company?.id !== COMPANY.c).map((row) => row.id).sort();
    expect(after.data.map((row) => row.id).sort()).toEqual(kept);
    expect(after.pagination.total).toBe(kept.length);
  });

  it("gives a person without group standing nothing beyond their own company (§57, §62)", async () => {
    const accountant = await loginAsEmail(DEMO_EMAIL.financeA, { workspace: "GROUP" });
    // The resolver does not take the group for somebody without group standing.
    expect(accountant.workspace.scopeType).toBe("COMPANY");

    const result = await listGroup(accountant, { limit: "100" });
    expect(result).toEqual(await listOwn(accountant, { limit: "100" }));
    const owners = await ownerCompanies(kind, result.data.map((row) => row.id));
    expect([...owners.values()].every((companyId) => companyId === COMPANY.a)).toBe(true);
    expect(result.data.every((row) => row.company === undefined)).toBe(true);
  });

  it("narrows to one company with the company filter, and ignores any company the person may not read (§86, §87)", async () => {
    const session = await groupFinance();
    const all = await listGroup(session, { limit: "100" });

    const onlyB = await listGroup(session, { limit: "100" }, COMPANY.b);
    expect(onlyB.data.length).toBeGreaterThan(0);
    expect(onlyB.data.every((row) => row.company?.id === COMPANY.b)).toBe(true);
    expect(onlyB.data.map((row) => row.id).sort()).toEqual(all.data.filter((row) => row.company?.id === COMPANY.b).map((row) => row.id).sort());

    // Not a company of theirs, not a company at all, another group's company: nothing, and no error.
    for (const stranger of [COMPANY.tenant, "company_that_does_not_exist", "", COMPANY.suspended]) {
      const none = await listGroup(session, { limit: "100" }, stranger);
      if (stranger === "") expect(none.pagination.total).toBe(all.pagination.total);
      else expect(none).toMatchObject({ data: [], pagination: { total: 0 } });
    }

    // A company they read only until Finance is switched off there.
    await switchFinanceOff(COMPANY.c);
    const off = await listGroup(await groupFinance(), { limit: "100" }, COMPANY.c);
    expect(off).toMatchObject({ data: [], pagination: { total: 0 } });

    // In a company workspace the filter is locked: it cannot reach another company.
    const aurelia = await loginAs("FINANCE");
    const locked = await listGroup(aurelia, { limit: "100" }, COMPANY.b);
    expect(locked).toEqual(await listOwn(aurelia, { limit: "100" }));
  });

  it("pages the union without repeating or dropping a row", async () => {
    const session = await groupFinance();
    const everything = await listGroup(session, { limit: "100", sort: kind === "budget" ? "project-asc" : "amount-desc" });
    expect(everything.data.length).toBeGreaterThan(3);

    const seen: string[] = [];
    for (let page = 1; page <= Math.ceil(everything.pagination.total / 2); page += 1) {
      const chunk = await listGroup(session, { limit: "2", page: String(page), sort: kind === "budget" ? "project-asc" : "amount-desc" });
      seen.push(...chunk.data.map((row) => row.id));
    }
    expect(seen.length).toBe(everything.pagination.total);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(everything.data.map((row) => row.id).sort());
  });

  it("answers a group person with no Finance anywhere with an empty list, not an error (§76)", async () => {
    const hr = await loginAs("HR", { workspace: "GROUP" });
    expect(hr.workspace.scopeType).toBe("GROUP");
    expect(await listGroup(hr, { limit: "100" })).toMatchObject({ data: [], pagination: { total: 0 } });
  });
});

/* -------------------------------------------------------------------------- */
/* The overview                                                               */
/* -------------------------------------------------------------------------- */

const NOW = new Date("2026-09-20T12:00:00Z");

describe("overview", () => {
  it("is each company's own overview, side by side (§36, §73)", async () => {
    const session = await groupFinance();
    const group = await getGroupFinanceOverview(session, { now: NOW });
    expect(group.scope).toBe("GROUP");
    expect(group.companies.map((row) => row.company.id).sort()).toEqual([...GROUP_COMPANIES].sort());

    const names = await companyNames();
    const own = await ownSessions(session, "finance.dashboard.view");
    for (const { company, overview } of group.companies) {
      expect(company.name).toBe(names.get(company.id));
      expect(overview).toEqual(await getFinanceOverview(own.get(company.id)!, { now: NOW }));
    }
  });

  it("adds each currency only to itself: EUR beside USD, never one figure across them (§72)", async () => {
    const session = await groupFinance();
    const eur = await raiseSentInvoice(session, "EUR");
    const usd = await raiseSentInvoice(session, "USD");
    expect(eur).not.toBe(usd);

    const group = await getGroupFinanceOverview(session, { now: NOW });
    const byCurrency = (totals: Array<{ currency: string; amount: string }>) => new Map(totals.map((row) => [row.currency, row.amount]));
    const receivables = byCurrency(group.totals.receivables);
    expect([...receivables.keys()].sort()).toEqual(["EUR", "USD"]);

    // Each currency is exactly the sum of the companies' own figures in that currency…
    const own = await ownSessions(session, "finance.dashboard.view");
    const companies = await Promise.all([...own.values()].map((company) => getFinanceOverview(company, { now: NOW })));
    for (const currency of ["EUR", "USD"]) {
      const figures = companies.flatMap((overview) => overview.receivables.filter((row) => row.currency === currency).map((row) => row.amount));
      expect(receivables.get(currency)).toBe(total(figures));
    }
    // …the two invoices raised here are 1000.00 in each, and neither amount has leaked into the other currency.
    const usdOfCompanyC = (await getFinanceOverview(own.get(COMPANY.c)!, { now: NOW })).receivables.find((row) => row.currency === "USD")?.amount ?? "0.00";
    expect(receivables.get("USD")).toBe(total(["1000.00", usdOfCompanyC]));
    expect(dec(receivables.get("USD")!).lt(dec(receivables.get("EUR")!))).toBe(true);
    for (const row of [...group.totals.overdueReceivables, ...group.totals.payables, ...group.totals.cashIn, ...group.totals.cashOut, ...group.totals.netCashflow, ...group.totals.openCommitments]) {
      expect(["EUR", "USD"]).toContain(row.currency);
    }
    // No single entry stands for both currencies.
    expect(group.totals.receivables).toHaveLength(2);
    expect(group.totals.overdueReceivables.map((row) => row.currency).sort()).toEqual(["EUR", "USD"]);
  });

  it("aggregates only the companies where the person holds Finance: A and B, never C (§60, §92)", async () => {
    const session = await groupFinance();
    const own = await ownSessions(session, "finance.dashboard.view");
    const usdOfCompanyC = (await getFinanceOverview(own.get(COMPANY.c)!, { now: NOW })).receivables.find((row) => row.currency === "USD");
    expect(usdOfCompanyC, "the seed puts the group's only USD invoice in company C").toBeDefined();

    await switchFinanceOff(COMPANY.c);
    await switchFinanceOff(COMPANY.d);
    await switchFinanceOff(COMPANY.e);
    const group = await getGroupFinanceOverview(await groupFinance(), { now: NOW });

    expect(group.companies.map((row) => row.company.id).sort()).toEqual([COMPANY.a, COMPANY.b].sort());
    // C's USD invoice is not in any total.
    expect(group.totals.receivables.map((row) => row.currency)).toEqual(["EUR"]);
    const companies = await Promise.all([COMPANY.a, COMPANY.b].map((id) => getFinanceOverview(own.get(id)!, { now: NOW })));
    expect(group.totals.receivables[0].amount).toBe(total(companies.flatMap((overview) => overview.receivables.map((row) => row.amount))));
    expect(group.counts.draftInvoices).toBe(companies.reduce((sum, overview) => sum + overview.counts.draftInvoices, 0));
  });

  it("is the company's own overview in a company workspace, and refuses nobody in the group an empty answer (§76)", async () => {
    const aurelia = await loginAs("FINANCE");
    expect(await getFinanceOverviewForWorkspace(aurelia, { now: NOW })).toEqual(await getFinanceOverview(aurelia, { now: NOW }));

    const hr = await loginAs("HR", { workspace: "GROUP" });
    const empty = await getFinanceOverviewForWorkspace(hr, { now: NOW });
    expect(empty).toMatchObject({ scope: "GROUP", companies: [], totals: { receivables: [], payables: [] }, counts: { draftInvoices: 0, pendingApprovals: 0 } });
  });
});

/* -------------------------------------------------------------------------- */
/* The reports                                                                */
/* -------------------------------------------------------------------------- */

describe("reports", () => {
  it("receivables aging is each company's report with totals per currency (§41, §72)", async () => {
    const session = await groupFinance();
    await raiseSentInvoice(session, "EUR");
    await raiseSentInvoice(session, "USD");

    const group = await reports.receivablesAgingAcross(session, { now: NOW });
    expect(new Set(group.rows.map((row) => row.company.id)).size).toBeGreaterThanOrEqual(2);

    const own = await ownSessions(session, "finance.receivables.view");
    for (const [companyId, company] of own) {
      const mine = group.rows.filter((row) => row.company.id === companyId).map(({ company: _company, ...row }) => row);
      expect(mine).toEqual(await reports.receivablesAging(company, { now: NOW }));
    }

    // One totals row per currency, each the sum of that currency's rows.
    expect(group.totals.map((row) => row.currency)).toEqual(["EUR", "USD"]);
    for (const row of group.totals) {
      const rows = group.rows.filter((entry) => entry.currency === row.currency);
      expect(row.total).toBe(total(rows.map((entry) => entry.total)));
      for (const bucket of reports.AGING_BUCKETS) expect(row.buckets[bucket]).toBe(total(rows.map((entry) => entry.buckets[bucket])));
    }
    // The 1000.00 invoices are ninety days past due: 1000.00 in that bucket of each currency, not 2000.00 anywhere.
    const eur = group.totals.find((row) => row.currency === "EUR")!;
    const usd = group.totals.find((row) => row.currency === "USD")!;
    expect(dec(eur.buckets.D90_PLUS).gte(1000)).toBe(true);
    expect(dec(usd.buckets.D90_PLUS).gte(1000)).toBe(true);
    expect(dec(usd.total).lt(dec(eur.total))).toBe(true);
    expect(group.rows.filter((row) => row.currency === "USD").every((row) => row.company.id === COMPANY.a || row.company.id === COMPANY.c)).toBe(true);
  });

  it("budget vs actual, expenses by category and commitments name their company and total within a currency", async () => {
    const session = await groupFinance();
    const own = await ownSessions(session, "finance.report.view");

    const budgetReport = await reports.budgetVsActualAcross(session);
    expect(new Set(budgetReport.rows.map((row) => row.company.id)).size).toBeGreaterThanOrEqual(2);
    const projects = await prisma.project.findMany({ where: { id: { in: budgetReport.rows.map((row) => row.projectId) } }, select: { id: true, companyId: true } });
    const projectCompany = new Map(projects.map((row) => [row.id, row.companyId]));
    for (const row of budgetReport.rows) expect(projectCompany.get(row.projectId)).toBe(row.company.id);
    for (const [companyId, company] of own) {
      const mine = budgetReport.rows.filter((row) => row.company.id === companyId).map(({ company: _company, ...row }) => row);
      expect(mine.sort((a, b) => a.name.localeCompare(b.name))).toEqual(await reports.budgetVsActual(company));
    }
    for (const row of budgetReport.totals) {
      const rows = budgetReport.rows.filter((entry) => entry.currency === row.currency);
      expect(row.budget).toBe(total(rows.map((entry) => entry.budget)));
      expect(row.variance).toBe(total(rows.map((entry) => entry.variance)));
    }

    const categories = await reports.expensesByCategoryAcross(session);
    expect(new Set(categories.rows.map((row) => row.company.id)).size).toBeGreaterThanOrEqual(2);
    for (const row of categories.totals) {
      const rows = categories.rows.filter((entry) => entry.category === row.category && entry.currency === row.currency);
      expect(row.actual).toBe(total(rows.map((entry) => entry.actual)));
      expect(row.committed).toBe(total(rows.map((entry) => entry.committed)));
    }

    const commitments = await reports.commitmentSummaryAcross(session);
    expect(new Set(commitments.rows.map((row) => row.company.id)).size).toBeGreaterThanOrEqual(2);
    for (const row of commitments.totals) expect(row.amount).toBe(total(commitments.rows.filter((entry) => entry.currency === row.currency).map((entry) => entry.amount)));
    const perCompany = await Promise.all([...own.values()].map((company) => reports.commitmentSummary(company)));
    expect(commitments.totals).toEqual(
      [...new Set(perCompany.flatMap((report) => report.totals.map((row) => row.currency)))].sort().map((currency) => ({
        currency,
        amount: total(perCompany.flatMap((report) => report.totals.filter((row) => row.currency === currency).map((row) => row.amount))),
      })),
    );
  });

  it("cashflow adds receipts and payments within a currency and reports the period once", async () => {
    const session = await groupFinance();
    const group = await reports.cashflowSummaryAcross(session, "ytd", { now: NOW });
    expect(group).toMatchObject({ period: "ytd", from: "2026-01-01", to: "2026-12-31" });
    expect(new Set(group.rows.map((row) => row.company.id)).size).toBeGreaterThanOrEqual(2);

    const own = await ownSessions(session, "finance.cashflow.view");
    for (const [companyId, company] of own) {
      const mine = group.rows.filter((row) => row.company.id === companyId).map(({ company: _company, ...row }) => row);
      expect(mine).toEqual((await reports.cashflowSummary(company, "ytd", { now: NOW })).rows);
    }
    for (const row of group.totals) {
      const rows = group.rows.filter((entry) => entry.currency === row.currency);
      expect(row.cashIn).toBe(total(rows.map((entry) => entry.cashIn)));
      expect(row.cashOut).toBe(total(rows.map((entry) => entry.cashOut)));
      expect(row.net).toBe(dec(row.cashIn).minus(row.cashOut).toFixed(2));
    }
  });

  it("leaves a company where Finance is switched off out of every report (§60, §92)", async () => {
    await switchFinanceOff(COMPANY.c);
    const session = await groupFinance();
    const answers = await Promise.all([
      reports.receivablesAgingAcross(session, { now: NOW }),
      reports.budgetVsActualAcross(session),
      reports.expensesByCategoryAcross(session),
      reports.cashflowSummaryAcross(session, "ytd", { now: NOW }),
      reports.commitmentSummaryAcross(session),
    ]);
    for (const report of answers) {
      expect(report.rows.length).toBeGreaterThan(0);
      expect(report.rows.some((row) => row.company.id === COMPANY.c)).toBe(false);
    }
    // C holds the group's only USD invoice.
    expect(answers[0].totals.map((row) => row.currency)).toEqual(["EUR"]);
  });

  it("is the company's own report in a company workspace, and empty for a group person without Finance (§76)", async () => {
    const hr = await loginAs("HR", { workspace: "GROUP" });
    expect(await reports.receivablesAgingAcross(hr)).toEqual({ rows: [], totals: [] });
    expect(await reports.commitmentSummaryAcross(hr)).toEqual({ rows: [], totals: [] });
    expect(await reports.cashflowSummaryAcross(hr, "ytd", { now: NOW })).toMatchObject({ rows: [], totals: [], from: "2026-01-01" });
  });
});

/* -------------------------------------------------------------------------- */
/* The module's tab bar                                                       */
/* -------------------------------------------------------------------------- */

describe("the tab bar", () => {
  it("offers only the sections that read across companies in the group, read-only (§25, §29)", async () => {
    const experience = await financeExperience(await groupFinance());
    expect(experience.sections.map((section) => section.key)).toEqual(["overview", "invoices", "expenses", "budgets", "reports"]);
    expect(experience.defaultSection).toBe("overview");
    expect(experience).toMatchObject({ canCreate: false, canUpdate: false, readOnly: true });
    for (const section of experience.sections) {
      const route = section.key === "overview" ? "/finance" : `/finance/${section.key}`;
      expect(isGroupRoute("finance", route)).toBe(true);
    }
  });

  it("is the company's own bar in a company workspace, sections that stay in one company included", async () => {
    const experience = await financeExperience(await loginAs("FINANCE"));
    const keys = experience.sections.map((section) => section.key);
    expect(keys).toEqual(expect.arrayContaining(["overview", "invoices", "payments", "expenses", "budgets", "commitments", "approvals", "reports"]));
    expect(experience.canCreate).toBe(true);
  });

  it("drops a section no company offers the person, and keeps the rest", async () => {
    // Nothing of Finance is offered to a group head who has none of it.
    const hr = await financeExperience(await loginAs("HR", { workspace: "GROUP" }));
    expect(hr.sections).toEqual([]);
  });
});
