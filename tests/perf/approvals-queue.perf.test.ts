import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { getApprovalCounts, listApprovals } from "@/lib/modules/approvals/approvals.service";
import { cleanupSessions, loginAs, prisma } from "../helpers";

/**
 * Approvals Center performance (PRD #41 §129, §284).
 *
 * Seeds 10,000 approvals across Finance and Procurement — a quarter still
 * pending, the rest decided — then times the queue, history pages, filters and
 * search as the CEO, who can see all of them. Targets: queue P50 < 300 ms and
 * P95 < 1.2 s.
 *
 * Opt-in (`NESTO_PERF=1`), because it writes ten thousand rows into the shared
 * development database for the length of the run and removes them afterwards.
 *
 *   NESTO_PERF=1 npx vitest run tests/perf/approvals-queue.perf.test.ts
 */

const RUN = process.env.NESTO_PERF === "1";
const PREFIX = "PERF-APR";
const COMPANY = "company_demo_a";
const EXPENSES = 6_000;
const REQUESTS = 4_000;

async function cleanup() {
  const expenses = await prisma.expense.findMany({ where: { companyId: COMPANY, description: { startsWith: PREFIX } }, select: { id: true } });
  const requests = await prisma.purchaseRequest.findMany({ where: { companyId: COMPANY, title: { startsWith: PREFIX } }, select: { id: true } });
  for (let index = 0; index < expenses.length; index += 2000) {
    const ids = expenses.slice(index, index + 2000).map((row) => row.id);
    await prisma.financeApproval.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.expense.deleteMany({ where: { id: { in: ids } } });
  }
  for (let index = 0; index < requests.length; index += 2000) {
    const ids = requests.slice(index, index + 2000).map((row) => row.id);
    await prisma.procurementApproval.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.purchaseRequest.deleteMany({ where: { id: { in: ids } } });
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

describe.skipIf(!RUN)("approvals queue at 10,000 approvals (§284)", () => {
  beforeAll(async () => {
    await cleanup();
    const finance = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "finance@nesto.test" } } });
    const pm = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "pm@nesto.test" } } });
    const ceo = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "ceo@nesto.test" } } });
    const now = Date.now();

    const expenseRows = Array.from({ length: EXPENSES }, (_, index) => ({
      id: `perf_exp_${index}`,
      companyId: COMPANY,
      projectId: index % 2 ? "project_a" : "project_b",
      expenseDate: new Date(now - (index % 365) * 86_400_000),
      category: "MATERIALS" as const,
      description: `${PREFIX} expense ${index}`,
      currency: "EUR",
      netAmount: new Prisma.Decimal(100 + index),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(100 + index),
      status: index % 4 === 0 ? ("PENDING_APPROVAL" as const) : ("APPROVED" as const),
      createdByMemberId: finance.id,
    }));
    const requestRows = Array.from({ length: REQUESTS }, (_, index) => ({
      id: `perf_pr_${index}`,
      companyId: COMPANY,
      requestNumber: `${PREFIX}-${index}`,
      title: `${PREFIX} request ${index}`,
      projectId: index % 2 ? "project_a" : "project_b",
      requestedByMemberId: pm.id,
      priority: "MEDIUM" as const,
      currency: "EUR",
      estimatedTotal: new Prisma.Decimal(500 + index),
      status: index % 4 === 0 ? ("PENDING_APPROVAL" as const) : ("APPROVED" as const),
      createdByMemberId: pm.id,
    }));
    for (let index = 0; index < expenseRows.length; index += 2000) await prisma.expense.createMany({ data: expenseRows.slice(index, index + 2000) });
    for (let index = 0; index < requestRows.length; index += 2000) await prisma.purchaseRequest.createMany({ data: requestRows.slice(index, index + 2000) });

    const decided = (index: number) => index % 4 !== 0;
    const at = (index: number) => new Date(now - index * 60_000);
    for (let index = 0; index < EXPENSES; index += 2000) {
      await prisma.financeApproval.createMany({
        data: expenseRows.slice(index, index + 2000).map((row, offset) => {
          const n = index + offset;
          return { companyId: COMPANY, recordType: "EXPENSE" as const, recordId: row.id, status: decided(n) ? ("APPROVED" as const) : ("PENDING" as const), submittedByMemberId: finance.id, submittedAt: at(n), ...(decided(n) ? { decidedByMemberId: ceo.id, decidedAt: at(n - 1) } : {}) };
        }),
      });
    }
    for (let index = 0; index < REQUESTS; index += 2000) {
      await prisma.procurementApproval.createMany({
        data: requestRows.slice(index, index + 2000).map((row, offset) => {
          const n = index + offset;
          return { companyId: COMPANY, recordType: "PURCHASE_REQUEST" as const, recordId: row.id, status: decided(n) ? ("APPROVED" as const) : ("PENDING" as const), submittedByMemberId: pm.id, submittedAt: at(n), ...(decided(n) ? { decidedByMemberId: ceo.id, decidedAt: at(n - 1) } : {}) };
        }),
      });
    }
  }, 600_000);

  afterAll(async () => {
    await cleanup();
    await cleanupSessions();
    await prisma.$disconnect();
  }, 600_000);

  it("meets the queue targets for the views an approver uses", async () => {
    const ceo = await loginAs("CEO");
    const scenarios: Record<string, () => Promise<unknown>> = {
      waiting: () => listApprovals(ceo, approvalQuerySchema.parse({ tab: "waiting" })),
      counts: () => getApprovalCounts(ceo),
      "history first page": () => listApprovals(ceo, approvalQuerySchema.parse({ tab: "history" })),
      approved: () => listApprovals(ceo, approvalQuerySchema.parse({ tab: "approved" })),
      "provider filter": () => listApprovals(ceo, approvalQuerySchema.parse({ tab: "history", provider: "procurement" })),
      search: () => listApprovals(ceo, approvalQuerySchema.parse({ tab: "history", q: `${PREFIX}-39` })),
      "amount range": () => listApprovals(ceo, approvalQuerySchema.parse({ tab: "history", amountMin: "1000", amountMax: "2000" })),
      "project filter": () => listApprovals(ceo, approvalQuerySchema.parse({ tab: "waiting", projectId: "project_a" })),
    };
    const report: Record<string, { p50: number; p95: number }> = {};
    const all: number[] = [];
    for (const [name, run] of Object.entries(scenarios)) {
      await run();
      const timings: number[] = [];
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const started = performance.now();
        await run();
        timings.push(performance.now() - started);
      }
      all.push(...timings);
      report[name] = { p50: Math.round(percentile(timings, 50)), p95: Math.round(percentile(timings, 95)) };
    }

    // A deep page through history, by cursor.
    let cursor: string | undefined;
    const pageTimings: number[] = [];
    for (let page = 0; page < 8; page += 1) {
      const started = performance.now();
      const result = await listApprovals(ceo, approvalQuerySchema.parse({ tab: "history", cursor, limit: 50 }));
      pageTimings.push(performance.now() - started);
      cursor = result.nextCursor ?? undefined;
      expect(result.items.length).toBe(50);
    }
    report["history pages 1-8"] = { p50: Math.round(percentile(pageTimings, 50)), p95: Math.round(percentile(pageTimings, 95)) };
    all.push(...pageTimings);

    if (process.env.NESTO_PERF_REPORT) (await import("node:fs")).writeFileSync(process.env.NESTO_PERF_REPORT, JSON.stringify(report, null, 2));
    console.table(report);
    expect(percentile(all, 50)).toBeLessThan(300);
    expect(percentile(all, 95)).toBeLessThan(1200);
  }, 600_000);
});
