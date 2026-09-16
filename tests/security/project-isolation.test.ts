import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ModuleKey } from "@/config/modules";
import { accessibleProjectIds } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, loginAs, prisma } from "../helpers";
import { actAs } from "./harness/actor";
import { COMPANY_A } from "./harness/companies";
import { projectFootprint, snapshotDifferences } from "./harness/company-data";
import { sweepActions, sweepRoutes } from "./harness/sweep";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

/**
 * Project A / Project B inside one company (PRD #47 §49-§53, §139, §210).
 *
 * The seeded Project Manager belongs to Projects A and B only, and holds
 * PROJECT scope in every module that has project-bound records. Every route
 * and server action of those modules is called with real records of the
 * company's *other* projects. Expected: nothing of those projects is shown,
 * changed, or confirmed to exist.
 *
 * Calendar and Meetings are left out: the Project Manager holds COMPANY scope
 * there by design, and a company-visible meeting on another project is theirs
 * to see. Records they raised, own or are assigned to are left out too, for the
 * same reason: every scope keeps a SELF door open, so their own purchase
 * request on another project is theirs whichever site it names (PRD #19 §218,
 * PRD #47 §56, §57). What is swept is other people's work on those projects.
 */

/** Route prefixes → the module whose scope governs them. */
const ROUTE_MODULES: [RegExp, ModuleKey][] = [
  [/^\/api\/projects(\/|$)/, "projects"],
  [/^\/api\/project-(milestones|phases|milestone-blockers|planning)(\/|$)/, "projects"],
  [/^\/api\/tasks(\/|$)/, "tasks"],
  [/^\/api\/clients(\/|$)/, "clients"],
  [/^\/api\/documents(\/|$)|^\/api\/document-/, "documents"],
  [/^\/api\/finance(\/|$)/, "finance"],
  [/^\/api\/contracts(\/|$)/, "contracts"],
  [/^\/api\/sales(\/|$)/, "sales"],
  [/^\/api\/daily-logs(\/|$)/, "dailyLogs"],
  [/^\/api\/(rfis|submittals|submittal-revisions|transmittals|engineering)/, "engineering"],
  [/^\/api\/(contractors|contractor-|work-packages|project-contractor-assignments)/, "contractors"],
  [/^\/api\/(hse|qaqc|procurement|inventory)(\/|$)/, "hse"],
  [/^\/api\/search$|^\/api\/productivity\/palette$|^\/api\/approvals$|^\/api\/approvals\/counts$/, "projects"],
];
const ACTION_MODULES: Record<string, ModuleKey> = {
  "lib/actions/projects.ts": "projects",
  "lib/actions/tasks.ts": "tasks",
  "lib/actions/finance.ts": "finance",
  "lib/actions/contracts.ts": "contracts",
  "lib/actions/procurement.ts": "procurement",
  "lib/actions/inventory.ts": "inventory",
  "lib/actions/qaqc.ts": "qaqc",
  "lib/actions/hse.ts": "hse",
  "lib/actions/documents.ts": "documents",
};
const NARROW = new Set(["SELF", "ASSIGNED", "PROJECT"]);

let pm: UserContext;
let outside: string[];
const report: Record<string, unknown> = {};

beforeAll(async () => {
  pm = await loginAs("PROJECT_MANAGER");
  const mine = new Set(await accessibleProjectIds(pm));
  outside = (await prisma.project.findMany({ where: { companyId: COMPANY_A }, select: { id: true } })).map((row) => row.id).filter((id) => !mine.has(id));
}, 60_000);

afterAll(async () => {
  actAs(null);
  if (process.env.SECURITY_REPORT) writeFileSync(process.env.SECURITY_REPORT, JSON.stringify(report, null, 2));
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("Project isolation for a project-scoped member (PRD #47 §210)", () => {
  it("starts from a Project Manager who belongs to some projects and not others", () => {
    expect(outside.length).toBeGreaterThan(0);
    expect(outside).not.toContain("project_a");
  });

  it("shows, changes and confirms nothing of the other projects through any API route", async () => {
    const before = await projectFootprint(COMPANY_A, outside, pm.membershipId);
    const governed = (pattern: string) => {
      const entry = ROUTE_MODULES.find(([regex]) => regex.test(pattern));
      return Boolean(entry && NARROW.has(pm.moduleAccess[entry[1]].scope));
    };
    const result = await sweepRoutes(pm, { companyId: COMPANY_A, approvals: [], sessionId: null, projectIds: outside, exceptMemberId: pm.membershipId, foreign: before.ids }, { only: governed });
    const changed = snapshotDifferences(before.digest, (await projectFootprint(COMPANY_A, outside, pm.membershipId)).digest);
    report.routes = { ...result, changed };

    expect(result.calls).toBeGreaterThan(100);
    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 900_000);

  it("shows, changes and confirms nothing of the other projects through any server action", async () => {
    const before = await projectFootprint(COMPANY_A, outside, pm.membershipId);
    const result = await sweepActions(pm, { companyId: COMPANY_A, approvals: [], sessionId: null, projectIds: outside, exceptMemberId: pm.membershipId, foreign: before.ids }, { only: (action) => Boolean(ACTION_MODULES[action.file] && NARROW.has(pm.moduleAccess[ACTION_MODULES[action.file]].scope)) });
    const changed = snapshotDifferences(before.digest, (await projectFootprint(COMPANY_A, outside, pm.membershipId)).digest);
    report.actions = { ...result, changed };

    expect(result.violations).toEqual([]);
    expect(changed).toEqual([]);
  }, 900_000);
});
