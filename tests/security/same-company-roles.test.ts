import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { RoleKey } from "@/config/roles";
import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma, projectTypeId, taskVersion } from "../helpers";
import { actAs } from "./harness/actor";
import type { ServerAction } from "./harness/actions";
import { companySnapshot, snapshotDifferences } from "./harness/company-data";
import {
  callActionFilled,
  callRouteFilled,
  companyRowIds,
  labelsDisclosed,
  preserveRows,
  recordLabels,
  removeRowsCreatedSince,
  routeHandlers,
  serverAction,
  sweepAllActions,
  sweepWrites,
  type MutationAttempt,
} from "./harness/mutations";
import { idsByFieldName } from "./harness/params";
import { callRoute, discoverApiRoutes, fillPattern, HTTP_METHODS, type HttpMethod } from "./harness/routes";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * Lower privilege inside the same company (AUD-06 §6; RP-09, RP-17, RP-23).
 *
 * The isolation suites attack another company or another project. Here the
 * attacker is a colleague: Aurelia's Viewer, who may read and never write
 * (config/role-defaults.ts VIEWER: every cell V, and no Finance, HR, Sales,
 * Contracts, Procurement, Inventory, QA/QC, HSE, Approvals or Timesheets at
 * all), and Aurelia's Engineer, whose self-service and assigned-scope rights
 * stop short of Finance, Sales, Contracts, Procurement, Inventory, Clients,
 * Team, Settings, Organization and announcing anything (ENGINEER row: V or
 * nothing in those cells; finance views denied outright). Those expectations
 * are written here from the matrix, not read back from the service.
 *
 * A hidden button is not the enforcement (RP-23), so every write is forged
 * directly — each route's write methods, collection creates included, and
 * every exported server action — with the company's own real ids. A forgery
 * must be refused with a controlled 401/403/404 (never a 2xx or an HTML page),
 * write nothing (every company table byte-identical afterwards), and say
 * nothing about the record it named. Each refusal is paired with a positive
 * control: the same operation, on a fixture the authorized actor creates for
 * the purpose, succeeds for somebody entitled to it — so a refusal is the
 * policy, not a broken endpoint — and the fixture is removed again.
 */

const REFUSED = new Set([401, 403, 404]);
const ENVELOPE = new Set(["code", "message", "requestId", "details"]);

/**
 * The caller's own affairs, which a Viewer may write by design and which the
 * forged-write sweep therefore does not call: their account and sessions,
 * their notifications and read receipts, their stars and recent items, their
 * shell settings, following a record (`collaboration.watch` stays with the
 * Viewer, PRD #38 §127), and opening a project, which only moves their own
 * session (E-05A §26). Public and telemetry endpoints are not business writes.
 */
const SELF_SERVICE: RegExp[] = [
  /^\/api\/me(\/|$)/,
  /^\/api\/notifications(\/|$)/,
  /^\/api\/activity-center\/mark-all-read$/,
  /^\/api\/announcements\/\[announcementId\]\/(read|seen|acknowledge)$/,
  /^\/api\/collaboration\/\[parentType\]\/\[parentId\]\/watch$/,
  /^\/api\/(favorites|recent-work|my-work)(\/|$)/,
  /^\/api\/projects\/\[projectId\]\/(favorite|open)$/,
  /^\/api\/productivity\/settings$/,
  /^\/api\/(public|telemetry)\//,
];

/**
 * POSTs that read: a duplicate check, and a signed download or preview link.
 * They may answer 200, but only for a record the caller can already open —
 * asserted against the record's own detail route below (RP-12: a link never
 * outreaches the record).
 */
const READ_SHAPED: Record<string, string> = {
  "/api/clients/check-duplicate": "",
  "/api/documents/[documentId]/download": "/api/documents/[documentId]",
  "/api/documents/[documentId]/preview": "/api/documents/[documentId]",
  "/api/documents/[documentId]/versions/[versionId]/download": "/api/documents/[documentId]",
};

/**
 * State answered before permission, on a record the caller may read: a
 * locked daily log, and a meeting whose minutes are final (or not yet final,
 * or whose meeting is not yet complete), say so with a 409 to anybody who can
 * open them. The meeting and daily-log permission predicates are themselves
 * state-aware (lib/modules/meetings/meeting.permissions.ts), which is why the
 * services name the state first, for the people who may act. Nothing is
 * written and nothing is disclosed that the record's own page does not show —
 * asserted below by opening the record as the same caller — so a 409 there is
 * accepted, and any other 409 fails. The order is reported as an observation.
 */
const STATE_BEFORE_PERMISSION: [RegExp, string][] = [
  [/^\/api\/daily-logs\/\[dailyLogId\]\//, "/api/daily-logs/[dailyLogId]"],
  [/^\/api\/meetings\/\[meetingId\]\//, "/api/meetings/[meetingId]"],
];
const stateDetail = (pattern: string) => STATE_BEFORE_PERMISSION.find(([rule]) => rule.test(pattern))?.[1];

/** Actions that are the caller's own account, not the company's records. */
const SELF_SERVICE_ACTIONS = (action: ServerAction) => action.file === "lib/actions/account.ts" || action.name === "acceptInviteAsCurrentUserAction";

/**
 * Where the Engineer holds no write authority at all (ENGINEER matrix row):
 * no module, V, or V with the reads denied. Their own leave and attendance are
 * self-service (`hr.self.*`, PRD #16 §74) and are exercised as positive
 * controls below, not forged here.
 */
const ENGINEER_READ_ONLY = /^\/api\/(finance|sales|contracts|procurement|inventory|clients|team|settings|organization|announcements|approvals\/\[providerKey\]|hr\/(employees|candidates|user-provisioning-requests|leave\/\[leaveId\]))(\/|$)/;
const ENGINEER_READ_ONLY_ACTIONS = /lib\/actions\/(finance|sales|contracts|procurement|inventory|clients|team|settings)\.ts$/;

const actors = {} as Record<"owner" | "viewer" | "engineer" | "hr" | "ceo" | "tenantOwner", UserContext>;
const report: Record<string, unknown> = {};
/** Counters the positive controls move by succeeding: invoice and expense numbers, the Engineer's leave balance, a project's last activity. */
const restores: Array<() => Promise<void>> = [];

beforeAll(async () => {
  for (const table of ["company_numbering_schemes", "leave_balances", "projects"]) restores.push(await preserveRows(table, COMPANY.a));
  const roles: [keyof typeof actors, RoleKey][] = [["owner", "OWNER"], ["viewer", "VIEWER"], ["engineer", "ENGINEER"], ["hr", "HR"], ["ceo", "CEO"]];
  for (const [key, role] of roles) actors[key] = await loginAs(role);
  actors.tenantOwner = await loginAsEmail(DEMO_EMAIL.tenantOwner);
  for (const key of ["owner", "viewer", "engineer", "hr", "ceo"] as const) expect(actors[key].companyId).toBe(COMPANY.a);
}, 60_000);

afterAll(async () => {
  actAs(null);
  for (const restore of restores) await restore();
  if (process.env.SECURITY_REPORT) writeFileSync(process.env.SECURITY_REPORT, JSON.stringify(report, null, 2));
  await cleanupSessions();
  await prisma.$disconnect();
});

/** Why an answer is not a controlled refusal, or null when it is one. */
function notARefusal(outcome: { status: number; body: unknown; thrown?: string }): string | null {
  if (outcome.thrown) return `threw ${outcome.thrown}`;
  if (typeof outcome.body === "string" && outcome.body.trimStart().startsWith("<")) return "answered with HTML";
  if (!REFUSED.has(outcome.status)) return `status ${outcome.status}`;
  const error = (outcome.body as { error?: Record<string, unknown> } | null)?.error;
  if (!error) return "no error envelope";
  const extra = Object.keys(error).filter((key) => !ENVELOPE.has(key));
  return extra.length > 0 ? `envelope carries ${extra.join(", ")}` : null;
}

async function rowText(table: string, id: string): Promise<string | null> {
  const [row] = await prisma.$queryRawUnsafe<{ row: string }[]>(`SELECT t::text AS row FROM "${table}" t WHERE t."id" = $1`, id);
  return row?.row ?? null;
}

async function readable(actor: UserContext, pattern: string, params: Record<string, string>): Promise<number> {
  actAs(actor);
  const handlers = await routeHandlers(pattern);
  return (await callRoute(handlers.GET!, "GET", fillPattern(pattern, params), params)).status;
}

/**
 * Takes away the audit rows a read-shaped POST leaves (a download or preview
 * grant) and returns their action keys; any other new row stays, for the
 * snapshot comparison to fail on.
 */
async function readGrantsSince(baseline: Map<string, Set<string>>): Promise<string[]> {
  const known = [...(baseline.get("audit_events") ?? [])];
  const rows = await prisma.auditEvent.findMany({ where: { companyId: COMPANY.a, id: { notIn: known }, actionKey: { in: ["DOCUMENT_DOWNLOAD_GRANTED", "DOCUMENT_PREVIEW_GRANTED"] } }, select: { id: true, actionKey: true } });
  await prisma.auditEvent.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
  return rows.map((row) => row.actionKey);
}

/** Judges one sweep of forged route writes against the expectations above. */
async function judgeRouteSweep(actor: UserContext, attempts: MutationAttempt[], labels: Map<string, string[]>): Promise<string[]> {
  const problems: string[] = [];
  for (const attempt of attempts) {
    const params = attempt.params;
    const leaked = labelsDisclosed(attempt.body, attempt.ids, labels);
    if (leaked.length > 0 && attempt.status >= 300) problems.push(`${attempt.endpoint}: refusal repeats ${leaked.join(", ")}`);
    if (attempt.status === 422) continue; // not reached: the paired probes below reach these with valid bodies
    if (attempt.pattern in READ_SHAPED && attempt.status === 200) {
      const detail = READ_SHAPED[attempt.pattern];
      if (detail && (await readable(actor, detail, params)) !== 200) problems.push(`${attempt.endpoint}: a link to a record the caller cannot open`);
      continue;
    }
    const detail = stateDetail(attempt.pattern);
    if (detail && attempt.status === 409) {
      if ((await readable(actor, detail, params)) !== 200) problems.push(`${attempt.endpoint}: 409 on a record the caller cannot open`);
      continue;
    }
    const why = notARefusal(attempt);
    if (why) problems.push(`${attempt.endpoint}: ${why} ${JSON.stringify(attempt.body).slice(0, 160)}`);
  }
  return problems;
}

describe("a Viewer forging writes in their own company (RP-09, RP-23)", () => {
  it("refuses every write method of every route, and nothing changes", async () => {
    const labels = await recordLabels(COMPANY.a);
    const baseline = await companyRowIds(COMPANY.a);
    const before = await companySnapshot(COMPANY.a);
    const { attempts, uncovered } = await sweepWrites(actors.viewer, { companyId: COMPANY.a, approvals: [], sessionId: null }, { only: (pattern) => !SELF_SERVICE.some((rule) => rule.test(pattern)) });
    // A signed link to a readable document is audited (PRD #13): the only rows the sweep may leave.
    const audited = await readGrantsSince(baseline);
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY.a));
    const problems = await judgeRouteSweep(actors.viewer, attempts, labels);
    report.viewerRoutes = { calls: attempts.length, uncovered, unreached: attempts.filter((attempt) => attempt.status === 422).map((attempt) => attempt.endpoint), problems, changed, audited };

    expect(attempts.length).toBeGreaterThan(400);
    expect(problems).toEqual([]);
    expect(changed).toEqual([]);
  }, 600_000);

  it("refuses every server action, creates included, and nothing changes", async () => {
    const before = await companySnapshot(COMPANY.a);
    const { attempts } = await sweepAllActions(actors.viewer, COMPANY.a, { only: (action) => !SELF_SERVICE_ACTIONS(action) });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY.a));
    // A thrown AccessError is a refusal; a thrown ZodError never reached the check and wrote nothing.
    const accepted = attempts.filter((attempt) => attempt.outcome === "accepted" || (attempt.outcome === "threw" && !/^(AccessError|ZodError):/.test(attempt.detail)));
    report.viewerActions = { calls: attempts.length, accepted, changed };

    expect(attempts.length).toBeGreaterThan(200);
    expect(accepted.map((attempt) => `${attempt.endpoint}: ${attempt.detail}`)).toEqual([]);
    expect(changed).toEqual([]);
  }, 600_000);
});

describe("an Engineer forging writes outside their authority (RP-09)", () => {
  it("refuses every write to the modules the Engineer only reads or cannot open", async () => {
    const labels = await recordLabels(COMPANY.a);
    const before = await companySnapshot(COMPANY.a);
    const { attempts } = await sweepWrites(actors.engineer, { companyId: COMPANY.a, approvals: [], sessionId: null }, { only: (pattern) => ENGINEER_READ_ONLY.test(pattern) && !(pattern in READ_SHAPED) && !SELF_SERVICE.some((rule) => rule.test(pattern)) });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY.a));
    const problems = await judgeRouteSweep(actors.engineer, attempts, labels);
    report.engineerRoutes = { calls: attempts.length, unreached: attempts.filter((attempt) => attempt.status === 422).map((attempt) => attempt.endpoint), problems, changed };

    expect(attempts.length).toBeGreaterThan(150);
    expect(problems).toEqual([]);
    expect(changed).toEqual([]);
  }, 600_000);

  it("refuses every server action of those modules", async () => {
    const before = await companySnapshot(COMPANY.a);
    const { attempts } = await sweepAllActions(actors.engineer, COMPANY.a, { only: (action) => ENGINEER_READ_ONLY_ACTIONS.test(action.file) && !SELF_SERVICE_ACTIONS(action) });
    const changed = snapshotDifferences(before, await companySnapshot(COMPANY.a));
    const accepted = attempts.filter((attempt) => attempt.outcome === "accepted" || (attempt.outcome === "threw" && !/^(AccessError|ZodError):/.test(attempt.detail)));
    report.engineerActions = { calls: attempts.length, accepted, changed };

    expect(attempts.length).toBeGreaterThan(80);
    expect(accepted.map((attempt) => `${attempt.endpoint}: ${attempt.detail}`)).toEqual([]);
    expect(changed).toEqual([]);
  }, 600_000);
});

/* -------------------------------------------------------------------------- */
/* Paired probes: the refusal, and the same operation succeeding               */
/* -------------------------------------------------------------------------- */

type ActorKey = keyof typeof actors;
/** The pending finance cycle a page shows, which every decision now names (AUD-10 §4, A1). */
async function pendingFinanceCycle(id: string): Promise<Record<string, unknown>> {
  const cycle = await prisma.financeApproval.findFirstOrThrow({ where: { recordId: id, status: "PENDING" }, select: { id: true } });
  return { approvalId: cycle.id };
}

type Step = { method: HttpMethod; suffix: string; seed?: (id: string, created: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown> };

type RouteProbe = {
  name: string;
  collection: string;
  item: string;
  table: string;
  /** What the fixture is created with; a distinctive marker in a free-text field is what a refusal must never repeat. */
  seed: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  marker: string;
  authorized: ActorKey;
  /** Refused the create itself. */
  deniedCreate: ActorKey[];
  /** Refused every write on the fixture (every write route under `item`). */
  deniedItem: ActorKey[];
  /** What the authorized actor then does to the fixture, each expected to succeed and change it. */
  positive: Step[];
  /** Added to every forged write on the fixture: what the request must carry to get past its own preconditions (a task's version, AUD-02 §3). */
  deniedSeed?: (id: string, pattern: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

const MARK = "AUD06-PROBE";

const ROUTE_PROBES: RouteProbe[] = [
  {
    name: "task",
    collection: "/api/tasks",
    item: "/api/tasks/[taskId]",
    table: "tasks",
    // A personal task of the Owner's: on a shared project the Engineer's ASSIGNED
    // scope reaches colleagues' tasks by design (lib/access/scope.ts), so the
    // fixture sits on no project and is nobody's but the Owner's.
    seed: () => ({ title: `${MARK} task` }),
    marker: `${MARK} task`,
    authorized: "owner",
    deniedCreate: ["viewer"],
    deniedItem: ["viewer", "engineer"],
    deniedSeed: (id) => taskVersion(id),
    positive: [
      { method: "PATCH", suffix: "", seed: async (id) => ({ title: `${MARK} task edited`, ...(await taskVersion(id)) }) },
      { method: "POST", suffix: "/archive", seed: (id) => taskVersion(id) },
      { method: "POST", suffix: "/restore", seed: (id) => taskVersion(id) },
    ],
  },
  {
    name: "client",
    collection: "/api/clients",
    item: "/api/clients/[clientId]",
    table: "clients",
    seed: () => ({ name: `${MARK} client`, type: "COMPANY" }),
    marker: `${MARK} client`,
    authorized: "owner",
    deniedCreate: ["viewer", "engineer"],
    deniedItem: ["viewer", "engineer"],
    positive: [{ method: "POST", suffix: "/archive" }, { method: "POST", suffix: "/restore" }],
  },
  {
    name: "invoice",
    collection: "/api/finance/invoices",
    item: "/api/finance/invoices/[invoiceId]",
    table: "invoices",
    seed: () => ({ currency: "EUR", clientId: "client_acme", projectId: PROJECT.a, issueDate: "2026-09-14", dueDate: "2026-09-30", notes: `${MARK} invoice`, lineItems: [{ description: `${MARK} invoice line`, quantity: "1", unitPrice: "100", taxRate: "0" }] }),
    marker: `${MARK} invoice`,
    authorized: "owner",
    deniedCreate: ["viewer", "engineer"],
    deniedItem: ["viewer", "engineer"],
    positive: [{ method: "POST", suffix: "/submit" }, { method: "POST", suffix: "/approve", seed: pendingFinanceCycle }],
  },
  {
    name: "expense",
    collection: "/api/finance/expenses",
    item: "/api/finance/expenses/[expenseId]",
    table: "expenses",
    seed: () => ({ currency: "EUR", category: "MATERIALS", description: `${MARK} expense`, netAmount: "10", taxAmount: "0", expenseDate: "2026-09-14", projectId: PROJECT.a }),
    marker: `${MARK} expense`,
    authorized: "owner",
    deniedCreate: ["viewer", "engineer"],
    deniedItem: ["viewer", "engineer"],
    positive: [{ method: "POST", suffix: "/submit" }, { method: "POST", suffix: "/approve", seed: pendingFinanceCycle }],
  },
  {
    name: "contract",
    collection: "/api/contracts",
    item: "/api/contracts/[contractId]",
    table: "contracts",
    seed: () => ({ contractNumber: `${MARK}-C-1`, title: `${MARK} contract`, contractType: "CLIENT_AGREEMENT", ownerMemberId: actors.owner.membershipId }),
    marker: `${MARK} contract`,
    authorized: "owner",
    deniedCreate: ["viewer", "engineer"],
    deniedItem: ["viewer", "engineer"],
    positive: [{ method: "POST", suffix: "/archive" }, { method: "POST", suffix: "/restore" }],
  },
  {
    name: "sales lead",
    collection: "/api/sales/leads",
    item: "/api/sales/leads/[leadId]",
    table: "leads",
    seed: () => ({ name: `${MARK} lead`, source: "WEBSITE" }),
    marker: `${MARK} lead`,
    authorized: "owner",
    deniedCreate: ["viewer", "engineer"],
    deniedItem: ["viewer", "engineer"],
    deniedSeed: (_id, pattern) => (pattern.endsWith("/convert") ? { opportunityName: `${MARK} opportunity`, ownerMemberId: actors.owner.membershipId, estimatedValue: "1000", currency: "EUR" } : {}),
    positive: [{ method: "PATCH", suffix: "", seed: () => ({ name: `${MARK} lead edited`, source: "WEBSITE" }) }],
  },
  {
    name: "announcement",
    collection: "/api/announcements",
    item: "/api/announcements/[announcementId]",
    table: "announcements",
    seed: () => ({ title: `${MARK} announcement`, body: `${MARK} announcement body` }),
    marker: `${MARK} announcement`,
    authorized: "owner",
    deniedCreate: ["viewer", "engineer"],
    deniedItem: ["viewer", "engineer"],
    positive: [
      { method: "POST", suffix: "/publish", seed: async (id) => ({ expectedVersion: (await prisma.announcement.findUniqueOrThrow({ where: { id } })).version }) },
      { method: "POST", suffix: "/archive", seed: async (id) => ({ expectedVersion: (await prisma.announcement.findUniqueOrThrow({ where: { id } })).version }) },
    ],
  },
  {
    // Meetings are C/C for the Engineer: the positive control is the Engineer.
    name: "meeting",
    collection: "/api/meetings",
    item: "/api/meetings/[meetingId]",
    table: "meetings",
    seed: () => ({ title: `${MARK} meeting`, startTime: "09:00", endTime: "10:00", date: "2026-10-14", meetingType: "INTERNAL", visibility: "PARTICIPANTS", saveAsDraft: true }),
    marker: `${MARK} meeting`,
    authorized: "engineer",
    deniedCreate: ["viewer"],
    deniedItem: ["viewer"],
    deniedSeed: (_id, pattern) => (pattern.endsWith("/agenda/reorder") ? { itemIds: ["agenda_aud06_probe"] } : pattern.endsWith("/participants") ? { participants: [{ memberId: "member_architect" }] } : {}),
    positive: [{ method: "POST", suffix: "/cancel", seed: () => ({ reason: `${MARK} cancelled` }) }],
  },
];

/** Every write route under a fixture's item route whose only segment is the fixture. */
function itemWrites(item: string): { pattern: string; method: HttpMethod }[] {
  const param = /\[([^\]]+)\]$/.exec(item)![1];
  return discoverApiRoutes()
    .filter((route) => (route.pattern === item || route.pattern.startsWith(`${item}/`)) && route.params.length === 1 && route.params[0] === param && !SELF_SERVICE.some((rule) => rule.test(route.pattern)) && !(route.pattern in READ_SHAPED))
    .flatMap((route) => HTTP_METHODS.filter((method) => method !== "GET").map((method) => ({ pattern: route.pattern, method })));
}

const idOf = (body: unknown): string | undefined => {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  const value = data?.id ?? (data?.meeting as { id?: unknown } | undefined)?.id;
  return typeof value === "string" ? value : undefined;
};

describe("paired route probes: refused for the colleague, done by the entitled (RP-09)", () => {
  for (const probe of ROUTE_PROBES) {
    it(`${probe.name}: create, change, decide and archive`, async () => {
      const idFor = await idsByFieldName(COMPANY.a);
      const baseline = await companyRowIds(COMPANY.a);
      const problems: string[] = [];
      try {
        // The positive create first: it proves the body valid, so each denial below is the policy speaking.
        const collection = await routeHandlers(probe.collection);
        actAs(actors[probe.authorized]);
        const created = await callRouteFilled(collection.POST!, "POST", probe.collection, {}, idFor, await probe.seed());
        expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
        const id = idOf(created.body)!;
        expect(id).toBeTruthy();
        const param = /\[([^\]]+)\]$/.exec(probe.item)![1];

        const countBefore = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${probe.table}" WHERE "companyId" = $1`, COMPANY.a);
        for (const key of probe.deniedCreate) {
          actAs(actors[key]);
          const outcome = await callRoute(collection.POST!, "POST", probe.collection, {}, created.sent);
          const why = notARefusal(outcome);
          if (why) problems.push(`${key} create: ${why}`);
        }
        const countAfter = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${probe.table}" WHERE "companyId" = $1`, COMPANY.a);
        expect(countAfter[0].n).toBe(countBefore[0].n);

        const fixture = await rowText(probe.table, id);
        for (const key of probe.deniedItem) {
          for (const { pattern, method } of itemWrites(probe.item)) {
            const handlers = await routeHandlers(pattern);
            if (!handlers[method]) continue;
            actAs(actors[key]);
            const seed = { ...(method === "PATCH" ? created.sent : {}), ...((await probe.deniedSeed?.(id, pattern)) ?? {}) };
            const outcome = await callRouteFilled(handlers[method]!, method, fillPattern(pattern, { [param]: id }), { [param]: id }, idFor, seed);
            const why = notARefusal(outcome);
            if (why) problems.push(`${key} ${method} ${pattern}: ${why} ${JSON.stringify(outcome.body).slice(0, 160)}`);
            if (JSON.stringify(outcome.body ?? "").includes(probe.marker)) problems.push(`${key} ${method} ${pattern}: refusal repeats the record`);
          }
        }
        expect(await rowText(probe.table, id)).toBe(fixture);

        for (const step of probe.positive) {
          const pattern = `${probe.item}${step.suffix}`;
          const handlers = await routeHandlers(pattern);
          const before = await rowText(probe.table, id);
          actAs(actors[probe.authorized]);
          const outcome = await callRouteFilled(handlers[step.method]!, step.method, fillPattern(pattern, { [param]: id }), { [param]: id }, idFor, step.seed ? await step.seed(id, created.sent) : {});
          if (outcome.status >= 300) problems.push(`positive ${step.method} ${pattern}: ${outcome.status} ${JSON.stringify(outcome.body).slice(0, 200)}`);
          else if ((await rowText(probe.table, id)) === before) problems.push(`positive ${step.method} ${pattern}: answered ${outcome.status} and changed nothing`);
        }
      } finally {
        actAs(null);
        const left = await removeRowsCreatedSince(COMPANY.a, baseline);
        expect(left).toEqual([]);
      }
      expect(problems).toEqual([]);
    }, 120_000);
  }
});

type ActionProbe = {
  name: string;
  create: [file: string, name: string];
  args?: () => unknown[];
  seed: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  table: string;
  authorized: ActorKey;
  denied: ActorKey[];
  /** Actions taking the created id, refused for `denied` and then done by the authorized actor. */
  lifecycle?: [file: string, name: string][];
};

const ACTION_PROBES: ActionProbe[] = [
  { name: "client (action)", create: ["lib/actions/clients.ts", "createClientAction"], seed: () => ({ name: `${MARK} action client`, type: "INDIVIDUAL" }), table: "clients", authorized: "owner", denied: ["viewer", "engineer"], lifecycle: [["lib/actions/clients.ts", "archiveClientAction"], ["lib/actions/clients.ts", "restoreClientAction"]] },
  { name: "project", create: ["lib/actions/projects.ts", "createProjectAction"], seed: async () => ({ name: `${MARK} project`, code: `${MARK}-P-1`, projectTypeId: await projectTypeId(COMPANY.a) }), table: "projects", authorized: "owner", denied: ["viewer", "engineer"], lifecycle: [["lib/actions/projects.ts", "archiveProjectAction"], ["lib/actions/projects.ts", "restoreProjectAction"]] },
  { name: "expense (action)", create: ["lib/actions/finance.ts", "createExpenseAction"], seed: () => ({ currency: "EUR", category: "MATERIALS", description: `${MARK} action expense`, netAmount: "10", taxAmount: "0", expenseDate: "2026-09-14" }), table: "expenses", authorized: "owner", denied: ["viewer", "engineer"] },
  { name: "purchase request", create: ["lib/actions/procurement.ts", "createRequestAction"], seed: () => ({ projectId: PROJECT.a, title: `${MARK} purchase request`, "items[0][description]": `${MARK} line`, "items[0][quantity]": "1", "items[0][unit]": "pcs" }), table: "purchase_requests", authorized: "owner", denied: ["viewer", "engineer"] },
  { name: "inventory item", create: ["lib/actions/inventory.ts", "createItemAction"], seed: () => ({ sku: `${MARK}-SKU-1`, name: `${MARK} item`, category: "MATERIAL", baseUnit: "pcs" }), table: "inventory_items", authorized: "owner", denied: ["viewer", "engineer"] },
  // HSE and QA/QC are C/P for the Engineer on their project: the positive control is the Engineer.
  { name: "HSE incident", create: ["lib/actions/hse.ts", "createIncidentAction"], seed: () => ({ projectId: PROJECT.a, incidentType: "INCIDENT", title: `${MARK} incident`, description: `${MARK} incident`, occurredAt: "2026-09-14", severity: "LOW" }), table: "hse_incidents", authorized: "engineer", denied: ["viewer"] },
  { name: "QA/QC defect", create: ["lib/actions/qaqc.ts", "createDefectAction"], seed: () => ({ projectId: PROJECT.a, title: `${MARK} defect`, description: `${MARK} defect`, severity: "LOW" }), table: "quality_defects", authorized: "engineer", denied: ["viewer"] },
  // Pay is the HR role's and the Owner's alone (PRD #16 §17); the CEO reads HR and still may not record it.
  { name: "compensation", create: ["lib/actions/hr.ts", "recordCompensationAction"], args: () => ["employee_emp_001"], seed: () => ({ currency: "EUR", payType: "SALARY", baseAmount: "1234", effectiveFrom: "2026-09-01", notes: `${MARK} pay` }), table: "compensations", authorized: "hr", denied: ["viewer", "engineer", "ceo"] },
];

async function tableCount(table: string): Promise<bigint> {
  const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE "companyId" = $1`, COMPANY.a);
  return row.n;
}

describe("paired server-action probes (RP-09, RP-23)", () => {
  for (const probe of ACTION_PROBES) {
    it(`${probe.name}: create and lifecycle`, async () => {
      const idFor = await idsByFieldName(COMPANY.a);
      const baseline = await companyRowIds(COMPANY.a);
      const problems: string[] = [];
      try {
        const action = serverAction(...probe.create);
        const args = [...(probe.args?.() ?? []), new FormData()];
        const countBefore = await tableCount(probe.table);
        actAs(actors[probe.authorized]);
        const created = await callActionFilled(action, args, idFor, await probe.seed());
        expect(created.outcome, created.detail).toBe("accepted");
        expect(await tableCount(probe.table)).toBe(countBefore + BigInt(1));
        const [fresh] = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${probe.table}" WHERE "companyId" = $1 AND NOT ("id" = ANY($2::text[])) LIMIT 1`, COMPANY.a, [...(baseline.get(probe.table) ?? [])]);

        for (const key of probe.denied) {
          actAs(actors[key]);
          const outcome = await callActionFilled(action, args, idFor, created.form);
          if (outcome.outcome !== "refused") problems.push(`${key} ${probe.create[1]}: ${outcome.outcome} ${outcome.detail}`);
          else if ((outcome.result as { fieldErrors?: unknown } | null)?.fieldErrors) problems.push(`${key} ${probe.create[1]}: stopped at validation, not at the permission`);
        }
        expect(await tableCount(probe.table)).toBe(countBefore + BigInt(1));

        for (const [file, name] of probe.lifecycle ?? []) {
          const step = serverAction(file, name);
          const before = await rowText(probe.table, fresh.id);
          for (const key of probe.denied) {
            actAs(actors[key]);
            const outcome = await callActionFilled(step, [fresh.id], idFor);
            if (outcome.outcome !== "refused") problems.push(`${key} ${name}: ${outcome.outcome} ${outcome.detail}`);
            if (outcome.detail.includes(MARK)) problems.push(`${key} ${name}: refusal repeats the record`);
          }
          expect(await rowText(probe.table, fresh.id)).toBe(before);
          actAs(actors[probe.authorized]);
          const done = await callActionFilled(step, [fresh.id], idFor);
          if (done.outcome !== "accepted") problems.push(`positive ${name}: ${done.outcome} ${done.detail}`);
          else if ((await rowText(probe.table, fresh.id)) === before) problems.push(`positive ${name}: accepted and changed nothing`);
        }
      } finally {
        actAs(null);
        const left = await removeRowsCreatedSince(COMPANY.a, baseline);
        expect(left).toEqual([]);
      }
      expect(problems).toEqual([]);
    }, 120_000);
  }
});

describe("self-service stops at the self (RP-09)", () => {
  it("files the Engineer's own leave, refuses it filed for somebody else, and leaves the decision to HR", async () => {
    const baseline = await companyRowIds(COMPANY.a);
    const collection = await routeHandlers("/api/hr/leave");
    const leave = { leaveType: "ANNUAL", startDate: "2026-12-01", endDate: "2026-12-02", reason: `${MARK} leave` };
    try {
      const other = await prisma.employeeProfile.findFirstOrThrow({ where: { companyId: COMPANY.a, companyMemberId: { not: actors.engineer.membershipId } }, select: { id: true } });
      const countBefore = await tableCount("leave_requests");

      actAs(actors.engineer);
      const forged = await callRoute(collection.POST!, "POST", "/api/hr/leave", {}, { ...leave, employeeId: other.id });
      expect(notARefusal(forged), JSON.stringify(forged.body)).toBeNull();
      actAs(actors.viewer);
      expect(notARefusal(await callRoute(collection.POST!, "POST", "/api/hr/leave", {}, leave))).toBeNull();
      expect(await tableCount("leave_requests")).toBe(countBefore);

      actAs(actors.engineer);
      const own = await callRoute(collection.POST!, "POST", "/api/hr/leave", {}, leave);
      expect(own.status, JSON.stringify(own.body)).toBe(201);
      const leaveId = idOf(own.body)!;
      const params = { leaveId };
      const submit = await routeHandlers("/api/hr/leave/[leaveId]/submit");
      expect((await callRoute(submit.POST!, "POST", `/api/hr/leave/${leaveId}/submit`, params, {})).status).toBeLessThan(300);

      // Deciding is hr.leave.approve: not the person who asked, not a reader of HR (CEO: hr V/C), not the Viewer.
      const approve = await routeHandlers("/api/hr/leave/[leaveId]/approve");
      const pending = await rowText("leave_requests", leaveId);
      // The submission the page showed (AUD-10 A2): without it every decision is 428, which would hide whether a refusal was about access.
      const shown = { submittedAt: (await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveId }, select: { submittedAt: true } })).submittedAt!.toISOString() };
      for (const key of ["engineer", "ceo", "viewer"] as const) {
        actAs(actors[key]);
        const outcome = await callRoute(approve.POST!, "POST", `/api/hr/leave/${leaveId}/approve`, params, shown);
        expect(notARefusal(outcome), `${key}: ${JSON.stringify(outcome.body)}`).toBeNull();
      }
      expect(await rowText("leave_requests", leaveId)).toBe(pending);

      actAs(actors.hr);
      const decided = await callRoute(approve.POST!, "POST", `/api/hr/leave/${leaveId}/approve`, params, shown);
      expect(decided.status, JSON.stringify(decided.body)).toBeLessThan(300);
      expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveId } })).status).toBe("APPROVED");
    } finally {
      actAs(null);
      expect(await removeRowsCreatedSince(COMPANY.a, baseline)).toEqual([]);
    }
  }, 120_000);
});

describe("self-service attendance stops at the self (RP-09)", () => {
  it("lets the Engineer correct their own day and refuses a colleague's", async () => {
    const pattern = "/api/hr/attendance/[attendanceId]";
    const handlers = await routeHandlers(pattern);
    const body = { status: "PRESENT", checkIn: "08:00", checkOut: "16:00", notes: `${MARK} attendance` };
    const colleague = await prisma.attendanceRecord.findFirstOrThrow({ where: { companyId: COMPANY.a, companyMemberId: { not: actors.engineer.membershipId }, source: "SELF" }, orderBy: { id: "asc" } });
    const own = await prisma.attendanceRecord.findFirstOrThrow({ where: { companyId: COMPANY.a, companyMemberId: actors.engineer.membershipId, source: "SELF" }, orderBy: { id: "asc" } });
    const baseline = await companyRowIds(COMPANY.a);
    try {
      const before = await rowText("attendance_records", colleague.id);
      for (const key of ["engineer", "viewer"] as const) {
        actAs(actors[key]);
        const outcome = await callRoute(handlers.PATCH!, "PATCH", `/api/hr/attendance/${colleague.id}`, { attendanceId: colleague.id }, body);
        expect(notARefusal(outcome), `${key}: ${JSON.stringify(outcome.body)}`).toBeNull();
      }
      expect(await rowText("attendance_records", colleague.id)).toBe(before);

      actAs(actors.engineer);
      const mine = await callRoute(handlers.PATCH!, "PATCH", `/api/hr/attendance/${own.id}`, { attendanceId: own.id }, body);
      expect(mine.status, JSON.stringify(mine.body)).toBe(200);
      expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: own.id } })).notes).toBe(`${MARK} attendance`);
    } finally {
      actAs(null);
      const { id, ...original } = own;
      await prisma.attendanceRecord.update({ where: { id }, data: original });
      expect(await removeRowsCreatedSince(COMPANY.a, baseline)).toEqual([]);
    }
  });
});

describe("denied, missing and empty are three different answers (RP-17)", () => {
  const codeOf = (body: unknown) => (body as { error?: { code?: string } } | null)?.error?.code;

  it("tells a module the role lacks from a module the company switched off", async () => {
    const invoices = await routeHandlers("/api/finance/invoices");
    actAs(actors.viewer);
    const lacking = await callRoute(invoices.GET!, "GET", "/api/finance/invoices", {});
    expect([lacking.status, codeOf(lacking.body)]).toEqual([403, "FORBIDDEN"]);
    // The fixture tenant runs with Finance switched off (PRD #9 §13); its Owner holds every permission a role can.
    actAs(actors.tenantOwner);
    const disabled = await callRoute(invoices.GET!, "GET", "/api/finance/invoices", {});
    expect([disabled.status, codeOf(disabled.body)]).toEqual([403, "MODULE_UNAVAILABLE"]);
    // And the positive control: the Owner reads the list.
    actAs(actors.owner);
    expect((await callRoute(invoices.GET!, "GET", "/api/finance/invoices", {})).status).toBe(200);
  });

  it("answers an authorized search that matches nothing with an empty 200", async () => {
    const tasks = await routeHandlers("/api/tasks");
    actAs(actors.viewer);
    const empty = await callRoute(tasks.GET!, "GET", "/api/tasks?search=zz-aud06-no-such-task", {});
    expect(empty.status).toBe(200);
    const rows = (empty.body as { data?: unknown[]; items?: unknown[] }).data ?? (empty.body as { items?: unknown[] }).items;
    expect(rows).toEqual([]);
  });

  it("answers a record out of scope exactly as a record that does not exist", async () => {
    const task = await prisma.task.findFirstOrThrow({ where: { companyId: COMPANY.a, projectId: null, archivedAt: null, assigneeMemberId: { not: actors.viewer.membershipId }, createdByMemberId: { not: actors.viewer.membershipId } }, select: { id: true, title: true } });
    const detail = await routeHandlers("/api/tasks/[taskId]");
    actAs(actors.viewer);
    const hidden = await callRoute(detail.GET!, "GET", `/api/tasks/${task.id}`, { taskId: task.id });
    const missing = await callRoute(detail.GET!, "GET", "/api/tasks/task_aud06_missing", { taskId: "task_aud06_missing" });
    const strip = (body: unknown) => ({ ...(body as { error: Record<string, unknown> }).error, requestId: undefined });
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(strip(hidden.body)).toEqual(strip(missing.body));
    expect(JSON.stringify(hidden.body)).not.toContain(task.title);
    // Positive control: the Owner opens it.
    actAs(actors.owner);
    expect((await callRoute(detail.GET!, "GET", `/api/tasks/${task.id}`, { taskId: task.id })).status).toBe(200);
  });
});
