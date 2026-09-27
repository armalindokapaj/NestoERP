import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { listActionItems } from "@/lib/modules/meetings/meeting.actions";
import { actionListQuerySchema, meetingListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { listMeetings } from "@/lib/modules/meetings/meeting.service";
import { listActionItemsForWorkspace, listMeetingsForWorkspace } from "@/lib/modules/meetings/meeting.workspace";
import { cleanupSessions, COMPANY, loginAs, prisma, PROJECT } from "../../helpers";

/**
 * AUD-08 §3, §4 on the meeting and meeting-action lists, against the real
 * database (DT-02, DT-04, DT-05, DT-06, DT-22). Expected ids and counts come
 * from the fixture definitions below, never from the list under test.
 * Fixtures carry the `aud08e_` prefix and are removed in afterAll.
 */

const P = "aud08e_meet_project";
const DAY = 86_400_000;
/** Five upcoming meetings at one instant: only the id orders them. */
const TIED = ["aud08e_m_1", "aud08e_m_2", "aud08e_m_3", "aud08e_m_4", "aud08e_m_5"];
const EARLY = "aud08e_m_0";
const PAST = "aud08e_m_past";
const ARCHIVED = "aud08e_m_archived";
const ACTIONS = { due1: "aud08e_act_1", due2: "aud08e_act_2", undated: "aud08e_act_3", done: "aud08e_act_4" } as const;

let owner: UserContext;

async function cleanup() {
  await prisma.meetingActionItem.deleteMany({ where: { id: { startsWith: "aud08e_" } } });
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: { startsWith: "aud08e_" } } });
  await prisma.meeting.deleteMany({ where: { id: { startsWith: "aud08e_" } } });
  await prisma.project.deleteMany({ where: { id: P } });
}

beforeAll(async () => {
  await cleanup();
  owner = await loginAs("OWNER");
  await prisma.project.create({ data: { id: P, companyId: COMPANY.a, code: "AUD08E-MP", name: "AUD08E Meeting Site", status: "ACTIVE", createdBy: "aud08e" } });
  const tied = new Date(Date.now() + 10 * DAY);
  tied.setUTCMilliseconds(0);
  const meeting = (id: string, startsAt: Date, extra: Record<string, unknown> = {}) => ({
    id,
    companyId: COMPANY.a,
    projectId: P,
    title: `AUD08E-M ${id}`,
    meetingType: "INTERNAL" as const,
    status: "SCHEDULED" as const,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    timezone: "Europe/Tirane",
    visibility: "COMPANY" as const,
    organizerMemberId: owner.membershipId,
    createdByMemberId: owner.membershipId,
    ...extra,
  });
  // Inserted out of id order, so insertion order cannot pass for the tie-breaker.
  await prisma.meeting.createMany({
    data: [
      meeting(TIED[3], tied),
      meeting(TIED[0], tied),
      meeting(TIED[4], tied),
      meeting(EARLY, new Date(tied.getTime() - DAY)),
      meeting(TIED[2], tied),
      meeting(TIED[1], tied),
      meeting(PAST, new Date(Date.now() - 5 * DAY), { status: "COMPLETED" }),
      meeting(ARCHIVED, tied, { archivedAt: new Date() }),
    ],
  });
  const due = new Date("2031-03-01T00:00:00.000Z");
  const created = new Date("2026-01-01T00:00:00.000Z");
  await prisma.meetingActionItem.createMany({
    data: [
      { id: ACTIONS.undated, companyId: COMPANY.a, meetingId: TIED[0], title: "AUD08E undated", ownerMemberId: owner.membershipId, createdByMemberId: owner.membershipId, createdAt: created },
      { id: ACTIONS.due2, companyId: COMPANY.a, meetingId: TIED[0], title: "AUD08E due", ownerMemberId: owner.membershipId, createdByMemberId: owner.membershipId, dueAt: due, createdAt: created },
      { id: ACTIONS.due1, companyId: COMPANY.a, meetingId: TIED[0], title: "AUD08E due", ownerMemberId: owner.membershipId, createdByMemberId: owner.membershipId, dueAt: due, createdAt: created },
      { id: ACTIONS.done, companyId: COMPANY.a, meetingId: TIED[0], title: "AUD08E done", ownerMemberId: owner.membershipId, createdByMemberId: owner.membershipId, status: "DONE", completedAt: new Date() },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await cleanupSessions();
  await prisma.$disconnect();
});

const upcoming = (extra: Record<string, unknown> = {}) => meetingListQuerySchema.parse({ section: "upcoming", projectId: P, limit: 2, ...extra });

describe("meeting lists (AUD-08 §3, §4)", () => {
  it("DT-04: upcoming, walked two at a time, is soonest first with ties in id order — no repeats, none missing", async () => {
    const walked: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await listMeetings(owner, upcoming({ page }));
      expect(result.pagination.total).toBe(6);
      walked.push(...result.data.map((row) => row.id));
    }
    expect(walked).toEqual([EARLY, ...TIED]);
  });

  it("DT-02: sections keep their restriction — past holds the held meeting, archived is never listed", async () => {
    const past = await listMeetings(owner, meetingListQuerySchema.parse({ section: "past", projectId: P }));
    expect(past.data.map((row) => row.id)).toEqual([PAST]);
    const all = await listMeetings(owner, meetingListQuerySchema.parse({ section: "all", projectId: P, limit: 100 }));
    expect(all.pagination.total).toBe(7);
    expect(all.data.map((row) => row.id)).not.toContain(ARCHIVED);
  });

  it("DT-05: a page past the end is clamped to the last page; an empty list is page 1", async () => {
    const result = await listMeetings(owner, upcoming({ page: 9 }));
    expect(result.pagination).toMatchObject({ page: 3, total: 6, totalPages: 3 });
    const none = await listMeetings(owner, upcoming({ q: "aud08e-no-such-meeting" }));
    expect(none.pagination).toMatchObject({ page: 1, total: 0, totalPages: 1 });
  });

  it("DT-22: a project the reader cannot open narrows to nothing; their own project answers", async () => {
    const foreign = await listMeetings(owner, meetingListQuerySchema.parse({ section: "all", projectId: PROJECT.companyB }));
    expect(foreign.pagination.total).toBe(0);
    expect((await listMeetings(owner, meetingListQuerySchema.parse({ section: "all", projectId: P }))).pagination.total).toBe(7);
  });

  it("DT-22: in the Group workspace an unreadable company narrows to nothing, never to every company", async () => {
    const group = await loginAs("OWNER", { workspace: "GROUP" });
    const mine = await listMeetingsForWorkspace(group, meetingListQuerySchema.parse({ section: "all", company: COMPANY.a, q: "AUD08E-M", limit: 100 }));
    expect(mine.pagination.total).toBe(7);
    for (const company of [COMPANY.tenant, "company_that_does_not_exist"]) {
      const asked = await listMeetingsForWorkspace(group, meetingListQuerySchema.parse({ section: "all", company, q: "AUD08E-M" }));
      expect(asked.pagination.total, company).toBe(0);
      const actions = await listActionItemsForWorkspace(group, actionListQuerySchema.parse({ status: "all", company }));
      expect(actions.pagination.total, company).toBe(0);
    }
  });
});

describe("meeting actions (AUD-08 §4)", () => {
  it("DT-04: due first (undated last), then created, then id; the open section excludes done ones", async () => {
    const open = await listActionItems(owner, actionListQuerySchema.parse({ projectId: P, limit: 1 }));
    expect(open.pagination.total).toBe(3);
    const walked: string[] = [];
    for (let page = 1; page <= 3; page += 1) walked.push(...(await listActionItems(owner, actionListQuerySchema.parse({ projectId: P, limit: 1, page }))).data.map((row) => row.id));
    expect(walked).toEqual([ACTIONS.due1, ACTIONS.due2, ACTIONS.undated]);
    const all = await listActionItems(owner, actionListQuerySchema.parse({ projectId: P, status: "all" }));
    expect(all.pagination.total).toBe(4);
    const past = await listActionItems(owner, actionListQuerySchema.parse({ projectId: P, limit: 1, page: 8 }));
    expect(past.pagination.page).toBe(3);
  });
});
