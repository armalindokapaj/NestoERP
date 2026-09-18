import type { EmploymentStatus, Prisma } from "@prisma/client";

import { AccessError, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { dayOf, type Day } from "@/lib/modules/hr/employment/employment.dates";
import { lockEmployment } from "@/lib/modules/hr/employment/employment.history";
import { workforceProjectWhere } from "./workforce.permissions";

/** The shared checks of the workforce's writes (E-04 §167-§175). */

export type Worker = { id: string; name: string; personProfileId: string; employmentStatus: EmploymentStatus; startDate: Day | null };

/**
 * The employment a workforce change is about: this company's, and not ended
 * (§105, §107). Locked, so two changes to one person's crew or projects queue
 * rather than race (§221, §222) — the database's own exclusions would refuse
 * the loser anyway; the lock turns that into a clear answer.
 */
export async function lockWorker(tx: Prisma.TransactionClient, companyId: string, employeeId: string): Promise<Worker> {
  await lockEmployment(tx, employeeId);
  const row = await tx.employeeProfile.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true, personProfileId: true, employmentStatus: true, startDate: true, personProfile: { select: { firstName: true, lastName: true } } },
  });
  if (!row) throw new AccessError("NOT_FOUND");
  const worker = {
    id: row.id,
    name: `${row.personProfile.firstName} ${row.personProfile.lastName}`,
    personProfileId: row.personProfileId,
    employmentStatus: row.employmentStatus,
    startDate: row.startDate ? dayOf(row.startDate) : null,
  };
  if (worker.employmentStatus === "ENDED") throw new AccessError("CONFLICT", `${worker.name}'s employment has ended.`, { code: "EMPLOYMENT_ENDED" });
  return worker;
}

/** A period may not begin before the employment does. */
export function assertWithinEmployment(worker: Worker, start: Day, field = "startDate"): void {
  if (worker.startDate && start < worker.startDate) {
    const message = `${worker.name} starts working here on ${worker.startDate}.`;
    throw new AccessError("VALIDATION_ERROR", message, { [field]: [message] });
  }
}

/** A project this reader reaches for the workforce, still in use (§171). */
export async function requireProject(tx: Prisma.TransactionClient, context: UserContext, projectId: string, field = "projectId") {
  const project = await tx.project.findFirst({
    where: { AND: [workforceProjectWhere(context), { id: projectId }] },
    select: { id: true, name: true, code: true, status: true, archivedAt: true },
  });
  if (!project) throw invalidRecordLink(field, "SCOPE_DENIED", "Choose one of your projects.");
  return project;
}

/** A site of that project, in use — or the one the record already has (§172). */
export async function requireSite(tx: Prisma.TransactionClient, companyId: string, projectId: string | null, siteId: string | null | undefined, current: string | null = null): Promise<string | null> {
  if (!siteId) return null;
  if (!projectId) throw invalidRecordLink("siteId", "CROSS_PROJECT_REFERENCE", "A site belongs to a project: choose the project too.");
  const site = await tx.projectSite.findFirst({ where: { id: siteId, projectId, companyId, ...(siteId === current ? {} : { status: "ACTIVE" }) }, select: { id: true } });
  if (!site) throw invalidRecordLink("siteId", "CROSS_PROJECT_REFERENCE", "Choose one of this project's sites.");
  return site.id;
}

/** Another write got there first: the database's exclusions said so, or the row moved on (§221, §222). */
export function workforceRaced(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if ((error as { code?: string } | null)?.code === "P2025" || /(workforce_crew_members|employee_project_assignments)_(no_overlap|one_primary|dates_check)/.test(message)) {
    throw new AccessError("CONFLICT", "Their assignments changed at the same moment. Refresh and try again.", { code: "WORKFORCE_RACED" });
  }
  throw error;
}

export function personName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`;
}
