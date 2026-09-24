import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { feedQuerySchema } from "@/lib/modules/announcements/announcement.schema";
import { criticalAnnouncementBanner, dashboardAnnouncements, listAnnouncements } from "@/lib/modules/announcements/announcement.service";
import { listFavorites } from "@/lib/modules/productivity/favorites.service";
import { listRecentWork } from "@/lib/modules/productivity/recent-work.service";
import { cleanupSessions, loginAs, prisma } from "../helpers";

/**
 * Announcements, favorites and recent work performance (PRD #45 §261, §329).
 *
 * Seeds 1,000 announcements across every audience, 10,000 reads and 10,000
 * acknowledgments, then 100 favorites and 100 recent items for the Engineer,
 * and times the feed, favorites, recent work and the dashboard's productivity
 * row together. Targets: feed P95 < 800 ms, favorites and recent work P95
 * < 500 ms, the dashboard aggregate P95 < 900 ms.
 *
 * Opt-in (`NESTO_PERF=1`): it writes into the shared development database for
 * the length of the run and removes everything afterwards.
 *
 *   NESTO_PERF=1 npx vitest run tests/perf/announcements.perf.test.ts
 */

const RUN = process.env.NESTO_PERF === "1";
const COMPANY = "company_demo_a";
const PREFIX = "perf_ann";
const COUNT = 1_000;

async function cleanup(engineerId?: string) {
  await prisma.announcement.deleteMany({ where: { id: { startsWith: PREFIX } } });
  if (engineerId) {
    await prisma.userFavorite.deleteMany({ where: { memberId: engineerId, entityId: { startsWith: PREFIX } } });
    await prisma.recentItem.deleteMany({ where: { memberId: engineerId, entityId: { startsWith: PREFIX } } });
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function time(run: () => Promise<unknown>, attempts = 12): Promise<number[]> {
  await run();
  const timings: number[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const started = performance.now();
    await run();
    timings.push(performance.now() - started);
  }
  return timings;
}

describe.skipIf(!RUN)("announcements at 1,000 per company with 20,000 read and acknowledgment rows (§329)", () => {
  let engineerId = "";

  beforeAll(async () => {
    const [owner, engineer, members, department] = await Promise.all([
      prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "owner@nesto.test" } } }),
      prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "engineer@nesto.test" } } }),
      prisma.companyMember.findMany({ where: { companyId: COMPANY, status: "ACTIVE" }, select: { id: true } }),
      prisma.department.findFirstOrThrow({ where: { companyId: COMPANY, name: "Engineering" } }),
    ]);
    engineerId = engineer.id;
    await cleanup(engineer.id);
    const audiences = ["COMPANY", "DEPARTMENT", "PROJECT", "SELECTED_MEMBERS"] as const;
    await prisma.announcement.createMany({
      data: Array.from({ length: COUNT }, (_, index) => ({
        id: `${PREFIX}_${index}`,
        companyId: COMPANY,
        title: `Perf notice ${index}`,
        body: `## Notice ${index}\n\nA body long enough to be excerpted for the card, about site ${index % 37}.`,
        status: index % 10 === 0 ? ("EXPIRED" as const) : ("PUBLISHED" as const),
        priority: index % 50 === 0 ? ("IMPORTANT" as const) : ("NORMAL" as const),
        audienceType: audiences[index % 4],
        departmentId: audiences[index % 4] === "DEPARTMENT" ? department.id : null,
        projectId: audiences[index % 4] === "PROJECT" ? "project_a" : null,
        authorMemberId: owner.id,
        publishedAt: new Date(Date.now() - index * 3_600_000),
        requiresAcknowledgment: index % 5 === 0,
      })),
    });
    await prisma.announcementAudienceMember.createMany({ data: Array.from({ length: COUNT / 4 }, (_, index) => ({ announcementId: `${PREFIX}_${index * 4 + 3}`, memberId: engineer.id })) });
    const reads: Array<{ announcementId: string; memberId: string; firstReadAt: Date; lastReadAt: Date }> = [];
    const acks: Array<{ announcementId: string; memberId: string; acknowledgedAt: Date }> = [];
    for (let index = 0; index < 10_000; index += 1) {
      const announcementId = `${PREFIX}_${index % COUNT}`;
      const memberId = members[Math.floor(index / COUNT) % members.length].id;
      reads.push({ announcementId, memberId, firstReadAt: new Date(), lastReadAt: new Date() });
      acks.push({ announcementId, memberId, acknowledgedAt: new Date() });
    }
    await prisma.announcementRead.createMany({ data: reads, skipDuplicates: true });
    await prisma.announcementAcknowledgment.createMany({ data: acks, skipDuplicates: true });
    const tasks = await prisma.task.findMany({ where: { companyId: COMPANY }, select: { id: true }, take: 50 });
    await prisma.userFavorite.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ companyId: COMPANY, memberId: engineer.id, entityType: index % 2 ? "task" : "project", entityId: index < tasks.length * 2 && index % 2 ? tasks[Math.floor(index / 2)].id : `${PREFIX}_missing_${index}` })), skipDuplicates: true });
    await prisma.recentItem.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ companyId: COMPANY, memberId: engineer.id, entityType: "task", entityId: index < tasks.length ? tasks[index].id : `${PREFIX}_gone_${index}`, lastAccessedAt: new Date(Date.now() - index * 60_000) })), skipDuplicates: true });
  }, 600_000);

  afterAll(async () => {
    await cleanup(engineerId);
    await cleanupSessions();
    await prisma.$disconnect();
  }, 600_000);

  it("meets the feed, favorites, recent work and dashboard targets", async () => {
    const [engineer, owner] = await Promise.all([loginAs("ENGINEER"), loginAs("OWNER")]);
    const report: Record<string, { p50: number; p95: number }> = {};
    const record = (name: string, timings: number[]) => {
      report[name] = { p50: Math.round(percentile(timings, 50)), p95: Math.round(percentile(timings, 95)) };
      return timings;
    };
    const feed = record("feed", [
      ...(await time(() => listAnnouncements(engineer, feedQuerySchema.parse({ tab: "for_me" })))),
      ...(await time(() => listAnnouncements(engineer, feedQuerySchema.parse({ tab: "history", cursor: "400" })))),
      ...(await time(() => listAnnouncements(owner, feedQuerySchema.parse({ tab: "manage", q: "site 7" })))),
    ]);
    const favorites = record("favorites", await time(() => listFavorites(engineer)));
    const recent = record("recent work", await time(() => listRecentWork(engineer)));
    const aggregate = record("dashboard productivity", await time(() => Promise.all([dashboardAnnouncements(engineer), listFavorites(engineer, { limit: 8 }), listRecentWork(engineer, { limit: 8 }), criticalAnnouncementBanner(engineer)])));

    if (process.env.NESTO_PERF_REPORT) (await import("node:fs")).writeFileSync(process.env.NESTO_PERF_REPORT, JSON.stringify(report, null, 2));
    console.table(report);
    expect(percentile(feed, 95)).toBeLessThan(800);
    expect(percentile(favorites, 95)).toBeLessThan(500);
    expect(percentile(recent, 95)).toBeLessThan(500);
    expect(percentile(aggregate, 95)).toBeLessThan(900);
  }, 600_000);
});
