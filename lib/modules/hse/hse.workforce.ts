import type { HseIncidentInvolvement, Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission, invalidRecordLink, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { buildHseProjectWhere, buildIncidentScopeWhere, buildPermitScopeWhere } from "./hse.scope";
import { isIncidentRecordEditable, isPermitEditable } from "./hse.status";

/**
 * HSE and the workforce (E-04 §70-§74, §142, §183, §270).
 *
 * Most people on a site have no NESTO login, and the safety record has to name
 * them all the same: who was inducted, who attended the talk, whose PPE was
 * checked, who was hurt or saw it, who a permit covers. Every one of those
 * names an employment of this company — never a login — or, for somebody the
 * company does not employ, a name. What the worker's own profile shows is a
 * compliance summary; incident details stay with the incident (§84).
 */

const MODULE = "hse" as const;

export type WorkerOption = { id: string; name: string };
export type HseWorkerRef = { employeeId: string; personId: string; name: string };

const name = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`;
const day = (value: Date) => value.toISOString().slice(0, 10);
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

/**
 * The people a safety form may name who have no login (§70): this company's
 * employments that have not ended. Anybody with a login is already offered as a
 * member, so they are not listed twice.
 */
export async function hseWorkerOptions(context: UserContext): Promise<WorkerOption[]> {
  const rows = await prisma.employeeProfile.findMany({
    where: { companyId: context.companyId, companyMemberId: null, employmentStatus: { not: "ENDED" } },
    orderBy: [{ personProfile: { firstName: "asc" } }, { personProfile: { lastName: "asc" } }],
    take: 2000,
    select: { id: true, personProfile: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({ id: row.id, name: name(row.personProfile) }));
}

/**
 * Everybody the company employs, login or not, for records that name an
 * employment rather than a member — the people in an incident, the workers on
 * a permit, an induction (§71-§74) — and the company's crews in use.
 */
export async function hseEmploymentOptions(context: UserContext): Promise<{ employees: Array<{ value: string; label: string }>; crews: Array<{ value: string; label: string }> }> {
  const [employees, crews] = await Promise.all([
    prisma.employeeProfile.findMany({
      where: { companyId: context.companyId, employmentStatus: { not: "ENDED" } },
      orderBy: [{ personProfile: { firstName: "asc" } }, { personProfile: { lastName: "asc" } }],
      take: 2000,
      select: { id: true, companyMemberId: true, personProfile: { select: { firstName: true, lastName: true } } },
    }),
    prisma.workforceCrew.findMany({ where: { companyId: context.companyId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    employees: employees.map((row) => ({ value: row.id, label: row.companyMemberId ? name(row.personProfile) : `${name(row.personProfile)} (no NESTO account)` })),
    crews: crews.map((row) => ({ value: row.id, label: row.name })),
  };
}

/** Employments a safety record may name: this company's, not ended — or already on the record. */
export async function requireHseWorkers(companyId: string, ids: Array<string | null | undefined>, keep: string[] = [], field = "employeeProfileId"): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id) && !keep.includes(id!)))];
  if (wanted.length === 0) return;
  const found = await prisma.employeeProfile.count({ where: { companyId, id: { in: wanted }, employmentStatus: { not: "ENDED" } } });
  if (found !== wanted.length) throw invalidRecordLink(field, "CROSS_COMPANY_REFERENCE", "Choose somebody this company employs.");
}

/* -------------------------------------------------------------------------- */
/* People involved in an incident (§73)                                        */
/* -------------------------------------------------------------------------- */

export type IncidentPersonDTO = { id: string; worker: HseWorkerRef | null; externalName: string | null; involvement: HseIncidentInvolvement; notes: string | null };

async function readableIncident(context: UserContext, incidentId: string) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.view");
  return assertFound(await prisma.hseIncident.findFirst({ where: { AND: [buildIncidentScopeWhere(context), { id: incidentId }] }, select: { id: true, incidentNumber: true, status: true } }));
}

export async function listIncidentPeople(context: UserContext, incidentId: string): Promise<IncidentPersonDTO[]> {
  const incident = await readableIncident(context, incidentId);
  const rows = await prisma.hseIncidentPerson.findMany({
    where: { incidentId: incident.id, companyId: context.companyId },
    orderBy: { createdAt: "asc" },
    select: { id: true, externalName: true, involvement: true, notes: true, employeeProfile: { select: { id: true, personProfileId: true, personProfile: { select: { firstName: true, lastName: true } } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    worker: row.employeeProfile ? { employeeId: row.employeeProfile.id, personId: row.employeeProfile.personProfileId, name: name(row.employeeProfile.personProfile) } : null,
    externalName: row.externalName,
    involvement: row.involvement,
    notes: row.notes,
  }));
}

export async function addIncidentPerson(
  context: UserContext,
  incidentId: string,
  input: { employeeId?: string | null; externalName?: string | null; involvement: HseIncidentInvolvement; notes?: string | null },
): Promise<void> {
  const incident = await readableIncident(context, incidentId);
  assertPermission(context, "hse.incident.update");
  if (!isIncidentRecordEditable(incident.status)) throw stateDenied("This incident can no longer be changed.");
  if (Boolean(input.employeeId) === Boolean(input.externalName)) {
    throw new AccessError("VALIDATION_ERROR", "Choose somebody the company employs, or write the name of somebody it does not.", { employeeId: ["Choose one or the other."] });
  }
  if (input.employeeId) await requireHseWorkers(context.companyId, [input.employeeId], [], "employeeId");

  await prisma
    .$transaction(async (tx) => {
      const row = await tx.hseIncidentPerson.create({
        data: { companyId: context.companyId, incidentId: incident.id, employeeProfileId: input.employeeId ?? null, externalName: input.externalName ?? null, involvement: input.involvement, notes: input.notes ?? null, createdByMemberId: context.membershipId },
        select: { id: true },
      });
      await recordActivity(tx, context, { module: MODULE, entityType: "HseIncident", entityId: incident.id, action: "HSE_INCIDENT_PERSON_ADDED", message: `recorded a person ${input.involvement.toLowerCase()} in ${incident.incidentNumber}`, metadata: { personRowId: row.id, employmentId: input.employeeId ?? null, involvement: input.involvement } });
    })
    .catch((error: unknown) => {
      if ((error as { code?: string } | null)?.code === "P2002") throw new AccessError("CONFLICT", "They are already recorded on this incident.", { code: "ALREADY_RECORDED" });
      throw error;
    });
}

export async function removeIncidentPerson(context: UserContext, incidentId: string, personRowId: string): Promise<void> {
  const incident = await readableIncident(context, incidentId);
  assertPermission(context, "hse.incident.update");
  if (!isIncidentRecordEditable(incident.status)) throw stateDenied("This incident can no longer be changed.");
  await prisma.$transaction(async (tx) => {
    const removed = await tx.hseIncidentPerson.deleteMany({ where: { id: personRowId, incidentId: incident.id, companyId: context.companyId } });
    if (removed.count === 0) throw new AccessError("NOT_FOUND");
    await recordActivity(tx, context, { module: MODULE, entityType: "HseIncident", entityId: incident.id, action: "HSE_INCIDENT_PERSON_REMOVED", message: `removed a person from ${incident.incidentNumber}`, metadata: { personRowId } });
  });
}

/* -------------------------------------------------------------------------- */
/* Who a work permit covers (§74)                                              */
/* -------------------------------------------------------------------------- */

export type PermitWorkerDTO = { id: string; worker: HseWorkerRef | null; crew: { id: string; name: string; size: number } | null };

async function readablePermit(context: UserContext, permitId: string) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.view");
  return assertFound(await prisma.hseWorkPermit.findFirst({ where: { AND: [buildPermitScopeWhere(context), { id: permitId }] }, select: { id: true, permitNumber: true, status: true } }));
}

export async function listPermitWorkers(context: UserContext, permitId: string): Promise<PermitWorkerDTO[]> {
  const permit = await readablePermit(context, permitId);
  const now = today();
  const rows = await prisma.hseWorkPermitWorker.findMany({
    where: { permitId: permit.id, companyId: context.companyId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      employeeProfile: { select: { id: true, personProfileId: true, personProfile: { select: { firstName: true, lastName: true } } } },
      crew: { select: { id: true, name: true, _count: { select: { members: { where: { startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] } } } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    worker: row.employeeProfile ? { employeeId: row.employeeProfile.id, personId: row.employeeProfile.personProfileId, name: name(row.employeeProfile.personProfile) } : null,
    crew: row.crew ? { id: row.crew.id, name: row.crew.name, size: row.crew._count.members } : null,
  }));
}

/** A person or a whole crew on a permit still being written (§351: an issued permit's terms are fixed). */
export async function addPermitWorker(context: UserContext, permitId: string, input: { employeeId?: string | null; crewId?: string | null }): Promise<void> {
  const permit = await readablePermit(context, permitId);
  assertPermission(context, "hse.permit.update");
  if (!isPermitEditable(permit.status)) throw stateDenied("Only a draft permit's workers can change.");
  if (Boolean(input.employeeId) === Boolean(input.crewId)) throw new AccessError("VALIDATION_ERROR", "Choose a person or a crew.", { employeeId: ["Choose a person or a crew."] });
  if (input.employeeId) await requireHseWorkers(context.companyId, [input.employeeId], [], "employeeId");
  if (input.crewId) {
    const crew = await prisma.workforceCrew.count({ where: { id: input.crewId, companyId: context.companyId, status: "ACTIVE" } });
    if (!crew) throw invalidRecordLink("crewId", "CROSS_COMPANY_REFERENCE", "Choose one of this company's crews.");
  }
  await prisma
    .$transaction(async (tx) => {
      await tx.hseWorkPermitWorker.create({ data: { companyId: context.companyId, permitId: permit.id, employeeProfileId: input.employeeId ?? null, crewId: input.crewId ?? null, createdByMemberId: context.membershipId } });
      await recordActivity(tx, context, { module: MODULE, entityType: "HseWorkPermit", entityId: permit.id, action: "HSE_PERMIT_WORKER_ADDED", message: `added ${input.crewId ? "a crew" : "a worker"} to ${permit.permitNumber}`, metadata: { employmentId: input.employeeId ?? null, crewId: input.crewId ?? null } });
    })
    .catch((error: unknown) => {
      if ((error as { code?: string } | null)?.code === "P2002") throw new AccessError("CONFLICT", "The permit already covers them.", { code: "ALREADY_COVERED" });
      throw error;
    });
}

export async function removePermitWorker(context: UserContext, permitId: string, rowId: string): Promise<void> {
  const permit = await readablePermit(context, permitId);
  assertPermission(context, "hse.permit.update");
  if (!isPermitEditable(permit.status)) throw stateDenied("Only a draft permit's workers can change.");
  await prisma.$transaction(async (tx) => {
    const removed = await tx.hseWorkPermitWorker.deleteMany({ where: { id: rowId, permitId: permit.id, companyId: context.companyId } });
    if (removed.count === 0) throw new AccessError("NOT_FOUND");
    await recordActivity(tx, context, { module: MODULE, entityType: "HseWorkPermit", entityId: permit.id, action: "HSE_PERMIT_WORKER_REMOVED", message: `removed a worker from ${permit.permitNumber}`, metadata: { rowId } });
  });
}

/* -------------------------------------------------------------------------- */
/* Site inductions (§71, §183, §270)                                           */
/* -------------------------------------------------------------------------- */

export type InductionDTO = {
  id: string;
  worker: HseWorkerRef;
  project: { id: string; name: string };
  site: { id: string; name: string } | null;
  inductedOn: string;
  validUntil: string | null;
  conductedBy: string;
  notes: string | null;
  valid: boolean;
  voided: boolean;
  voidReason: string | null;
  canVoid: boolean;
};

const INDUCTION_SELECT = {
  id: true,
  inductedOn: true,
  validUntil: true,
  notes: true,
  voidedAt: true,
  voidReason: true,
  employeeProfile: { select: { id: true, personProfileId: true, personProfile: { select: { firstName: true, lastName: true } } } },
  project: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
  conductedBy: { select: { user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.HseInductionSelect;

function toInduction(context: UserContext, row: Prisma.HseInductionGetPayload<{ select: typeof INDUCTION_SELECT }>): InductionDTO {
  const valid = !row.voidedAt && (!row.validUntil || row.validUntil >= today());
  return {
    id: row.id,
    worker: { employeeId: row.employeeProfile.id, personId: row.employeeProfile.personProfileId, name: name(row.employeeProfile.personProfile) },
    project: row.project,
    site: row.site,
    inductedOn: day(row.inductedOn),
    validUntil: row.validUntil ? day(row.validUntil) : null,
    conductedBy: name(row.conductedBy.user),
    notes: row.notes,
    valid,
    voided: Boolean(row.voidedAt),
    voidReason: row.voidReason,
    canVoid: !row.voidedAt && can(context, "hse.induction.void"),
  };
}

function inductionsOpen(context: UserContext): boolean {
  return can(context, "hse.view") && can(context, "hse.induction.view");
}

/** A project's inductions, newest first — within the reader's HSE project scope. */
export async function inductionsForProject(context: UserContext, projectId: string): Promise<InductionDTO[]> {
  if (!inductionsOpen(context)) return [];
  const rows = await prisma.hseInduction.findMany({
    where: { companyId: context.companyId, projectId, project: buildHseProjectWhere(context) },
    orderBy: [{ inductedOn: "desc" }],
    take: 500,
    select: INDUCTION_SELECT,
  });
  return rows.map((row) => toInduction(context, row));
}

/** A worker's inductions, for their profile: dates and validity only (§84, §142). */
export async function inductionsForWorker(context: UserContext, employeeId: string): Promise<InductionDTO[]> {
  if (!inductionsOpen(context)) return [];
  const rows = await prisma.hseInduction.findMany({
    where: { companyId: context.companyId, employeeProfileId: employeeId, project: buildHseProjectWhere(context) },
    orderBy: [{ inductedOn: "desc" }],
    take: 100,
    select: INDUCTION_SELECT,
  });
  return rows.map((row) => toInduction(context, row));
}

/**
 * The people assigned to a project today who have no valid induction for it
 * (§183): the list a site manager works through before anybody starts.
 */
export async function workersMissingInduction(context: UserContext, projectId: string): Promise<HseWorkerRef[]> {
  if (!inductionsOpen(context)) return [];
  const now = today();
  const rows = await prisma.employeeProfile.findMany({
    where: {
      companyId: context.companyId,
      employmentStatus: { not: "ENDED" },
      projectAssignments: { some: { projectId, project: buildHseProjectWhere(context), startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] } },
      hseInductions: { none: { projectId, voidedAt: null, OR: [{ validUntil: null }, { validUntil: { gte: now } }] } },
    },
    orderBy: [{ personProfile: { firstName: "asc" } }],
    select: { id: true, personProfileId: true, personProfile: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({ employeeId: row.id, personId: row.personProfileId, name: name(row.personProfile) }));
}

export async function recordInduction(
  context: UserContext,
  input: { employeeId: string; projectId: string; siteId?: string | null; inductedOn: string; validUntil?: string | null; notes?: string | null },
): Promise<InductionDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.induction.record");
  const project = await prisma.project.findFirst({ where: { AND: [buildHseProjectWhere(context), { id: input.projectId }] }, select: { id: true, name: true } });
  if (!project) throw invalidRecordLink("projectId", "SCOPE_DENIED", "Choose one of your projects.");
  if (input.siteId) {
    const site = await prisma.projectSite.count({ where: { id: input.siteId, projectId: project.id, companyId: context.companyId } });
    if (!site) throw invalidRecordLink("siteId", "CROSS_PROJECT_REFERENCE", "Choose one of this project's sites.");
  }
  await requireHseWorkers(context.companyId, [input.employeeId], [], "employeeId");
  if (input.inductedOn > new Date().toISOString().slice(0, 10)) throw new AccessError("VALIDATION_ERROR", "An induction is recorded once it has happened.", { inductedOn: ["An induction is recorded once it has happened."] });
  if (input.validUntil && input.validUntil < input.inductedOn) throw new AccessError("VALIDATION_ERROR", "It cannot expire before it was given.", { validUntil: ["It cannot expire before it was given."] });

  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.hseInduction.create({
      data: {
        companyId: context.companyId,
        employeeProfileId: input.employeeId,
        projectId: project.id,
        siteId: input.siteId ?? null,
        inductedOn: new Date(`${input.inductedOn}T00:00:00.000Z`),
        validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00.000Z`) : null,
        conductedByMemberId: context.membershipId,
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });
    await recordActivity(tx, context, { module: MODULE, entityType: "HseInduction", entityId: row.id, action: "HSE_INDUCTION_RECORDED", message: `recorded a site induction on ${project.name}`, metadata: { employmentId: input.employeeId, projectId: project.id, siteId: input.siteId ?? null, inductedOn: input.inductedOn } });
    return row.id;
  });
  return toInduction(context, await prisma.hseInduction.findFirstOrThrow({ where: { id, companyId: context.companyId }, select: INDUCTION_SELECT }));
}

/** An induction recorded in error stays on the record, marked void with the reason. */
export async function voidInduction(context: UserContext, inductionId: string, reason: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.induction.void");
  const row = assertFound(await prisma.hseInduction.findFirst({ where: { id: inductionId, companyId: context.companyId, project: buildHseProjectWhere(context) }, select: { id: true, voidedAt: true } }));
  if (row.voidedAt) throw stateDenied("This induction is already void.");
  await prisma.$transaction(async (tx) => {
    const voided = await tx.hseInduction.updateMany({ where: { id: row.id, companyId: context.companyId, voidedAt: null }, data: { voidedAt: new Date(), voidedByMemberId: context.membershipId, voidReason: reason } });
    if (voided.count === 0) throw stateDenied("This induction is already void.");
    await recordActivity(tx, context, { module: MODULE, entityType: "HseInduction", entityId: row.id, action: "HSE_INDUCTION_VOIDED", message: "voided a site induction", metadata: { reason } });
  });
}

/* -------------------------------------------------------------------------- */
/* A worker's safety summary (§84, §142)                                       */
/* -------------------------------------------------------------------------- */

export type WorkerHseSummary = {
  inductions: InductionDTO[];
  toolboxTalks: number;
  lastPpeCheck: { date: string; result: string } | null;
  openPermits: number;
  /** A count only: what happened, and to whom, stays with the incident (§84). */
  incidents: number;
};

export async function workerHseSummary(context: UserContext, employeeId: string): Promise<WorkerHseSummary | null> {
  if (!can(context, "hse.view")) return null;
  const [inductions, toolboxTalks, lastPpe, openPermits, incidents] = await Promise.all([
    inductionsForWorker(context, employeeId),
    can(context, "hse.toolbox.view") ? prisma.toolboxTalkParticipant.count({ where: { employeeProfileId: employeeId, attendanceStatus: "ATTENDED", toolboxTalk: { companyId: context.companyId } } }) : 0,
    can(context, "hse.ppe.view") ? prisma.ppeCheck.findFirst({ where: { companyId: context.companyId, subjectEmployeeProfileId: employeeId }, orderBy: { checkDate: "desc" }, select: { checkDate: true, result: true } }) : null,
    can(context, "hse.permit.view") ? prisma.hseWorkPermitWorker.count({ where: { companyId: context.companyId, employeeProfileId: employeeId, permit: { status: { in: ["APPROVED", "ACTIVE"] } } } }) : 0,
    can(context, "hse.incident.view") ? prisma.hseIncidentPerson.count({ where: { companyId: context.companyId, employeeProfileId: employeeId, incident: buildIncidentScopeWhere(context) } }) : 0,
  ]);
  return { inductions, toolboxTalks, lastPpeCheck: lastPpe ? { date: day(lastPpe.checkDate), result: lastPpe.result } : null, openPermits, incidents };
}
