import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as listTasksRoute, POST as createTaskRoute } from "@/app/api/tasks/route";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { taskListQuerySchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import {
  listTasksForWorkspace,
  priorityTasksForWorkspace,
  taskExperience,
  taskFilterOptionsForWorkspace,
  taskOverviewForWorkspace,
} from "@/lib/modules/tasks/task.workspace";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * My Work in the Group workspace (Workspace Context §32, §45, §57-§60, §86, §87).
 *
 * Real sessions, real resolver, real database. Tasks are made in three companies
 * of the demo group and one of another group; the Owner (a member of every demo
 * company, with group standing) reads them from the group, and the same Owner in
 * one company reads only that company's.
 */

const PREFIX = "WSG-T";
const ids = {
  a: "wsg_task_a",
  b: "wsg_task_b",
  bColleague: "wsg_task_b_colleague",
  d: "wsg_task_d_overdue",
  multiA: "wsg_task_multi_a",
  multiD: "wsg_task_multi_d",
  tenant: "wsg_task_tenant",
};
const ALL = Object.values(ids);
const restore: Array<() => Promise<unknown>> = [];
let names: Record<string, string> = {};

const member = (userEmail: string, companyId: string) =>
  prisma.companyMember.findFirstOrThrow({ where: { companyId, user: { email: userEmail } }, select: { id: true, userId: true } });

beforeAll(async () => {
  names = Object.fromEntries((await prisma.company.findMany({ select: { id: true, name: true } })).map((company) => [company.id, company.name]));
  await prisma.task.deleteMany({ where: { id: { in: ALL } } });

  const ownerA = await member("owner@nesto.test", COMPANY.a);
  const ownerB = await member("owner@nesto.test", COMPANY.b);
  const ownerD = await member("owner@nesto.test", COMPANY.d);
  const pmB = await member(DEMO_EMAIL.pmB, COMPANY.b);
  const multiA = await member(DEMO_EMAIL.multiCompany, COMPANY.a);
  const multiD = await member(DEMO_EMAIL.multiCompany, COMPANY.d);
  const tenantMember = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.tenant }, select: { id: true, userId: true } });

  const make = (id: string, companyId: string, title: string, creator: { id: string; userId: string }, extra: Record<string, unknown> = {}) =>
    prisma.task.create({ data: { id, companyId, title: `${PREFIX} ${title}`, createdByMemberId: creator.id, createdBy: creator.userId, ...extra } });

  await make(ids.a, COMPANY.a, "Aurelia site walk", ownerA, { assigneeMemberId: ownerA.id, priority: "HIGH" });
  await make(ids.b, COMPANY.b, "Meridian permit review", ownerB, { assigneeMemberId: ownerB.id, priority: "HIGH" });
  // Somebody else's work in Meridian: the Owner can read it there, but it is not theirs.
  await make(ids.bColleague, COMPANY.b, "Meridian colleague task", ownerB, { assigneeMemberId: pmB.id });
  await make(ids.d, COMPANY.d, "Forma overdue drawing set", ownerD, { assigneeMemberId: ownerD.id, priority: "CRITICAL", status: "IN_PROGRESS", dueDate: new Date(Date.now() - 3 * 86_400_000) });
  await make(ids.multiA, COMPANY.a, "Aurelia multi-company architect task", ownerA, { assigneeMemberId: multiA.id });
  await make(ids.multiD, COMPANY.d, "Forma multi-company architect task", ownerD, { assigneeMemberId: multiD.id });
  await make(ids.tenant, COMPANY.tenant, "Fixture tenant task", tenantMember, { assigneeMemberId: tenantMember.id, priority: "CRITICAL" });
}, 60_000);

afterEach(async () => {
  actAs(null);
  for (const undo of restore.splice(0).reverse()) await undo();
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { id: { in: ALL } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

const query = (overrides: Record<string, unknown> = {}) => taskListQuerySchema.parse({ search: PREFIX, limit: 100, sort: "title-asc", ...overrides });
const idsOf = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort();

/** Company C's Tasks module off, restored after the test — the person then holds it in the other companies only. */
async function switchTasksOff(companyId: string) {
  const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId, module: { key: "tasks" } } });
  await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
  restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));
}

describe("the Group workspace list (§32, §45)", () => {
  it("reads every company the Owner may open Tasks in, each row naming its company", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    expect(owner.workspace.scopeType).toBe("GROUP");

    const result = await listTasksForWorkspace(owner, query());

    expect(idsOf(result.data)).toEqual([ids.a, ids.b, ids.bColleague, ids.d, ids.multiA, ids.multiD].sort());
    expect(result.pagination.total).toBe(6);
    for (const row of result.data) expect(row.company, row.id).toBeDefined();
    const byId = new Map(result.data.map((row) => [row.id, row]));
    expect(byId.get(ids.a)?.company).toEqual({ id: COMPANY.a, name: names[COMPANY.a] });
    expect(byId.get(ids.b)?.company).toEqual({ id: COMPANY.b, name: names[COMPANY.b] });
    expect(byId.get(ids.d)?.company).toEqual({ id: COMPANY.d, name: names[COMPANY.d] });
  });

  it("never reads another group's company, whatever the search or the company filter", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const plain = await listTasksForWorkspace(owner, query());
    const asked = await listTasksForWorkspace(owner, query({ company: COMPANY.tenant }));
    expect(idsOf(plain.data)).not.toContain(ids.tenant);
    expect(idsOf(asked.data)).not.toContain(ids.tenant);
  });

  it("keeps a company workspace to its own company, with no company on the row", async () => {
    const owner = await loginAs("OWNER");
    expect(owner.workspace.scopeType).toBe("COMPANY");

    const result = await listTasksForWorkspace(owner, query());

    expect(idsOf(result.data)).toEqual([ids.a, ids.multiA].sort());
    for (const row of result.data) expect(row.company).toBeUndefined();
    // The company path is the existing service, byte for byte.
    expect(result).toEqual(await tasks.listTasks(owner, query()));
  });

  it("gives My Tasks each company's own 'mine': the Owner's assignments there, not a colleague's", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const mine = await listTasksForWorkspace(owner, query({ mine: true }));
    expect(idsOf(mine.data)).toEqual([ids.a, ids.b, ids.d].sort());
    expect(idsOf(mine.data)).not.toContain(ids.bColleague);
    for (const row of mine.data) {
      const context = (await resolveWorkspaceContexts(owner, { module: "tasks" })).find((candidate) => candidate.companyId === row.company?.id);
      expect(row.assignee?.memberId, row.id).toBe(context?.membershipId);
    }
  });

  it("aggregates the Overdue section across companies, open work only", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const overdue = await listTasksForWorkspace(owner, query({ due: "overdue", openOnly: true }));
    expect(idsOf(overdue.data)).toEqual([ids.d]);
    expect(overdue.data[0]).toMatchObject({ isOverdue: true, company: { id: COMPANY.d } });
  });

  it("pages and orders over the union, not over each company's page", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const everything = await listTasksForWorkspace(owner, query());
    const titles = everything.data.map((row) => row.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));

    const first = await listTasksForWorkspace(owner, query({ limit: 2, page: 1 }));
    const second = await listTasksForWorkspace(owner, query({ limit: 2, page: 2 }));
    const third = await listTasksForWorkspace(owner, query({ limit: 2, page: 3 }));
    expect(first.pagination.total).toBe(6);
    expect([...first.data, ...second.data, ...third.data].map((row) => row.id)).toEqual(everything.data.map((row) => row.id));
  });
});

describe("only the companies where the person holds Tasks (§58, §60, §92)", () => {
  it("leaves out a company that switched Tasks off, and reads the others", async () => {
    await switchTasksOff(COMPANY.b);
    const owner = await loginAs("OWNER", { workspace: "GROUP" });

    const result = await listTasksForWorkspace(owner, query());

    expect(idsOf(result.data)).toEqual([ids.a, ids.d, ids.multiA, ids.multiD].sort());
    expect(result.data.every((row) => row.company?.id !== COMPANY.b)).toBe(true);
    const options = await taskFilterOptionsForWorkspace(owner);
    expect(options.companies.map((company) => company.id)).not.toContain(COMPANY.b);
    // The overview sums the same companies: none of Meridian's counts is in it.
    const overview = await taskOverviewForWorkspace(owner);
    const contexts = await resolveWorkspaceContexts(owner, { module: "tasks", permission: "task.view" });
    let open = 0;
    for (const context of contexts) open += (await tasks.getTaskOverview(await loginAsMembership(context.membershipId))).open;
    expect(overview.open).toBe(open);
  });

  it("gives a multi-company person their own two companies and never a third (§60, §62)", async () => {
    // Architect in Aurelia and Forma. Working in two companies opens the group
    // (§7), and the group is the union of those two, read with each one's own
    // rules — it adds nothing they could not already read there.
    const architect = await loginAsEmail(DEMO_EMAIL.multiCompany, { workspace: "GROUP" });
    expect(architect.workspace.scopeType).toBe("GROUP");

    const result = await listTasksForWorkspace(architect, query());
    expect(idsOf(result.data)).toEqual([ids.multiA, ids.multiD].sort());
    expect(new Set(result.data.map((row) => row.company?.id))).toEqual(new Set([COMPANY.a, COMPANY.d]));
    // Meridian is not theirs, so nothing of it is reachable by asking for it.
    expect(idsOf((await listTasksForWorkspace(architect, query({ company: COMPANY.b }))).data)).not.toContain(ids.b);
  });

  it("gives a company-only employee their own company however the session was asked (§16, §91)", async () => {
    const pm = await loginAs("PROJECT_MANAGER", { workspace: "GROUP" });
    expect(pm.workspace.scopeType).toBe("COMPANY");

    const result = await listTasksForWorkspace(pm, query({ company: COMPANY.d }));
    expect(idsOf(result.data)).not.toContain(ids.d);
    for (const row of result.data) expect(row.company).toBeUndefined();
  });
});

describe("the company filter (§86, §87)", () => {
  it("narrows the group list to one company", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const b = await listTasksForWorkspace(owner, query({ company: COMPANY.b }));
    expect(idsOf(b.data)).toEqual([ids.b, ids.bColleague].sort());
    expect(b.pagination.total).toBe(2);
    expect(b.data.every((row) => row.company?.id === COMPANY.b)).toBe(true);
  });

  // AUD-08 §3, DT-22: an unreadable, suspended, unknown or switched-off company
  // answers no rows — the same empty answer for each, so nothing is disclosed.
  // It used to be ignored and answer every company: a silent broadening.
  it("a company the person may not read: no error, no rows, nothing disclosed", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const everything = await listTasksForWorkspace(owner, query());
    expect(everything.data.length).toBeGreaterThan(0);
    for (const company of [COMPANY.tenant, COMPANY.suspended, "company_that_does_not_exist"]) {
      const asked = await listTasksForWorkspace(owner, query({ company }));
      expect(idsOf(asked.data), company).toEqual([]);
      expect(asked.pagination.total, company).toBe(0);
    }
    // A company that switched Tasks off is a company the person may not read from here.
    await switchTasksOff(COMPANY.b);
    const fresh = await loginAs("OWNER", { workspace: "GROUP" });
    const off = await listTasksForWorkspace(fresh, query({ company: COMPANY.b }));
    expect(idsOf(off.data)).toEqual([]);
    // Positive control: a readable company still narrows to its own rows.
    const readable = await listTasksForWorkspace(fresh, query({ company: COMPANY.d }));
    expect(idsOf(readable.data)).toEqual([ids.d, ids.multiD].sort());
  });

  it("is locked in a company workspace: the list stays that company's", async () => {
    const owner = await loginAs("OWNER");
    const result = await listTasksForWorkspace(owner, query({ company: COMPANY.b }));
    expect(idsOf(result.data)).toEqual([ids.a, ids.multiA].sort());
  });

  it("offers the companies to narrow to, and projects named with theirs, but no cross-company assignee", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const options = await taskFilterOptionsForWorkspace(owner);
    expect(options.companies.map((company) => company.id).sort()).toEqual([COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e].sort());
    expect(options.assignees).toEqual([]);
    expect(options.projects.length).toBeGreaterThan(0);
    for (const project of options.projects) expect(project.name).toMatch(/ · /);

    const inCompany = await taskFilterOptionsForWorkspace(await loginAs("OWNER"));
    expect(inCompany.companies).toEqual([]);
    expect(inCompany.assignees.length).toBeGreaterThan(0);
  });
});

describe("the overview (§32)", () => {
  it("sums each company's own counters", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const overview = await taskOverviewForWorkspace(owner);

    const contexts = await resolveWorkspaceContexts(owner, { module: "tasks", permission: "task.view" });
    expect(contexts.length).toBe(5);
    const sum = { open: 0, dueToday: 0, overdue: 0, blocked: 0, completedThisWeek: 0, mine: 0 };
    for (const context of contexts) {
      const own = await tasks.getTaskOverview(await loginAsMembership(context.membershipId));
      for (const key of Object.keys(sum) as Array<keyof typeof sum>) sum[key] += own[key];
    }
    expect(overview).toEqual(sum);
    expect(overview.open).toBeGreaterThan((await tasks.getTaskOverview(await loginAs("OWNER"))).open);
  });

  it("lists the priority work of every company, naming each", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const priority = await priorityTasksForWorkspace(owner, 100);
    const byId = new Map(priority.map((row) => [row.id, row]));
    expect(byId.get(ids.a)?.company?.id).toBe(COMPANY.a);
    expect(byId.get(ids.b)?.company?.id).toBe(COMPANY.b);
    expect(byId.get(ids.d)?.company?.id).toBe(COMPANY.d);
    expect(byId.has(ids.tenant)).toBe(false);
    expect(byId.has(ids.bColleague)).toBe(false);
    // Critical before high, as in a company.
    const order = priority.map((row) => row.priority);
    expect(order).toEqual([...order].sort((a, b) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(b) - ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(a)));
  });
});

describe("the module's tabs", () => {
  it("offer only the sections that read across companies in the group, and every section in a company", async () => {
    const group = taskExperience(await loginAs("OWNER", { workspace: "GROUP" }));
    expect(group.sections.map((section) => section.key)).toEqual(["overview", "my-tasks", "all", "overdue", "completed"]);
    const company = taskExperience(await loginAs("OWNER"));
    expect(company.sections.map((section) => section.key)).toContain("archived");
  });
});

describe("GET /api/tasks and POST /api/tasks", () => {
  const get = (search = "") => listTasksRoute(new Request(`http://nesto.test/api/tasks?search=${PREFIX}&limit=100${search}`));

  it("answers the group's union in the group workspace", async () => {
    actAs(await loginAs("OWNER", { workspace: "GROUP" }));
    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string; company?: { id: string; name: string } }>; pagination: { total: number } };
    expect(idsOf(body.data)).toEqual([ids.a, ids.b, ids.bColleague, ids.d, ids.multiA, ids.multiD].sort());
    // §45: every row names the company it belongs to.
    expect(body.data.every((row) => row.company !== undefined && row.company.name === names[row.company.id])).toBe(true);
  });

  // AUD-08 §3, DT-22: a company the caller may not read narrows to nothing. It
  // used to be dropped, answering all six rows — a silent broadening.
  it("narrows by company; one the caller may not read answers no rows, never every company", async () => {
    actAs(await loginAs("OWNER", { workspace: "GROUP" }));
    const narrowed = (await (await get(`&company=${COMPANY.d}`)).json()) as { data: Array<{ id: string }> };
    expect(idsOf(narrowed.data)).toEqual([ids.d, ids.multiD].sort());
    const foreign = await get(`&company=${COMPANY.tenant}`);
    expect(foreign.status).toBe(200);
    const body = (await foreign.json()) as { data: Array<{ id: string }>; pagination: { total: number } };
    expect(idsOf(body.data)).not.toContain(ids.tenant);
    expect(body.data.length).toBe(0);
    expect(body.pagination.total).toBe(0);
  });

  it("answers the company's own list, with no company on the row, in a company workspace", async () => {
    actAs(await loginAs("OWNER"));
    const response = await get(`&company=${COMPANY.b}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string; company?: unknown }> };
    expect(idsOf(body.data)).toEqual([ids.a, ids.multiA].sort());
    expect(body.data.every((row) => row.company === undefined)).toBe(true);
  });

  it("refuses a create in the group workspace and creates nothing", async () => {
    actAs(await loginAs("OWNER", { workspace: "GROUP" }));
    const before = await prisma.task.count();
    const response = await createTaskRoute(
      new Request("http://nesto.test/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `${PREFIX} refused in the group` }) }),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("WORKSPACE_COMPANY_REQUIRED");
    expect(await prisma.task.count()).toBe(before);
  });
});

describe("what the group asks each company (§57)", () => {
  it("reads the contexts from the resolver, so a company id in a request is never authority", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const contexts: UserContext[] = await resolveWorkspaceContexts(owner, { module: "tasks", permission: "task.view" });
    expect(contexts.map((context) => context.companyId).sort()).toEqual([COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e].sort());
  });
});
