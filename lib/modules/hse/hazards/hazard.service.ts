import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import { assertSameProject } from "@/lib/access/references";
import type { UserContext } from "@/lib/context/types";
import { notifyCriticalSafety } from "@/lib/core/notifications/safety-notifications";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { dateString, isOverdue, loadMemberRef, loadMembers, toProjectRef } from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import {
  assessResidualRisk,
  assessRisk,
  requiresImmediateControl,
  residualRiskExceedsInitial,
} from "../hse.risk";
import {
  buildHazardScopeWhere,
  buildHseMemberWhere,
  buildHseProjectWhere,
  buildInspectionScopeWhere,
} from "../hse.scope";
import type {
  HazardAssessInput,
  HazardCloseInput,
  HazardInput,
  HazardListQuery,
} from "../hse.schema";
import {
  hazardClosureGaps,
  isHazardCancellable,
  isHazardClosable,
  isHazardEditable,
  isHazardReopenable,
  OPEN_HAZARD_STATUSES,
} from "../hse.status";
import type { HazardDetailDTO, HazardSummaryDTO, RiskDTO } from "../hse.types";

/**
 * Hazards (PRD #22 §57–§75).
 *
 * A condition that could hurt somebody. Three rules shape this file.
 *
 * **Risk is derived, never accepted** (PRD #22 §243). The caller sends a
 * likelihood and a severity; the score and the level are computed here. A
 * browser that could post its own `riskLevel` could file a critical hazard as
 * LOW and route it away from the people who must see it.
 *
 * **A critical hazard needs an immediate control** (PRD #22 §68). Not a plan, a
 * control — what was actually done at the time, which is the difference between
 * a barricaded excavation and one somebody walks into tonight.
 *
 * **Closing means the control is in** (PRD #22 §73): the control described, the
 * actions verified, the residual risk assessed if it was serious, and a closure
 * note. The page lists what is still missing rather than refusing a button
 * silently.
 */

const MODULE = "hse" as const;
const ENTITY = "HseHazard";

const LIST_SELECT = {
  id: true,
  hazardNumber: true,
  title: true,
  hazardCategory: true,
  status: true,
  likelihood: true,
  severityScore: true,
  riskScore: true,
  riskLevel: true,
  residualLikelihood: true,
  residualSeverity: true,
  residualRiskScore: true,
  residualRiskLevel: true,
  assignedToMemberId: true,
  observedAt: true,
  dueDate: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.HseHazardSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  locationText: true,
  inspectionId: true,
  immediateControl: true,
  controlMeasure: true,
  reportedByMemberId: true,
  closedAt: true,
  closedByMemberId: true,
  closureNote: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
  inspection: { select: { id: true, inspectionNumber: true } },
} satisfies Prisma.HseHazardSelect;

type ListRow = Prisma.HseHazardGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.HseHazardGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listHazards(context: UserContext, query: HazardListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.view");

  const filters: Prisma.HseHazardWhereInput[] = [buildHazardScopeWhere(context)];

  if (query.view === "open") filters.push({ status: { in: OPEN_HAZARD_STATUSES } });
  if (query.view === "mine") filters.push({ assignedToMemberId: context.membershipId });
  if (query.view === "critical") {
    filters.push({ riskLevel: "CRITICAL", status: { in: OPEN_HAZARD_STATUSES } });
  }
  if (query.view === "overdue") {
    filters.push({ status: { in: OPEN_HAZARD_STATUSES }, dueDate: { lt: startOfToday() } });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.riskLevel?.length) filters.push({ riskLevel: { in: query.riskLevel } });
  if (query.hazardCategory?.length) {
    filters.push({ hazardCategory: { in: query.hazardCategory } });
  }
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.assignedToMemberId) filters.push({ assignedToMemberId: query.assignedToMemberId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { hazardNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.HseHazardWhereInput = { AND: filters };

  const orderBy: Prisma.HseHazardOrderByWithRelationInput[] =
    query.sort === "risk-desc"
      ? [{ riskScore: "desc" }, { observedAt: "desc" }]
      : query.sort === "due-asc"
        ? [{ dueDate: { sort: "asc", nulls: "last" } }]
        : query.sort === "number-asc"
          ? [{ hazardNumber: "asc" }]
          : [{ updatedAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.hseHazard.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.hseHazard.count({ where }),
  ]);

  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedToMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getHazard(
  context: UserContext,
  hazardId: string,
): Promise<HazardDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.view");

  const row = assertFound(
    await prisma.hseHazard.findFirst({
      where: { AND: [buildHazardScopeWhere(context), { id: hazardId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, reportedBy, actions, stopWorks] = await Promise.all([
    loadMembers(context.companyId, [row.assignedToMemberId, row.closedByMemberId]),
    loadMemberRef(context.companyId, row.createdByMemberId),
    loadMemberRef(context.companyId, row.reportedByMemberId),
    can(context, "hse.action.view")
      ? import("../actions/action.service").then((m) => m.listForParent(context, { hazardId }))
      : Promise.resolve([]),
    can(context, "hse.stop_work.view")
      ? import("../stop-work/stop-work.service").then((m) => m.listForHazard(context, hazardId))
      : Promise.resolve([]),
  ]);

  return {
    ...toSummaryDTO(row, members),
    description: row.description,
    locationText: row.locationText,
    immediateControl: row.immediateControl,
    controlMeasure: row.controlMeasure,
    reportedBy,
    inspection: await inspectionLink(context, row.inspection),
    closedBy: row.closedByMemberId ? (members.get(row.closedByMemberId) ?? null) : null,
    closedAt: dateString(row.closedAt),
    closureNote: row.closureNote,
    cancelledAt: dateString(row.cancelledAt),
    actions,
    stopWorks,
    closureGaps: hazardClosureGaps({
      riskLevel: row.riskLevel,
      controlMeasure: row.controlMeasure,
      closureNote: row.closureNote,
      residualRiskScore: row.residualRiskScore,
      actions: actions.map((action) => ({ status: action.status })),
    }),
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row),
  };
}

export async function listForInspection(
  context: UserContext,
  inspectionId: string,
): Promise<HazardSummaryDTO[]> {
  if (!can(context, "hse.hazard.view")) return [];

  const rows = await prisma.hseHazard.findMany({
    where: { AND: [buildHazardScopeWhere(context), { inspectionId }] },
    orderBy: [{ riskScore: "desc" }, { createdAt: "desc" }],
    select: LIST_SELECT,
  });

  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<HazardSummaryDTO[]> {
  if (!can(context, "hse.hazard.view")) return [];

  const rows = await prisma.hseHazard.findMany({
    where: { AND: [buildHazardScopeWhere(context), { projectId }] },
    orderBy: [{ riskScore: "desc" }, { observedAt: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function hazardFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.view");

  const scope = buildHazardScopeWhere(context);

  const [projects, assignees] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [buildHseProjectWhere(context), { hseHazards: { some: scope } }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, assignedHazards: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, assignees };
}

export async function hazardFormOptions(context: UserContext) {
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

export async function createHazard(
  context: UserContext,
  input: HazardInput,
): Promise<HazardDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.create");

  if (input.projectId) await requireProject(context, input.projectId);
  if (input.assignedToMemberId) await requireMember(context, input.assignedToMemberId);

  /*
   * A hazard found on an inspection is on that inspection's site. It borrows
   * the project when the form left it blank, and naming a different one is
   * refused (PRD #47 §51) — otherwise the finding lands on a job whose people
   * never ran the inspection and the inspection's own close check counts it.
   */
  let projectId = input.projectId ?? null;
  if (input.inspectionId) {
    const inspection = await requireInspection(context, input.inspectionId);
    projectId = projectId ?? inspection.projectId;
    assertSameProject("inspectionId", projectId, inspection.projectId);
  }

  const risk = assessRisk(input.likelihood, input.severity);

  // The schema already refuses a critical hazard with no control; this is the
  // same rule at the service boundary, because the schema is not the only way
  // in (PRD #22 §68).
  if (
    requiresImmediateControl(risk.riskLevel) &&
    (input.immediateControl ?? "").trim().length === 0
  ) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "A critical hazard needs the immediate control that was put in place.",
      { code: "IMMEDIATE_CONTROL_REQUIRED" },
    );
  }

  const id = await prisma.$transaction(async (tx) => {
    const hazardNumber = await nextHseNumber(tx, "hseHazard", context.companyId);

    const hazard = await tx.hseHazard.create({
      data: {
        companyId: context.companyId,
        hazardNumber,
        title: input.title,
        description: input.description,
        projectId,
        inspectionId: input.inspectionId ?? null,
        hazardCategory: input.hazardCategory,
        likelihood: input.likelihood,
        severityScore: input.severity,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        status: "OPEN",
        locationText: input.locationText ?? null,
        observedAt: input.observedAt,
        reportedByMemberId: context.membershipId,
        assignedToMemberId: input.assignedToMemberId ?? null,
        immediateControl: input.immediateControl ?? null,
        controlMeasure: input.controlMeasure ?? null,
        dueDate: input.dueDate ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, hazardNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: hazard.id,
      action: "HSE_HAZARD_CREATED",
      message: `reported hazard ${hazard.hazardNumber} at ${risk.riskLevel.toLowerCase()} risk`,
    });

    if (risk.riskLevel === "CRITICAL") {
      await notifyCriticalSafety(tx, context, { recordType: "hazard", recordId: hazard.id, projectId, noun: "Critical hazard" });
    }

    return hazard.id;
  });

  return getHazard(context, id);
}

export async function updateHazard(
  context: UserContext,
  hazardId: string,
  input: HazardInput,
): Promise<HazardDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.update");

  const existing = await requireHazard(context, hazardId);

  if (!isHazardEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed hazard cannot be edited. Reopen it first.", {
      code: "HAZARD_CLOSED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  if (input.projectId) await requireProject(context, input.projectId);
  if (input.assignedToMemberId) await requireMember(context, input.assignedToMemberId);

  /*
   * Reassigning and re-scoring are their own grants (PRD #22 §70, PRD #47 §85).
   * The edit form carries both fields so a reporter can correct a typo, and
   * that must not make it a way round `hse.hazard.assign` or
   * `hse.hazard.assess` — an unchanged value needs neither.
   */
  if ((input.assignedToMemberId ?? null) !== existing.assignedToMemberId) {
    assertPermission(context, "hse.hazard.assign");
  }
  if (input.likelihood !== existing.likelihood || input.severity !== existing.severityScore) {
    assertPermission(context, "hse.hazard.assess");
  }

  const risk = assessRisk(input.likelihood, input.severity);

  await prisma.$transaction(async (tx) => {
    await tx.hseHazard.update({
      where: { id: hazardId },
      data: {
        title: input.title,
        description: input.description,
        projectId: input.projectId ?? null,
        hazardCategory: input.hazardCategory,
        likelihood: input.likelihood,
        severityScore: input.severity,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        locationText: input.locationText ?? null,
        observedAt: input.observedAt,
        assignedToMemberId: input.assignedToMemberId ?? null,
        immediateControl: input.immediateControl ?? null,
        controlMeasure: input.controlMeasure ?? null,
        dueDate: input.dueDate ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    // Raised to critical by this edit: the same alert a new critical hazard gets.
    if (risk.riskLevel === "CRITICAL" && existing.riskLevel !== "CRITICAL") {
      await notifyCriticalSafety(tx, context, { recordType: "hazard", recordId: hazardId, projectId: input.projectId ?? null, noun: "Critical hazard" });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: hazardId,
      action: "HSE_HAZARD_UPDATED",
      message: `updated hazard ${existing.hazardNumber}`,
    });
  });

  return getHazard(context, hazardId);
}

export async function assignHazard(
  context: UserContext,
  hazardId: string,
  memberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.assign");

  const existing = await requireHazard(context, hazardId);

  if (!isHazardEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed hazard cannot be reassigned.", {
      code: "HAZARD_CLOSED",
    });
  }

  const member = await requireMember(context, memberId);

  await prisma.$transaction(async (tx) => {
    await tx.hseHazard.update({
      where: { id: hazardId },
      data: {
        assignedToMemberId: member.id,
        status: existing.status === "OPEN" ? "IN_PROGRESS" : existing.status,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: hazardId,
      action: "HSE_HAZARD_ASSIGNED",
      message: `assigned hazard ${existing.hazardNumber}`,
      metadata: { memberId: member.id } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Re-scoring a hazard once somebody who knows has looked at it (PRD #22 §70).
 *
 * Both the initial and the residual scores are computed here from the two axes.
 * A residual score above the initial one is refused: controls reduce risk, so
 * either the axes went in the wrong way round or the "control" made things worse
 * — which is a new hazard, not a residual figure (PRD #22 §72).
 */
export async function assessHazard(
  context: UserContext,
  hazardId: string,
  input: HazardAssessInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.assess");

  const existing = await requireHazard(context, hazardId);

  if (!isHazardEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed hazard cannot be reassessed.", {
      code: "HAZARD_CLOSED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const risk = assessRisk(input.likelihood, input.severity);
  const residual = assessResidualRisk(input.residualLikelihood, input.residualSeverity);

  if (residualRiskExceedsInitial(risk.riskScore, residual.residualRiskScore)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "The residual risk cannot be higher than the risk before the control.",
      { code: "RESIDUAL_EXCEEDS_INITIAL" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseHazard.update({
      where: { id: hazardId },
      data: {
        likelihood: input.likelihood,
        severityScore: input.severity,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        controlMeasure: input.controlMeasure ?? undefined,
        ...residual,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: hazardId,
      action: "HSE_HAZARD_RISK_UPDATED",
      message: `re-scored hazard ${existing.hazardNumber} as ${risk.riskLevel.toLowerCase()}`,
    });
  });
}

/** Recording the control that went in (PRD #22 §67). */
export async function controlHazard(
  context: UserContext,
  hazardId: string,
  input: { immediateControl?: string; controlMeasure: string },
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.control");

  const existing = await requireHazard(context, hazardId);

  if (!isHazardEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed hazard cannot be controlled.", {
      code: "HAZARD_CLOSED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseHazard.update({
      where: { id: hazardId },
      data: {
        immediateControl: input.immediateControl ?? undefined,
        controlMeasure: input.controlMeasure,
        status: "CONTROLLED",
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: hazardId,
      action: "HSE_HAZARD_CONTROLLED",
      message: `recorded a control on hazard ${existing.hazardNumber}`,
    });
  });
}

/**
 * Closing a hazard (PRD #22 §73).
 *
 * Everything `hazardClosureGaps` names has to be dealt with first. A hazard
 * closed with unverified actions against it is a hazard somebody filed rather
 * than fixed.
 */
export async function closeHazard(
  context: UserContext,
  hazardId: string,
  input: HazardCloseInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.close");

  const existing = assertFound(
    await prisma.hseHazard.findFirst({
      where: { AND: [buildHazardScopeWhere(context), { id: hazardId }] },
      select: {
        id: true,
        hazardNumber: true,
        status: true,
        riskLevel: true,
        riskScore: true,
        controlMeasure: true,
        residualRiskScore: true,
        // Only this company's actions count towards closing (PRD #47 §20).
        actions: { where: { companyId: context.companyId }, select: { status: true } },
      },
    }),
  );

  if (!isHazardClosable(existing.status)) {
    throw new AccessError("CONFLICT", "This hazard is already closed.", { code: "NOT_OPEN" });
  }

  const residual = assessResidualRisk(input.residualLikelihood, input.residualSeverity);

  if (residualRiskExceedsInitial(existing.riskScore, residual.residualRiskScore)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "The residual risk cannot be higher than the risk before the control.",
      { code: "RESIDUAL_EXCEEDS_INITIAL" },
    );
  }

  const gaps = hazardClosureGaps({
    riskLevel: existing.riskLevel,
    controlMeasure: existing.controlMeasure,
    closureNote: input.closureNote,
    residualRiskScore: residual.residualRiskScore ?? existing.residualRiskScore,
    actions: existing.actions,
  });

  if (gaps.length > 0) {
    throw new AccessError("VALIDATION_ERROR", "This hazard is not ready to close.", {
      code: "CLOSURE_BLOCKED",
      gaps,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseHazard.update({
      where: { id: hazardId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedByMemberId: context.membershipId,
        closureNote: input.closureNote,
        ...(residual.residualRiskScore != null ? residual : {}),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: hazardId,
      action: "HSE_HAZARD_CLOSED",
      message: `closed hazard ${existing.hazardNumber}`,
    });
  });
}

export async function reopenHazard(
  context: UserContext,
  hazardId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.reopen");

  const existing = await requireHazard(context, hazardId);

  if (!isHazardReopenable(existing.status)) {
    throw new AccessError("CONFLICT", "This hazard is not closed.", { code: "NOT_CLOSED" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseHazard.update({
      where: { id: hazardId },
      data: {
        status: "REOPENED",
        closedAt: null,
        closedByMemberId: null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: hazardId,
      action: "HSE_HAZARD_REOPENED",
      message: `reopened hazard ${existing.hazardNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelHazard(
  context: UserContext,
  hazardId: string,
  reason: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.hazard.cancel");

  const existing = await requireHazard(context, hazardId);

  if (!isHazardCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This hazard is already finished.", {
      code: "NOT_CANCELLABLE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseHazard.update({
      where: { id: hazardId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: hazardId,
      action: "HSE_HAZARD_CANCELLED",
      message: `cancelled hazard ${existing.hazardNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function requireHazard(context: UserContext, hazardId: string) {
  return assertFound(
    await prisma.hseHazard.findFirst({
      where: { AND: [buildHazardScopeWhere(context), { id: hazardId }] },
      select: {
        id: true,
        hazardNumber: true,
        status: true,
        riskLevel: true,
        likelihood: true,
        severityScore: true,
        assignedToMemberId: true,
        updatedAt: true,
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

async function requireInspection(context: UserContext, inspectionId: string) {
  const inspection = await prisma.hseInspection.findFirst({
    where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
    select: { id: true, projectId: true },
  });

  if (!inspection) {
    throw new AccessError("VALIDATION_ERROR", "That inspection does not exist.", {
      code: "INVALID_INSPECTION",
    });
  }

  return inspection;
}

/**
 * The inspection a hazard came out of, linked only if the reader can open it
 * (PRD #22 §187).
 *
 * Hazard access is not inspection access. Somebody who may see the hazard but
 * not the walk-round that found it gets the reference without a link, rather
 * than a link that will 404 on them.
 */
async function inspectionLink(
  context: UserContext,
  inspection: { id: string; inspectionNumber: string } | null,
) {
  if (!inspection) return null;
  if (!can(context, "hse.inspection.view")) return null;

  const reachable = await prisma.hseInspection.findFirst({
    where: { AND: [buildInspectionScopeWhere(context), { id: inspection.id }] },
    select: { id: true },
  });

  return {
    id: inspection.id,
    label: inspection.inspectionNumber,
    href: reachable ? `/hse/inspections/${inspection.id}` : null,
  };
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this hazard while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toRiskDTO(row: {
  likelihood: number;
  severityScore: number;
  riskScore: number;
  riskLevel: ListRow["riskLevel"];
}): RiskDTO {
  return {
    likelihood: row.likelihood,
    severity: row.severityScore,
    score: row.riskScore,
    level: row.riskLevel,
  };
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): HazardSummaryDTO {
  const open = OPEN_HAZARD_STATUSES.includes(row.status);

  return {
    id: row.id,
    hazardNumber: row.hazardNumber,
    title: row.title,
    hazardCategory: row.hazardCategory,
    status: row.status,
    risk: toRiskDTO(row),
    residualRisk:
      row.residualRiskScore != null && row.residualRiskLevel != null
        ? {
            likelihood: row.residualLikelihood!,
            severity: row.residualSeverity!,
            score: row.residualRiskScore,
            level: row.residualRiskLevel,
          }
        : null,
    project: toProjectRef(row.project),
    assignedTo: row.assignedToMemberId ? (members.get(row.assignedToMemberId) ?? null) : null,
    observedAt: row.observedAt.toISOString(),
    dueDate: dateString(row.dueDate),
    overdue: isOverdue(row.dueDate, open),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, row: DetailRow) {
  return {
    canEdit: isHazardEditable(row.status) && can(context, "hse.hazard.update"),
    canAssign: isHazardEditable(row.status) && can(context, "hse.hazard.assign"),
    canAssess: isHazardEditable(row.status) && can(context, "hse.hazard.assess"),
    canControl: isHazardEditable(row.status) && can(context, "hse.hazard.control"),
    canClose: isHazardClosable(row.status) && can(context, "hse.hazard.close"),
    canReopen: isHazardReopenable(row.status) && can(context, "hse.hazard.reopen"),
    canCancel: isHazardCancellable(row.status) && can(context, "hse.hazard.cancel"),
    canRaiseAction: isHazardEditable(row.status) && can(context, "hse.action.create"),
    canStopWork: isHazardEditable(row.status) && can(context, "hse.stop_work.create"),
    canViewDocuments: can(context, "hse.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "hse.activity.view"),
  };
}
