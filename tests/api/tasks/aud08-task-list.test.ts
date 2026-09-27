import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as listTasksRoute } from "@/app/api/tasks/route";
import type { UserContext } from "@/lib/context/types";
import { prisma as appPrisma } from "@/lib/database/prisma";
import { parseTaskListQuery, type TaskQueryDefaults } from "@/lib/modules/tasks/task.query";
import { buildTaskListWhere } from "@/lib/modules/tasks/task.repository";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * AUD-08 — the Tasks list's query contract (§3, §4; DT-02..DT-06, DT-22).
 *
 * Real Postgres, the real service and parser, the seeded Owner. Every expected
 * id list below is written out by hand from the fixture table — never read
 * back from the list under test (PRD §9). Fixtures carry tied titles, tied due
 * dates, tied `updatedAt`, null due dates, an archived and a completed task, a
 * task in another company and a timestamped (non-midnight) due date.
 *
 * | id | title        | priority | status      | due                   | other                  |
 * |----|--------------|----------|-------------|-----------------------|------------------------|
 * | t1 | Alpha        | HIGH     | TODO        | 2099-10-01            |                        |
 * | t2 | Alpha        | HIGH     | TODO        | 2099-10-01            |                        |
 * | t3 | Bravo        | MEDIUM   | IN_PROGRESS | —                     |                        |
 * | t4 | Charlie      | LOW      | BLOCKED     | 2020-09-15            |                        |
 * | t5 | Delta        | HIGH     | COMPLETED   | —                     |                        |
 * | t6 | Echo         | MEDIUM   | ARCHIVED    | —                     | archived               |
 * | t7 | Foxtrot      | HIGH     | TODO        | 2099-10-01            | company B              |
 * | t8 | Golf         | MEDIUM   | TODO        | 2099-10-01            | project A, Owner's     |
 * | t9 | Hotel        | MEDIUM   | TODO        | 2020-09-15T18:00Z     | an API client's instant|
 * | tz | India (TZ)   | MEDIUM   | TODO        | 2020-12-01            | only for the zone test |
 */

const TAG = "aud08c-TL";
const TZ_TAG = "aud08c-TZ";
const id = (key: string) => `aud08c_task_${key}`;
const t = { t1: id("t1"), t2: id("t2"), t3: id("t3"), t4: id("t4"), t5: id("t5"), t6: id("t6"), t7: id("t7"), t8: id("t8"), t9: id("t9"), tz: id("tz"), late: id("late") };
const ALL = Object.values(t);

let owner: UserContext;
let ownerA: { id: string; userId: string };

const list = (params: Record<string, string>, defaults: TaskQueryDefaults = {}) =>
  tasks.listTasks(owner, parseTaskListQuery({ search: TAG, ...params }, defaults));
const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

/** Every page of a sort, walked with a small limit: the concatenation is the list's order. */
async function walk(sort: string, limit = 2) {
  const seen: string[] = [];
  const totals = new Set<number>();
  for (let page = 1; page < 20; page += 1) {
    const result = await list({ sort, limit: String(limit), page: String(page) });
    totals.add(result.pagination.total);
    seen.push(...ids(result.data));
    if (page >= result.pagination.totalPages) break;
  }
  return { seen, totals: [...totals] };
}

beforeAll(async () => {
  await prisma.task.deleteMany({ where: { id: { in: ALL } } });
  owner = await loginAs("OWNER");
  ownerA = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.a, user: { email: "owner@nesto.test" } }, select: { id: true, userId: true } });
  const ownerB = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.b, user: { email: "owner@nesto.test" } }, select: { id: true, userId: true } });
  const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

  const make = (key: keyof typeof t, title: string, extra: Record<string, unknown>, creator = ownerA, companyId: string = COMPANY.a) =>
    prisma.task.create({ data: { id: t[key], companyId, title, createdByMemberId: creator.id, createdBy: creator.userId, ...extra } });

  await make("t1", `${TAG} Alpha`, { priority: "HIGH", status: "TODO", dueDate: day("2099-10-01") });
  await make("t2", `${TAG} Alpha`, { priority: "HIGH", status: "TODO", dueDate: day("2099-10-01") });
  await make("t3", `${TAG} Bravo`, { priority: "MEDIUM", status: "IN_PROGRESS" });
  await make("t4", `${TAG} Charlie`, { priority: "LOW", status: "BLOCKED", dueDate: day("2020-09-15") });
  await make("t5", `${TAG} Delta`, { priority: "HIGH", status: "COMPLETED", completedAt: day("2026-01-01") });
  await make("t6", `${TAG} Echo`, { priority: "MEDIUM", status: "ARCHIVED", archivedAt: day("2026-01-01") });
  await make("t7", `${TAG} Foxtrot`, { priority: "HIGH", status: "TODO", dueDate: day("2099-10-01") }, ownerB, COMPANY.b);
  await make("t8", `${TAG} Golf`, { priority: "MEDIUM", status: "TODO", dueDate: day("2099-10-01"), projectId: PROJECT.a, assigneeMemberId: ownerA.id });
  await make("t9", `${TAG} Hotel`, { priority: "MEDIUM", status: "TODO", dueDate: new Date("2020-09-15T18:00:00.000Z") });
  await make("tz", `${TZ_TAG} India`, { priority: "MEDIUM", status: "TODO", dueDate: day("2020-12-01") });
  // One shared updatedAt, so the due sorts' secondary key ties too and only the id decides.
  await prisma.$executeRaw`UPDATE tasks SET "updatedAt" = '2026-01-01 00:00:00' WHERE id = ANY(${ALL})`;
}, 60_000);

afterEach(() => {
  actAs(null);
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { id: { in: ALL } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("DT-04 — sorts are total orders, identical across every page", () => {
  // Seven live tasks in company A match the tag: t1 t2 t3 t4 t5 t8 t9.
  it.each([
    ["title-asc", [t.t1, t.t2, t.t3, t.t4, t.t5, t.t8, t.t9]],
    ["title-desc", [t.t9, t.t8, t.t5, t.t4, t.t3, t.t1, t.t2]],
    // Nulls last in both directions; equal due dates and equal updatedAt fall to the id.
    ["due-asc", [t.t4, t.t9, t.t1, t.t2, t.t8, t.t3, t.t5]],
    ["due-desc", [t.t1, t.t2, t.t8, t.t9, t.t4, t.t3, t.t5]],
    // Enum order (HIGH > MEDIUM > LOW), then due soonest with nulls last, then id.
    ["priority-desc", [t.t1, t.t2, t.t5, t.t9, t.t8, t.t3, t.t4]],
    ["priority-asc", [t.t4, t.t9, t.t8, t.t3, t.t1, t.t2, t.t5]],
  ])("%s walks every page in the expected order with one total", async (sort, expected) => {
    const { seen, totals } = await walk(sort as string);
    expect(seen).toEqual(expected);
    expect(totals).toEqual([7]);
  });

  it("the API answers the same order as the page parser", async () => {
    actAs(owner);
    const response = await listTasksRoute(new Request(`http://nesto.test/api/tasks?search=${TAG}&sort=due-asc&limit=3&page=2`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string }>; pagination: { total: number; page: number } };
    expect(ids(body.data)).toEqual([t.t2, t.t8, t.t3]);
    expect(body.pagination).toMatchObject({ total: 7, page: 2 });
  });
});

describe("DT-03 — filters OR within, AND across; counted before pagination", () => {
  it("status (TODO or BLOCKED) and priority (HIGH or LOW)", async () => {
    const result = await list({ status: "TODO,BLOCKED", priority: "HIGH,LOW", sort: "title-asc", limit: "2" });
    expect(ids(result.data)).toEqual([t.t1, t.t2]);
    expect(result.pagination.total).toBe(3);
    const second = await list({ status: "TODO,BLOCKED", priority: "HIGH,LOW", sort: "title-asc", limit: "2", page: "2" });
    expect(ids(second.data)).toEqual([t.t4]);
  });

  it("search narrows within the filters", async () => {
    const result = await tasks.listTasks(owner, parseTaskListQuery({ search: `${TAG} Alpha`, status: "TODO", sort: "title-asc" }));
    expect(ids(result.data)).toEqual([t.t1, t.t2]);
    expect(result.pagination.total).toBe(2);
  });

  it("dueFrom/dueTo are inclusive calendar days: the whole of dueTo counts", async () => {
    // t9 is due at 18:00 UTC on the 15th — `lte` midnight used to drop it.
    const result = await list({ dueFrom: "2020-09-15", dueTo: "2020-09-15", sort: "due-asc" });
    expect(ids(result.data)).toEqual([t.t4, t.t9]);
    expect(result.pagination.total).toBe(2);
  });

  it("an unknown status value is dropped rather than broadening or failing the list", async () => {
    const result = await list({ status: "NOPE", priority: "LOW" });
    expect(ids(result.data)).toEqual([t.t4]);
  });

  it("the day presets use a fixed clock and half-open [start, end) days", async () => {
    const where = (due: string, now: Date, today: string) => buildTaskListWhere(owner, parseTaskListQuery({ search: TAG, due }), now, today);
    const at = new Date("2020-09-15T12:00:00.000Z");
    const found = async (value: ReturnType<typeof where>) =>
      (await prisma.task.findMany({ where: value, select: { id: true }, orderBy: { id: "asc" } })).map((row) => row.id);
    expect(await found(where("today", at, "2020-09-15"))).toEqual([t.t4, t.t9]);
    expect(await found(where("today", at, "2020-09-16"))).toEqual([]);
    // 2020-09-15 is a Tuesday; its week runs Monday 14 to Sunday 20.
    expect(await found(where("week", at, "2020-09-20"))).toEqual([t.t4, t.t9]);
    expect(await found(where("week", at, "2020-09-21"))).toEqual([]);
    expect(await found(where("next7", at, "2020-09-09"))).toEqual([t.t4, t.t9]);
    expect(await found(where("next7", at, "2020-09-08"))).toEqual([]);
  });
});

describe("DT-03 — 'today' is the company's day in Europe/Tirane, across midnight and DST", () => {
  const today = async (instant: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(instant));
    const result = await tasks.listTasks(owner, parseTaskListQuery({ search: "aud08c-T", due: "today", sort: "title-asc" }));
    vi.useRealTimers();
    return ids(result.data);
  };

  it("summer (UTC+2): 23:30 local on the 15th is still the 15th; 00:30 local is the 16th", async () => {
    expect(await today("2020-09-15T21:30:00.000Z")).toEqual([t.t4, t.t9]);
    expect(await today("2020-09-15T22:30:00.000Z")).toEqual([]);
  });

  it("winter (UTC+1): 00:30 local on 1 December is already the 1st while UTC is still 30 November", async () => {
    expect(await today("2020-11-30T23:30:00.000Z")).toEqual([t.tz]);
    expect(await today("2020-11-30T22:30:00.000Z")).toEqual([]);
  });
});

describe("DT-02 — section restrictions are part of the query", () => {
  const OVERDUE: TaskQueryDefaults = { due: "overdue", openOnly: true };

  it("Completed, Archived and My Tasks keep their restriction", async () => {
    expect(ids((await list({}, { completedOnly: true })).data)).toEqual([t.t5]);
    expect(ids((await list({}, { archived: true })).data)).toEqual([t.t6]);
    expect(ids((await list({}, { mine: true })).data)).toEqual([t.t8]);
  });

  it("Overdue keeps its restriction even when the URL names another due preset", async () => {
    expect(ids((await list({ sort: "title-asc" }, OVERDUE)).data)).toEqual([t.t4, t.t9]);
    expect(ids((await list({ sort: "title-asc", due: "next7" }, OVERDUE)).data)).toEqual([t.t4, t.t9]);
    // Positive control: on All Tasks `due` is an ordinary filter.
    expect(ids((await list({ sort: "title-asc", due: "none" })).data)).toEqual([t.t3, t.t5]);
  });
});

describe("DT-05 — out-of-range pages and small totals", () => {
  it("a page past the end is clamped, so the page redirects once to the last page", async () => {
    const result = await list({ sort: "title-asc", limit: "2", page: "99" });
    expect(result.pagination).toMatchObject({ page: 4, totalPages: 4, total: 7 });
    expect(result.data).toEqual([]);
    const last = await list({ sort: "title-asc", limit: "2", page: "4" });
    expect(ids(last.data)).toEqual([t.t9]);
  });

  it("an empty list is page 1 of 1 with total 0; a one-page list keeps its count", async () => {
    const empty = await tasks.listTasks(owner, parseTaskListQuery({ search: "aud08c-nothing-matches", page: "5" }));
    expect(empty.pagination).toMatchObject({ page: 1, totalPages: 1, total: 0 });
    const one = await list({ status: "BLOCKED" });
    expect(one.pagination).toMatchObject({ page: 1, totalPages: 1, total: 1 });
  });
});

describe("DT-22 — foreign ids narrow to nothing; the positive control still answers", () => {
  it("another company's project, or a member of another company, yields no rows", async () => {
    expect((await list({ projectId: PROJECT.b })).pagination.total).toBe(0);
    expect((await list({ projectId: PROJECT.companyB })).pagination.total).toBe(0);
    const foreignMember = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.b }, select: { id: true } });
    expect((await list({ assignee: foreignMember.id })).pagination.total).toBe(0);
    // Positive controls: their own project and their own membership.
    expect(ids((await list({ projectId: PROJECT.a })).data)).toEqual([t.t8]);
    expect(ids((await list({ assignee: ownerA.id })).data)).toEqual([t.t8]);
  });

  it("company B's task never appears in company A's list, whatever the search", async () => {
    const result = await tasks.listTasks(owner, parseTaskListQuery({ search: `${TAG} Foxtrot` }));
    expect(result.pagination.total).toBe(0);
  });
});

describe("DT-06 — the page and its count come from one snapshot", () => {
  it("a task committed between the page read and the count does not change the total", async () => {
    const locker = new PrismaClient();
    const observer = new PrismaClient();
    try {
      // Hold the users table so the list stops at the assignee names — after
      // the tasks page, before the count — while a writer commits a new task
      // into the same list. Without a search the page read itself does not
      // touch users, so the wait falls exactly between the two statements.
      // The expected total is counted independently, in SQL, before the write.
      const [{ n: before }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM tasks
        WHERE "companyId" = ${COMPANY.a} AND "archivedAt" IS NULL AND status <> 'ARCHIVED'`;
      const expected = Number(before);
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockHeld = new Promise<void>((resolve) => (locked = resolve));
      const holder = locker.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("LOCK TABLE users IN ACCESS EXCLUSIVE MODE");
          locked();
          await released;
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
      await lockHeld;

      const pending = tasks.listTasks(owner, parseTaskListQuery({ sort: "title-asc", limit: "25" }));

      // Barrier: wait until the list's connection is waiting on that lock.
      let waiting = 0;
      for (let attempt = 0; attempt < 400 && waiting === 0; attempt += 1) {
        const rows = await observer.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*)::bigint AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%FROM "public"."users"%'`;
        waiting = Number(rows[0]?.n ?? 0);
        if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBeGreaterThan(0);

      await observer.task.create({
        data: { id: t.late, companyId: COMPANY.a, title: `${TAG} Aaa late`, createdByMemberId: ownerA.id, createdBy: ownerA.userId },
      });
      release();
      await holder;

      const result = await pending;
      expect(result.pagination.total).toBe(expected);
      expect(ids(result.data)).not.toContain(t.late);
      expect(result.data.length).toBe(Math.min(25, expected));

      // The next request is a live view and sees the new task (§4: no frozen snapshot across requests).
      const after = await tasks.listTasks(owner, parseTaskListQuery({ sort: "title-asc", limit: "25" }));
      expect(after.pagination.total).toBe(expected + 1);
    } finally {
      await prisma.task.deleteMany({ where: { id: t.late } });
      await locker.$disconnect();
      await observer.$disconnect();
    }
  }, 60_000);
});

// Keep the app client's pool from holding the process open.
afterAll(async () => {
  await appPrisma.$disconnect();
});
