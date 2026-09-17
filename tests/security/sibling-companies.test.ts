import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { contextInCompany } from "@/lib/context/member-context";
import { listApprovals } from "@/lib/modules/approvals/approvals.service";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { cleanupSessions, COMPANY, createRawSession, loginAsEmail, prisma } from "../helpers";
import { actAs } from "./harness/actor";
import { companyIdentifiers, companySnapshot, snapshotDifferences } from "./harness/company-data";
import { sweepRoutes } from "./harness/sweep";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));

/**
 * Sibling companies of one group, through every API route (E-06 §117, §118, §144, §170).
 *
 * The companies of the demo group share a parent group, group departments and
 * people who work in several of them. None of that opens one company's records
 * to somebody who works only in another. Meridian's CEO — the widest reader a
 * single company has — calls every session route with Aurelia's real record ids;
 * Meridian's accountant calls every Finance route with Terra's. The expected
 * result is the tenant sweep's: 0 leaks, 0 mutations, 0 disclosures, and each
 * target company's rows unchanged afterwards.
 */

let meridianCeo: UserContext;
let meridianFinance: UserContext;
const report: Record<string, unknown> = {};

beforeAll(async () => {
  meridianCeo = await loginAsEmail("ceo-b@nesto.test");
  meridianFinance = await loginAsEmail("finance-b@nesto.test");
}, 120_000);

afterAll(async () => {
  actAs(null);
  if (process.env.SECURITY_REPORT) writeFileSync(process.env.SECURITY_REPORT, JSON.stringify(report, null, 2));
  await cleanupSessions();
  await prisma.$disconnect();
});

async function approvalsIn(companyId: string) {
  const owner = await contextInCompany(await loginAsEmail("owner@nesto.test"), companyId);
  const refs = new Map<string, { providerKey: string; approvalId: string }>();
  for (const tab of ["waiting", "history"] as const) {
    const queue = await listApprovals(owner!, approvalQuerySchema.parse({ tab, limit: 100 }));
    for (const item of queue.items) {
      if (!refs.has(item.providerKey)) refs.set(item.providerKey, { providerKey: item.providerKey, approvalId: item.approvalId });
    }
  }
  return [...refs.values()];
}

const only = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;

describe("sibling companies of one group (E-06 §118, §144)", () => {
  it("gives Meridian's CEO nothing of Aurelia's", async () => {
    const session = await createRawSession("ceo@nesto.test");
    const before = await companySnapshot(COMPANY.a);
    const result = await sweepRoutes(meridianCeo, { companyId: COMPANY.a, approvals: await approvalsIn(COMPANY.a), sessionId: session.session.id, foreign: await companyIdentifiers(COMPANY.a) }, { only: only ? (pattern) => only.test(pattern) : undefined });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY.a));
    report.meridianToAurelia = { ...result, changed };

    expect(result.calls).toBeGreaterThan(only ? 0 : 800);
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 900_000);

  it("gives Meridian's accountant none of Terra's Finance (§144)", async () => {
    const session = await createRawSession("ceo-c@nesto.test");
    const before = await companySnapshot(COMPANY.c);
    const result = await sweepRoutes(meridianFinance, { companyId: COMPANY.c, approvals: await approvalsIn(COMPANY.c), sessionId: session.session.id, foreign: await companyIdentifiers(COMPANY.c) }, { only: (pattern) => pattern.startsWith("/api/finance") });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY.c));
    report.meridianFinanceToTerra = { ...result, changed };

    expect(result.calls).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 600_000);
});
