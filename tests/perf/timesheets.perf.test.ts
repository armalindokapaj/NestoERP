import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildMemberContext } from "@/lib/context/member-context";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { listTeamTimesheets, projectTimeSummary } from "@/lib/modules/timesheets/timesheet.reports";
import { projectSummaryQuerySchema, teamQuerySchema } from "@/lib/modules/timesheets/timesheet.schema";
import { getMyWeek } from "@/lib/modules/timesheets/timesheet.service";
import { businessInstant, weekStartOf } from "@/lib/modules/timesheets/timesheet.time";
import { cleanupSessions, loginAs, prisma } from "../helpers";

/**
 * Timesheets performance (PRD #42 §168, §265, §270-§272).
 *
 * Seeds 500 members with 52 weeks each and ten entries a week — 26,000 weeks
 * and 260,000 work logs on two projects — then times My Timesheet, the team
 * week for a project manager and for HR, and a project's month and quarter.
 * Targets: My Timesheet P50 < 250 ms and P95 < 800 ms; team and project
 * summary P95 < 1.2 s.
 *
 * Opt-in (`NESTO_PERF=1`), because it writes a quarter of a million rows into
 * the shared development database for the length of the run and removes them
 * afterwards.
 *
 *   NESTO_PERF=1 npx vitest run tests/perf/timesheets.perf.test.ts
 */

const RUN = process.env.NESTO_PERF === "1";
const COMPANY = "company_demo_a";
const PREFIX = "perf_ts";
const MEMBERS = 500;
const WEEKS = 52;
const ZONE = "Europe/Tirane";
const CHUNK = 5_000;

async function cleanup() {
  const members = await prisma.companyMember.findMany({ where: { id: { startsWith: `${PREFIX}_member_` } }, select: { id: true } });
  const ids = members.map((row) => row.id);
  for (let index = 0; index < ids.length; index += 50) {
    const slice = ids.slice(index, index + 50);
    await prisma.workLog.deleteMany({ where: { memberId: { in: slice } } });
    await prisma.timesheet.deleteMany({ where: { memberId: { in: slice } } });
  }
  await prisma.projectMember.deleteMany({ where: { companyMemberId: { in: ids } } });
  await prisma.timesheetApproverAssignment.deleteMany({ where: { memberId: { in: ids } } });
  await prisma.companyMember.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: `${PREFIX}_user_` } } });
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

describe.skipIf(!RUN)("timesheets at 500 members × 52 weeks (§265)", () => {
  const current = weekStartOf(localDate(new Date(), ZONE), 1);

  beforeAll(async () => {
    await cleanup();
    const [role, engineering, pm, template] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: "ENGINEER" } }),
      prisma.department.findFirstOrThrow({ where: { companyId: COMPANY, key: "engineering" } }),
      prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "pm@nesto.test" } } }),
      prisma.user.findFirstOrThrow({ where: { email: "engineer@nesto.test" }, select: { passwordHash: true } }),
    ]);

    await prisma.user.createMany({
      data: Array.from({ length: MEMBERS }, (_, index) => ({ id: `${PREFIX}_user_${index}`, username: `${PREFIX}.${index}`, firstName: "Perf", lastName: `Member ${String(index).padStart(3, "0")}`, email: `${PREFIX}_${index}@nesto.test`, passwordHash: template.passwordHash })),
    });
    await prisma.companyMember.createMany({
      data: Array.from({ length: MEMBERS }, (_, index) => ({ id: `${PREFIX}_member_${index}`, companyId: COMPANY, userId: `${PREFIX}_user_${index}`, roleId: role.id, departmentId: engineering.id, status: "ACTIVE" as const })),
    });
    await prisma.projectMember.createMany({
      data: Array.from({ length: MEMBERS }, (_, index) => ({ companyId: COMPANY, projectId: index % 2 ? "project_a" : "project_b", companyMemberId: `${PREFIX}_member_${index}`, status: "ACTIVE" as const })),
    });
    await prisma.timesheetApproverAssignment.createMany({
      data: Array.from({ length: MEMBERS }, (_, index) => ({ companyId: COMPANY, memberId: `${PREFIX}_member_${index}`, approverMemberId: pm.id })),
    });

    const statuses = ["APPROVED", "APPROVED", "APPROVED", "SUBMITTED", "RETURNED"] as const;
    const weeks: Array<{ id: string; companyId: string; memberId: string; periodStart: Date; periodEnd: Date; status: (typeof statuses)[number] | "DRAFT"; approverMemberId: string; submittedAt: Date | null }> = [];
    for (let member = 0; member < MEMBERS; member += 1) {
      for (let week = 0; week < WEEKS; week += 1) {
        const start = addLocalDays(current, -7 * week);
        weeks.push({
          id: `${PREFIX}_week_${member}_${week}`,
          companyId: COMPANY,
          memberId: `${PREFIX}_member_${member}`,
          periodStart: businessInstant(start),
          periodEnd: businessInstant(addLocalDays(start, 6)),
          status: week === 0 ? "DRAFT" : statuses[(member + week) % statuses.length],
          approverMemberId: pm.id,
          submittedAt: week === 0 ? null : businessInstant(addLocalDays(start, 4)),
        });
      }
    }
    for (let index = 0; index < weeks.length; index += CHUNK) await prisma.timesheet.createMany({ data: weeks.slice(index, index + CHUNK) });

    let logs: Array<Record<string, unknown>> = [];
    const flush = async () => {
      if (logs.length) await prisma.workLog.createMany({ data: logs as never });
      logs = [];
    };
    for (const week of weeks) {
      const start = week.periodStart.toISOString().slice(0, 10);
      const member = Number(week.memberId.split("_").pop());
      for (let entry = 0; entry < 10; entry += 1) {
        logs.push({
          companyId: COMPANY,
          timesheetId: week.id,
          memberId: week.memberId,
          workDate: businessInstant(addLocalDays(start, entry % 5)),
          projectId: entry % 5 === 4 ? null : member % 2 ? "project_a" : "project_b",
          workType: entry % 5 === 4 ? "INTERNAL" : "PROJECT_WORK",
          minutes: 240,
          description: `Perf entry ${entry}`,
          billable: entry % 5 !== 4,
          createdByMemberId: week.memberId,
        });
      }
      if (logs.length >= CHUNK) await flush();
    }
    await flush();
  }, 1_800_000);

  afterAll(async () => {
    await cleanup();
    await cleanupSessions();
    await prisma.$disconnect();
  }, 1_800_000);

  it("meets the targets for the member, the team and the project", async () => {
    const member = (await buildMemberContext(COMPANY, `${PREFIX}_member_1`))!;
    const [pm, hr] = await Promise.all([loginAs("PROJECT_MANAGER"), loginAs("HR")]);
    const month = { from: addLocalDays(current, -28), to: addLocalDays(current, 6) };
    const quarter = { from: addLocalDays(current, -91), to: addLocalDays(current, 6) };

    const report: Record<string, { p50: number; p95: number }> = {};
    const record = (name: string, timings: number[]) => {
      report[name] = { p50: Math.round(percentile(timings, 50)), p95: Math.round(percentile(timings, 95)) };
      return timings;
    };

    const myWeek = record("my week", [...(await time(() => getMyWeek(member))), ...(await time(() => getMyWeek(member, { week: addLocalDays(current, -70) })))]);
    const team = record("team week", [...(await time(() => listTeamTimesheets(pm, teamQuerySchema.parse({ week: addLocalDays(current, -7) })))), ...(await time(() => listTeamTimesheets(hr, teamQuerySchema.parse({ status: "SUBMITTED", week: addLocalDays(current, -14) }))))]);
    const project = record("project month / quarter", [
      ...(await time(() => projectTimeSummary(pm, projectSummaryQuerySchema.parse({ projectId: "project_a", ...month })))),
      ...(await time(() => projectTimeSummary(pm, projectSummaryQuerySchema.parse({ projectId: "project_a", ...quarter, include: "all" })))),
      ...(await time(() => projectTimeSummary(hr, projectSummaryQuerySchema.parse({ ...quarter })))),
    ]);

    const list = await listTeamTimesheets(pm, teamQuerySchema.parse({ week: addLocalDays(current, -7) }));
    expect(list.rows.length).toBeGreaterThanOrEqual(MEMBERS);

    if (process.env.NESTO_PERF_REPORT) (await import("node:fs")).writeFileSync(process.env.NESTO_PERF_REPORT, JSON.stringify(report, null, 2));
    console.table(report);
    expect(percentile(myWeek, 50)).toBeLessThan(250);
    expect(percentile(myWeek, 95)).toBeLessThan(800);
    expect(percentile(team, 95)).toBeLessThan(1200);
    expect(percentile(project, 95)).toBeLessThan(1200);
  }, 1_800_000);
});
