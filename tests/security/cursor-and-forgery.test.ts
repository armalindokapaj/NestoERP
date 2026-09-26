import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, PROJECT, prisma, taskVersion } from "../helpers";
import { actAs } from "./harness/actor";
import { companyIdentifiers, foreignIdentifiersIn, ownedRows, projectFootprint } from "./harness/company-data";
import { captureCompanyRows, companyRowIds, preserveRows, removeRowsCreatedSince, routeHandlers } from "./harness/mutations";
import { callRoute, fillPattern } from "./harness/routes";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * Forged cursors and forged ids (AUD-06 §6, RP-14).
 *
 * A page cursor is data the client hands back, so it can be anything: another
 * person's notification id, another company's record id, a timestamp from the
 * far future or past, or a hand-built keyset for a project the reader cannot
 * open. Whatever it is, the next page may only ever hold what the first page
 * could — the cursor positions within the authorised set, it never widens it.
 * Every forged cursor is sent to every cursor-paged list, by readers of three
 * shapes (a same-company Viewer, a Project Manager of another project, and
 * another group's Owner); no answer may be a server error or carry an
 * identifier outside the reader's reach.
 *
 * Ids in bodies and query strings are forged the same way across a
 * representative set of creates and updates — a task's project and assignee,
 * an invoice's client and project, a meeting's participant, a deal's unit, a
 * leave request's employee, a body's `companyId` — each refused (or, for
 * `companyId`, ignored) with nothing written anywhere, and each paired with
 * the same request carrying the reader's own ids succeeding.
 */

const FIX = {
  probe: { userId: "user_aud06_cursor_pm", memberId: "member_aud06_cursor_pm", projectId: "project_aud06_cursor" },
  notifications: { viewerOld: "aud06_note_viewer_old", viewerNew: "aud06_note_viewer_new", owner: "aud06_note_owner", tenant: "aud06_note_tenant" },
} as const;
const TITLE = { viewerOld: "AUD06 viewer older note", viewerNew: "AUD06 viewer newer note", owner: "AUD06 NOTE FOR THE OWNER ONLY", tenant: "AUD06 NOTE FOR THE TENANT ONLY" };
const MARK = "AUD06-FORGERY";

let owner: UserContext;
let viewer: UserContext;
let hr: UserContext;
let probe: UserContext;
let tenantOwner: UserContext;
const report: Record<string, unknown> = {};
const restores: Array<() => Promise<void>> = [];
/** A company's productivity defaults are written the first time somebody there reads a list; the run's are taken away again. */
let settingsBefore: string[] = [];

async function removeFixtures() {
  await prisma.notification.deleteMany({ where: { id: { in: Object.values(FIX.notifications) } } });
  await prisma.session.deleteMany({ where: { userId: FIX.probe.userId } });
  await prisma.project.deleteMany({ where: { id: FIX.probe.projectId } });
  await prisma.companyMember.deleteMany({ where: { id: FIX.probe.memberId } });
  await prisma.user.deleteMany({ where: { id: FIX.probe.userId } });
}

beforeAll(async () => {
  await removeFixtures();
  settingsBefore = (await prisma.productivitySettings.findMany({ select: { id: true } })).map((row) => row.id);
  owner = await loginAs("OWNER");
  viewer = await loginAs("VIEWER");
  hr = await loginAs("HR");
  tenantOwner = await loginAsEmail(DEMO_EMAIL.tenantOwner);
  const tenantViewer = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.tenant, user: { email: DEMO_EMAIL.tenantViewer } }, select: { id: true } });

  // A Project Manager whose one project is not Riverside Residences (PRD #47 §210's shape).
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "PROJECT_MANAGER" }, select: { id: true } });
  await prisma.user.create({ data: { id: FIX.probe.userId, username: "aud06-cursor-pm", firstName: "Cursor", lastName: "Probe", passwordHash: "not-a-login" } });
  await prisma.companyMember.create({ data: { id: FIX.probe.memberId, companyId: COMPANY.a, userId: FIX.probe.userId, roleId: role.id, jobTitle: "Project Manager", joinedAt: new Date() } });
  await prisma.project.create({ data: { id: FIX.probe.projectId, companyId: COMPANY.a, code: "AUD06-CUR", name: "AUD-06 cursor site", status: "ACTIVE", projectManagerMemberId: FIX.probe.memberId, createdBy: FIX.probe.userId, members: { create: { companyId: COMPANY.a, companyMemberId: FIX.probe.memberId, projectRole: "Project Manager", isPrimary: true } } } });
  probe = await loginAsMembership(FIX.probe.memberId);

  // Notifications about a task every recipient can open, at known times, so a cursor has something on each side.
  const task = await prisma.task.findFirstOrThrow({ where: { companyId: COMPANY.a, projectId: PROJECT.a, archivedAt: null }, select: { id: true } });
  const tenantTask = await prisma.task.findFirst({ where: { companyId: COMPANY.tenant }, select: { id: true } });
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
  const note = (id: string, companyId: string, recipientMemberId: string, title: string, entityId: string | null, createdAt: Date) =>
    prisma.notification.create({ data: { id, companyId, recipientMemberId, eventType: "TASK_ASSIGNED", moduleKey: "tasks", entityType: entityId ? "task" : null, entityId, projectId: entityId === task.id ? PROJECT.a : null, title, dedupeKey: id, category: "tasks", createdAt } });
  await note(FIX.notifications.viewerOld, COMPANY.a, viewer.membershipId, TITLE.viewerOld, task.id, at(120));
  await note(FIX.notifications.viewerNew, COMPANY.a, viewer.membershipId, TITLE.viewerNew, task.id, at(60));
  await note(FIX.notifications.owner, COMPANY.a, owner.membershipId, TITLE.owner, task.id, at(90));
  await note(FIX.notifications.tenant, COMPANY.tenant, tenantViewer.id, TITLE.tenant, tenantTask?.id ?? null, at(80));

  // Counters a positive control moves by succeeding (an invoice number; a project's last activity).
  for (const table of ["company_numbering_schemes", "projects"]) restores.push(await preserveRows(table, COMPANY.a));
}, 120_000);

afterAll(async () => {
  actAs(null);
  if (process.env.SECURITY_REPORT) writeFileSync(process.env.SECURITY_REPORT, JSON.stringify(report, null, 2));
  for (const restore of restores) await restore();
  await cleanupSessions();
  await removeFixtures();
  await prisma.productivitySettings.deleteMany({ where: { id: { notIn: settingsBefore } } });
  await prisma.$disconnect();
});

const textOf = (body: unknown) => (typeof body === "string" ? body : JSON.stringify(body ?? ""));

async function get(context: UserContext, pattern: string, params: Record<string, string>, query: string) {
  const handlers = await routeHandlers(pattern);
  actAs(context);
  return callRoute(handlers.GET!, "GET", `${fillPattern(pattern, params)}${query ? `?${query}` : ""}`, params);
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/* -------------------------------------------------------------------------- */
/* Cursors                                                                     */
/* -------------------------------------------------------------------------- */

describe("a forged or stale cursor never widens a list (RP-14)", () => {
  it("pages the reader's own notifications by cursor (positive control)", async () => {
    const first = await get(viewer, "/api/notifications", {}, "");
    expect(first.status).toBe(200);
    expect(textOf(first.body)).toContain(FIX.notifications.viewerNew);
    const next = await get(viewer, "/api/notifications", {}, `before=${FIX.notifications.viewerNew}`);
    expect(next.status).toBe(200);
    expect(textOf(next.body)).toContain(FIX.notifications.viewerOld);
    expect(textOf(next.body)).not.toContain(FIX.notifications.viewerNew);
    // And the other fixtures are live rows their own readers are shown, so their absence below means something.
    expect(textOf((await get(owner, "/api/notifications", {}, "")).body)).toContain(FIX.notifications.owner);
    expect(textOf((await get(tenantOwner, "/api/projects", {}, "")).body)).toContain(PROJECT.companyB);
  });

  it("answers every forged cursor on every cursor-paged list without a server error or a foreign row", async () => {
    const tenantIds = await companyIdentifiers(COMPANY.tenant);
    const companyAIds = await companyIdentifiers(COMPANY.a);
    const riverside = await projectFootprint(COMPANY.a, [PROJECT.a], probe.membershipId);
    const otherPeoplesNotes = new Set<string>([FIX.notifications.owner, FIX.notifications.tenant]);
    const foreignTitles = [TITLE.owner, TITLE.tenant];

    const lists: { pattern: string; param: string; params?: Record<string, string> }[] = [
      { pattern: "/api/notifications", param: "before" },
      { pattern: "/api/activity-center", param: "cursor" },
      { pattern: "/api/my-work", param: "cursor" },
      { pattern: "/api/projects", param: "cursor" },
      { pattern: "/api/announcements", param: "cursor" },
      { pattern: "/api/collaboration/[parentType]/[parentId]/comments", param: "before", params: { parentType: "project", parentId: PROJECT.a } },
    ];
    const tenantComment = (await ownedRows("Comment", COMPANY.tenant))[0]?.id as string | undefined;
    const aComment = (await ownedRows("Comment", COMPANY.a))[0]?.id as string | undefined;
    const forged = [
      FIX.notifications.owner,
      FIX.notifications.tenant,
      PROJECT.companyB,
      PROJECT.a,
      ...(tenantComment ? [tenantComment] : []),
      ...(aComment ? [aComment] : []),
      "9999-12-31T23:59:59.999Z|zzzzzzzz",
      "1970-01-01T00:00:00.000Z|",
      `${new Date().toISOString()}|${FIX.notifications.owner}`,
      "999999",
      "0",
      b64({ s: "ACTIVE", v: ["", ""] }),
      b64({ s: "FINISHED", v: ["￿", "￿"] }),
      b64({ s: "ACTIVE", v: ["Riverside Residences", PROJECT.a] }),
      b64({ s: "PENDING", v: ["a", PROJECT.companyB], companyId: COMPANY.tenant }),
      "not-a-cursor",
      "' OR 1=1 --",
    ];

    // Who reads, and what must never reach them.
    const readers: [string, UserContext, Set<string>][] = [
      ["viewer", viewer, new Set([...tenantIds, ...otherPeoplesNotes])],
      ["probe PM", probe, new Set([...tenantIds, ...riverside.ids, ...otherPeoplesNotes])],
      ["tenant owner", tenantOwner, new Set([...companyAIds, FIX.notifications.owner, FIX.notifications.tenant].filter((id) => id !== COMPANY.tenant))],
    ];

    const problems: string[] = [];
    const statuses: Record<string, number> = {};
    for (const [who, context, foreign] of readers) {
      for (const list of lists) {
        for (const cursor of forged) {
          const outcome = await get(context, list.pattern, list.params ?? {}, `${list.param}=${encodeURIComponent(cursor)}`);
          statuses[outcome.status] = (statuses[outcome.status] ?? 0) + 1;
          const where = `${who} ${list.pattern}?${list.param}=${cursor.slice(0, 40)}`;
          if (outcome.thrown || outcome.status >= 500) problems.push(`${where}: ${outcome.status} ${outcome.thrown ?? textOf(outcome.body).slice(0, 160)}`);
          if (outcome.status < 300) {
            // The cursor itself is echoed only by the caller; anything else foreign is a leak.
            const leaked = foreignIdentifiersIn(outcome.body, foreign, new Set([cursor, ...Object.values(list.params ?? {})]));
            if (leaked.length > 0) problems.push(`${where}: carries ${leaked.slice(0, 4).join(", ")}`);
            const titles = foreignTitles.filter((title) => textOf(outcome.body).includes(title));
            if (titles.length > 0) problems.push(`${where}: carries ${titles.join(", ")}`);
          }
        }
      }
    }
    report.cursors = { statuses, problems };
    expect(problems).toEqual([]);
    expect(Object.values(statuses).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(250);
  }, 300_000);

  it("keeps a Project Manager's project list to their project whatever the cursor (positive control included)", async () => {
    const plain = await get(probe, "/api/projects", {}, "");
    expect(plain.status).toBe(200);
    expect(textOf(plain.body)).toContain(FIX.probe.projectId);
    expect(textOf(plain.body)).not.toContain(`"${PROJECT.a}"`);
    const forged = await get(probe, "/api/projects", {}, `cursor=${b64({ s: "PENDING", v: ["", ""] })}`);
    expect([200, 422]).toContain(forged.status);
    expect(textOf(forged.body)).not.toContain(`"${PROJECT.a}"`);
  });
});

/* -------------------------------------------------------------------------- */
/* Forged ids in bodies and query strings                                      */
/* -------------------------------------------------------------------------- */

const ACCEPTABLE_REFUSALS = new Set([400, 403, 404, 409, 422]);

type Forgery = { name: string; actor: () => UserContext; body: Record<string, unknown>; foreignName?: string };

/**
 * Sends each forgery, then the genuine body; asserts every forgery was refused
 * with nothing written in either company and the foreign record not named, and
 * the genuine one created. Everything created is removed.
 */
async function forgeCreate(pattern: string, forgeries: Forgery[], genuine: { actor: () => UserContext; body: Record<string, unknown> }, table: string) {
  const handlers = await routeHandlers(pattern);
  const baselineA = await companyRowIds(COMPANY.a);
  const baselineTenant = await companyRowIds(COMPANY.tenant);
  const baselineB = await companyRowIds(COMPANY.b);
  const problems: string[] = [];
  try {
    for (const forgery of forgeries) {
      actAs(forgery.actor());
      const outcome = await callRoute(handlers.POST!, "POST", pattern, {}, forgery.body);
      if (outcome.thrown || !ACCEPTABLE_REFUSALS.has(outcome.status)) problems.push(`${forgery.name}: ${outcome.status} ${outcome.thrown ?? textOf(outcome.body).slice(0, 200)}`);
      if (forgery.foreignName && textOf(outcome.body).includes(forgery.foreignName)) problems.push(`${forgery.name}: the refusal names ${forgery.foreignName}`);
    }
    // Nothing written by any forgery, in the attacker's company or the one the ids came from.
    const count = async (companyId: string) => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE "companyId" = $1`, companyId))[0].n);
    expect(await count(COMPANY.a)).toBe(baselineA.get(table)?.size ?? 0);
    expect(await count(COMPANY.tenant)).toBe(baselineTenant.get(table)?.size ?? 0);
    expect(await count(COMPANY.b)).toBe(baselineB.get(table)?.size ?? 0);

    actAs(genuine.actor());
    const ok = await callRoute(handlers.POST!, "POST", pattern, {}, genuine.body);
    if (ok.status !== 201) problems.push(`genuine: ${ok.status} ${textOf(ok.body).slice(0, 200)}`);
  } finally {
    actAs(null);
    expect(await removeRowsCreatedSince(COMPANY.a, baselineA)).toEqual([]);
    expect(await removeRowsCreatedSince(COMPANY.tenant, baselineTenant)).toEqual([]);
    expect(await removeRowsCreatedSince(COMPANY.b, baselineB)).toEqual([]);
  }
  return problems;
}

describe("forged ids in a create are refused; the reader's own are accepted (RP-14)", () => {
  let tenant: { project: { id: string; name: string }; client: { id: string; name: string }; member: string; unit: string };

  beforeAll(async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: PROJECT.companyB }, select: { id: true, name: true } });
    const client = await prisma.client.findFirstOrThrow({ where: { companyId: COMPANY.tenant }, select: { id: true, name: true } });
    const member = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.tenant }, select: { id: true } });
    const unit = await prisma.projectUnit.findFirstOrThrow({ where: { companyId: COMPANY.tenant }, select: { id: true } });
    tenant = { project, client, member: member.id, unit: unit.id };
  });

  it("task: another company's project or assignee, another project of one's own company", async () => {
    const problems = await forgeCreate(
      "/api/tasks",
      [
        { name: "tenant project", actor: () => owner, body: { title: `${MARK} task`, projectId: tenant.project.id }, foreignName: tenant.project.name },
        { name: "tenant assignee", actor: () => owner, body: { title: `${MARK} task`, assigneeMemberId: tenant.member } },
        { name: "project out of the PM's reach", actor: () => probe, body: { title: `${MARK} task`, projectId: PROJECT.a } },
      ],
      { actor: () => owner, body: { title: `${MARK} task`, projectId: PROJECT.a, assigneeMemberId: viewer.membershipId } },
      "tasks",
    );
    expect(problems).toEqual([]);
  });

  it("task: a companyId in the body is ignored, never obeyed", async () => {
    const handlers = await routeHandlers("/api/tasks");
    const baseline = await companyRowIds(COMPANY.a);
    const tenantTasks = await prisma.task.count({ where: { companyId: COMPANY.tenant } });
    try {
      actAs(owner);
      const outcome = await callRoute(handlers.POST!, "POST", "/api/tasks", {}, { title: `${MARK} company`, companyId: COMPANY.tenant, createdByMemberId: tenant.member });
      expect(outcome.status).toBe(201);
      const id = (outcome.body as { data: { id: string } }).data.id;
      const row = await prisma.task.findUniqueOrThrow({ where: { id }, select: { companyId: true, createdByMemberId: true } });
      expect(row).toEqual({ companyId: COMPANY.a, createdByMemberId: owner.membershipId });
      expect(await prisma.task.count({ where: { companyId: COMPANY.tenant } })).toBe(tenantTasks);
    } finally {
      actAs(null);
      expect(await removeRowsCreatedSince(COMPANY.a, baseline)).toEqual([]);
    }
  });

  it("task update: moving one's own task onto another company's project", async () => {
    const handlers = await routeHandlers("/api/tasks");
    const item = await routeHandlers("/api/tasks/[taskId]");
    const baseline = await companyRowIds(COMPANY.a);
    try {
      actAs(owner);
      const created = await callRoute(handlers.POST!, "POST", "/api/tasks", {}, { title: `${MARK} move` });
      const id = (created.body as { data: { id: string } }).data.id;
      const before = await prisma.task.findUniqueOrThrow({ where: { id } });
      for (const body of [{ projectId: tenant.project.id }, { assigneeMemberId: tenant.member }]) {
        const outcome = await callRoute(item.PATCH!, "PATCH", `/api/tasks/${id}`, { taskId: id }, { title: `${MARK} move`, ...body, ...(await taskVersion(id)) });
        expect(ACCEPTABLE_REFUSALS.has(outcome.status), `${JSON.stringify(body)}: ${outcome.status} ${textOf(outcome.body)}`).toBe(true);
        expect(textOf(outcome.body)).not.toContain(tenant.project.name);
      }
      expect(await prisma.task.findUniqueOrThrow({ where: { id } })).toEqual(before);
      // Positive control: the same edit onto the company's own project.
      const moved = await callRoute(item.PATCH!, "PATCH", `/api/tasks/${id}`, { taskId: id }, { title: `${MARK} move`, projectId: PROJECT.a, ...(await taskVersion(id)) });
      expect(moved.status, textOf(moved.body)).toBe(200);
      expect((await prisma.task.findUniqueOrThrow({ where: { id } })).projectId).toBe(PROJECT.a);
    } finally {
      actAs(null);
      expect(await removeRowsCreatedSince(COMPANY.a, baseline)).toEqual([]);
    }
  });

  it("invoice: another company's client or project", async () => {
    const invoice = { currency: "EUR", issueDate: "2026-09-14", dueDate: "2026-09-30", notes: MARK, lineItems: [{ description: `${MARK} line`, quantity: "1", unitPrice: "100", taxRate: "0" }] };
    const problems = await forgeCreate(
      "/api/finance/invoices",
      [
        { name: "tenant client", actor: () => owner, body: { ...invoice, clientId: tenant.client.id }, foreignName: tenant.client.name },
        { name: "tenant project", actor: () => owner, body: { ...invoice, clientId: "client_acme", projectId: tenant.project.id }, foreignName: tenant.project.name },
      ],
      { actor: () => owner, body: { ...invoice, clientId: "client_acme", projectId: PROJECT.a } },
      "invoices",
    );
    expect(problems).toEqual([]);
  });

  it("meeting: another company's participant or project", async () => {
    const meeting = { title: `${MARK} meeting`, startTime: "09:00", endTime: "10:00", date: "2026-10-14", meetingType: "INTERNAL", visibility: "PARTICIPANTS", saveAsDraft: true };
    const problems = await forgeCreate(
      "/api/meetings",
      [
        { name: "tenant participant", actor: () => owner, body: { ...meeting, participants: [{ memberId: tenant.member }] } },
        { name: "tenant project", actor: () => owner, body: { ...meeting, visibility: "PROJECT", projectId: tenant.project.id }, foreignName: tenant.project.name },
      ],
      { actor: () => owner, body: { ...meeting, participants: [{ memberId: viewer.membershipId }] } },
      "meetings",
    );
    expect(problems).toEqual([]);
  });

  it("leave: filed by HR for an employee of another company", async () => {
    const otherEmployee = (await ownedRows("EmployeeProfile", COMPANY.b))[0]?.id as string;
    const ownEmployee = await prisma.employeeProfile.findFirstOrThrow({ where: { companyId: COMPANY.a, companyMember: { user: { email: "architect@nesto.test" } } }, select: { id: true } });
    const leave = { leaveType: "UNPAID", startDate: "2026-12-14", endDate: "2026-12-15", reason: MARK };
    const problems = await forgeCreate(
      "/api/hr/leave",
      [{ name: "company B employee", actor: () => hr, body: { ...leave, employeeId: otherEmployee } }],
      { actor: () => hr, body: { ...leave, employeeId: ownEmployee.id } },
      "leave_requests",
    );
    expect(problems).toEqual([]);
  });

  it("deal: another company's unit", async () => {
    const pattern = "/api/sales/opportunities/[opportunityId]/units";
    const handlers = await routeHandlers(pattern);
    const params = { opportunityId: "opportunity_001" };
    const path = fillPattern(pattern, params);
    const restore = await captureCompanyRows(COMPANY.a);
    try {
      const linked = await prisma.opportunityUnit.count({ where: { opportunityId: params.opportunityId } });
      actAs(owner);
      const forged = await callRoute(handlers.POST!, "POST", path, params, { unitId: tenant.unit });
      expect(ACCEPTABLE_REFUSALS.has(forged.status), `${forged.status} ${textOf(forged.body)}`).toBe(true);
      expect(await prisma.opportunityUnit.count({ where: { opportunityId: params.opportunityId } })).toBe(linked);
      expect(await prisma.opportunityUnit.count({ where: { unitId: tenant.unit } })).toBe(0);

      // Positive control: a unit of the company's own, not yet in the deal.
      const taken = new Set((await prisma.opportunityUnit.findMany({ where: { opportunityId: params.opportunityId }, select: { unitId: true } })).map((row) => row.unitId));
      const candidates = (await prisma.projectUnit.findMany({ where: { companyId: COMPANY.a, projectId: PROJECT.a }, select: { id: true }, orderBy: { id: "asc" } })).filter((unit) => !taken.has(unit.id));
      let accepted = 0;
      for (const unit of candidates.slice(0, 10)) {
        const outcome = await callRoute(handlers.POST!, "POST", path, params, { unitId: unit.id });
        if (outcome.status === 201) {
          accepted += 1;
          break;
        }
      }
      expect(accepted).toBe(1);
    } finally {
      actAs(null);
      expect(await restore()).toEqual([]);
    }
  });
});

describe("forged ids in a query string narrow nothing open (RP-14)", () => {
  it("answers a filter naming another company's record without its rows", async () => {
    const tenantIds = await companyIdentifiers(COMPANY.tenant);
    const project = PROJECT.companyB;
    const client = (await ownedRows("Client", COMPANY.tenant))[0].id as string;
    const reads: [string, string][] = [
      ["/api/tasks", `projectId=${project}`],
      ["/api/finance/invoices", `clientId=${client}&projectId=${project}`],
      ["/api/calendar/events", `projectId=${project}&from=2026-08-01T00:00:00.000Z&to=2026-10-15T00:00:00.000Z`],
      ["/api/documents", `projectId=${project}`],
      ["/api/meetings", `projectId=${project}`],
      ["/api/search", `q=Munich&projectId=${project}`],
    ];
    const problems: string[] = [];
    for (const [pattern, query] of reads) {
      const outcome = await get(owner, pattern, {}, query);
      if (outcome.thrown || outcome.status >= 500) problems.push(`${pattern}?${query}: ${outcome.status}`);
      else if (outcome.status < 300) {
        const leaked = foreignIdentifiersIn(outcome.body, tenantIds, new Set([project, client]));
        if (leaked.length > 0) problems.push(`${pattern}?${query}: carries ${leaked.slice(0, 4).join(", ")}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("refuses an Activity Center company filter naming a company the reader cannot use, and serves their own", async () => {
    const foreign = await get(viewer, "/api/activity-center", {}, `companyId=${COMPANY.tenant}`);
    expect(ACCEPTABLE_REFUSALS.has(foreign.status), `${foreign.status} ${textOf(foreign.body)}`).toBe(true);
    const sibling = await get(viewer, "/api/activity-center", {}, `companyId=${COMPANY.b}`);
    expect(ACCEPTABLE_REFUSALS.has(sibling.status), `${sibling.status} ${textOf(sibling.body)}`).toBe(true);
    const own = await get(viewer, "/api/activity-center", {}, `companyId=${COMPANY.a}`);
    expect(own.status).toBe(200);
  });
});
