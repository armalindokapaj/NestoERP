import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { dateString, loadMemberRef, loadMembers, toProjectRef } from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import {
  buildHazardScopeWhere,
  buildHseProjectWhere,
  buildIncidentScopeWhere,
  buildStopWorkScopeWhere,
} from "../hse.scope";
import type { StopWorkInput, StopWorkListQuery } from "../hse.schema";
import {
  isStopWorkCancellable,
  isStopWorkReleasable,
  stopWorkReleaseGaps,
} from "../hse.status";
import type { StopWorkDetailDTO, StopWorkSummaryDTO } from "../hse.types";

/**
 * Stop-work records (PRD #22 §170–§176).
 *
 * A formal halt because it was not safe to carry on. Two rules shape this file.
 *
 * **Stopping and releasing are different grants** (PRD #22 §173, §174). Anybody
 * who can see the work going wrong may halt it; letting it restart needs
 * `hse.stop_work.release`. The whole point is that whoever called it does not
 * have to argue with the person who wants the job going again.
 *
 * **A release needs the cause dealt with** (PRD #22 §174). Every critical action
 * raised against the stop-work has to be verified first. Releasing while the
 * thing that stopped the job is still outstanding is how the same accident
 * happens twice in one week.
 *
 * V0.1 does not freeze the project's other data (PRD #22 §176). It is an
 * operational state and an alert that must be impossible to miss, not a lock.
 */

const MODULE = "hse" as const;
const ENTITY = "StopWorkRecord";

const LIST_SELECT = {
  id: true,
  stopWorkNumber: true,
  title: true,
  status: true,
  locationText: true,
  issuedByMemberId: true,
  issuedAt: true,
  releasedAt: true,
  releasedByMemberId: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.StopWorkRecordSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  reason: true,
  releaseReason: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
  hazard: { select: { id: true, hazardNumber: true } },
  incident: { select: { id: true, incidentNumber: true } },
} satisfies Prisma.StopWorkRecordSelect;

type ListRow = Prisma.StopWorkRecordGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.StopWorkRecordGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listStopWorks(context: UserContext, query: StopWorkListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.stop_work.view");

  const filters: Prisma.StopWorkRecordWhereInput[] = [buildStopWorkScopeWhere(context)];

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.projectId) filters.push({ projectId: query.projectId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { stopWorkNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.StopWorkRecordWhereInput = { AND: filters };

  const orderBy: Prisma.StopWorkRecordOrderByWithRelationInput[] =
    query.sort === "issued-desc"
      ? [{ issuedAt: "desc" }]
      : query.sort === "number-asc"
        ? [{ stopWorkNumber: "asc" }]
        : // Active first, always: an open stop-work is the most urgent row on
          // any HSE page it appears on (PRD #22 §175).
          [{ status: "asc" }, { issuedAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.stopWorkRecord.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.stopWorkRecord.count({ where }),
  ]);

  const members = await loadMembers(
    rows.flatMap((row) => [row.issuedByMemberId, row.releasedByMemberId]),
  );

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getStopWork(
  context: UserContext,
  stopWorkId: string,
): Promise<StopWorkDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.stop_work.view");

  const row = assertFound(
    await prisma.stopWorkRecord.findFirst({
      where: { AND: [buildStopWorkScopeWhere(context), { id: stopWorkId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, actions] = await Promise.all([
    loadMembers([row.issuedByMemberId, row.releasedByMemberId]),
    loadMemberRef(row.createdByMemberId),
    can(context, "hse.action.view")
      ? import("../actions/action.service").then((m) => m.listForParent(context, { stopWorkId }))
      : Promise.resolve([]),
  ]);

  return {
    ...toSummaryDTO(row, members),
    reason: row.reason,
    releaseReason: row.releaseReason,
    hazard: row.hazard
      ? {
          id: row.hazard.id,
          label: row.hazard.hazardNumber,
          href: can(context, "hse.hazard.view") ? `/hse/hazards/${row.hazard.id}` : null,
        }
      : null,
    incident: row.incident
      ? {
          id: row.incident.id,
          label: row.incident.incidentNumber,
          href: can(context, "hse.incident.view") ? `/hse/incidents/${row.incident.id}` : null,
        }
      : null,
    actions,
    releaseGaps: stopWorkReleaseGaps({
      releaseReason: row.releaseReason,
      actions: actions.map((action) => ({
        status: action.status,
        priority: action.priority,
      })),
    }),
    createdBy,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: dateString(row.cancelledAt),
    capabilities: capabilitiesFor(context, row, actions),
  };
}

export async function listForHazard(
  context: UserContext,
  hazardId: string,
): Promise<StopWorkSummaryDTO[]> {
  if (!can(context, "hse.stop_work.view")) return [];
  return listBy(context, { hazardId });
}

export async function listForIncident(
  context: UserContext,
  incidentId: string,
): Promise<StopWorkSummaryDTO[]> {
  if (!can(context, "hse.stop_work.view")) return [];
  return listBy(context, { incidentId });
}

export async function listForProject(
  context: UserContext,
  projectId: string,
): Promise<StopWorkSummaryDTO[]> {
  if (!can(context, "hse.stop_work.view")) return [];
  return listBy(context, { projectId });
}

/** Everything currently halting work that this reader can see (§175, §361). */
export async function activeStopWorks(context: UserContext): Promise<StopWorkSummaryDTO[]> {
  if (!can(context, "hse.stop_work.view")) return [];
  return listBy(context, { status: "ACTIVE" });
}

export async function stopWorkFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const projects = await prisma.project.findMany({
    where: buildHseProjectWhere(context),
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { projects };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createStopWork(
  context: UserContext,
  input: StopWorkInput,
): Promise<StopWorkDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.stop_work.create");

  await requireProject(context, input.projectId);
  if (input.hazardId) await requireHazard(context, input.hazardId);
  if (input.incidentId) await requireIncident(context, input.incidentId);

  const id = await prisma.$transaction(async (tx) => {
    const stopWorkNumber = await nextHseNumber(tx, "stopWorkRecord", context.companyId);

    const record = await tx.stopWorkRecord.create({
      data: {
        companyId: context.companyId,
        stopWorkNumber,
        projectId: input.projectId,
        title: input.title,
        reason: input.reason,
        locationText: input.locationText ?? null,
        hazardId: input.hazardId ?? null,
        incidentId: input.incidentId ?? null,
        issuedAt: new Date(),
        issuedByMemberId: context.membershipId,
        status: "ACTIVE",
        createdByMemberId: context.membershipId,
      },
      select: { id: true, stopWorkNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: record.id,
      action: "HSE_STOP_WORK_CREATED",
      // The reason stays on the record, behind its permission (PRD #22 §197).
      message: `issued stop-work ${record.stopWorkNumber}`,
    });

    return record.id;
  });

  return getStopWork(context, id);
}

/**
 * Sending people back to the job (PRD #22 §174).
 *
 * The gaps are checked here rather than only on the page, because a release is
 * the one act in this module with immediate physical consequences.
 */
export async function releaseStopWork(
  context: UserContext,
  stopWorkId: string,
  releaseReason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.stop_work.release");

  const existing = assertFound(
    await prisma.stopWorkRecord.findFirst({
      where: { AND: [buildStopWorkScopeWhere(context), { id: stopWorkId }] },
      select: {
        id: true,
        stopWorkNumber: true,
        status: true,
        actions: { select: { status: true, priority: true } },
      },
    }),
  );

  if (!isStopWorkReleasable(existing.status)) {
    throw new AccessError("CONFLICT", "This stop-work is not active.", { code: "NOT_ACTIVE" });
  }

  const gaps = stopWorkReleaseGaps({ releaseReason, actions: existing.actions });

  if (gaps.length > 0) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "This stop-work cannot be released yet.",
      { code: "RELEASE_BLOCKED", gaps },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.stopWorkRecord.update({
      where: { id: stopWorkId },
      data: {
        status: "RELEASED",
        releasedAt: new Date(),
        releasedByMemberId: context.membershipId,
        releaseReason,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: stopWorkId,
      action: "HSE_STOP_WORK_RELEASED",
      message: `released stop-work ${existing.stopWorkNumber}`,
    });
  });
}

export async function cancelStopWork(
  context: UserContext,
  stopWorkId: string,
  reason: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.stop_work.release");

  const existing = assertFound(
    await prisma.stopWorkRecord.findFirst({
      where: { AND: [buildStopWorkScopeWhere(context), { id: stopWorkId }] },
      select: { id: true, stopWorkNumber: true, status: true },
    }),
  );

  if (!isStopWorkCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This stop-work is not active.", { code: "NOT_ACTIVE" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.stopWorkRecord.update({
      where: { id: stopWorkId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: stopWorkId,
      action: "HSE_STOP_WORK_CANCELLED",
      message: `cancelled stop-work ${existing.stopWorkNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function listBy(
  context: UserContext,
  filter: Prisma.StopWorkRecordWhereInput,
): Promise<StopWorkSummaryDTO[]> {
  const rows = await prisma.stopWorkRecord.findMany({
    where: { AND: [buildStopWorkScopeWhere(context), filter] },
    orderBy: [{ status: "asc" }, { issuedAt: "desc" }],
    select: LIST_SELECT,
  });

  const members = await loadMembers(
    rows.flatMap((row) => [row.issuedByMemberId, row.releasedByMemberId]),
  );
  return rows.map((row) => toSummaryDTO(row, members));
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

async function requireHazard(context: UserContext, hazardId: string) {
  const hazard = await prisma.hseHazard.findFirst({
    where: { AND: [buildHazardScopeWhere(context), { id: hazardId }] },
    select: { id: true },
  });

  if (!hazard) {
    throw new AccessError("VALIDATION_ERROR", "That hazard does not exist.", {
      code: "INVALID_HAZARD",
    });
  }

  return hazard;
}

async function requireIncident(context: UserContext, incidentId: string) {
  const incident = await prisma.hseIncident.findFirst({
    where: { AND: [buildIncidentScopeWhere(context), { id: incidentId }] },
    select: { id: true },
  });

  if (!incident) {
    throw new AccessError("VALIDATION_ERROR", "That incident does not exist.", {
      code: "INVALID_INCIDENT",
    });
  }

  return incident;
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): StopWorkSummaryDTO {
  return {
    id: row.id,
    stopWorkNumber: row.stopWorkNumber,
    title: row.title,
    status: row.status,
    project: toProjectRef(row.project)!,
    locationText: row.locationText,
    issuedBy: members.get(row.issuedByMemberId) ?? null,
    issuedAt: row.issuedAt.toISOString(),
    releasedBy: row.releasedByMemberId ? (members.get(row.releasedByMemberId) ?? null) : null,
    releasedAt: dateString(row.releasedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  row: DetailRow,
  actions: { status: string; priority: string }[],
) {
  // Offered only when it would actually succeed: a release button that fails on
  // an unverified critical action teaches people to distrust the buttons.
  const blocked = actions.some(
    (action) =>
      action.priority === "CRITICAL" &&
      action.status !== "VERIFIED" &&
      action.status !== "CANCELLED",
  );

  return {
    canRelease:
      isStopWorkReleasable(row.status) && can(context, "hse.stop_work.release") && !blocked,
    canCancel: isStopWorkCancellable(row.status) && can(context, "hse.stop_work.release"),
    canRaiseAction: row.status === "ACTIVE" && can(context, "hse.action.create"),
    canViewActivity: can(context, "hse.activity.view"),
  };
}
