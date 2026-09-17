import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { listApprovals } from "@/lib/modules/approvals/approvals.service";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { cleanupSessions, createRawSession, DEMO_EMAIL, loginAsEmail, prisma } from "../helpers";
import { actAs } from "./harness/actor";
import { COMPANY_A, COMPANY_TENANT, COMPANY_WORKS, withAllModulesEnabled } from "./harness/companies";
import { companyIdentifiers, companySnapshot, snapshotDifferences } from "./harness/company-data";
import { sweepRoutes } from "./harness/sweep";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));

/**
 * Company A / the fixture tenant, through every API route (PRD #47 §131-§138,
 * §155, §209; E-06 §117, §118).
 *
 * The Owner of one company — every permission, the widest scope, every module
 * switched on — calls every session-authenticated route handler in the
 * repository with real record ids from the other company, in another parent
 * group: every method, every dynamic segment, a body the route's own validator
 * accepts. Collection routes are read with the other company's ids in their
 * filters, its project name as the search text, and a calendar range.
 *
 * The Owner is the strongest attacker there is inside a tenant: no permission
 * check stands between them and the record, so the only thing that can refuse
 * is the company boundary itself. The expected result is PRD #47 §209's:
 * 0 leaks, 0 mutations, 0 disclosures —
 *
 *   - no 2xx body carries an identifier the other company owns;
 *   - no write to another company's record succeeds;
 *   - no route answers 409 about a record it should not have found;
 *   - nothing throws or answers 500;
 *   - afterwards, every table's rows for the other company are byte-identical.
 */

let ownerA: UserContext;
let ownerB: UserContext;
const report: Record<string, unknown> = {};
let restoreModules: (() => Promise<void>) | null = null;

beforeAll(async () => {
  // The fixture tenant runs with modules switched off on purpose (PRD #9 §13);
  // here they are switched on, so a refusal comes from the company boundary
  // rather than from the module guard.
  restoreModules = await withAllModulesEnabled(COMPANY_TENANT);
  ownerA = await loginAsEmail("owner@nesto.test");
  ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
}, 120_000);

afterAll(async () => {
  actAs(null);
  await restoreModules?.();
  if (process.env.SECURITY_REPORT) writeFileSync(process.env.SECURITY_REPORT, JSON.stringify(report, null, 2));
  await cleanupSessions();
  await prisma.$disconnect();
});

async function approvalsOf(owner: UserContext) {
  const refs = new Map<string, { providerKey: string; approvalId: string }>();
  for (const tab of ["waiting", "history"] as const) {
    const queue = await listApprovals(owner, approvalQuerySchema.parse({ tab, limit: 100 }));
    for (const item of queue.items) {
      if (!refs.has(item.providerKey)) refs.set(item.providerKey, { providerKey: item.providerKey, approvalId: item.approvalId });
    }
  }
  return [...refs.values()];
}

const only = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;

describe("Company A / fixture tenant isolation across every API route (PRD #47 §209)", () => {
  it("detects a leak when there is one: a company's own Owner trips the check", async () => {
    // Without this, a harness that silently reached no data would pass.
    const result = await sweepRoutes(ownerA, { companyId: COMPANY_A, approvals: [], sessionId: null, foreign: await companyIdentifiers(COMPANY_A) }, { only: (pattern) => pattern === "/api/tasks/[taskId]" });
    expect(result.violations.map((violation) => violation.kind)).toContain("leak");
  });

  it("gives the fixture tenant's Owner nothing of Company A's", async () => {
    const session = await createRawSession("ceo@nesto.test");
    const approvals = await approvalsOf(ownerA);
    const before = await companySnapshot(COMPANY_A);
    const result = await sweepRoutes(ownerB, { companyId: COMPANY_A, approvals, sessionId: session.session.id, foreign: await companyIdentifiers(COMPANY_A) }, { only: only ? (pattern) => only.test(pattern) : undefined });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY_A));
    report.bToA = { ...result, changed };

    expect(result.calls).toBeGreaterThan(only ? 0 : 800);
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 900_000);

  it("gives Company A's Owner nothing of the fixture tenant's", async () => {
    const session = await createRawSession(DEMO_EMAIL.tenantViewer);
    const approvals = await approvalsOf(ownerB);
    const before = await companySnapshot(COMPANY_TENANT);
    const result = await sweepRoutes(ownerA, { companyId: COMPANY_TENANT, approvals, sessionId: session.session.id, foreign: await companyIdentifiers(COMPANY_TENANT) }, { only: only ? (pattern) => only.test(pattern) : undefined });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY_TENANT));
    report.aToB = { ...result, changed };

    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 900_000);

  it("gives Company A's Owner none of another group's invitations", async () => {
    // Every invitation is seeded in Fixture Works, so neither sweep above meets one.
    const before = await companySnapshot(COMPANY_WORKS);
    const result = await sweepRoutes(ownerA, { companyId: COMPANY_WORKS, approvals: [], sessionId: null, foreign: await companyIdentifiers(COMPANY_WORKS) }, { only: (pattern) => pattern.startsWith("/api/team/invitations/") });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY_WORKS));
    report.aToWorks = { ...result, changed };

    expect(result.uncovered).toEqual([]);
    expect(result.calls).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 300_000);
});
