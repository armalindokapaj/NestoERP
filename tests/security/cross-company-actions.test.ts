import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, loginAsEmail, prisma } from "../helpers";
import { actAs } from "./harness/actor";
import { COMPANY_A, COMPANY_B, withAllModulesEnabled } from "./harness/companies";
import { companyIdentifiers, companySnapshot, snapshotDifferences } from "./harness/company-data";
import { sweepActions } from "./harness/sweep";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));
// Revalidation needs a live Next request; outside one it is a no-op here.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

/**
 * Company A / Company B, through every server action (PRD #47 §131-§133, §155, §209).
 *
 * Server actions are endpoints: any browser can call an exported action with
 * any arguments. Every action that takes a record id is called by the Owner of
 * one company, all modules on, with real ids from the other company — and a
 * form body completed from the action's own validation errors, so the call
 * reaches the lookup instead of stopping at the schema.
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
  restoreModules = await withAllModulesEnabled(COMPANY_B);
  ownerA = await loginAsEmail("owner@nesto.test");
  ownerB = await loginAsEmail("owner-b@nesto.test");
}, 120_000);

afterAll(async () => {
  actAs(null);
  await restoreModules?.();
  if (process.env.SECURITY_REPORT) writeFileSync(process.env.SECURITY_REPORT, JSON.stringify(report, null, 2));
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("Company A / Company B isolation across every server action (PRD #47 §209)", () => {
  it("lets Company B's Owner act on nothing of Company A's", async () => {
    const before = await companySnapshot(COMPANY_A);
    const result = await sweepActions(ownerB, { companyId: COMPANY_A, approvals: [], sessionId: null, foreign: await companyIdentifiers(COMPANY_A) });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY_A));
    report.bToA = { ...result, changed };
    expect(result.calls).toBeGreaterThan(100);
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 900_000);

  it("lets Company A's Owner act on nothing of Company B's", async () => {
    const before = await companySnapshot(COMPANY_B);
    const result = await sweepActions(ownerA, { companyId: COMPANY_B, approvals: [], sessionId: null, foreign: await companyIdentifiers(COMPANY_B) });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY_B));
    report.aToB = { ...result, changed };
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 900_000);
});
