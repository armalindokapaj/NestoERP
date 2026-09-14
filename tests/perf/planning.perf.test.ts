import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { quickUpdateMilestone } from "@/lib/modules/project-planning/planning.milestones";
import { planningReport } from "@/lib/modules/project-planning/planning.reports";
import { reportQuerySchema } from "@/lib/modules/project-planning/planning.schema";
import { getMilestone, getPlanningOverview, getPlanningTimeline } from "@/lib/modules/project-planning/planning.service";
import { cleanupSessions, loginAs, prisma } from "../helpers";

/**
 * Planning performance (PRD #44 §218-§222, §302).
 *
 * Seeds 100 projects with 10 phases and 50 milestones each, and one stress
 * project with 100 phases and 500 milestones — dependencies chaining every
 * phase, a blocker on every fifth milestone and two task links on each —
 * then times the stress project's overview and timeline, a milestone's detail,
 * a quick update and the cross-project report. Targets: overview P95 < 1 s,
 * timeline P95 < 1.2 s, milestone update P95 < 800 ms.
 *
 * Opt-in (`NESTO_PERF=1`): it writes into the shared development database for
 * the length of the run and removes everything afterwards.
 *
 *   NESTO_PERF=1 npx vitest run tests/perf/planning.perf.test.ts
 */

const RUN = process.env.NESTO_PERF === "1";
const COMPANY = "company_demo_a";
const PREFIX = "perf_plan";
const PROJECTS = 100;
const STRESS = `${PREFIX}_project_stress`;
const ZONE = "Europe/Tirane";
const CHUNK = 5_000;

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { id: { startsWith: `${PREFIX}_project_` } }, select: { id: true } });
  const projectIds = projects.map((row) => row.id);
  if (!projectIds.length) return;
  const milestoneIds = (await prisma.projectMilestone.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((row) => row.id);
  for (let index = 0; index < milestoneIds.length; index += CHUNK) {
    const ids = milestoneIds.slice(index, index + CHUNK);
    await prisma.projectMilestoneBlocker.deleteMany({ where: { milestoneId: { in: ids } } });
    await prisma.projectMilestoneTaskLink.deleteMany({ where: { milestoneId: { in: ids } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  }
  await prisma.projectMilestoneDependency.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectMilestone.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectPhase.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
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

describe.skipIf(!RUN)("planning at 100 projects and a 500-milestone plan (§302)", () => {
  const today = localDate(new Date(), ZONE);
  const at = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);

  beforeAll(async () => {
    await cleanup();
    const pm = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email: "pm@nesto.test" } } });
    const projectIds = [...Array.from({ length: PROJECTS }, (_, index) => `${PREFIX}_project_${index}`), STRESS];
    await prisma.project.createMany({ data: projectIds.map((id, index) => ({ id, companyId: COMPANY, code: `PERF-PL-${index}`, name: `Perf plan ${String(index).padStart(3, "0")}`, status: "ACTIVE" as const, projectManagerMemberId: pm.id, startDate: at(-200), endDate: at(400), createdBy: "perf" })) });

    const phases: Array<Record<string, unknown>> = [];
    const milestones: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];
    const blockers: Array<Record<string, unknown>> = [];
    const tasks: Array<Record<string, unknown>> = [];
    const links: Array<Record<string, unknown>> = [];
    for (const projectId of projectIds) {
      const stress = projectId === STRESS;
      const phaseCount = stress ? 100 : 10;
      const perPhase = 5;
      let previous: string | null = null;
      for (let phase = 0; phase < phaseCount; phase += 1) {
        const phaseId = `${projectId}_ph_${phase}`;
        phases.push({ id: phaseId, companyId: COMPANY, projectId, name: `Phase ${phase}`, sortOrder: phase + 1, createdByMemberId: pm.id, plannedStartDate: at(phase * 5 - 100), plannedEndDate: at(phase * 5 - 60) });
        for (let index = 0; index < perPhase; index += 1) {
          const id = `${phaseId}_m_${index}`;
          const offset = phase * 5 + index - 120;
          milestones.push({
            id, companyId: COMPANY, projectId, phaseId, name: `Milestone ${phase}.${index}`, milestoneType: "CONSTRUCTION", sortOrder: index + 1, createdByMemberId: pm.id, ownerMemberId: pm.id,
            status: offset < -30 ? "COMPLETED" : offset < 0 ? "IN_PROGRESS" : "NOT_STARTED", baselineDate: at(offset), plannedDate: at(offset), forecastDate: at(offset + (index % 3)), actualDate: offset < -30 ? at(offset + 1) : null, critical: index === 0,
          });
          if (previous) edges.push({ companyId: COMPANY, projectId, predecessorMilestoneId: previous, successorMilestoneId: id, lagDays: index % 2, createdByMemberId: pm.id });
          previous = id;
          if (index % 5 === 0) blockers.push({ companyId: COMPANY, milestoneId: id, title: `Blocker ${phase}`, severity: phase % 10 === 0 ? "CRITICAL" : "MEDIUM", createdByMemberId: pm.id });
          if (stress) {
            for (const n of [0, 1]) {
              const taskId = `${id}_t_${n}`;
              tasks.push({ id: taskId, companyId: COMPANY, projectId, title: `Task ${phase}.${index}.${n}`, status: n ? "COMPLETED" : "TODO", priority: "MEDIUM", createdByMemberId: pm.id, createdBy: "perf" });
              links.push({ companyId: COMPANY, milestoneId: id, taskId, linkType: "SUPPORTS", createdByMemberId: pm.id });
            }
          }
        }
      }
    }
    const insert = async (rows: Array<Record<string, unknown>>, write: (chunk: never) => Promise<unknown>) => {
      for (let index = 0; index < rows.length; index += CHUNK) await write(rows.slice(index, index + CHUNK) as never);
    };
    await insert(phases, (data) => prisma.projectPhase.createMany({ data }));
    await insert(milestones, (data) => prisma.projectMilestone.createMany({ data }));
    await insert(edges, (data) => prisma.projectMilestoneDependency.createMany({ data }));
    await insert(blockers, (data) => prisma.projectMilestoneBlocker.createMany({ data }));
    await insert(tasks, (data) => prisma.task.createMany({ data }));
    await insert(links, (data) => prisma.projectMilestoneTaskLink.createMany({ data }));
  }, 1_800_000);

  afterAll(async () => {
    await cleanup();
    await cleanupSessions();
    await prisma.$disconnect();
  }, 1_800_000);

  it("meets the overview, timeline and update targets", async () => {
    const [owner, pm] = await Promise.all([loginAs("OWNER"), loginAs("PROJECT_MANAGER")]);
    const report: Record<string, { p50: number; p95: number }> = {};
    const record = (name: string, timings: number[]) => {
      report[name] = { p50: Math.round(percentile(timings, 50)), p95: Math.round(percentile(timings, 95)) };
      return timings;
    };

    const overview = record("overview (500 milestones)", [...(await time(() => getPlanningOverview(pm, STRESS))), ...(await time(() => getPlanningOverview(owner, `${PREFIX}_project_7`)))]);
    const timeline = record("timeline (500 milestones)", await time(() => getPlanningTimeline(pm, STRESS)));
    const detail = record("milestone detail", await time(() => getMilestone(pm, `${STRESS}_ph_50_m_2`)));
    let progress = 0;
    const update = record(
      "milestone update",
      await time(async () => {
        const current = await prisma.projectMilestone.findUniqueOrThrow({ where: { id: `${STRESS}_ph_80_m_3` }, select: { version: true } });
        progress = (progress + 7) % 100;
        await quickUpdateMilestone(pm, `${STRESS}_ph_80_m_3`, { expectedVersion: current.version, progressPercent: progress, forecastReason: null });
      }),
    );
    const reports = record("report (5,500 milestones)", await time(() => planningReport(owner, reportQuerySchema.parse({})), 5));

    if (process.env.NESTO_PERF_REPORT) (await import("node:fs")).writeFileSync(process.env.NESTO_PERF_REPORT, JSON.stringify(report, null, 2));
    console.table(report);
    expect(percentile(overview, 95)).toBeLessThan(1_000);
    expect(percentile(timeline, 95)).toBeLessThan(1_200);
    expect(percentile(detail, 95)).toBeLessThan(1_000);
    expect(percentile(update, 95)).toBeLessThan(800);
    expect(percentile(reports, 95)).toBeLessThan(3_000);
  }, 1_800_000);
});
