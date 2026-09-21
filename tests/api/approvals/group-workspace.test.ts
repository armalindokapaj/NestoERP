import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { getApprovalCountsForWorkspace, listApprovalsForWorkspace } from "@/lib/modules/approvals/approvals.group";
import type { ApprovalProvider } from "@/lib/modules/approvals/approvals.provider";
import { approvalProviders, createApprovalRegistry } from "@/lib/modules/approvals/approvals.registry";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { getApprovalCounts, listApprovals } from "@/lib/modules/approvals/approvals.service";
import type { ApprovalTab, UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";
import { createExpenseSchema } from "@/lib/modules/finance/expenses/expense.schema";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import { GET as listRoute } from "@/app/api/approvals/route";
import { GET as countsRoute } from "@/app/api/approvals/counts/route";
import { GET as delegationsRoute } from "@/app/api/approvals/delegations/route";
import { POST as approveRoute } from "@/app/api/approvals/[providerKey]/[approvalId]/approve/route";
import { cleanupSessions, COMPANY, loginAs, loginAsEmail, loginAsMembership, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

// Only the cookie half of the context resolver: the context a route works with is still built
// by the real resolver from a real session row (the same stand-in the security suites use).
vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * The Approvals Center in the Group workspace, against the real database
 * (Workspace Context §33, §45, §73; PRD #41 §114, §253).
 *
 * The group's queue is each company's own queue, asked with the person's own
 * context there, then merged. So the checks that matter are that it is
 * exactly the union of what the company workspaces show, that every row names
 * its company, that a company that withholds the module contributes nothing,
 * that the company filter can only narrow, and that paging across companies
 * neither repeats nor skips an item.
 */

const PREFIX = "WSAPTEST";
const COMPANY_NAME: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
const FINANCE_OF = { a: "finance-a@nesto.test", b: "finance-b@nesto.test", c: "finance-c@nesto.test" } as const;
type Where = keyof typeof FINANCE_OF;

const created: string[] = [];
const restore: Array<() => Promise<unknown>> = [];

beforeAll(async () => {
  const rows = await prisma.company.findMany({ where: { id: { in: [COMPANY.a, COMPANY.b, COMPANY.c] } }, select: { id: true, name: true } });
  COMPANY_NAME.a = rows.find((row) => row.id === COMPANY.a)!.name;
  COMPANY_NAME.b = rows.find((row) => row.id === COMPANY.b)!.name;
  COMPANY_NAME.c = rows.find((row) => row.id === COMPANY.c)!.name;
});

afterEach(async () => {
  actAs(null);
  for (const undo of restore.splice(0).reverse()) await undo();
  if (created.length) {
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: created } } });
    await prisma.notification.deleteMany({ where: { entityId: { in: created } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: created } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: created } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: created } } });
    await prisma.financeApproval.deleteMany({ where: { recordId: { in: created } } });
    await prisma.expense.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  }
});

afterAll(async () => {
  actAs(null);
  await cleanupSessions();
  await prisma.$disconnect();
});

/* Fixtures ------------------------------------------------------------------ */

const query = (input: Record<string, unknown> = {}) => approvalQuerySchema.parse({ limit: 100, ...input });

/** An expense that company's accountant raised and submitted: somebody else has to decide it. */
async function submittedExpense(where: Where, netAmount = "1200.00") {
  const finance = await loginAsEmail(FINANCE_OF[where]);
  const project = { a: PROJECT.a, b: PROJECT.b, c: PROJECT.c }[where];
  const expense = await expenses.createExpense(
    finance,
    createExpenseSchema.parse({ projectId: project, expenseDate: "2026-09-01", category: "MATERIALS", description: `${PREFIX} ${where} scaffold hire`, currency: "EUR", netAmount, taxAmount: "0" }),
  );
  created.push(expense.id);
  await expenses.submitExpense(finance, expense.id);
  const approval = await prisma.financeApproval.findFirstOrThrow({ where: { recordId: expense.id, status: "PENDING" } });
  return { expenseId: expense.id, approvalId: approval.id };
}

const ids = (items: UnifiedApprovalItem[]) => items.map((item) => item.approvalId);
const has = (items: UnifiedApprovalItem[], approvalId: string) => items.some((item) => item.approvalId === approvalId);
const companiesOf = (items: UnifiedApprovalItem[]) => [...new Set(items.map((item) => item.company?.id))].sort();

const ownerGroup = () => loginAs("OWNER", { workspace: "GROUP" });

async function switchOff(companyId: string, moduleKey: string) {
  const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId, module: { key: moduleKey } } });
  await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
  restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));
}

/* Group ---------------------------------------------------------------------- */

describe("the group queue (§33, §45)", () => {
  it("merges every company's approvals, each row naming its company, and counts them per company", async () => {
    const [a, b] = [await submittedExpense("a"), await submittedExpense("b")];
    const owner = await ownerGroup();
    expect(owner.workspace.scopeType).toBe("GROUP");

    const result = await listApprovalsForWorkspace(owner, query({ tab: "waiting" }));
    expect(has(result.items, a.approvalId)).toBe(true);
    expect(has(result.items, b.approvalId)).toBe(true);
    const rowA = result.items.find((item) => item.approvalId === a.approvalId)!;
    const rowB = result.items.find((item) => item.approvalId === b.approvalId)!;
    expect(rowA.company).toEqual({ id: COMPANY.a, name: COMPANY_NAME.a });
    expect(rowB.company).toEqual({ id: COMPANY.b, name: COMPANY_NAME.b });
    // Every row is labelled, and no id repeats across companies.
    expect(result.items.every((item) => item.company)).toBe(true);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(result.items.length);
    expect(result.failedProviders).toEqual([]);

    // The header counts are the sum of the companies' own, and the same as the counts endpoint's.
    const counts = result.counts;
    expect(counts.waiting).toBe(result.items.length);
    expect(counts.byCompany?.map((row) => row.company.id)).toEqual(result.companies?.map((company) => company.id));
    expect(counts.byCompany?.reduce((sum, row) => sum + row.waiting, 0)).toBe(counts.waiting);
    expect(counts.byCompany?.reduce((sum, row) => sum + row.overdue, 0)).toBe(counts.overdue);
    expect(counts.byCompany?.reduce((sum, row) => sum + row.critical, 0)).toBe(counts.critical);
    for (const row of counts.byCompany ?? []) expect(row.waiting).toBe(result.items.filter((item) => item.company?.id === row.company.id).length);
    expect(counts.byCompany?.find((row) => row.company.id === COMPANY.a)?.waiting).toBeGreaterThanOrEqual(1);
    expect(counts.byCompany?.find((row) => row.company.id === COMPANY.b)?.waiting).toBeGreaterThanOrEqual(1);
    const endpoint = await getApprovalCountsForWorkspace(owner);
    expect(endpoint).toMatchObject({ waiting: counts.waiting, overdue: counts.overdue, critical: counts.critical, byCompany: counts.byCompany });
  });

  it("is exactly the union of what each company's own workspace shows the same person", async () => {
    await submittedExpense("a");
    await submittedExpense("b");
    const owner = await ownerGroup();
    const contexts = await resolveWorkspaceContexts(owner, { module: "approvals", permission: "approvals.view" });
    expect(contexts.length).toBeGreaterThan(1);

    for (const tab of ["waiting", "requested"] as ApprovalTab[]) {
      const group = await listApprovalsForWorkspace(owner, query({ tab }));
      const union: string[] = [];
      for (const context of contexts) {
        const own = await listApprovals(await loginAsMembership(context.membershipId), query({ tab }));
        union.push(...own.items.map((item) => item.id));
      }
      expect(group.items.map((item) => item.id).sort(), tab).toEqual(union.sort());
    }

    const total = { waiting: 0, overdue: 0, critical: 0 };
    for (const context of contexts) {
      const own = await getApprovalCounts(await loginAsMembership(context.membershipId));
      total.waiting += own.waiting;
      total.overdue += own.overdue;
      total.critical += own.critical;
    }
    expect(await getApprovalCountsForWorkspace(owner)).toMatchObject(total);
  });

  it("orders the merge by the list's own sort and carries the module, search and priority filters through", async () => {
    const { approvalId } = await submittedExpense("b", "33333.00");
    await submittedExpense("a", "44444.00");
    const owner = await ownerGroup();

    const urgency = (await listApprovalsForWorkspace(owner, query({ tab: "waiting" }))).items.map((item) => item.urgency);
    expect(urgency).toEqual([...urgency].sort((x, y) => y - x));

    const amount = (await listApprovalsForWorkspace(owner, query({ tab: "waiting", sort: "amount", provider: "finance" }))).items;
    expect(amount.every((item) => item.providerKey === "finance")).toBe(true);
    const values = amount.map((item) => (item.amount ? Number(item.amount.value) : -1));
    expect(values).toEqual([...values].sort((x, y) => y - x));

    expect(has((await listApprovalsForWorkspace(owner, query({ tab: "waiting", q: `${PREFIX} b scaffold` }))).items, approvalId)).toBe(true);
    expect(has((await listApprovalsForWorkspace(owner, query({ tab: "waiting", q: "nothing-like-this" }))).items, approvalId)).toBe(false);
    expect(has((await listApprovalsForWorkspace(owner, query({ tab: "waiting", provider: "procurement" }))).items, approvalId)).toBe(false);
    // A project belongs to one company, so a project filter reaches only that company's items.
    const byProject = (await listApprovalsForWorkspace(owner, query({ tab: "waiting", projectId: PROJECT.b }))).items;
    expect(has(byProject, approvalId)).toBe(true);
    expect(byProject.every((item) => item.company?.id === COMPANY.b)).toBe(true);
  });

  it("pages across companies with one cursor that neither repeats nor skips an item", async () => {
    await submittedExpense("a");
    await submittedExpense("b");
    await submittedExpense("c");
    const owner = await ownerGroup();

    // History is exact date order, merged page by page; waiting is ordered over each source's window.
    for (const tab of ["history", "waiting"] as ApprovalTab[]) {
      const all = (await listApprovalsForWorkspace(owner, query({ tab, limit: 100 }))).items;
      expect(companiesOf(all).length, tab).toBeGreaterThan(1);
      const paged: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const result = await listApprovalsForWorkspace(owner, query({ tab, limit: 7, cursor }));
        paged.push(...result.items.map((item) => item.id));
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      expect(new Set(paged).size, tab).toBe(paged.length);
      expect(paged, tab).toEqual(all.map((item) => item.id).slice(0, paged.length));
      expect(paged.length, tab).toBeGreaterThanOrEqual(Math.min(all.length, 100 - 7));
    }
  });

  it("reads a company's own history grant, and offers the tab only when some company gives it", async () => {
    await submittedExpense("a");
    const owner = await ownerGroup();
    const result = await listApprovalsForWorkspace(owner, query({ tab: "history" }));
    expect(result.canViewHistory).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    // The group is never a place to decide, delegate or open a review from.
    expect(result.canManageDelegation).toBe(false);
  });

  it("names the company of a source that could not be read, and shows no count for it", async () => {
    await submittedExpense("a");
    const failing: ApprovalProvider = { ...approvalProviders.getProvider("sales"), key: "sales", queue: async () => Promise.reject(new Error("boom")) };
    const registry = createApprovalRegistry([...approvalProviders.all().filter((provider) => provider.key !== "sales"), failing]);
    const owner = await ownerGroup();
    const result = await listApprovalsForWorkspace(owner, query({ tab: "waiting" }), { registry });
    expect(result.failedProviders.length).toBe(result.companies?.length);
    expect(result.failedProviders.every((provider) => provider.key === "sales" && provider.company)).toBe(true);
    expect(result.items.some((item) => item.providerKey === "sales")).toBe(false);
    expect(result.items.length).toBeGreaterThan(0);
  });
});

describe("what a company withholds (§60, §92)", () => {
  it("leaves out a company whose Approvals module is off: no rows, no count, no filter choice", async () => {
    const [a, b] = [await submittedExpense("a"), await submittedExpense("b")];
    await switchOff(COMPANY.b, "approvals");
    const owner = await ownerGroup();
    const result = await listApprovalsForWorkspace(owner, query({ tab: "waiting" }));
    expect(has(result.items, a.approvalId)).toBe(true);
    expect(has(result.items, b.approvalId)).toBe(false);
    expect(result.items.some((item) => item.company?.id === COMPANY.b)).toBe(false);
    expect(result.companies?.map((company) => company.id)).not.toContain(COMPANY.b);
    expect(result.counts.byCompany?.map((row) => row.company.id)).not.toContain(COMPANY.b);
    expect((await getApprovalCountsForWorkspace(owner)).byCompany?.map((row) => row.company.id)).not.toContain(COMPANY.b);
  });

  it("leaves out only the source a company switched off, not the company's other approvals", async () => {
    const b = await submittedExpense("b");
    await switchOff(COMPANY.b, "finance");
    const owner = await ownerGroup();
    const result = await listApprovalsForWorkspace(owner, query({ tab: "waiting" }));
    expect(has(result.items, b.approvalId)).toBe(false);
    expect(result.companies?.map((company) => company.id)).toContain(COMPANY.b);
    expect(result.items.some((item) => item.company?.id === COMPANY.b && item.providerKey === "finance")).toBe(false);
  });
});

describe("the company filter (§86, §87)", () => {
  it("narrows the list to one company, and leaves the header counts as the person's whole queue", async () => {
    const [a, b] = [await submittedExpense("a"), await submittedExpense("b")];
    const owner = await ownerGroup();
    const all = await listApprovalsForWorkspace(owner, query({ tab: "waiting" }));
    const onlyB = await listApprovalsForWorkspace(owner, query({ tab: "waiting", company: COMPANY.b }));
    expect(has(onlyB.items, b.approvalId)).toBe(true);
    expect(has(onlyB.items, a.approvalId)).toBe(false);
    expect(companiesOf(onlyB.items)).toEqual([COMPANY.b]);
    expect(onlyB.counts).toMatchObject({ waiting: all.counts.waiting, byCompany: all.counts.byCompany });
    // Every company still offered as a choice.
    expect(onlyB.companies).toEqual(all.companies);
  });

  it("finds nothing for a company the person may not read, and discloses nothing about it", async () => {
    const b = await submittedExpense("b");
    await switchOff(COMPANY.b, "approvals");
    const owner = await ownerGroup();
    // A company that withholds Approvals, another group's company, and one that does not exist.
    for (const company of [COMPANY.b, COMPANY.tenant, "company_that_does_not_exist"]) {
      const result = await listApprovalsForWorkspace(owner, query({ tab: "waiting", company }));
      expect(result.items, company).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(has(result.items, b.approvalId)).toBe(false);
    }
    // The choices are still only the readable ones.
    const choices = (await listApprovalsForWorkspace(owner, query({ tab: "waiting" }))).companies?.map((company) => company.id) ?? [];
    expect(choices).not.toContain(COMPANY.b);
    expect(choices).not.toContain(COMPANY.tenant);
  });

  it("is ignored in a company workspace, whose company is fixed", async () => {
    const [a, b] = [await submittedExpense("a"), await submittedExpense("b")];
    const ceo = await loginAs("CEO");
    expect(ceo.workspace.scopeType).toBe("COMPANY");
    const result = await listApprovalsForWorkspace(ceo, query({ tab: "waiting", company: COMPANY.b }));
    expect(has(result.items, a.approvalId)).toBe(true);
    expect(has(result.items, b.approvalId)).toBe(false);
  });
});

describe("a company workspace is unchanged, and nobody gains a company by asking (§61, §62)", () => {
  it("answers a company session with that company's queue alone, with no company labels", async () => {
    const [a, b] = [await submittedExpense("a"), await submittedExpense("b")];
    for (const person of [await loginAs("CEO"), await loginAs("OWNER")]) {
      expect(person.workspace.scopeType).toBe("COMPANY");
      const result = await listApprovalsForWorkspace(person, query({ tab: "waiting" }));
      expect(has(result.items, a.approvalId)).toBe(person.companyId === COMPANY.a);
      expect(has(result.items, b.approvalId)).toBe(false);
      expect(result.items.every((item) => item.company === undefined)).toBe(true);
      expect(result.companies).toBeUndefined();
      expect(result.counts.byCompany).toBeUndefined();
      expect(await listApprovalsForWorkspace(person, query({ tab: "waiting" })).then((row) => ids(row.items))).toEqual(ids((await listApprovals(person, query({ tab: "waiting" }))).items));
    }
  });

  it("gives a company-only employee their own company however the session was asked (§16, §91)", async () => {
    const b = await submittedExpense("b");
    const pm = await loginAs("PROJECT_MANAGER", { workspace: "GROUP" });
    expect(pm.workspace.scopeType).toBe("COMPANY");
    const result = await listApprovalsForWorkspace(pm, query({ tab: "waiting" }));
    expect(has(result.items, b.approvalId)).toBe(false);
    expect(result.companies).toBeUndefined();
  });

  it("gives a multi-company person the companies they work in, and no other (§7, §60, §62)", async () => {
    // Working in two companies opens the group; Meridian is not one of them.
    const b = await submittedExpense("b");
    const architect = await loginAsEmail("multicompany@nesto.test", { workspace: "GROUP" });
    expect(architect.workspace.scopeType).toBe("GROUP");
    const result = await listApprovalsForWorkspace(architect, query({ tab: "waiting" }));
    expect(has(result.items, b.approvalId)).toBe(false);
    for (const item of result.items) expect([COMPANY.a, COMPANY.d]).toContain(item.company?.id);
  });
});

describe("the routes (§85, §105)", () => {
  it("answers the list and the counts in the group, and refuses to decide or delegate there", async () => {
    const a = await submittedExpense("a");
    const owner = await ownerGroup();
    actAs(owner);

    const list = await listRoute(new Request(`http://localhost/api/approvals?tab=waiting&limit=100`));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: { items: UnifiedApprovalItem[]; companies: Array<{ id: string }> } };
    expect(has(body.data.items, a.approvalId)).toBe(true);
    expect(body.data.items.every((item) => item.company)).toBe(true);
    expect(body.data.companies.length).toBeGreaterThan(1);

    const narrowed = await listRoute(new Request(`http://localhost/api/approvals?tab=waiting&limit=100&company=${COMPANY.b}`));
    const narrowedBody = (await narrowed.json()) as { data: { items: UnifiedApprovalItem[] } };
    expect(narrowed.status).toBe(200);
    expect(has(narrowedBody.data.items, a.approvalId)).toBe(false);

    const counts = await countsRoute();
    expect(counts.status).toBe(200);
    const countsBody = (await counts.json()) as { data: { waiting: number; byCompany: Array<{ waiting: number }> } };
    expect(countsBody.data.byCompany.reduce((sum, row) => sum + row.waiting, 0)).toBe(countsBody.data.waiting);

    // Deciding and delegating are one company's affairs: the group answers "choose a company".
    const decide = await approveRoute(
      new Request(`http://localhost/api/approvals/finance/${a.approvalId}/approve`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ providerKey: "finance", approvalId: a.approvalId }) },
    );
    expect(decide.status).toBe(409);
    expect(((await decide.json()) as { error: { code: string } }).error.code).toBe("WORKSPACE_COMPANY_REQUIRED");
    expect((await prisma.financeApproval.findUniqueOrThrow({ where: { id: a.approvalId } })).status).toBe("PENDING");
    expect((await delegationsRoute()).status).toBe(409);
  });

  it("answers the same routes in a company workspace with that company alone", async () => {
    const [a, b] = [await submittedExpense("a"), await submittedExpense("b")];
    actAs(await loginAs("CEO"));
    const list = await listRoute(new Request(`http://localhost/api/approvals?tab=waiting&limit=100&company=${COMPANY.b}`));
    const body = (await list.json()) as { data: { items: UnifiedApprovalItem[]; companies?: unknown } };
    expect(list.status).toBe(200);
    expect(has(body.data.items, a.approvalId)).toBe(true);
    expect(has(body.data.items, b.approvalId)).toBe(false);
    expect(body.data.companies).toBeUndefined();
  });
});
