import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * AUD-07 §5, PS-05: page rows 10 → 50 add no statement per row.
 *
 * The real list services every list page calls, at a fixed Company scope (and
 * the Group union where the page has one), read with a page of 10 and a page of
 * 50. Counted by the application's own opt-in statement counter
 * (`NESTO_PERF_SQL_COUNT=1`, lib/core/observability/statement-counter.ts): the
 * exact SQL statements each read sent, in its own request scope — not the
 * transaction-commit proxy. Both reads must send the same statements and the
 * same Prisma calls; the 50-row read must really return 50 rows, so the
 * comparison is not two empty pages.
 *
 * The fixture (tests/api/perf/aud07-fixture.ts) adds sixty deterministic records per
 * family to Aurelia (company_demo_a) under the `aud07k` prefix and removes them
 * afterwards; no seeded row is changed.
 */

process.env.NESTO_PERF_SQL_COUNT = "1";
// A client another test file left on globalThis would bypass the counter.
(globalThis as unknown as { prisma?: unknown }).prisma = undefined;

const PREFIX = "aud07k";
const COMPANY = "company_demo_a";
const ROWS = 60;

type Counter = typeof import("@/lib/core/observability/statement-counter");
type Scope = typeof import("@/lib/core/observability/request-scope");
type Helpers = typeof import("../../helpers");
type Fixture = typeof import("@/tests/api/perf/aud07-fixture");

let counter: Counter;
let scope: Scope;
let helpers: Helpers;
let fixture: Fixture;
let db: PrismaClient;

type Read = { name: string; group?: boolean; read: (limit: number) => Promise<unknown>; rows: (result: unknown) => number };
const reads: Read[] = [];

const dataRows = (result: unknown) => ((result as { data: unknown[] }).data ?? []).length;
const itemRows = (result: unknown) => ((result as { items: unknown[] }).items ?? []).length;

beforeAll(async () => {
  counter = await import("@/lib/core/observability/statement-counter");
  scope = await import("@/lib/core/observability/request-scope");
  helpers = await import("../../helpers");
  fixture = await import("@/tests/api/perf/aud07-fixture");
  db = helpers.prisma;

  const owner = await db.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "owner@nesto.test" } }, select: { id: true, userId: true } });
  const submitter = await db.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, status: "ACTIVE", id: { not: owner.id }, user: { email: "finance@nesto.test" } }, select: { id: true } });
  await fixture.removeOperationalFixture(db, PREFIX);
  await fixture.buildOperationalFixture(db, {
    prefix: PREFIX,
    companyId: COMPANY,
    createdByUserId: owner.userId,
    creatorMemberId: owner.id,
    submitterMemberId: submitter.id,
    counts: { projects: ROWS, clients: ROWS, tasks: ROWS, invoices: ROWS, expenses: ROWS, approvals: ROWS, documents: ROWS, dailyLogs: ROWS, units: 0 },
  });

  const company = await helpers.loginAs("OWNER");
  const group = await helpers.loginAs("OWNER", { workspace: "GROUP" });
  const tasks = await import("@/lib/modules/tasks/task.workspace");
  const taskSchema = await import("@/lib/modules/tasks/task.schema");
  const projects = await import("@/lib/modules/projects/project.service");
  const projectSchema = await import("@/lib/modules/projects/project.schema");
  const clients = await import("@/lib/modules/clients/client.service");
  const clientSchema = await import("@/lib/modules/clients/client.schema");
  const invoices = await import("@/lib/modules/finance/invoices/invoice.service");
  const invoiceSchema = await import("@/lib/modules/finance/invoices/invoice.schema");
  const expenses = await import("@/lib/modules/finance/expenses/expense.service");
  const expenseSchema = await import("@/lib/modules/finance/expenses/expense.schema");
  const documents = await import("@/lib/modules/documents/document.workspace");
  const documentSchema = await import("@/lib/modules/documents/document.schema");
  const approvals = await import("@/lib/modules/approvals/approvals.group");
  const approvalSchema = await import("@/lib/modules/approvals/approvals.schema");
  const dailyLogs = await import("@/lib/modules/daily-logs/daily-log.service");
  const dailyLogSchema = await import("@/lib/modules/daily-logs/daily-log.schema");

  reads.push(
    { name: "tasks", read: (limit) => tasks.listTasksForWorkspace(company, taskSchema.taskListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "projects", read: (limit) => projects.listProjects(company, projectSchema.projectListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "clients", read: (limit) => clients.listClients(company, clientSchema.clientListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "invoices", read: (limit) => invoices.listInvoicesForWorkspace(company, invoiceSchema.invoiceListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "expenses", read: (limit) => expenses.listExpensesForWorkspace(company, expenseSchema.expenseListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "documents", read: (limit) => documents.listDocumentsForWorkspace(company, documentSchema.documentListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "approvals (Center, waiting)", read: (limit) => approvals.listApprovalsForWorkspace(company, approvalSchema.approvalQuerySchema.parse({ tab: "waiting", limit })), rows: itemRows },
    { name: "daily logs", read: (limit) => dailyLogs.listDailyLogs(company, dailyLogSchema.listQuerySchema.parse({ pageSize: limit })), rows: itemRows },
    // The Group union: its per-company work is bounded by the companies, never by the rows (§5).
    { name: "group tasks", group: true, read: (limit) => tasks.listTasksForWorkspace(group, taskSchema.taskListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "group invoices", group: true, read: (limit) => invoices.listInvoicesForWorkspace(group, invoiceSchema.invoiceListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "group expenses", group: true, read: (limit) => expenses.listExpensesForWorkspace(group, expenseSchema.expenseListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "group documents", group: true, read: (limit) => documents.listDocumentsForWorkspace(group, documentSchema.documentListQuerySchema.parse({ limit })), rows: dataRows },
    { name: "group approvals (Center, waiting)", group: true, read: (limit) => approvals.listApprovalsForWorkspace(group, approvalSchema.approvalQuerySchema.parse({ tab: "waiting", limit })), rows: itemRows },
  );
}, 120_000);

afterAll(async () => {
  await fixture?.removeOperationalFixture(db, PREFIX);
  await helpers?.cleanupSessions();
  const app = (globalThis as unknown as { prisma?: PrismaClient }).prisma;
  await app?.$disconnect();
  await db?.$disconnect();
});

async function measure(read: Read, limit: number) {
  const run = <R>(fn: () => Promise<R>) => scope.runWithRequestScope(fn);
  // One unmeasured read first: module-level caches warm on the first call, not per row.
  await counter.measureStatements(run, () => read.read(limit));
  return counter.measureStatements(run, () => read.read(limit));
}

describe("AUD-07 PS-05: rows 10 → 50 add no statement per row", () => {
  it("the counter is on and counts exact statements", async () => {
    expect(counter.statementCountingEnabled()).toBe(true);
    const probe = await measure(reads[0]!, 10);
    expect(probe.operations).toBeGreaterThan(0);
    expect(probe.statements).toBeGreaterThan(0);
    // Nothing else ran: every statement the process sent was credited to this read.
    expect(probe.processStatements).toBe(probe.statements);
    expect(probe.ambiguous).toBe(0);
  });

  it.each([
    "tasks",
    "projects",
    "clients",
    "invoices",
    "expenses",
    "documents",
    "approvals (Center, waiting)",
    "daily logs",
    "group tasks",
    "group invoices",
    "group expenses",
    "group documents",
    "group approvals (Center, waiting)",
  ])("%s", async (name) => {
    const read = reads.find((candidate) => candidate.name === name)!;
    const ten = await measure(read, 10);
    const fifty = await measure(read, 50);
    const evidence = { name, ten: { statements: ten.statements, operations: ten.operations, rows: read.rows(ten.result), byModel: ten.byModel }, fifty: { statements: fifty.statements, operations: fifty.operations, rows: read.rows(fifty.result), byModel: fifty.byModel } };
    console.log(`[aud07 PS-05] ${JSON.stringify(evidence)}`);

    // The comparison means something only when the pages hold 10 and 50 rows.
    expect(read.rows(ten.result), `${name}: rows on a page of 10`).toBe(10);
    expect(read.rows(fifty.result), `${name}: rows on a page of 50`).toBe(50);
    expect(ten.processStatements, `${name}: nothing else ran`).toBe(ten.statements);
    expect(fifty.processStatements, `${name}: nothing else ran`).toBe(fifty.statements);
    // No statement, and no Prisma call, per row. Prisma skips a relation's read when no row on the
    // page references it, so a page can cost one statement less, never one more (daily logs: 12 → 11).
    expect(fifty.statements, `${name}: statements for 50 rows vs 10`).toBeLessThanOrEqual(ten.statements);
    expect(ten.statements - fifty.statements, `${name}: only a skipped relation read may differ`).toBeLessThanOrEqual(2);
    expect(fifty.operations, `${name}: Prisma calls for 50 rows vs 10`).toBe(ten.operations);
  });
});
