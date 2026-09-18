import type { EmploymentStatus } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { employmentStatusLabels } from "../hr.status";
import { hrScopeKind } from "../hr.scope";
import { dayOf, dbDay, daysBetween, todayDay, type Day } from "./employment.dates";
import type { OrganizationReportQuery } from "./employment.schema";
import type { HeadcountRowDTO, OrganizationReportDTO } from "./employment.types";

/**
 * Organization reporting (E-03 §141-§144, §214, §247).
 *
 * Every figure is read from the history's effective dates, never from when a
 * row was written (§142): headcount on a day is who was employed that day —
 * active or on leave — in the department and with the title they held then
 * (§143, §144). Movements count the history rows that began in the period.
 *
 * A company counts when the reader holds HR reporting and history across that
 * whole company, judged by their own membership there — so Group HR, who works
 * in every company, sees the group by legal entity, and a company's HR sees
 * their company (§66, §67).
 */

const HEADCOUNT: EmploymentStatus[] = ["ACTIVE", "ON_LEAVE"];
const PERIOD_START = ["HIRE", "REHIRE", "LEGAL_ENTITY_TRANSFER"] as const;

function qualifies(context: UserContext): boolean {
  return canAccessModule(context, "hr") && can(context, "hr.report.view") && can(context, "hr.employment_history.view") && hrScopeKind(context) === "COMPANY";
}

async function reportableCompanies(session: UserContext): Promise<Array<{ id: string; name: string }>> {
  const memberships = await prisma.companyMember.findMany({
    where: { userId: session.userId, status: "ACTIVE", company: { parentGroupId: session.parentGroupId, status: "ACTIVE" } },
    select: { companyId: true, company: { select: { name: true } } },
    orderBy: { company: { name: "asc" } },
  });
  const companies: Array<{ id: string; name: string }> = [];
  for (const membership of memberships) {
    const context = membership.companyId === session.companyId ? session : await contextInCompany(session, membership.companyId);
    if (context && qualifies(context)) companies.push({ id: membership.companyId, name: membership.company.name });
  }
  return companies;
}

function rows(counts: Map<string, { label: string; count: number }>): HeadcountRowDTO[] {
  return [...counts.entries()].map(([key, value]) => ({ key, label: value.label, count: value.count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function bump(counts: Map<string, { label: string; count: number }>, key: string, label: string) {
  const row = counts.get(key);
  if (row) row.count += 1;
  else counts.set(key, { label, count: 1 });
}

export async function getOrganizationReport(context: UserContext, query: OrganizationReportQuery): Promise<OrganizationReportDTO> {
  assertModule(context, "hr");
  assertPermission(context, "hr.report.view");
  assertPermission(context, "hr.employment_history.view");
  if (hrScopeKind(context) !== "COMPANY") throw new AccessError("FORBIDDEN", "Organization reports cover whole companies.");

  const today = todayDay();
  const asOf = query.asOf ?? today;
  const to = query.to ?? asOf;
  const from = query.from ?? `${to.slice(0, 4)}-01-01`;
  if (from > to) throw new AccessError("VALIDATION_ERROR", "The period starts after it ends.", { field: "from" });

  const companies = await reportableCompanies(context);
  const companyIds = companies.map((company) => company.id);
  const at = dbDay(asOf);

  // Who was employed on the day, and in what status (§143).
  const statusRows = await prisma.employmentStatusHistory.findMany({
    where: { companyId: { in: companyIds }, supersededAt: null, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
    select: { employeeProfileId: true, companyId: true, status: true },
  });
  const counted = statusRows.filter((row) => HEADCOUNT.includes(row.status));
  const countedIds = counted.map((row) => row.employeeProfileId);

  // Where each of them sat that day (§144).
  const assignments = countedIds.length
    ? await prisma.employmentAssignment.findMany({
        where: { employeeProfileId: { in: countedIds }, supersededAt: null, isPrimary: true, startDate: { lte: at }, OR: [{ endDate: null }, { endDate: { gte: at } }] },
        select: { employeeProfileId: true, companyId: true, departmentId: true, departmentName: true, jobTitle: true },
      })
    : [];
  const companyName = new Map(companies.map((company) => [company.id, company.name]));
  const byCompany = new Map<string, { label: string; count: number }>();
  const byDepartment = new Map<string, { label: string; count: number }>();
  const byTitle = new Map<string, { label: string; count: number }>();
  const byStatus = new Map<string, { label: string; count: number }>();
  for (const row of counted) bump(byCompany, row.companyId, companyName.get(row.companyId) ?? "Company");
  for (const row of statusRows) if (row.status !== "ENDED" && row.status !== "PLANNED") bump(byStatus, row.status, employmentStatusLabels[row.status]);
  for (const row of assignments) {
    const company = companyName.get(row.companyId) ?? "Company";
    bump(byDepartment, row.departmentId ?? `none:${row.companyId}`, row.departmentName ? `${row.departmentName} · ${company}` : `No department · ${company}`);
    bump(byTitle, (row.jobTitle ?? "").toLowerCase() || "none", row.jobTitle ?? "No title");
  }

  // Movements that took effect in the period (§141).
  const period = { gte: dbDay(from), lte: dbDay(to) };
  const [assignmentMoves, statusMoves] = await Promise.all([
    prisma.employmentAssignment.groupBy({ by: ["reason"], where: { companyId: { in: companyIds }, supersededAt: null, startDate: period }, _count: { _all: true } }),
    prisma.employmentStatusHistory.findMany({ where: { companyId: { in: companyIds }, supersededAt: null, effectiveFrom: period }, select: { status: true, reason: true } }),
  ]);
  const moved = (reason: string) => assignmentMoves.find((row) => row.reason === reason)?._count._all ?? 0;

  // Tenure in the current period of employment, as of the day (§141).
  const starts = countedIds.length
    ? await prisma.employmentStatusHistory.findMany({
        where: { employeeProfileId: { in: countedIds }, supersededAt: null, status: "ACTIVE", reason: { in: [...PERIOD_START] }, effectiveFrom: { lte: at } },
        orderBy: { effectiveFrom: "desc" },
        select: { employeeProfileId: true, effectiveFrom: true },
      })
    : [];
  const periodStart = new Map<string, Day>();
  for (const row of starts) if (!periodStart.has(row.employeeProfileId)) periodStart.set(row.employeeProfileId, dayOf(row.effectiveFrom));
  const years = [...periodStart.values()].map((start) => daysBetween(start, asOf) / 365.25).sort((a, b) => a - b);
  const round = (value: number) => Math.round(value * 10) / 10;
  const median = years.length === 0 ? null : years.length % 2 ? years[(years.length - 1) / 2]! : (years[years.length / 2 - 1]! + years[years.length / 2]!) / 2;

  return {
    asOf,
    period: { from, to },
    headcount: counted.length,
    byCompany: rows(byCompany),
    byDepartment: rows(byDepartment),
    byTitle: rows(byTitle),
    byStatus: rows(byStatus),
    movements: {
      joiners: statusMoves.filter((row) => row.status === "ACTIVE" && (row.reason === "HIRE" || row.reason === "REHIRE")).length,
      leavers: statusMoves.filter((row) => row.status === "ENDED" && row.reason !== "LEGAL_ENTITY_TRANSFER").length,
      promotions: moved("PROMOTION"),
      departmentTransfers: moved("DEPARTMENT_TRANSFER"),
      companyTransfers: moved("LEGAL_ENTITY_TRANSFER"),
      managerChanges: moved("MANAGER_CHANGE"),
      statusChanges: statusMoves.filter((row) => row.status === "ON_LEAVE" || row.status === "SUSPENDED" || (row.status === "ACTIVE" && row.reason === "RETURN")).length,
    },
    tenure: { averageYears: years.length ? round(years.reduce((sum, value) => sum + value, 0) / years.length) : null, medianYears: median === null ? null : round(median), employees: years.length },
  };
}
