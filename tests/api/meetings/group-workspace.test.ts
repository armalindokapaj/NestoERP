import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as listActionsRoute } from "@/app/api/meetings/actions/route";
import { GET as listMeetingsRoute, POST as createMeetingRoute } from "@/app/api/meetings/route";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { listActionItems } from "@/lib/modules/meetings/meeting.actions";
import { actionListQuerySchema, meetingListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { listMeetings } from "@/lib/modules/meetings/meeting.service";
import {
  listActionItemsForWorkspace,
  listMeetingsForWorkspace,
  meetingCompanyOptions,
  meetingExperience,
  meetingFilterOptionsForWorkspace,
} from "@/lib/modules/meetings/meeting.workspace";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * Meetings in the Group workspace (Workspace Context §34, §45, §57-§60, §86, §87).
 *
 * Real sessions, real resolver, real database. Meetings are made in three
 * companies of the demo group, each in a different time zone, and one in another
 * group. The Owner (a member of every demo company, with group standing) reads
 * them from the group; in one company the same Owner reads only that company's.
 */

const PREFIX = "WSG-M";
const DAY = 86_400_000;
const ids = {
  a: "wsg_meeting_a",
  aMulti: "wsg_meeting_a_multi",
  b: "wsg_meeting_b",
  bAttending: "wsg_meeting_b_attending",
  bColleague: "wsg_meeting_b_colleague",
  bPrivate: "wsg_meeting_b_private",
  d: "wsg_meeting_d",
  dMulti: "wsg_meeting_d_multi",
  dPast: "wsg_meeting_d_past",
  tenant: "wsg_meeting_tenant",
};
const actionIds = { a: "wsg_action_a", b: "wsg_action_b", bColleague: "wsg_action_b_colleague", d: "wsg_action_d_done", tenant: "wsg_action_tenant" };
const ALL = Object.values(ids);
const ALL_ACTIONS = Object.values(actionIds);
const restore: Array<() => Promise<unknown>> = [];
let names: Record<string, string> = {};
const startedAt: Record<string, Date> = {};

const member = (userEmail: string, companyId: string) =>
  prisma.companyMember.findFirstOrThrow({ where: { companyId, user: { email: userEmail } }, select: { id: true, userId: true, user: { select: { firstName: true, lastName: true } } } });

async function clear() {
  await prisma.meetingActionItem.deleteMany({ where: { id: { in: ALL_ACTIONS } } });
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: ALL } } });
  await prisma.meeting.deleteMany({ where: { id: { in: ALL } } });
}

beforeAll(async () => {
  names = Object.fromEntries((await prisma.company.findMany({ select: { id: true, name: true } })).map((company) => [company.id, company.name]));
  await clear();

  const ownerA = await member("owner@nesto.test", COMPANY.a);
  const ownerB = await member("owner@nesto.test", COMPANY.b);
  const ownerD = await member("owner@nesto.test", COMPANY.d);
  const pmB = await member(DEMO_EMAIL.pmB, COMPANY.b);
  const multiA = await member(DEMO_EMAIL.multiCompany, COMPANY.a);
  const multiD = await member(DEMO_EMAIL.multiCompany, COMPANY.d);
  const tenantOwner = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.tenant, user: { email: DEMO_EMAIL.tenantOwner } }, select: { id: true } });

  const now = Date.now();
  const make = async (
    id: string,
    companyId: string,
    title: string,
    organizerMemberId: string,
    options: { inDays: number; timezone: string; visibility?: "COMPANY" | "PARTICIPANTS"; status?: "SCHEDULED" | "COMPLETED"; participants?: Array<{ id: string; name: string }> },
  ) => {
    const startsAt = new Date(now + options.inDays * DAY);
    startedAt[id] = startsAt;
    await prisma.meeting.create({
      data: {
        id,
        companyId,
        title: `${PREFIX} ${title}`,
        meetingType: "INTERNAL",
        status: options.status ?? "SCHEDULED",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        timezone: options.timezone,
        visibility: options.visibility ?? "COMPANY",
        organizerMemberId,
        createdByMemberId: organizerMemberId,
        participants: {
          create: (options.participants ?? []).map((participant) => ({ memberId: participant.id, companyId, displayName: participant.name })),
        },
      },
    });
  };

  await make(ids.d, COMPANY.d, "Forma design coordination", ownerD.id, { inDays: 1, timezone: "Asia/Tokyo" });
  await make(ids.a, COMPANY.a, "Aurelia weekly review", ownerA.id, { inDays: 2, timezone: "Europe/Tirane" });
  await make(ids.b, COMPANY.b, "Meridian investor update", ownerB.id, { inDays: 3, timezone: "America/New_York" });
  // Somebody else's, open to the whole company: the Owner reads it in Meridian without being on it.
  await make(ids.bColleague, COMPANY.b, "Meridian sales huddle", pmB.id, { inDays: 4, timezone: "America/New_York" });
  // Somebody else's, and private to its participants: the Owner is on it, so it is theirs.
  await make(ids.bAttending, COMPANY.b, "Meridian one to one", pmB.id, { inDays: 5, timezone: "America/New_York", visibility: "PARTICIPANTS", participants: [{ id: ownerB.id, name: "Owner" }] });
  // Private to people the Owner is not among: not theirs to open, even as the Owner.
  await make(ids.bPrivate, COMPANY.b, "Meridian private matter", pmB.id, { inDays: 6, timezone: "America/New_York", visibility: "PARTICIPANTS" });
  await make(ids.aMulti, COMPANY.a, "Aurelia architect sync", ownerA.id, { inDays: 7, timezone: "Europe/Tirane", visibility: "PARTICIPANTS", participants: [{ id: multiA.id, name: "Multi Architect" }] });
  await make(ids.dMulti, COMPANY.d, "Forma architect sync", ownerD.id, { inDays: 8, timezone: "Asia/Tokyo", visibility: "PARTICIPANTS", participants: [{ id: multiD.id, name: "Multi Architect" }] });
  await make(ids.dPast, COMPANY.d, "Forma kickoff", ownerD.id, { inDays: -3, timezone: "Asia/Tokyo", status: "COMPLETED" });
  await make(ids.tenant, COMPANY.tenant, "Fixture tenant board", tenantOwner.id, { inDays: 2, timezone: "UTC" });

  const action = (id: string, companyId: string, meetingId: string, title: string, owner: { id: string }, extra: Record<string, unknown> = {}) =>
    prisma.meetingActionItem.create({ data: { id, companyId, meetingId, title: `${PREFIX} ${title}`, ownerMemberId: owner.id, createdByMemberId: owner.id, ...extra } });
  await action(actionIds.a, COMPANY.a, ids.a, "Send the Aurelia minutes", ownerA);
  await action(actionIds.b, COMPANY.b, ids.b, "Circulate the Meridian deck", ownerB);
  await action(actionIds.bColleague, COMPANY.b, ids.bColleague, "Meridian colleague follow-up", pmB);
  await action(actionIds.d, COMPANY.d, ids.dPast, "Forma kickoff notes", ownerD, { status: "DONE", completedAt: new Date() });
  await action(actionIds.tenant, COMPANY.tenant, ids.tenant, "Fixture tenant follow-up", tenantOwner);
}, 60_000);

afterEach(async () => {
  actAs(null);
  for (const undo of restore.splice(0).reverse()) await undo();
});

afterAll(async () => {
  await clear();
  await cleanupSessions();
  await prisma.$disconnect();
});

const meetingQuery = (overrides: Record<string, unknown> = {}) => meetingListQuerySchema.parse({ q: PREFIX, limit: 100, ...overrides });
const actionQuery = (overrides: Record<string, unknown> = {}) => actionListQuerySchema.parse({ mine: "false", status: "all", limit: 100, ...overrides });
const idsOf = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort();
const sortedIds = (...values: string[]) => [...values].sort();
/** The demo's own actions are in the list too; only the test's are the subject. */
const mineOnly = <T extends { title: string }>(rows: T[]) => rows.filter((row) => row.title.startsWith(PREFIX));

async function switchMeetingsOff(companyId: string) {
  const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId, module: { key: "meetings" } } });
  await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
  restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));
}

describe("the Group workspace list (§34, §45)", () => {
  it("reads every company the Owner may open Meetings in, each row naming its company", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    expect(owner.workspace.scopeType).toBe("GROUP");

    const result = await listMeetingsForWorkspace(owner, meetingQuery());

    // Each company applies its own rule: the private Meridian meeting is not the Owner's to open.
    expect(idsOf(result.data)).toEqual(sortedIds(ids.a, ids.aMulti, ids.b, ids.bAttending, ids.bColleague, ids.d, ids.dMulti));
    expect(result.pagination.total).toBe(7);
    const byId = new Map(result.data.map((row) => [row.id, row]));
    expect(byId.get(ids.a)?.company).toEqual({ id: COMPANY.a, name: names[COMPANY.a] });
    expect(byId.get(ids.b)?.company).toEqual({ id: COMPANY.b, name: names[COMPANY.b] });
    expect(byId.get(ids.d)?.company).toEqual({ id: COMPANY.d, name: names[COMPANY.d] });
    for (const row of result.data) expect(row.company, row.id).toBeDefined();
  });

  it("orders upcoming meetings soonest first across companies", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const result = await listMeetingsForWorkspace(owner, meetingQuery({ section: "upcoming" }));
    expect(result.data.map((row) => row.id)).toEqual([ids.d, ids.a, ids.b, ids.bColleague, ids.bAttending, ids.aMulti, ids.dMulti]);
  });

  it("keeps each meeting in its own company's time zone: nothing is converted on the way through", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const result = await listMeetingsForWorkspace(owner, meetingQuery());
    const byId = new Map(result.data.map((row) => [row.id, row]));
    expect(byId.get(ids.d)).toMatchObject({ timezone: "Asia/Tokyo", startsAt: startedAt[ids.d].toISOString() });
    expect(byId.get(ids.a)).toMatchObject({ timezone: "Europe/Tirane", startsAt: startedAt[ids.a].toISOString() });
    expect(byId.get(ids.b)).toMatchObject({ timezone: "America/New_York", startsAt: startedAt[ids.b].toISOString() });
  });

  it("never reads another group's company", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const plain = await listMeetingsForWorkspace(owner, meetingQuery());
    const asked = await listMeetingsForWorkspace(owner, meetingQuery({ company: COMPANY.tenant }));
    expect(idsOf(plain.data)).not.toContain(ids.tenant);
    expect(idsOf(asked.data)).not.toContain(ids.tenant);
  });

  it("keeps a company workspace to its own company, with no company on the row", async () => {
    const owner = await loginAs("OWNER");
    expect(owner.workspace.scopeType).toBe("COMPANY");

    const result = await listMeetingsForWorkspace(owner, meetingQuery());

    expect(idsOf(result.data)).toEqual(sortedIds(ids.a, ids.aMulti));
    for (const row of result.data) expect(row.company).toBeUndefined();
    expect(result).toEqual(await listMeetings(owner, meetingQuery()));
  });

  it("gives My Meetings each company's own 'mine': organized or attended there, not a colleague's", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const mine = await listMeetingsForWorkspace(owner, meetingQuery({ section: "mine" }));
    expect(idsOf(mine.data)).toEqual(sortedIds(ids.a, ids.aMulti, ids.b, ids.bAttending, ids.d, ids.dMulti));
    expect(idsOf(mine.data)).not.toContain(ids.bColleague);
  });

  it("puts held meetings in Past and not in Upcoming", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const past = await listMeetingsForWorkspace(owner, meetingQuery({ section: "past" }));
    expect(idsOf(past.data)).toEqual([ids.dPast]);
    expect(past.data[0]).toMatchObject({ status: "COMPLETED", company: { id: COMPANY.d } });
    expect(idsOf((await listMeetingsForWorkspace(owner, meetingQuery({ section: "upcoming" }))).data)).not.toContain(ids.dPast);
  });

  it("pages and orders over the union, not over each company's page", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const everything = await listMeetingsForWorkspace(owner, meetingQuery({ section: "upcoming" }));
    const pages = [];
    for (const page of [1, 2, 3, 4]) pages.push(await listMeetingsForWorkspace(owner, meetingQuery({ section: "upcoming", limit: 2, page })));
    expect(pages[0].pagination.total).toBe(7);
    expect(pages.flatMap((page) => page.data.map((row) => row.id))).toEqual(everything.data.map((row) => row.id));
  });
});

describe("only the companies where the person holds Meetings (§58, §60, §92)", () => {
  it("leaves out a company that switched Meetings off, and reads the others", async () => {
    await switchMeetingsOff(COMPANY.b);
    const owner = await loginAs("OWNER", { workspace: "GROUP" });

    const result = await listMeetingsForWorkspace(owner, meetingQuery());

    expect(idsOf(result.data)).toEqual(sortedIds(ids.a, ids.aMulti, ids.d, ids.dMulti));
    expect(result.data.every((row) => row.company?.id !== COMPANY.b)).toBe(true);
    expect((await meetingCompanyOptions(owner)).map((company) => company.id)).not.toContain(COMPANY.b);
    const actions = await listActionItemsForWorkspace(owner, actionQuery());
    expect(mineOnly(actions.data).map((row) => row.id)).not.toContain(actionIds.b);
  });

  it("gives a multi-company person their own two companies and never a third (§60, §62)", async () => {
    // Architect in Aurelia and Forma: working in two opens the group (§7), and
    // the group is the union of those two and nothing else.
    const architect = await loginAsEmail(DEMO_EMAIL.multiCompany, { workspace: "GROUP" });
    expect(architect.workspace.scopeType).toBe("GROUP");

    const result = await listMeetingsForWorkspace(architect, meetingQuery());
    expect(idsOf(result.data)).toContain(ids.aMulti);
    expect(idsOf(result.data)).toContain(ids.dMulti);
    for (const id of [ids.b, ids.tenant]) expect(idsOf(result.data)).not.toContain(id);
    for (const row of result.data) expect([COMPANY.a, COMPANY.d]).toContain(row.company?.id);
  });

  it("gives a company-only employee their own company however the session was asked (§16, §91)", async () => {
    const pm = await loginAs("PROJECT_MANAGER", { workspace: "GROUP" });
    expect(pm.workspace.scopeType).toBe("COMPANY");

    const result = await listMeetingsForWorkspace(pm, meetingQuery({ company: COMPANY.d }));
    for (const id of [ids.d, ids.dMulti, ids.tenant]) expect(idsOf(result.data)).not.toContain(id);
    for (const row of result.data) expect(row.company).toBeUndefined();
  });
});

describe("the company filter (§86, §87)", () => {
  it("narrows the group list to one company", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const b = await listMeetingsForWorkspace(owner, meetingQuery({ company: COMPANY.b }));
    expect(idsOf(b.data)).toEqual(sortedIds(ids.b, ids.bAttending, ids.bColleague));
    expect(b.pagination.total).toBe(3);
    expect(b.data.every((row) => row.company?.id === COMPANY.b)).toBe(true);
  });

  // AUD-08 §3, DT-22 changed this deliberately: a company the person may not
  // read used to be dropped, answering every company instead — a silent
  // broadening. It now narrows to no rows: still no error and nothing disclosed.
  it("narrows a company the person may not read to no rows: no error, nothing disclosed, never every company", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const everything = await listMeetingsForWorkspace(owner, meetingQuery());
    expect(everything.data.length).toBeGreaterThan(0);
    for (const company of [COMPANY.tenant, COMPANY.suspended, "company_that_does_not_exist"]) {
      const asked = await listMeetingsForWorkspace(owner, meetingQuery({ company }));
      expect(idsOf(asked.data), company).toEqual([]);
      expect(asked.pagination.total, company).toBe(0);
    }
    await switchMeetingsOff(COMPANY.b);
    const fresh = await loginAs("OWNER", { workspace: "GROUP" });
    const off = await listMeetingsForWorkspace(fresh, meetingQuery({ company: COMPANY.b }));
    expect(idsOf(off.data)).toEqual([]);
    expect((await listMeetingsForWorkspace(fresh, meetingQuery())).data.length).toBeGreaterThan(0);
  });

  it("is locked in a company workspace: the list stays that company's", async () => {
    const owner = await loginAs("OWNER");
    const result = await listMeetingsForWorkspace(owner, meetingQuery({ company: COMPANY.b }));
    expect(idsOf(result.data)).toEqual(sortedIds(ids.a, ids.aMulti));
  });

  it("offers the companies to narrow to, and projects named with theirs", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const options = await meetingFilterOptionsForWorkspace(owner);
    expect(options.companies.map((company) => company.id).sort()).toEqual(sortedIds(COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e));
    expect(options.projects.length).toBeGreaterThan(0);
    for (const project of options.projects) expect(project.name).toMatch(/ · /);

    const inCompany = await meetingFilterOptionsForWorkspace(await loginAs("OWNER"));
    expect(inCompany.companies).toEqual([]);
    for (const project of inCompany.projects) expect(project.name).not.toMatch(/ · /);
  });
});

describe("actions from meetings (§34)", () => {
  it("lists every company's actions, each naming its company", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const result = await listActionItemsForWorkspace(owner, actionQuery());
    const own = mineOnly(result.data);
    expect(idsOf(own)).toEqual(sortedIds(actionIds.a, actionIds.b, actionIds.bColleague, actionIds.d));
    const byId = new Map(own.map((row) => [row.id, row]));
    expect(byId.get(actionIds.a)?.company).toEqual({ id: COMPANY.a, name: names[COMPANY.a] });
    expect(byId.get(actionIds.b)?.company).toEqual({ id: COMPANY.b, name: names[COMPANY.b] });
    expect(byId.get(actionIds.d)?.company).toEqual({ id: COMPANY.d, name: names[COMPANY.d] });
    for (const row of result.data) expect(row.company, row.id).toBeDefined();
    expect(byId.get(actionIds.b)?.meeting).toMatchObject({ id: ids.b, href: `/meetings/${ids.b}` });
  });

  it("gives the default view each company's own 'mine', and the status filter its meaning", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const mine = await listActionItemsForWorkspace(owner, actionQuery({ mine: "true", status: "open" }));
    expect(idsOf(mineOnly(mine.data))).toEqual(sortedIds(actionIds.a, actionIds.b));
    const done = await listActionItemsForWorkspace(owner, actionQuery({ mine: "true", status: "done" }));
    expect(idsOf(mineOnly(done.data))).toEqual([actionIds.d]);
  });

  it("never reads another group's actions and narrows by company like the meeting list", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const foreign = await listActionItemsForWorkspace(owner, actionQuery({ company: COMPANY.tenant }));
    expect(idsOf(foreign.data)).not.toContain(actionIds.tenant);
    // AUD-08 §3, DT-22 (deliberate change): an unreadable company narrows to nothing, never to every company.
    expect(foreign.data).toEqual([]);
    expect(foreign.pagination.total).toBe(0);
    const b = await listActionItemsForWorkspace(owner, actionQuery({ company: COMPANY.b }));
    expect(b.data.every((row) => row.company?.id === COMPANY.b)).toBe(true);
    expect(idsOf(mineOnly(b.data))).toEqual(sortedIds(actionIds.b, actionIds.bColleague));
  });

  it("keeps a company workspace to its own company, with no company on the row", async () => {
    const owner = await loginAs("OWNER");
    const result = await listActionItemsForWorkspace(owner, actionQuery());
    expect(idsOf(mineOnly(result.data))).toEqual([actionIds.a]);
    for (const row of result.data) expect(row.company).toBeUndefined();
    expect(result).toEqual(await listActionItems(owner, actionQuery()));
  });
});

describe("the module's tabs", () => {
  it("offer the same four sections in the group, all of which read across companies", async () => {
    const group = meetingExperience(await loginAs("OWNER", { workspace: "GROUP" }));
    expect(group.sections.map((section) => section.key)).toEqual(["upcoming", "mine", "past", "actions"]);
    const company = meetingExperience(await loginAs("OWNER"));
    expect(company.sections.map((section) => section.key)).toEqual(["upcoming", "mine", "past", "actions"]);
  });
});

describe("GET /api/meetings, GET /api/meetings/actions and POST /api/meetings", () => {
  const getMeetings = (search = "") => listMeetingsRoute(new Request(`http://nesto.test/api/meetings?q=${PREFIX}&limit=100${search}`));
  const getActions = (search = "") => listActionsRoute(new Request(`http://nesto.test/api/meetings/actions?mine=false&status=all&limit=100${search}`));

  it("answers the group's union in the group workspace", async () => {
    actAs(await loginAs("OWNER", { workspace: "GROUP" }));
    const response = await getMeetings();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string; timezone: string; company?: { id: string; name: string } }> };
    expect(idsOf(body.data)).toEqual(sortedIds(ids.a, ids.aMulti, ids.b, ids.bAttending, ids.bColleague, ids.d, ids.dMulti));
    // §45: every row names the company it belongs to.
    expect(body.data.every((row) => row.company !== undefined && row.company.name === names[row.company.id])).toBe(true);
    expect(body.data.find((row) => row.id === ids.d)?.timezone).toBe("Asia/Tokyo");
  });

  it("narrows by company; one the caller may not read narrows to nothing (AUD-08 DT-22)", async () => {
    actAs(await loginAs("OWNER", { workspace: "GROUP" }));
    const narrowed = (await (await getMeetings(`&company=${COMPANY.d}`)).json()) as { data: Array<{ id: string }> };
    expect(idsOf(narrowed.data)).toEqual(sortedIds(ids.d, ids.dMulti));
    const foreign = await getMeetings(`&company=${COMPANY.tenant}`);
    expect(foreign.status).toBe(200);
    const body = (await foreign.json()) as { data: Array<{ id: string }> };
    expect(idsOf(body.data)).not.toContain(ids.tenant);
    // AUD-08 §3, DT-22 (deliberate change): no longer every company's seven meetings.
    expect(body.data.length).toBe(0);
  });

  it("answers the company's own list, with no company on the row, in a company workspace", async () => {
    actAs(await loginAs("OWNER"));
    const response = await getMeetings(`&company=${COMPANY.b}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string; company?: unknown }> };
    expect(idsOf(body.data)).toEqual(sortedIds(ids.a, ids.aMulti));
    expect(body.data.every((row) => row.company === undefined)).toBe(true);
  });

  it("answers the group's actions in the group workspace", async () => {
    actAs(await loginAs("OWNER", { workspace: "GROUP" }));
    const response = await getActions();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string; title: string; company?: { id: string } }> };
    expect(idsOf(mineOnly(body.data))).toEqual(sortedIds(actionIds.a, actionIds.b, actionIds.bColleague, actionIds.d));
    expect(body.data.every((row) => row.company)).toBe(true);
    const narrowed = (await (await getActions(`&company=${COMPANY.a}`)).json()) as { data: Array<{ id: string; title: string }> };
    expect(idsOf(mineOnly(narrowed.data))).toEqual([actionIds.a]);
  });

  it("refuses a create in the group workspace and creates nothing", async () => {
    actAs(await loginAs("OWNER", { workspace: "GROUP" }));
    const before = await prisma.meeting.count();
    const response = await createMeetingRoute(
      new Request("http://nesto.test/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: `${PREFIX} refused in the group`, meetingType: "INTERNAL", date: "2030-01-15", startTime: "10:00", endTime: "11:00", visibility: "COMPANY" }),
      }),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("WORKSPACE_COMPANY_REQUIRED");
    expect(await prisma.meeting.count()).toBe(before);
  });
});

describe("what the group asks each company (§57)", () => {
  it("reads the contexts from the resolver, so a company id in a request is never authority", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const contexts = await resolveWorkspaceContexts(owner, { module: "meetings", permission: "meeting.view" });
    expect(contexts.map((context) => context.companyId).sort()).toEqual(sortedIds(COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e));
  });
});
