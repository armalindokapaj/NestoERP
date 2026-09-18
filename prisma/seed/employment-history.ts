/**
 * Employment history for the seeded employments (E-03 §183-§185, ADR 0004).
 *
 * The seed writes employments the way the application once did — current
 * fields only — so their first history rows come from the E-03 migration's own
 * data steps, read from the migration file and run again here: one backfill,
 * not two copies of it that could drift apart. Rows it adds are marked
 * MIGRATION; an employment that already has history is left alone, so a rerun
 * adds nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

const MIGRATION = "prisma/migrations/20260918170000_employment_history_e03/migration.sql";
const DATA_STEPS = "-- 5. The current state";

/** The migration's data steps, one statement at a time (a prepared statement takes one). */
export function employmentBackfillStatements(): string[] {
  const sql = readFileSync(path.resolve(process.cwd(), MIGRATION), "utf8");
  const start = sql.indexOf(DATA_STEPS);
  if (start < 0) throw new Error(`Seed: ${MIGRATION} has no "${DATA_STEPS}" section.`);
  return sql
    .slice(start)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function syncEmploymentHistory(prisma: PrismaClient): Promise<void> {
  for (const statement of employmentBackfillStatements()) await prisma.$executeRawUnsafe(statement);
}

/* -------------------------------------------------------------------------- */
/* Stories (E-03 §123, §220-§224)                                              */
/* -------------------------------------------------------------------------- */

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

type Earlier = { jobTitle?: string; departmentKey?: string; managerUser?: string };

async function memberOf(prisma: PrismaClient, companyId: string, userId: string): Promise<{ id: string; name: string } | null> {
  const member = await prisma.companyMember.findFirst({ where: { companyId, userId }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return member ? { id: member.id, name: `${member.user.firstName} ${member.user.lastName}` } : null;
}

/**
 * What an employee held before their current assignment: the backfilled row
 * now begins on the change's day, and a row before it says what they had from
 * the start. The current state is exactly what it was — only its past is told.
 */
async function tellPast(
  prisma: PrismaClient,
  input: { story: string; employmentId: string; changedOn: string; reason: "PROMOTION" | "DEPARTMENT_TRANSFER" | "MANAGER_CHANGE" | "TITLE_CHANGE"; earlier: Earlier; recordedBy: string },
): Promise<void> {
  const id = `eas_seed_${input.story}`;
  if (await prisma.employmentAssignment.findUnique({ where: { id }, select: { id: true } })) return;
  const first = await prisma.employmentAssignment.findFirst({
    where: { employeeProfileId: input.employmentId, supersededAt: null },
    orderBy: { startDate: "asc" },
    select: { id: true, companyId: true, startDate: true, departmentId: true, departmentName: true, jobTitle: true, managerMemberId: true, managerName: true, workLocationType: true, workLocation: true, employmentType: true, reason: true },
  });
  if (!first) throw new Error(`Seed: ${input.employmentId} has no history to tell the past of.`);
  const department = input.earlier.departmentKey
    ? await prisma.department.findFirst({ where: { companyId: first.companyId, key: input.earlier.departmentKey }, select: { id: true, name: true } })
    : null;
  const manager = input.earlier.managerUser ? await memberOf(prisma, first.companyId, input.earlier.managerUser) : null;

  await prisma.$transaction(async (tx) => {
    // The row the backfill made now starts on the day of the change…
    await tx.employmentAssignment.update({ where: { id: first.id }, data: { startDate: date(input.changedOn), reason: input.reason, source: "CHANGE", createdByUserId: input.recordedBy } });
    // …and before it, what they held from the start.
    await tx.employmentAssignment.create({
      data: {
        id,
        companyId: first.companyId,
        employeeProfileId: input.employmentId,
        departmentId: department?.id ?? first.departmentId,
        departmentName: department?.name ?? first.departmentName,
        jobTitle: input.earlier.jobTitle ?? first.jobTitle,
        managerMemberId: manager?.id ?? first.managerMemberId,
        managerName: manager?.name ?? first.managerName,
        workLocationType: first.workLocationType,
        workLocation: first.workLocation,
        employmentType: first.employmentType,
        startDate: first.startDate,
        endDate: new Date(date(input.changedOn).getTime() - DAY),
        reason: first.reason,
        source: "CHANGE",
        createdByUserId: input.recordedBy,
      },
    });
  });
}

/**
 * A few employments with a past worth showing (E-03 §123): an architect
 * promoted, an engineer who moved department, a project manager whose manager
 * changed before a promotion, an architect transferred between two of the
 * group's companies, and a promotion scheduled for next month. Nobody's
 * current placement changes.
 */
export async function seedEmploymentHistoryStories(prisma: PrismaClient): Promise<void> {
  const HR = "user_hr";
  await tellPast(prisma, { story: "architect_promotion", employmentId: "employee_emp_006", changedOn: day(-200), reason: "PROMOTION", earlier: { jobTitle: "Architect" }, recordedBy: HR });
  await tellPast(prisma, { story: "engineer_transfer", employmentId: "employee_emp_007", changedOn: day(-150), reason: "DEPARTMENT_TRANSFER", earlier: { departmentKey: "projects" }, recordedBy: HR });
  await tellPast(prisma, { story: "pm_promotion", employmentId: "employee_emp_005", changedOn: day(-120), reason: "PROMOTION", earlier: { jobTitle: "Project Manager" }, recordedBy: HR });
  await tellPast(prisma, { story: "pm_manager", employmentId: "employee_emp_005", changedOn: day(-400), reason: "MANAGER_CHANGE", earlier: { jobTitle: "Project Manager", managerUser: "user_owner" }, recordedBy: HR });
  await transferStory(prisma);
  await scheduledStory(prisma);
}

/**
 * The architect who works in two companies was Forma Engineering's before
 * Aurelia took them on (E-03 §13, §221): Forma's employment ended the day
 * before Aurelia's began, both by the transfer. Forma's record has no login of
 * its own; the person's login there stays a membership, as Team decided.
 */
async function transferStory(prisma: PrismaClient): Promise<void> {
  const FORMA = "company_demo_d";
  const formaId = "employee_d_multi_architect";
  const aurelia = await prisma.employeeProfile.findUnique({ where: { id: "employee_emp_022" }, select: { personProfileId: true, startDate: true } });
  const forma = await prisma.company.findUnique({ where: { id: FORMA }, select: { id: true } });
  if (!aurelia?.startDate || !forma || (await prisma.employeeProfile.findUnique({ where: { id: formaId }, select: { id: true } }))) return;
  const joined = aurelia.startDate.toISOString().slice(0, 10);
  const lastDay = new Date(date(joined).getTime() - DAY).toISOString().slice(0, 10);
  const started = new Date(date(joined).getTime() - 510 * DAY).toISOString().slice(0, 10);
  const department = await prisma.department.findFirst({ where: { companyId: FORMA, key: "architecture" }, select: { id: true, name: true } });
  const manager = await memberOf(prisma, FORMA, "user_ceo_d");

  await prisma.$transaction(async (tx) => {
    await tx.employeeProfile.create({
      data: {
        id: formaId,
        companyId: FORMA,
        personProfileId: aurelia.personProfileId,
        employeeNumber: "FE-031",
        employmentStatus: "ENDED",
        employmentType: "FULL_TIME",
        startDate: new Date(`${started}T12:00:00.000Z`),
        endDate: new Date(`${lastDay}T12:00:00.000Z`),
        departmentId: department?.id ?? null,
        jobTitle: "Junior Architect",
        managerMemberId: manager?.id ?? null,
        workLocationType: "OFFICE",
        workLocation: "Durrës office",
        onboardingStatus: "COMPLETED",
        offboardingStatus: "NOT_REQUIRED",
      },
    });
    await tx.employmentAssignment.create({
      data: {
        id: "eas_seed_transfer_forma",
        companyId: FORMA,
        employeeProfileId: formaId,
        departmentId: department?.id ?? null,
        departmentName: department?.name ?? null,
        jobTitle: "Junior Architect",
        managerMemberId: manager?.id ?? null,
        managerName: manager?.name ?? null,
        workLocationType: "OFFICE",
        workLocation: "Durrës office",
        employmentType: "FULL_TIME",
        startDate: date(started),
        endDate: date(lastDay),
        reason: "HIRE",
        source: "CHANGE",
      },
    });
    await tx.employmentStatusHistory.createMany({
      data: [
        { id: "esh_seed_transfer_forma_1", companyId: FORMA, employeeProfileId: formaId, status: "ACTIVE", effectiveFrom: date(started), effectiveTo: date(lastDay), reason: "HIRE", source: "CHANGE" },
        { id: "esh_seed_transfer_forma_2", companyId: FORMA, employeeProfileId: formaId, status: "ENDED", effectiveFrom: date(joined), reason: "LEGAL_ENTITY_TRANSFER", source: "CHANGE" },
      ],
    });
    // Aurelia's side began by the transfer, not by a hire.
    await tx.employmentAssignment.updateMany({ where: { employeeProfileId: "employee_emp_022", startDate: date(joined), supersededAt: null }, data: { reason: "LEGAL_ENTITY_TRANSFER", source: "CHANGE" } });
    await tx.employmentStatusHistory.updateMany({ where: { employeeProfileId: "employee_emp_022", effectiveFrom: date(joined), status: "ACTIVE", supersededAt: null }, data: { reason: "LEGAL_ENTITY_TRANSFER", source: "CHANGE" } });
  });
}

/** Changes HR has scheduled: a promotion next month at Aurelia, a move to site at Meridian (E-03 §31, §169). */
async function scheduledStory(prisma: PrismaClient): Promise<void> {
  const planned = [
    { id: "emc_seed_sales_promotion", companyId: "company_demo_a", employeeProfileId: "employee_emp_011", type: "POSITION_CHANGE" as const, days: 30, payload: { action: "POSITION", jobTitle: "Head of Business Development", reason: "PROMOTION" } },
    { id: "emc_seed_pm_b_site", companyId: "company_demo_b", employeeProfileId: "employee_b_emp_002", type: "LOCATION_CHANGE" as const, days: 45, payload: { action: "LOCATION", workLocationType: "SITE", workLocation: "Central Office Tower site" } },
  ];
  for (const change of planned) {
    if (await prisma.employmentChange.findUnique({ where: { id: change.id }, select: { id: true } })) continue;
    const effectiveDate = day(change.days);
    await prisma.employmentChange.create({
      data: { id: change.id, companyId: change.companyId, employeeProfileId: change.employeeProfileId, type: change.type, effectiveDate: date(effectiveDate), payload: { ...change.payload, effectiveDate }, requestedByUserId: "user_hr" },
    });
  }
}
