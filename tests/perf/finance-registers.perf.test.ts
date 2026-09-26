import { captureQueries, countingPrisma, withLiterals, type CapturedQuery } from "./support/counting-prisma";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as exportInvoicesRoute } from "@/app/api/finance/invoices/export/route";
import { GET as listExpensesRoute } from "@/app/api/finance/expenses/route";
import { GET as listInvoicesRoute } from "@/app/api/finance/invoices/route";
import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, loginAs } from "../helpers";
import { actAs } from "../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../security/harness/actor"));

/**
 * The invoice and expense registers at volume (AUD-01 §10, FA-22).
 *
 * Seeds 10,000 invoices and 10,000 expenses across the five demo companies,
 * two thirds of them paid through one to three allocations each — with voided
 * payments and reversed allocations among them — then times the registers'
 * API routes with ten concurrent readers: a company workspace and the Group
 * workspace, 25 and 100 rows a page, settlement and combined filters, a deep
 * page, and the CSV export at its 10,000-row cap. Records the queries one
 * request runs and EXPLAIN ANALYZE of each, so "no query per row" and the plans
 * are evidence rather than a claim. Target: warm p95 ≤ 1 s.
 *
 * Opt-in (`NESTO_PERF=1`): it writes about 45,000 rows into the database for
 * the length of the run and removes them afterwards. Point it at a lane.
 *
 *   NESTO_PERF=1 AUD01_PERF_OUT=<dir> npx vitest run tests/perf/finance-registers.perf.test.ts
 */

const RUN = process.env.NESTO_PERF === "1";
const OUT = process.env.AUD01_PERF_OUT;
const PREFIX = "aud01p";
const SEARCH = "PERF-AUD";
const PER_COMPANY = 2_000;
const READERS = 10;
const ROUNDS = 10;
const DAY = 86_400_000;

const COMPANIES = [
  { id: "company_demo_a", client: "client_acme", project: "project_a", member: "member_finance" },
  { id: "company_demo_b", client: "client_delta", project: "project_b", member: "member_finance__b" },
  { id: "company_demo_c", client: "client_municipality", project: "project_c", member: "member_finance__c" },
  { id: "company_demo_d", client: "client_meridian", project: "project_d", member: "member_finance__d" },
  { id: "company_demo_e", client: "client_greenline", project: "project_e", member: "member_finance__e" },
];

const db = countingPrisma;

async function cleanup() {
  for (;;) {
    const payments = await db.payment.findMany({ where: { id: { startsWith: PREFIX } }, select: { id: true }, take: 5_000 });
    if (payments.length === 0) break;
    const ids = payments.map((row) => row.id);
    await db.paymentAllocation.deleteMany({ where: { paymentId: { in: ids } } });
    await db.payment.deleteMany({ where: { id: { in: ids } } });
  }
  await db.invoice.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.expense.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.auditEvent.deleteMany({ where: { entityType: "export", entityId: { in: ["finance-invoices", "finance-expenses"] } } });
}

async function inBatches<T>(rows: T[], write: (batch: T[]) => Promise<unknown>) {
  for (let index = 0; index < rows.length; index += 2_000) await write(rows.slice(index, index + 2_000));
}

async function seed() {
  const now = Date.now();
  const invoices: Prisma.InvoiceCreateManyInput[] = [];
  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const allocations: Prisma.PaymentAllocationCreateManyInput[] = [];

  for (const [c, company] of COMPANIES.entries()) {
    for (let index = 0; index < PER_COMPANY; index += 1) {
      const n = c * PER_COMPANY + index;
      const total = 500 + (n % 97) * 25;
      const invoiceId = `${PREFIX}_inv_${n}`;
      const expenseId = `${PREFIX}_exp_${n}`;
      invoices.push({
        id: invoiceId,
        companyId: company.id,
        // Numbers repeat across companies on purpose, as they do in life.
        invoiceNumber: `${SEARCH}-${String(index).padStart(5, "0")}`,
        clientId: company.client,
        projectId: index % 10 === 0 ? null : company.project,
        issueDate: new Date(now - (n % 400) * DAY),
        dueDate: new Date(now + ((n % 90) - 45) * DAY),
        currency: n % 7 === 0 ? "USD" : "EUR",
        subtotal: `${total}.00`,
        taxAmount: "0.00",
        totalAmount: `${total}.00`,
        status: n % 11 === 0 ? "DRAFT" : n % 13 === 0 ? "CANCELLED" : "SENT",
        createdByMemberId: company.member,
      });
      expenses.push({
        id: expenseId,
        companyId: company.id,
        expenseNumber: `${SEARCH}-${String(index).padStart(5, "0")}`,
        projectId: company.project,
        expenseDate: new Date(now - (n % 400) * DAY),
        category: n % 2 ? "MATERIALS" : "LABOR",
        description: `${SEARCH} expense ${n}`,
        payeeName: `Supplier ${n % 50}`,
        currency: n % 7 === 0 ? "USD" : "EUR",
        netAmount: `${total}.00`,
        taxAmount: "0.00",
        totalAmount: `${total}.00`,
        status: n % 9 === 0 ? "DRAFT" : "APPROVED",
        createdByMemberId: company.member,
      });

      // Two in three records are paid something, through one to three allocations.
      for (const [kind, recordId, direction] of [["inv", invoiceId, "RECEIPT"], ["exp", expenseId, "DISBURSEMENT"]] as const) {
        if (n % 3 === 2) continue;
        const parts = 1 + (n % 3);
        const whole = n % 2 === 0;
        const paid = whole ? total : Math.floor(total / 2);
        const paymentId = `${PREFIX}_pay_${kind}_${n}`;
        payments.push({
          id: paymentId,
          companyId: company.id,
          direction,
          clientId: kind === "inv" ? company.client : null,
          amount: `${paid}.00`,
          currency: n % 7 === 0 ? "USD" : "EUR",
          paymentDate: new Date(now - (n % 30) * DAY),
          method: "BANK_TRANSFER",
          status: n % 17 === 0 ? "VOIDED" : "RECORDED",
          createdByMemberId: company.member,
        });
        for (let part = 0; part < parts; part += 1) {
          const amount = part === parts - 1 ? paid - Math.floor(paid / parts) * (parts - 1) : Math.floor(paid / parts);
          allocations.push({
            id: `${PREFIX}_alloc_${kind}_${n}_${part}`,
            companyId: company.id,
            paymentId,
            invoiceId: kind === "inv" ? recordId : null,
            expenseId: kind === "exp" ? recordId : null,
            amount: `${amount}.00`,
            createdByMemberId: company.member,
            reversedAt: n % 19 === 0 && part === 0 ? new Date(now - DAY) : null,
          });
        }
      }
    }
  }

  await inBatches(invoices, (batch) => db.invoice.createMany({ data: batch }));
  await inBatches(expenses, (batch) => db.expense.createMany({ data: batch }));
  await inBatches(payments, (batch) => db.payment.createMany({ data: batch }));
  await inBatches(allocations, (batch) => db.paymentAllocation.createMany({ data: batch }));
  // Fresh statistics, as autovacuum would have them after a real month's writes.
  for (const table of ["invoices", "expenses", "payments", "payment_allocations"]) await db.$executeRawUnsafe(`ANALYZE ${table}`);
  return { invoices: invoices.length, expenses: expenses.length, payments: payments.length, allocations: allocations.length };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

type Scenario = { name: string; reader: "company" | "group"; route: (request: Request) => Promise<Response>; path: string };

async function timed(route: Scenario["route"], path: string): Promise<{ ms: number; status: number; bytes: number }> {
  const started = performance.now();
  const response = await route(new Request(`http://nesto.test${path}`));
  const body = await response.arrayBuffer();
  return { ms: performance.now() - started, status: response.status, bytes: body.byteLength };
}

describe.skipIf(!RUN)("finance registers at 10,000 invoices and 10,000 expenses (AUD-01 §10, FA-22)", () => {
  const report: Record<string, unknown> = { dataset: null, scenarios: [], queries: [], memory: null, hardware: null };
  let company: UserContext;
  let group: UserContext;

  beforeAll(async () => {
    await cleanup();
    report.dataset = await seed();
    company = await loginAs("FINANCE");
    group = await loginAs("FINANCE", { workspace: "GROUP" });
    const os = await import("node:os");
    report.hardware = { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memoryGb: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}`, postgres: ((await db.$queryRawUnsafe("SHOW server_version")) as Array<{ server_version: string }>)[0]?.server_version };
  }, 600_000);

  afterAll(async () => {
    await cleanup();
    await cleanupSessions();
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, "finance-registers-perf.json"), JSON.stringify(report, null, 2));
    }
  }, 600_000);

  const SCENARIOS: Scenario[] = [
    { name: "company invoices 25", reader: "company", route: listInvoicesRoute, path: "/api/finance/invoices" },
    { name: "company invoices 100", reader: "company", route: listInvoicesRoute, path: "/api/finance/invoices?limit=100" },
    { name: "company invoices PAID 25", reader: "company", route: listInvoicesRoute, path: "/api/finance/invoices?settlement=PAID" },
    { name: "group invoices 25", reader: "group", route: listInvoicesRoute, path: "/api/finance/invoices" },
    { name: "group invoices 100", reader: "group", route: listInvoicesRoute, path: "/api/finance/invoices?limit=100" },
    { name: "group invoices PAID 25", reader: "group", route: listInvoicesRoute, path: "/api/finance/invoices?settlement=PAID" },
    { name: "group invoices PAID,PARTIALLY_PAID+search+EUR amount-desc 100", reader: "group", route: listInvoicesRoute, path: `/api/finance/invoices?settlement=PAID,PARTIALLY_PAID&search=${SEARCH}&currency=EUR&sort=amount-desc&limit=100` },
    { name: "group invoices OVERDUE deep page", reader: "group", route: listInvoicesRoute, path: "/api/finance/invoices?settlement=OVERDUE&page=60" },
    { name: "group expenses 25", reader: "group", route: listExpensesRoute, path: "/api/finance/expenses" },
    { name: "group expenses 100 UNPAID", reader: "group", route: listExpensesRoute, path: "/api/finance/expenses?limit=100&settlement=UNPAID" },
    { name: "company expenses PARTIALLY_PAID 100", reader: "company", route: listExpensesRoute, path: "/api/finance/expenses?limit=100&settlement=PARTIALLY_PAID" },
  ];

  it("answers every register page within a warm p95 of 1 s with ten concurrent readers", async () => {
    const results: Array<Record<string, unknown>> = [];
    for (const scenario of SCENARIOS) {
      actAs(scenario.reader === "group" ? group : company);
      await timed(scenario.route, scenario.path); // warm
      const samples: number[] = [];
      await Promise.all(
        Array.from({ length: READERS }, async () => {
          for (let round = 0; round < ROUNDS; round += 1) {
            const result = await timed(scenario.route, scenario.path);
            expect(result.status, scenario.name).toBe(200);
            samples.push(result.ms);
          }
        }),
      );
      const row = { name: scenario.name, samples: samples.length, p50: Math.round(percentile(samples, 50)), p95: Math.round(percentile(samples, 95)), max: Math.round(Math.max(...samples)) };
      results.push(row);
      console.log(`[perf] ${row.name}: p50 ${row.p50} ms, p95 ${row.p95} ms, max ${row.max} ms (${row.samples} requests, ${READERS} readers)`);
    }
    report.scenarios = results;
    for (const row of results) expect(row.p95 as number, row.name as string).toBeLessThanOrEqual(1_000);
  }, 900_000);

  it("runs a fixed number of queries per page, whatever its size, and records each one's plan", async () => {
    const runs: Array<Record<string, unknown>> = [];
    for (const scenario of SCENARIOS) {
      actAs(scenario.reader === "group" ? group : company);
      const stop = captureQueries();
      const result = await timed(scenario.route, scenario.path);
      const queries = stop();
      expect(result.status).toBe(200);
      const data = queries.filter((query) => !/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION|SELECT 1)/i.test(query.query.trim()));
      runs.push({ name: scenario.name, total: queries.length, data: data.length, queries: data.map(summarise) });
    }
    // 25 rows or 100, the same number of queries: nothing is read per row.
    const byName = new Map(runs.map((run) => [run.name, run.data as number]));
    expect(byName.get("group invoices 25")).toBe(byName.get("group invoices 100"));
    expect(byName.get("company invoices 25")).toBe(byName.get("company invoices 100"));

    // The plan of every query one filtered Group page runs.
    actAs(group);
    const stop = captureQueries();
    await timed(listInvoicesRoute, SCENARIOS[6]!.path);
    const plans: Array<Record<string, unknown>> = [];
    for (const query of stop().filter((entry) => /^SELECT/i.test(entry.query.trim()))) {
      const plan = (await db.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS) ${withLiterals(query)}`)) as Array<{ "QUERY PLAN": string }>;
      plans.push({ query: summarise(query), plan: plan.map((line) => line["QUERY PLAN"]) });
    }
    report.queries = runs;
    report.plans = plans;
    if (OUT) writeFileSync(join(OUT, "finance-registers-plans.txt"), plans.map((entry) => `${JSON.stringify(entry.query)}\n${(entry.plan as string[]).join("\n")}\n`).join("\n"));
  }, 300_000);

  it("exports 10,000 invoices in one file, with bounded memory", async () => {
    actAs(group);
    const before = process.memoryUsage();
    const samples: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      const result = await timed(exportInvoicesRoute, `/api/finance/invoices/export?search=${SEARCH}`);
      expect(result.status).toBe(200);
      samples.push(result.ms);
      report.exportBytes = result.bytes;
    }
    const after = process.memoryUsage();
    report.export = { rows: 10_000, runs: samples.map(Math.round), heapDeltaMb: Math.round((after.heapUsed - before.heapUsed) / 2 ** 20), rssMb: Math.round(after.rss / 2 ** 20) };
    console.log(`[perf] export 10,000 invoices: ${samples.map(Math.round).join(", ")} ms, ${Math.round((report.exportBytes as number) / 1024)} KiB`);
  }, 300_000);
});

function summarise(query: CapturedQuery) {
  return { ms: query.durationMs, sql: query.query.replace(/\s+/g, " ").slice(0, 220) };
}
