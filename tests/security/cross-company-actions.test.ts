import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, DEMO_EMAIL, loginAsEmail, prisma } from "../helpers";
import { actAs } from "./harness/actor";
import { COMPANY_A, COMPANY_TENANT, COMPANY_WORKS, withAllModulesEnabled } from "./harness/companies";
import { companyIdentifiers, companySnapshot, snapshotDifferences } from "./harness/company-data";
import { sweepActions } from "./harness/sweep";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));
// Revalidation needs a live Next request; outside one it is a no-op here.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

/**
 * Company A / the fixture tenant, through every server action (PRD #47 §131-§133,
 * §155, §209; E-06 §117, §118).
 *
 * Server actions are endpoints: any browser can call an exported action with
 * any arguments. Every action that takes a record id is called by the Owner of
 * one company, all modules on, with real ids from the other company, in another
 * parent group — and a form body completed from the action's own validation
 * errors, so the call reaches the lookup instead of stopping at the schema.
 *
 * Expected: no action reports success, redirects as if it succeeded, throws,
 * or returns anything of the other company's; the other company's rows are
 * byte-identical afterwards.
 */

let ownerA: UserContext;
let ownerB: UserContext;
let restoreModules: (() => Promise<void>) | null = null;
const report: Record<string, unknown> = {};

beforeAll(async () => {
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

describe("Company A / fixture tenant isolation across every server action (PRD #47 §209)", () => {
  it("lets the fixture tenant's Owner act on nothing of Company A's", async () => {
    const before = await companySnapshot(COMPANY_A);
    const result = await sweepActions(ownerB, { companyId: COMPANY_A, approvals: [], sessionId: null, foreign: await companyIdentifiers(COMPANY_A) });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY_A));
    report.bToA = { ...result, changed };
    expect(result.calls).toBeGreaterThan(100);
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 900_000);

  it("lets Company A's Owner act on nothing of the fixture tenant's", async () => {
    const before = await companySnapshot(COMPANY_TENANT);
    const result = await sweepActions(ownerA, { companyId: COMPANY_TENANT, approvals: [], sessionId: null, foreign: await companyIdentifiers(COMPANY_TENANT) });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY_TENANT));
    report.aToB = { ...result, changed };
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 900_000);

  it("lets Company A's Owner act on none of another group's invitations", async () => {
    // Every invitation is seeded in Fixture Works, so neither sweep above meets one.
    const before = await companySnapshot(COMPANY_WORKS);
    const result = await sweepActions(ownerA, { companyId: COMPANY_WORKS, approvals: [], sessionId: null, foreign: await companyIdentifiers(COMPANY_WORKS) }, { only: (action) => /Invitation/.test(action.name) });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY_WORKS));
    report.aToWorks = { ...result, changed };
    expect(result.uncovered).toEqual([]);
    expect(result.calls).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 300_000);
});
