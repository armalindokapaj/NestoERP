import type { PrismaClient } from "@prisma/client";

import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction } from "@/lib/core/audit/audit.service";
import { addDays, dayOf, todayDay } from "./employment.dates";
import { deriveCache, syncCache, type EmploymentCache } from "./employment.history";

/**
 * Employment history integrity (E-03 §180-§182, §215; ADR 0004).
 *
 * The current employment fields are a cache of the history, and a login's
 * membership carries the employment's department and title. This reads every
 * employment and says where either has drifted, where the history itself is
 * broken — no rows, no current row, a running employment with nothing open —
 * where the current reporting lines loop, and where the worker has fallen
 * behind. `pnpm verify:employment` fails on an error; `pnpm repair:employment`
 * rewrites drifted caches from the history, audited, and only with `--apply`
 * (§182: nothing is silently corrected).
 */

export type EmploymentFinding = { level: "error" | "warning"; code: string; employmentId: string | null; message: string };

const CACHE_FIELDS = ["departmentId", "jobTitle", "managerMemberId", "workLocationType", "workLocation", "employmentType", "employmentStatus", "startDate"] as const;

type CacheRow = {
  id: string;
  companyId: string;
  employmentStatus: EmploymentCache["employmentStatus"];
  departmentId: string | null;
  jobTitle: string | null;
  managerMemberId: string | null;
  workLocationType: EmploymentCache["workLocationType"];
  workLocation: string | null;
  employmentType: EmploymentCache["employmentType"];
  startDate: Date | null;
  endDate: Date | null;
};

function drifted(row: CacheRow, expected: EmploymentCache): string[] {
  const actual: Record<string, unknown> = { ...row, startDate: row.startDate ? dayOf(row.startDate) : null, endDate: row.endDate ? dayOf(row.endDate) : null };
  const fields: string[] = CACHE_FIELDS.filter((field) => (actual[field] ?? null) !== (expected[field] ?? null));
  if (expected.employmentStatus === "ENDED" && (actual.endDate ?? null) !== (expected.endDate ?? null)) fields.push("endDate");
  return fields;
}

export async function findEmploymentFindings(prisma: PrismaClient): Promise<EmploymentFinding[]> {
  const findings: EmploymentFinding[] = [];
  const employments = await prisma.employeeProfile.findMany({
    select: {
      id: true,
      companyId: true,
      employmentStatus: true,
      departmentId: true,
      jobTitle: true,
      managerMemberId: true,
      workLocationType: true,
      workLocation: true,
      employmentType: true,
      startDate: true,
      endDate: true,
      companyMember: { select: { departmentId: true, jobTitle: true, status: true } },
      _count: { select: { assignments: true, statusHistory: true } },
    },
    orderBy: { id: "asc" },
  });

  for (const employment of employments) {
    if (employment._count.assignments === 0 || employment._count.statusHistory === 0) {
      findings.push({ level: "error", code: "NO_HISTORY", employmentId: employment.id, message: `employment ${employment.id} has no ${employment._count.assignments === 0 ? "assignment" : "status"} history` });
      continue;
    }
    const [openAssignments, openStatuses] = await Promise.all([
      prisma.employmentAssignment.count({ where: { employeeProfileId: employment.id, endDate: null, supersededAt: null, isPrimary: true } }),
      prisma.employmentStatusHistory.count({ where: { employeeProfileId: employment.id, effectiveTo: null, supersededAt: null } }),
    ]);
    if (openStatuses !== 1) findings.push({ level: "error", code: "NO_CURRENT_STATUS", employmentId: employment.id, message: `employment ${employment.id} has ${openStatuses} current status rows` });
    if (employment.employmentStatus !== "ENDED" && openAssignments !== 1) {
      findings.push({ level: "error", code: "NO_CURRENT_ASSIGNMENT", employmentId: employment.id, message: `running employment ${employment.id} has ${openAssignments} current assignments` });
    }
    if (employment.employmentStatus === "ENDED" && openAssignments > 0) {
      findings.push({ level: "error", code: "ENDED_STILL_ASSIGNED", employmentId: employment.id, message: `ended employment ${employment.id} still has a current assignment` });
    }

    const expected = await deriveCache(prisma, employment.id, employment.endDate);
    if (expected) {
      const fields = drifted(employment, expected);
      if (fields.length > 0) findings.push({ level: "error", code: "CACHE_DRIFT", employmentId: employment.id, message: `employment ${employment.id} says ${fields.join(", ")} differently from its history` });
    }

    // An invited or deactivated login is not in use; its placement is settled when it is (the door on acceptance).
    const member = employment.companyMember;
    if (member && member.status === "ACTIVE" && employment.employmentStatus !== "ENDED" && (member.departmentId !== employment.departmentId || member.jobTitle !== employment.jobTitle)) {
      findings.push({ level: "error", code: "MEMBERSHIP_DRIFT", employmentId: employment.id, message: `employment ${employment.id}'s login is placed in another department or under another title` });
    }
  }

  // Current reporting lines loop (E-03 §113, §114).
  const lines = await prisma.employeeProfile.findMany({
    where: { employmentStatus: { not: "ENDED" }, companyMemberId: { not: null }, managerMemberId: { not: null } },
    select: { id: true, companyId: true, companyMemberId: true, managerMemberId: true },
  });
  const managerOf = new Map(lines.map((line) => [`${line.companyId}:${line.companyMemberId}`, line.managerMemberId!]));
  for (const line of lines) {
    const seen = new Set<string>([line.companyMemberId!]);
    let current: string | undefined = line.managerMemberId!;
    for (let depth = 0; current && depth < 100; depth += 1) {
      if (seen.has(current)) {
        if (current === line.companyMemberId) findings.push({ level: "error", code: "MANAGER_CYCLE", employmentId: line.id, message: `employment ${line.id} is managed, through others, by itself` });
        break;
      }
      seen.add(current);
      current = managerOf.get(`${line.companyId}:${current}`);
    }
  }

  // Managers of another company in a current row (the database cannot check this; the service does).
  const crossed = await prisma.employmentAssignment.findMany({
    where: { endDate: null, supersededAt: null, managerMemberId: { not: null } },
    select: { employeeProfileId: true, companyId: true, managerMember: { select: { companyId: true } } },
  });
  for (const row of crossed) {
    if (row.managerMember && row.managerMember.companyId !== row.companyId) {
      findings.push({ level: "error", code: "MANAGER_OTHER_COMPANY", employmentId: row.employeeProfileId, message: `employment ${row.employeeProfileId}'s manager belongs to another company` });
    }
  }

  // The worker fell behind (E-03 §156, §226): a change due before yesterday still waiting.
  const overdue = await prisma.employmentChange.findMany({
    where: { status: "SCHEDULED", effectiveDate: { lt: new Date(`${addDays(todayDay(), -1)}T00:00:00.000Z`) } },
    select: { id: true, employeeProfileId: true, effectiveDate: true },
  });
  for (const change of overdue) {
    findings.push({ level: "warning", code: "SCHEDULED_OVERDUE", employmentId: change.employeeProfileId, message: `scheduled change ${change.id} was due ${dayOf(change.effectiveDate)} and has not been applied` });
  }
  return findings;
}

/**
 * Rewrites an employment's current fields from its history where they drifted
 * (E-03 §182). Dry run unless `apply`; every rewrite is audited as the system.
 */
export async function repairEmploymentCaches(prisma: PrismaClient, options: { apply: boolean }): Promise<Array<{ employmentId: string; fields: string[] }>> {
  const findings = (await findEmploymentFindings(prisma)).filter((finding) => finding.code === "CACHE_DRIFT" && finding.employmentId);
  const repaired: Array<{ employmentId: string; fields: string[] }> = [];
  const companies = new Map((await prisma.employeeProfile.findMany({ where: { id: { in: findings.map((finding) => finding.employmentId!) } }, select: { id: true, companyId: true } })).map((row) => [row.id, row.companyId]));
  for (const finding of findings) {
    const employmentId = finding.employmentId!;
    const before = await prisma.employeeProfile.findFirstOrThrow({
      where: { id: employmentId, companyId: companies.get(employmentId) },
      select: { id: true, companyId: true, employmentStatus: true, departmentId: true, jobTitle: true, managerMemberId: true, workLocationType: true, workLocation: true, employmentType: true, startDate: true, endDate: true },
    });
    const expected = await deriveCache(prisma, employmentId, before.endDate);
    if (!expected) continue;
    const fields = drifted(before, expected);
    repaired.push({ employmentId, fields });
    if (!options.apply) continue;
    await prisma.$transaction(async (tx) => {
      await syncCache(tx, { id: employmentId, companyId: before.companyId });
      await recordSystemAction(
        before.companyId,
        {
          actionKey: AuditAction.HR_EMPLOYMENT_CACHE_REPAIRED,
          entity: { type: "EmployeeProfile", id: employmentId, label: "Employment" },
          before: Object.fromEntries(
            fields.map((field) => {
              const value = (before as Record<string, unknown>)[field];
              return [field, value instanceof Date ? dayOf(value) : value];
            }),
          ),
          after: Object.fromEntries(fields.map((field) => [field, (expected as Record<string, unknown>)[field] ?? null])),
        },
        { tx },
      );
    });
  }
  return repaired;
}
