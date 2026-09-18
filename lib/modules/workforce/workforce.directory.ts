import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { accountStatusOf, accountStatusWhere } from "@/lib/modules/hr/hr.person";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { assignmentsOf } from "./assignment.service";
import { crewMembershipsOf } from "./crew.service";
import { assertWorkforce, canManageAssignments, canManageCrewOn, coversDay, readableCrewWhere, readableWorkerWhere, seesWholeCompany, workforceOpen, workforceProjectWhere } from "./workforce.permissions";
import type { WorkerListQuery } from "./workforce.schema";
import { personName } from "./workforce.shared";
import type { WorkerSummaryDTO, WorkerWorkforceDTO } from "./workforce.types";

/**
 * The workforce directory (E-04 §18, §19, §136-§139): everybody the company
 * employs — office and site, with a login or without — by trade, crew,
 * project and site. Standard work facts only: no pay, no private contact data,
 * nothing HR keeps to itself (§79, §152). Ended employments are former workers
 * and are shown only when asked for (§107).
 */

const LIVE_STATUSES = ["PLANNED", "ACTIVE", "ON_LEAVE", "SUSPENDED"] as const;

const SUMMARY_SELECT = {
  id: true,
  personProfileId: true,
  employeeNumber: true,
  jobTitle: true,
  workerCategory: true,
  employmentStatus: true,
  trade: { select: { id: true, name: true } },
  personProfile: { select: { firstName: true, lastName: true } },
  companyMember: { select: { status: true, user: { select: { status: true } } } },
} satisfies Prisma.EmployeeProfileSelect;

const ORDER: Record<WorkerListQuery["sort"], Prisma.EmployeeProfileOrderByWithRelationInput[]> = {
  "name-asc": [{ personProfile: { lastName: "asc" } }, { personProfile: { firstName: "asc" } }],
  "name-desc": [{ personProfile: { lastName: "desc" } }, { personProfile: { firstName: "desc" } }],
  "number-asc": [{ employeeNumber: "asc" }],
  "trade-asc": [{ trade: { name: "asc" } }, { personProfile: { lastName: "asc" } }],
};

export async function listWorkers(context: UserContext, query: WorkerListQuery) {
  assertWorkforce(context);
  const filters: Prisma.EmployeeProfileWhereInput[] = [readableWorkerWhere(context), { employmentStatus: { in: query.status ?? [...LIVE_STATUSES] } }];

  if (query.search) {
    const term = query.search;
    filters.push({
      OR: [
        { personProfile: { firstName: { contains: term, mode: "insensitive" } } },
        { personProfile: { lastName: { contains: term, mode: "insensitive" } } },
        { employeeNumber: { contains: term, mode: "insensitive" } },
        { jobTitle: { contains: term, mode: "insensitive" } },
      ],
    });
  }
  if (query.workerCategory?.length) filters.push({ workerCategory: { in: query.workerCategory } });
  if (query.tradeId) filters.push({ tradeId: query.tradeId });
  if (query.accountStatus?.length) filters.push({ OR: query.accountStatus.map(accountStatusWhere) });
  if (query.crewId) filters.push({ crewMemberships: { some: { ...coversDay(), crewId: query.crewId, crew: readableCrewWhere(context) } } });
  if (query.projectId || query.siteId) {
    filters.push({
      projectAssignments: {
        some: { ...coversDay(), project: workforceProjectWhere(context), ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.siteId ? { siteId: query.siteId } : {}) },
      },
    });
  }

  const where: Prisma.EmployeeProfileWhereInput = { AND: filters };
  const [rows, total] = await Promise.all([
    prisma.employeeProfile.findMany({ where, orderBy: ORDER[query.sort], skip: skipFor(query.page, query.limit), take: query.limit, select: SUMMARY_SELECT }),
    prisma.employeeProfile.count({ where }),
  ]);
  const places = await currentPlaces(context, rows.map((row) => row.id));

  return {
    data: rows.map((row): WorkerSummaryDTO => {
      const place = places.get(row.id);
      return {
        employeeId: row.id,
        personId: row.personProfileId,
        name: personName(row.personProfile),
        employeeNumber: row.employeeNumber,
        jobTitle: row.jobTitle,
        workerCategory: row.workerCategory,
        trade: row.trade,
        crew: place?.crew ?? null,
        project: place?.project ?? null,
        site: place?.site ?? null,
        supervisor: place?.supervisor ?? null,
        employmentStatus: row.employmentStatus,
        accountStatus: accountStatusOf(row.companyMember),
      };
    }),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

/** Today's crew and main project of each worker on the page — two queries, never one per row (§244). */
async function currentPlaces(context: UserContext, employeeIds: string[]) {
  const places = new Map<string, { crew: { id: string; name: string } | null; supervisor: string | null; project: { id: string; name: string; code: string | null } | null; site: { id: string; name: string } | null }>();
  if (employeeIds.length === 0) return places;
  const [crews, assignments] = await Promise.all([
    prisma.workforceCrewMember.findMany({
      where: { employeeProfileId: { in: employeeIds }, ...coversDay(), crew: readableCrewWhere(context) },
      select: { employeeProfileId: true, crew: { select: { id: true, name: true, supervisor: { select: { personProfile: { select: { firstName: true, lastName: true } } } } } } },
    }),
    prisma.employeeProjectAssignment.findMany({
      where: { employeeProfileId: { in: employeeIds }, ...coversDay(), project: workforceProjectWhere(context) },
      orderBy: [{ isPrimary: "desc" }, { startDate: "asc" }],
      select: { employeeProfileId: true, project: { select: { id: true, name: true, code: true } }, site: { select: { id: true, name: true } } },
    }),
  ]);
  const at = (id: string) => places.get(id) ?? places.set(id, { crew: null, supervisor: null, project: null, site: null }).get(id)!;
  for (const row of crews) {
    const place = at(row.employeeProfileId);
    place.crew = { id: row.crew.id, name: row.crew.name };
    place.supervisor = row.crew.supervisor ? personName(row.crew.supervisor.personProfile) : null;
  }
  for (const row of assignments) {
    const place = at(row.employeeProfileId);
    if (place.project) continue;
    place.project = row.project;
    place.site = row.site;
  }
  return places;
}

/** What the directory's filters may offer this reader: only what they can already see (§19). */
export async function workerFilterOptions(context: UserContext) {
  const [trades, crews, projects] = await Promise.all([
    prisma.workforceTrade.findMany({ where: { companyId: context.companyId, employees: { some: readableWorkerWhere(context) } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.workforceCrew.findMany({ where: { AND: [readableCrewWhere(context), { status: "ACTIVE" }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    projectChoices(context),
  ]);
  return { trades, crews, projects };
}

/** The projects a workforce form may name: in the reader's scope and not archived (§171). */
export async function projectChoices(context: UserContext): Promise<Array<{ id: string; name: string; code: string | null }>> {
  if (!workforceOpen(context)) return [];
  return prisma.project.findMany({
    where: { AND: [workforceProjectWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
}

/** The active sites of those projects, for a project's site picker (§38, §172). */
export async function siteChoices(context: UserContext, projectIds: string[]): Promise<Array<{ id: string; projectId: string; name: string }>> {
  if (projectIds.length === 0) return [];
  return prisma.projectSite.findMany({ where: { companyId: context.companyId, projectId: { in: projectIds }, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, projectId: true, name: true } });
}

/**
 * The people a manager may put in a crew or on a project: anybody the company
 * employs who has not left (§114, §115). Somebody assigning people to their
 * project has to be able to find them first, so this reaches past the
 * manager's own read scope — names and trades only, nothing else.
 */
export async function workerChoices(context: UserContext): Promise<Array<{ value: string; label: string }>> {
  const manages = workforceOpen(context) && (can(context, "workforce.crew.manage") || can(context, "workforce.project_assignment.manage"));
  if (!manages) return [];
  const rows = await prisma.employeeProfile.findMany({
    where: { companyId: context.companyId, employmentStatus: { in: [...LIVE_STATUSES] } },
    orderBy: [{ personProfile: { lastName: "asc" } }, { personProfile: { firstName: "asc" } }],
    take: 2000,
    select: { id: true, employeeNumber: true, personProfile: { select: { firstName: true, lastName: true } }, trade: { select: { name: true } } },
  });
  return rows.map((row) => ({ value: row.id, label: [personName(row.personProfile), row.trade?.name, row.employeeNumber].filter(Boolean).join(" · ") }));
}

/**
 * A person's place in this company's workforce, for their profile's Workforce
 * tab (§139, E-09 §7): the employment here — the running one, else the latest —
 * when this reader may see it. `null` when they may not, so the tab is absent
 * rather than empty.
 */
export async function workforceForPerson(context: UserContext, personId: string): Promise<WorkerWorkforceDTO | null> {
  if (!workforceOpen(context)) return null;
  const rows = await prisma.employeeProfile.findMany({
    where: { AND: [readableWorkerWhere(context), { personProfileId: personId }] },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  });
  const row = rows.find((candidate) => candidate.employmentStatus !== "ENDED") ?? rows[0];
  if (!row) return null;

  const [crews, assignments] = await Promise.all([crewMembershipsOf(context, row.id), assignmentsOf(context, row.id)]);
  const live = row.employmentStatus !== "ENDED";
  return {
    employeeId: row.id,
    personId: row.personProfileId,
    name: personName(row.personProfile),
    employeeNumber: row.employeeNumber,
    jobTitle: row.jobTitle,
    workerCategory: row.workerCategory,
    trade: row.trade,
    employmentStatus: row.employmentStatus,
    accountStatus: accountStatusOf(row.companyMember),
    crews: crews.live,
    crewHistory: crews.history,
    assignments: assignments.live,
    assignmentHistory: assignments.history,
    capabilities: {
      canAssignProject: live && canManageAssignments(context),
      canAssignCrew: live && canManageCrewOn(context, seesWholeCompany(context) ? null : true),
    },
  };
}

/** A worker this reader may see, by employment — for the API's per-worker reads. */
export async function requireReadableWorker(context: UserContext, employeeId: string): Promise<{ id: string; personProfileId: string }> {
  assertWorkforce(context);
  const row = await prisma.employeeProfile.findFirst({ where: { AND: [readableWorkerWhere(context), { id: employeeId }] }, select: { id: true, personProfileId: true } });
  if (!row) throw new AccessError("NOT_FOUND");
  return row;
}

/** Whether a person's profile has a Workforce tab for this reader: an employment here they may see. */
export async function personInWorkforce(context: UserContext, personId: string): Promise<boolean> {
  if (!workforceOpen(context)) return false;
  const count = await prisma.employeeProfile.count({ where: { AND: [readableWorkerWhere(context), { personProfileId: personId }] } });
  return count > 0;
}
