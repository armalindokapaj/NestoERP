import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { listQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { listDailyLogs } from "@/lib/modules/daily-logs/daily-log.service";
import { cleanupSessions, COMPANY, loginAs, prisma, PROJECT } from "../../helpers";

/**
 * AUD-08 §3, §4 on the daily-log lists and the review queue, against the real
 * database (DT-02, DT-03, DT-04, DT-05, DT-22). Expected ids and counts are
 * written from the fixtures below. Fixtures carry the `aud08e_` prefix.
 */

const P = "aud08e_dl_project";
const at = (day: string) => new Date(`${day}T12:00:00.000Z`);
const CREATED = new Date("2026-01-01T08:00:00.000Z");

/**
 * Seven logs: the same three site days on two projects with one creation
 * instant, so a (workDate, createdAt) tie is broken only by the id; one more
 * day on the second project; and a void log.
 */
const LOGS = [
  { id: "aud08e_dl_a1", projectId: PROJECT.a, day: "2031-02-01", status: "SUBMITTED" as const },
  { id: "aud08e_dl_a2", projectId: PROJECT.a, day: "2031-02-02", status: "DRAFT" as const },
  { id: "aud08e_dl_a3", projectId: PROJECT.a, day: "2031-02-03", status: "SUBMITTED" as const },
  { id: "aud08e_dl_b1", projectId: P, day: "2031-02-01", status: "SUBMITTED" as const },
  { id: "aud08e_dl_b2", projectId: P, day: "2031-02-02", status: "REVIEWED" as const },
  { id: "aud08e_dl_b3", projectId: P, day: "2031-02-03", status: "DRAFT" as const },
  { id: "aud08e_dl_b4", projectId: P, day: "2031-02-04", status: "VOID" as const },
];

let owner: UserContext;

async function cleanup() {
  await prisma.dailyLog.deleteMany({ where: { id: { startsWith: "aud08e_" } } });
  await prisma.project.deleteMany({ where: { id: P } });
}

beforeAll(async () => {
  await cleanup();
  owner = await loginAs("OWNER");
  await prisma.project.create({ data: { id: P, companyId: COMPANY.a, code: "AUD08E-DL", name: "AUD08E Diary Site", status: "ACTIVE", createdBy: "aud08e" } });
  await prisma.dailyLog.createMany({
    data: LOGS.map((log, index) => ({
      id: log.id,
      companyId: COMPANY.a,
      projectId: log.projectId,
      workDate: at(log.day),
      status: log.status,
      summary: `AUD08E-DL ${log.id}`,
      createdByMemberId: owner.membershipId,
      createdAt: CREATED,
      // Submitted in the reverse of their ids, so the queue's oldest-first order is not id order.
      ...(log.status === "SUBMITTED" ? { submittedAt: new Date(Date.UTC(2031, 1, 10, 12 - index)), submittedByMemberId: owner.membershipId } : {}),
    })),
  });
});

afterAll(async () => {
  await cleanup();
  await cleanupSessions();
  await prisma.$disconnect();
});

const query = (extra: Record<string, unknown> = {}) => listQuerySchema.parse({ q: "AUD08E-DL", pageSize: 5, ...extra });

describe("daily-log lists (AUD-08 §3, §4)", () => {
  it("DT-04: newest day first, tied days in id order, the same across both pages", async () => {
    const first = await listDailyLogs(owner, query());
    const second = await listDailyLogs(owner, query({ page: 2 }));
    expect(first.total).toBe(7);
    expect([...first.items, ...second.items].map((row) => row.id)).toEqual([
      "aud08e_dl_b4",
      "aud08e_dl_a3",
      "aud08e_dl_b3",
      "aud08e_dl_a2",
      "aud08e_dl_b2",
      "aud08e_dl_a1",
      "aud08e_dl_b1",
    ]);
  });

  it("DT-03: project, status and a date range combine with AND; the total is counted before the page", async () => {
    const onB = await listDailyLogs(owner, query({ projectId: P, from: "2031-02-02", to: "2031-02-03" }));
    expect(onB.items.map((row) => row.id)).toEqual(["aud08e_dl_b3", "aud08e_dl_b2"]);
    const submitted = await listDailyLogs(owner, query({ status: "SUBMITTED", pageSize: 5 }));
    expect(submitted.total).toBe(3);
  });

  it("DT-02: the review queue holds only submitted logs, oldest submission first", async () => {
    const queue = await listDailyLogs(owner, query({ pageSize: 100 }), { reviewQueue: true });
    // Submitted at 12:00 (a1), 09:00 (a3), 08:00 (b1) on 10 Feb: oldest first is b1, a3, a1.
    expect(queue.items.map((row) => row.id)).toEqual(["aud08e_dl_b1", "aud08e_dl_a3", "aud08e_dl_a1"]);
    expect(queue.total).toBe(3);
  });

  it("DT-05: a page past the end is clamped to the last page; an empty list is page 1", async () => {
    expect(await listDailyLogs(owner, query({ page: 6 }))).toMatchObject({ total: 7, page: 2 });
    expect(await listDailyLogs(owner, query({ q: "aud08e-no-such-log" }))).toMatchObject({ total: 0, page: 1, items: [] });
    expect(listQuerySchema.parse({ page: "zero" }).page).toBe(1);
  });

  it("DT-22: a project the reader cannot open narrows to nothing; the reader's project answers", async () => {
    expect((await listDailyLogs(owner, query({ projectId: PROJECT.companyB }))).total).toBe(0);
    expect((await listDailyLogs(owner, query({ projectId: P }))).total).toBe(4);
    const engineer = await loginAs("ENGINEER");
    const own = await listDailyLogs(engineer, query({ pageSize: 100 }));
    expect(own.items.map((row) => row.id)).toEqual(["aud08e_dl_a3", "aud08e_dl_a2", "aud08e_dl_a1"]);
  });
});
