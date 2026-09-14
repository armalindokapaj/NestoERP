import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { addEntry } from "@/lib/modules/daily-logs/daily-log.entries";
import { dailyLogReport } from "@/lib/modules/daily-logs/daily-log.reports";
import { SECTION_SCHEMAS, listQuerySchema, reportQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { getDailyLog, listDailyLogs } from "@/lib/modules/daily-logs/daily-log.service";
import { cleanupSessions, loginAs, prisma } from "../helpers";

/**
 * Daily log performance (PRD #43 §239, §273).
 *
 * Seeds 100 projects with a year of logs each — 36,500 logs with three
 * workforce entries, two activities, a delay and photo metadata apiece, about
 * 250,000 rows — then times the project list, the all-projects list, a log's
 * detail, a section write and a quarter's report as the Owner and the Project
 * Manager. Targets: list P95 < 1 s, detail P95 < 1.2 s, section write
 * P95 < 800 ms.
 *
 * Opt-in (`NESTO_PERF=1`): it writes into the shared development database for
 * the length of the run and removes everything afterwards.
 *
 *   NESTO_PERF=1 npx vitest run tests/perf/daily-logs.perf.test.ts
 */

const RUN = process.env.NESTO_PERF === "1";
const COMPANY = "company_demo_a";
const PREFIX = "perf_dl";
const PROJECTS = 100;
const DAYS = 365;
const ZONE = "Europe/Tirane";
const CHUNK = 5_000;

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { id: { startsWith: `${PREFIX}_project_` } }, select: { id: true } });
  const projectIds = projects.map((row) => row.id);
  for (const projectId of projectIds) {
    const logs = await prisma.dailyLog.findMany({ where: { projectId }, select: { id: true } });
    const ids = logs.map((row) => row.id);
    await prisma.dailyLogDocumentLink.deleteMany({ where: { dailyLogId: { in: ids } } });
    await prisma.dailyLog.deleteMany({ where: { projectId } });
  }
  await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectDailyLogSettings.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function time(run: () => Promise<unknown>, attempts = 10): Promise<number[]> {
  await run();
  const timings: number[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const started = performance.now();
    await run();
    timings.push(performance.now() - started);
  }
  return timings;
}

describe.skipIf(!RUN)("daily logs at 100 projects × 365 days (§273)", () => {
  const today = localDate(new Date(), ZONE);

  beforeAll(async () => {
    await cleanup();
    const [pm, engineer] = await Promise.all([
      prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "pm@nesto.test" } } }),
      prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "engineer@nesto.test" } } }),
    ]);
    await prisma.project.createMany({
      data: Array.from({ length: PROJECTS }, (_, index) => ({ id: `${PREFIX}_project_${index}`, companyId: COMPANY, code: `PERF-DL-${index}`, name: `Perf site ${String(index).padStart(3, "0")}`, status: "ACTIVE" as const, projectManagerMemberId: pm.id, createdBy: "perf" })),
    });
    await prisma.projectMember.createMany({ data: Array.from({ length: PROJECTS }, (_, index) => ({ companyId: COMPANY, projectId: `${PREFIX}_project_${index}`, companyMemberId: engineer.id, status: "ACTIVE" as const })) });

    const logs = [];
    for (let project = 0; project < PROJECTS; project += 1) {
      for (let day = 1; day <= DAYS; day += 1) {
        const date = addLocalDays(today, -day);
        logs.push({ id: `${PREFIX}_log_${project}_${day}`, companyId: COMPANY, projectId: `${PREFIX}_project_${project}`, workDate: new Date(`${date}T12:00:00.000Z`), status: day > 3 ? ("LOCKED" as const) : ("DRAFT" as const), createdByMemberId: engineer.id, summary: `Perf day ${day} on site ${project}` });
      }
    }
    for (let index = 0; index < logs.length; index += CHUNK) await prisma.dailyLog.createMany({ data: logs.slice(index, index + CHUNK) });

    let rows: Array<Record<string, unknown>> = [];
    let activities: Array<Record<string, unknown>> = [];
    let delays: Array<Record<string, unknown>> = [];
    let photos: Array<Record<string, unknown>> = [];
    const flush = async (force = false) => {
      if (force || rows.length >= CHUNK) {
        if (rows.length) await prisma.dailyLogWorkforceEntry.createMany({ data: rows as never });
        if (activities.length) await prisma.dailyLogWorkActivity.createMany({ data: activities as never });
        if (delays.length) await prisma.dailyLogDelayEntry.createMany({ data: delays as never });
        if (photos.length) await prisma.dailyLogDocumentLink.createMany({ data: photos as never });
        rows = [];
        activities = [];
        delays = [];
        photos = [];
      }
    };
    for (const log of logs) {
      for (const trade of ["Concrete", "Formwork", "Supervision"]) rows.push({ companyId: COMPANY, dailyLogId: log.id, organizationName: `${trade} crew`, trade, headcount: 6 });
      for (const title of ["Pour", "Formwork"]) activities.push({ companyId: COMPANY, dailyLogId: log.id, title, createdByMemberId: engineer.id });
      delays.push({ companyId: COMPANY, dailyLogId: log.id, category: "WEATHER", title: "Rain", durationMinutes: 45, impact: "LOW" });
      photos.push({ companyId: COMPANY, dailyLogId: log.id, documentId: `${log.id}_photo`, category: "PHOTO", caption: "Site photo" });
      await flush();
    }
    await flush(true);
  }, 1_800_000);

  afterAll(async () => {
    await cleanup();
    await cleanupSessions();
    await prisma.$disconnect();
  }, 1_800_000);

  it("meets the list, detail, write and report targets", async () => {
    const [owner, pm, engineer] = await Promise.all([loginAs("OWNER"), loginAs("PROJECT_MANAGER"), loginAs("ENGINEER")]);
    const project = `${PREFIX}_project_7`;
    const report: Record<string, { p50: number; p95: number }> = {};
    const record = (name: string, timings: number[]) => {
      report[name] = { p50: Math.round(percentile(timings, 50)), p95: Math.round(percentile(timings, 95)) };
      return timings;
    };

    const list = record("list", [
      ...(await time(() => listDailyLogs(pm, listQuerySchema.parse({ projectId: project })))),
      ...(await time(() => listDailyLogs(owner, listQuerySchema.parse({ page: 40 })))),
      ...(await time(() => listDailyLogs(pm, listQuerySchema.parse({ status: "LOCKED", q: "site 7" })))),
    ]);
    const detail = record("detail", await time(() => getDailyLog(engineer, `${PREFIX}_log_7_10`)));
    let counter = 0;
    const write = record("section write", await time(() => addEntry(engineer, `${PREFIX}_log_7_1`, "workforce", SECTION_SCHEMAS.workforce.parse({ organizationName: `Perf crew ${counter++}`, headcount: 3 }) as never)));
    const reports = record("report (quarter)", [
      ...(await time(() => dailyLogReport(pm, reportQuerySchema.parse({ projectId: project, from: addLocalDays(today, -91), to: today })), 5)),
      ...(await time(() => dailyLogReport(owner, reportQuerySchema.parse({ from: addLocalDays(today, -30), to: today })), 5)),
    ]);

    if (process.env.NESTO_PERF_REPORT) (await import("node:fs")).writeFileSync(process.env.NESTO_PERF_REPORT, JSON.stringify(report, null, 2));
    console.table(report);
    expect(percentile(list, 95)).toBeLessThan(1_000);
    expect(percentile(detail, 95)).toBeLessThan(1_200);
    expect(percentile(write, 95)).toBeLessThan(800);
    expect(percentile(reports, 95)).toBeLessThan(2_000);
  }, 1_800_000);
});
