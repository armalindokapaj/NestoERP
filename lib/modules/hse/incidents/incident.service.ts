import { applyTransition } from "@/lib/core/state/transition";
import { hseIncidentMachine } from "./incident.machine";
import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { notifyCriticalSafety } from "@/lib/core/notifications/safety-notifications";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import {
  dateString,
  isOverdue,
  loadMemberRef,
  loadMembers,
  toInjuryFlags,
  toProjectRef,
} from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import {
  buildHseMemberWhere,
  buildHseProjectWhere,
  buildIncidentScopeWhere,
} from "../hse.scope";
import type { IncidentInput, IncidentListQuery, InvestigationInput } from "../hse.schema";
import {
  incidentClosureGaps,
  isIncidentCancellable,
  isIncidentClosable,
  isIncidentEditable,
  isIncidentRecordEditable,
  isIncidentInvestigable,
  isIncidentReopenable,
  isIncidentSubmittableForClose,
  OPEN_INCIDENT_STATUSES,
  requiresImmediateAction,
} from "../hse.status";
import type { IncidentDetailDTO, IncidentSummaryDTO } from "../hse.types";

/**
 * Incidents and near misses (PRD #22 §76–§99).
 *
 * Three rules shape this file.
 *
 * **A near miss is the same record** (PRD #22 §82). `incidentType = NEAR_MISS`,
 * not a second table. The whole value of near-miss reporting is that it sits in
 * the same register as the incidents it predicts — split them and nobody ever
 * compares the two.
 *
 * **Injury is recorded as flags, never as description** (PRD #22 §22, §87).
 * Occurred, first aid, treatment, lost time. There is no diagnosis field to fill
 * in, because V0.1 must not become an occupational health record it cannot
 * lawfully hold.
 *
 * **A serious incident cannot close without a root cause** (PRD #22 §95, §363).
 * That is what investigating one is for: an incident closed with "operative was
 * careless" and no cause teaches the company nothing and happens again.
 */

const MODULE = "hse" as const;
const ENTITY = "HseIncident";

const LIST_SELECT = {
  id: true,
  incidentNumber: true,
  incidentType: true,
  title: true,
  severity: true,
  status: true,
  reportedByMemberId: true,
  investigatorMemberId: true,
  occurredAt: true,
  reportedAt: true,
  dueDate: true,
  updatedAt: true,
  injuryOccurred: true,
  firstAidRequired: true,
  medicalTreatmentRequired: true,
  lostTime: true,
  propertyDamage: true,
  environmentalImpact: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.HseIncidentSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  locationText: true,
  immediateAction: true,
  investigationSummary: true,
  rootCause: true,
  lessonsLearned: true,
  submittedForCloseAt: true,
  closedAt: true,
  closedByMemberId: true,
  closureNote: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
} satisfies Prisma.HseIncidentSelect;

type ListRow = Prisma.HseIncidentGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.HseIncidentGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listIncidents(context: UserContext, query: IncidentListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.view");

  const filters: Prisma.HseIncidentWhereInput[] = [buildIncidentScopeWhere(context)];

  if (query.view === "open") filters.push({ status: { in: OPEN_INCIDENT_STATUSES } });
  if (query.view === "near-miss") filters.push({ incidentType: "NEAR_MISS" });
  if (query.view === "serious") filters.push({ severity: { in: ["HIGH", "CRITICAL"] } });
  if (query.view === "mine") {
    filters.push({
      OR: [
        { reportedByMemberId: context.membershipId },
        { investigatorMemberId: context.membershipId },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.incidentType?.length) filters.push({ incidentType: { in: query.incidentType } });
  if (query.severity?.length) filters.push({ severity: { in: query.severity } });
  if (query.projectId) filters.push({ projectId: query.projectId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { incidentNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.HseIncidentWhereInput = { AND: filters };

  const orderBy: Prisma.HseIncidentOrderByWithRelationInput[] =
    query.sort === "occurred-desc"
      ? [{ occurredAt: "desc" }]
      : query.sort === "severity-desc"
        ? [{ severity: "desc" }, { occurredAt: "desc" }]
        : query.sort === "number-asc"
          ? [{ incidentNumber: "asc" }]
          : [{ updatedAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.hseIncident.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.hseIncident.count({ where }),
  ]);

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.reportedByMemberId, row.investigatorMemberId]),
  );

  return {
    data: rows.map((row) => toSummaryDTO(context, row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getIncident(
  context: UserContext,
  incidentId: string,
): Promise<IncidentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.view");

  const row = assertFound(
    await prisma.hseIncident.findFirst({
      where: { AND: [buildIncidentScopeWhere(context), { id: incidentId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, actions, stopWorks, pending] = await Promise.all([
    loadMembers(context.companyId, [row.reportedByMemberId, row.investigatorMemberId, row.closedByMemberId]),
    loadMemberRef(context.companyId, row.createdByMemberId),
    can(context, "hse.action.view")
      ? import("../actions/action.service").then((m) => m.listForParent(context, { incidentId }))
      : Promise.resolve([]),
    can(context, "hse.stop_work.view")
      ? import("../stop-work/stop-work.service").then((m) =>
          m.listForIncident(context, incidentId),
        )
      : Promise.resolve([]),
    approvals.pendingFor(context, "INCIDENT_CLOSE", incidentId),
  ]);

  return {
    ...toSummaryDTO(context, row, members),
    description: row.description,
    locationText: row.locationText,
    immediateAction: row.immediateAction,
    investigationSummary: row.investigationSummary,
    rootCause: row.rootCause,
    lessonsLearned: row.lessonsLearned,
    submittedForCloseAt: dateString(row.submittedForCloseAt),
    closedBy: row.closedByMemberId ? (members.get(row.closedByMemberId) ?? null) : null,
    closedAt: dateString(row.closedAt),
    closureNote: row.closureNote,
    cancelledAt: dateString(row.cancelledAt),
    actions,
    stopWorks,
    closureGaps: incidentClosureGaps({
      severity: row.severity,
      rootCause: row.rootCause,
      investigationSummary: row.investigationSummary,
      closureNote: row.closureNote,
      actions: actions.map((action) => ({ status: action.status })),
    }),
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row, pending?.submittedByMemberId ?? null),
  };
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<IncidentSummaryDTO[]> {
  if (!can(context, "hse.incident.view")) return [];

  const rows = await prisma.hseIncident.findMany({
    where: { AND: [buildIncidentScopeWhere(context), { projectId }] },
    orderBy: [{ occurredAt: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.reportedByMemberId, row.investigatorMemberId]),
  );
  return rows.map((row) => toSummaryDTO(context, row, members));
}

export async function incidentFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.view");

  const scope = buildIncidentScopeWhere(context);

  const projects = await prisma.project.findMany({
    where: { AND: [buildHseProjectWhere(context), { hseIncidents: { some: scope } }] },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { projects };
}

export async function incidentFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: buildHseProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: buildHseMemberWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, members };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createIncident(
  context: UserContext,
  input: IncidentInput,
): Promise<IncidentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.create");

  if (input.projectId) await requireProject(context, input.projectId);

  // The same rule as the schema, at the service boundary, because the schema is
  // not the only way in (PRD #22 §362).
  if (
    requiresImmediateAction(input.severity) &&
    (input.immediateAction ?? "").trim().length === 0
  ) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "A high or critical incident needs the immediate action taken.",
      { code: "IMMEDIATE_ACTION_REQUIRED" },
    );
  }

  const id = await prisma.$transaction(async (tx) => {
    const incidentNumber = await nextHseNumber(tx, "hseIncident", context.companyId);

    const incident = await tx.hseIncident.create({
      data: {
        companyId: context.companyId,
        incidentNumber,
        incidentType: input.incidentType,
        title: input.title,
        description: input.description,
        projectId: input.projectId ?? null,
        occurredAt: input.occurredAt,
        reportedAt: new Date(),
        locationText: input.locationText ?? null,
        severity: input.severity,
        status: "OPEN",
        reportedByMemberId: context.membershipId,
        injuryOccurred: input.injuryOccurred,
        firstAidRequired: input.firstAidRequired,
        medicalTreatmentRequired: input.medicalTreatmentRequired,
        lostTime: input.lostTime,
        propertyDamage: input.propertyDamage,
        environmentalImpact: input.environmentalImpact,
        immediateAction: input.immediateAction ?? null,
        dueDate: input.dueDate ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, incidentNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: incident.id,
      action: "HSE_INCIDENT_CREATED",
      // The message names the kind and the number and nothing about the injury
      // — the flags live on the record, behind the permission (PRD #22 §197).
      message: `reported ${input.incidentType === "NEAR_MISS" ? "near miss" : "incident"} ${incident.incidentNumber}`,
    });

    if (input.severity === "CRITICAL") {
      await notifyCriticalSafety(tx, context, { recordType: "incident", recordId: incident.id, projectId: input.projectId ?? null, noun: "Critical incident" });
    }

    return incident.id;
  });

  return getIncident(context, id);
}

export async function updateIncident(
  context: UserContext,
  incidentId: string,
  input: IncidentInput,
): Promise<IncidentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.update");

  const existing = await requireIncident(context, incidentId);

  if (!isIncidentEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed incident cannot be edited. Reopen it first.", {
      code: "INCIDENT_CLOSED",
    });
  }

  if (!isIncidentRecordEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "This incident is waiting on a closure decision and cannot be edited now.",
      { code: "PENDING_CLOSE" },
      "STATE_DENIED",
    );
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  if (input.projectId) await requireProject(context, input.projectId);

  await prisma.$transaction(async (tx) => {
    await tx.hseIncident.update({
      where: { id: incidentId },
      data: {
        incidentType: input.incidentType,
        title: input.title,
        description: input.description,
        projectId: input.projectId ?? null,
        occurredAt: input.occurredAt,
        locationText: input.locationText ?? null,
        severity: input.severity,
        injuryOccurred: input.injuryOccurred,
        firstAidRequired: input.firstAidRequired,
        medicalTreatmentRequired: input.medicalTreatmentRequired,
        lostTime: input.lostTime,
        propertyDamage: input.propertyDamage,
        environmentalImpact: input.environmentalImpact,
        immediateAction: input.immediateAction ?? null,
        dueDate: input.dueDate ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: incidentId,
      action: "HSE_INCIDENT_UPDATED",
      message: `updated incident ${existing.incidentNumber}`,
    });
  });

  return getIncident(context, incidentId);
}

export async function assignInvestigator(
  context: UserContext,
  incidentId: string,
  memberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.assign");

  const existing = await requireIncident(context, incidentId);

  if (!isIncidentEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed incident cannot be reassigned.", {
      code: "INCIDENT_CLOSED",
    });
  }

  const member = await requireMember(context, memberId);

  await prisma.$transaction(async (tx) => {
    await tx.hseIncident.update({
      where: { id: incidentId },
      data: { investigatorMemberId: member.id, updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: incidentId,
      action: "HSE_INCIDENT_ASSIGNED",
      message: `assigned an investigator to incident ${existing.incidentNumber}`,
      metadata: { memberId: member.id } as Prisma.InputJsonValue,
    });
  });
}

/** Opening the investigation (PRD #22 §88). */
export async function startInvestigation(
  context: UserContext,
  incidentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.investigate");

  const existing = await requireIncident(context, incidentId);

  if (!isIncidentInvestigable(existing.status)) {
    throw new AccessError("CONFLICT", "This incident cannot be investigated now.", {
      code: "NOT_INVESTIGABLE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: hseIncidentMachine,
      action: "investigate",
      id: incidentId,
      context,
      from: existing.status,
      data: {
        investigatorMemberId: existing.investigatorMemberId ?? context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: incidentId,
      action: "HSE_INCIDENT_INVESTIGATION_STARTED",
      message: `began investigating incident ${existing.incidentNumber}`,
    });
  });
}

/** Recording what the investigation found (PRD #22 §90, §91). */
export async function recordInvestigation(
  context: UserContext,
  incidentId: string,
  input: InvestigationInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.investigate");

  const existing = await requireIncident(context, incidentId);

  if (!isIncidentEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed incident cannot be investigated further.", {
      code: "INCIDENT_CLOSED",
    });
  }

  if (!isIncidentRecordEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "This incident is waiting on a closure decision and its findings cannot change now.",
      { code: "PENDING_CLOSE" },
      "STATE_DENIED",
    );
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  await prisma.$transaction(async (tx) => {
    // Writing up findings opens the investigation if it was not open; for one
    // already under way it changes the write-up alone. Either way the write
    // carries the state it was decided from.
    const findings = {
      investigationSummary: input.investigationSummary ?? null,
      rootCause: input.rootCause ?? null,
      lessonsLearned: input.lessonsLearned ?? null,
      updatedByMemberId: context.membershipId,
    };
    if (existing.status === "OPEN" || existing.status === "REOPENED") {
      await applyTransition(tx, {
        machine: hseIncidentMachine,
        action: "investigate",
        id: incidentId,
        context,
        from: existing.status,
        data: findings,
      });
    } else {
      const moved = await tx.hseIncident.updateMany({
        where: { id: incidentId, companyId: context.companyId, status: existing.status },
        data: findings,
      });
      if (moved.count === 0) {
        throw new AccessError("CONFLICT", "This incident changed since you opened it. Reload to see the latest.", { code: "HSE_INCIDENT_STALE" });
      }
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: incidentId,
      // No excerpt: the root cause stays on the record, where its permission
      // applies (PRD #22 §197).
      action: "HSE_INCIDENT_UPDATED",
      message: `recorded investigation findings on incident ${existing.incidentNumber}`,
    });
  });
}

/**
 * Putting the incident up for closure (PRD #22 §94).
 *
 * Everything `incidentClosureGaps` names has to be dealt with first, and then a
 * second person decides. The two-step exists because whoever investigated an
 * incident is the last person who should be allowed to declare it finished.
 */
export async function submitIncidentClose(
  context: UserContext,
  incidentId: string,
  closureNote: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.submit_close");

  const existing = await loadForClosure(context, incidentId);

  if (!isIncidentSubmittableForClose(existing.status)) {
    throw new AccessError("CONFLICT", "This incident is not under investigation.", {
      code: "NOT_INVESTIGATING",
    });
  }

  const gaps = incidentClosureGaps({
    severity: existing.severity,
    rootCause: existing.rootCause,
    investigationSummary: existing.investigationSummary,
    closureNote,
    actions: existing.actions,
  });

  if (gaps.length > 0) {
    throw new AccessError("VALIDATION_ERROR", "This incident is not ready to close.", {
      code: "CLOSURE_BLOCKED",
      gaps,
    });
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: hseIncidentMachine,
      action: "submit_close",
      id: incidentId,
      context,
      from: existing.status,
      data: {
        closureNote,
        submittedForCloseAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await approvals.openApproval(tx, context, "INCIDENT_CLOSE", incidentId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: incidentId,
      action: "HSE_INCIDENT_SUBMITTED_CLOSE",
      message: `put incident ${existing.incidentNumber} up for closure`,
    });
  });
}

export async function closeIncident(
  context: UserContext,
  incidentId: string,
  decisionNote: string | null,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.close");

  const existing = await loadForClosure(context, incidentId);

  if (!isIncidentClosable(existing.status)) {
    throw new AccessError("CONFLICT", "This incident has not been put up for closure.", {
      code: "NOT_PENDING_CLOSE",
    });
  }

  const gaps = incidentClosureGaps({
    severity: existing.severity,
    rootCause: existing.rootCause,
    investigationSummary: existing.investigationSummary,
    closureNote: existing.closureNote,
    actions: existing.actions,
  });

  if (gaps.length > 0) {
    throw new AccessError("VALIDATION_ERROR", "This incident is not ready to close.", {
      code: "CLOSURE_BLOCKED",
      gaps,
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "INCIDENT_CLOSE", incidentId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await approvals.decideApproval(tx, context, approval.id, "APPROVED", decisionNote);

    await applyTransition(tx, {
      machine: hseIncidentMachine,
      action: "close",
      id: incidentId,
      context,
      from: existing.status,
      data: {
        closedAt: new Date(),
        closedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: incidentId,
      action: "HSE_INCIDENT_CLOSED",
      message: `closed incident ${existing.incidentNumber}`,
    });
  });
}

export async function reopenIncident(
  context: UserContext,
  incidentId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.reopen");

  const existing = await requireIncident(context, incidentId);

  if (!isIncidentReopenable(existing.status)) {
    throw new AccessError("CONFLICT", "This incident is not closed.", { code: "NOT_CLOSED" });
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: hseIncidentMachine,
      action: "reopen",
      id: incidentId,
      context,
      from: existing.status,
      reason,
      data: {
        closedAt: null,
        closedByMemberId: null,
        submittedForCloseAt: null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: incidentId,
      action: "HSE_INCIDENT_REOPENED",
      message: `reopened incident ${existing.incidentNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelIncident(
  context: UserContext,
  incidentId: string,
  reason: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.incident.cancel");

  const existing = await requireIncident(context, incidentId);

  if (!isIncidentCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This incident is already finished.", {
      code: "NOT_CANCELLABLE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await approvals.cancelPendingApprovals(tx, context, "INCIDENT_CLOSE", incidentId);

    await applyTransition(tx, {
      machine: hseIncidentMachine,
      action: "cancel",
      id: incidentId,
      context,
      from: existing.status,
      data: {
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: incidentId,
      action: "HSE_INCIDENT_CANCELLED",
      message: `cancelled incident ${existing.incidentNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireIncident(context: UserContext, incidentId: string) {
  return assertFound(
    await prisma.hseIncident.findFirst({
      where: { AND: [buildIncidentScopeWhere(context), { id: incidentId }] },
      select: {
        id: true,
        incidentNumber: true,
        status: true,
        updatedAt: true,
        investigatorMemberId: true,
      },
    }),
  );
}

async function loadForClosure(context: UserContext, incidentId: string) {
  return assertFound(
    await prisma.hseIncident.findFirst({
      where: { AND: [buildIncidentScopeWhere(context), { id: incidentId }] },
      select: {
        id: true,
        incidentNumber: true,
        status: true,
        severity: true,
        rootCause: true,
        investigationSummary: true,
        closureNote: true,
        // Only this company's actions count towards closing (PRD #47 §20).
        actions: { where: { companyId: context.companyId }, select: { status: true } },
      },
    }),
  );
}

async function requireProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildHseProjectWhere(context), { id: projectId }] },
    select: { id: true },
  });

  if (!project) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
      code: "INVALID_PROJECT",
    });
  }

  return project;
}

async function requireMember(context: UserContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildHseMemberWhere(context), { id: memberId }] },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That person is not an active member.", {
      code: "INVALID_MEMBER",
    });
  }

  return member;
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this incident while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(
  context: UserContext,
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): IncidentSummaryDTO {
  const open = OPEN_INCIDENT_STATUSES.includes(row.status);

  return {
    id: row.id,
    incidentNumber: row.incidentNumber,
    incidentType: row.incidentType,
    title: row.title,
    severity: row.severity,
    status: row.status,
    project: toProjectRef(row.project),
    reportedBy: members.get(row.reportedByMemberId) ?? null,
    investigator: row.investigatorMemberId
      ? (members.get(row.investigatorMemberId) ?? null)
      : null,
    occurredAt: row.occurredAt.toISOString(),
    reportedAt: row.reportedAt.toISOString(),
    injury: toInjuryFlags(context, row),
    dueDate: dateString(row.dueDate),
    overdue: isOverdue(row.dueDate, open),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  row: DetailRow,
  submittedByMemberId: string | null,
) {
  const notSelf =
    submittedByMemberId !== context.membershipId || can(context, "hse.approval.self");

  return {
    canEdit: isIncidentRecordEditable(row.status) && can(context, "hse.incident.update"),
    canAssign: isIncidentEditable(row.status) && can(context, "hse.incident.assign"),
    canInvestigate:
      isIncidentRecordEditable(row.status) && can(context, "hse.incident.investigate"),
    canSubmitClose:
      isIncidentSubmittableForClose(row.status) && can(context, "hse.incident.submit_close"),
    canClose: isIncidentClosable(row.status) && can(context, "hse.incident.close") && notSelf,
    canReopen: isIncidentReopenable(row.status) && can(context, "hse.incident.reopen"),
    canCancel: isIncidentCancellable(row.status) && can(context, "hse.incident.cancel"),
    canRaiseAction: isIncidentEditable(row.status) && can(context, "hse.action.create"),
    canStopWork: isIncidentEditable(row.status) && can(context, "hse.stop_work.create"),
    canViewDocuments: can(context, "hse.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "hse.activity.view"),
  };
}
