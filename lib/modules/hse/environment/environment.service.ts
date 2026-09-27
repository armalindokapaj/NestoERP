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
import { paginationMeta, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import { SNAPSHOT, type ListPreview } from "../hse.list";
import { dateString, isOverdue, loadMemberRef, loadMembers, toProjectRef } from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import {
  buildHseMemberWhere,
  buildHseProjectWhere,
  buildObservationScopeWhere,
} from "../hse.scope";
import type { ObservationInput, ObservationListQuery } from "../hse.schema";
import {
  isObservationClosable,
  isObservationEditable,
  isObservationReopenable,
  OPEN_ENVIRONMENTAL_STATUSES,
} from "../hse.status";
import type { ObservationDetailDTO, ObservationSummaryDTO } from "../hse.types";

/**
 * Environmental observations (PRD #22 §163–§169).
 *
 * A spill, dust, noise, waste gone astray. Structurally a hazard's sibling — it
 * is reported, assigned, actioned and closed the same way — but kept separate
 * because the people who answer for it and the register it belongs to are
 * different.
 *
 * V0.1 files nothing with a regulator (PRD #22 §169, §459). This is the
 * company's own record of what happened and what was done about it.
 */

const MODULE = "hse" as const;
const ENTITY = "EnvironmentalObservation";

const LIST_SELECT = {
  id: true,
  observationNumber: true,
  category: true,
  title: true,
  severity: true,
  status: true,
  reportedByMemberId: true,
  assignedToMemberId: true,
  observedAt: true,
  dueDate: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.EnvironmentalObservationSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  locationText: true,
  immediateAction: true,
  closedAt: true,
  closedByMemberId: true,
  closureNote: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
} satisfies Prisma.EnvironmentalObservationSelect;

type ListRow = Prisma.EnvironmentalObservationGetPayload<{ select: typeof LIST_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The environmental register's predicate (AUD-08 §3, DT-02, DT-03): scope,
 * then the section (`view`), then filters and search — shared by the page, its
 * count and the CSV export. OR within a filter, AND across filters; a foreign
 * project id is ANDed with scope and narrows to nothing (DT-22).
 */
export function buildObservationListWhere(
  context: UserContext,
  query: ObservationListQuery,
): Prisma.EnvironmentalObservationWhereInput {
  const filters: Prisma.EnvironmentalObservationWhereInput[] = [
    buildObservationScopeWhere(context),
  ];

  if (query.view === "open") filters.push({ status: { in: OPEN_ENVIRONMENTAL_STATUSES } });
  if (query.view === "mine") {
    filters.push({
      OR: [
        { reportedByMemberId: context.membershipId },
        { assignedToMemberId: context.membershipId },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.category?.length) filters.push({ category: { in: query.category } });
  if (query.severity?.length) filters.push({ severity: { in: query.severity } });
  if (query.projectId) filters.push({ projectId: query.projectId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { observationNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  return { AND: filters };
}

/** The allowlisted observation sorts, each ending in the id (AUD-08 §4, DT-04). No key is nullable. */
export function observationListOrder(
  sort: ObservationListQuery["sort"],
): Prisma.EnvironmentalObservationOrderByWithRelationInput[] {
  return withTieBreaker<Prisma.EnvironmentalObservationOrderByWithRelationInput>(
    sort === "observed-desc"
      ? [{ observedAt: "desc" }]
      : sort === "number-asc"
        ? [{ observationNumber: "asc" }]
        : [{ updatedAt: "desc" }],
  );
}

export async function listObservations(context: UserContext, query: ObservationListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.environment.view");

  const where = buildObservationListWhere(context, query);

  // Rows and total from one snapshot (AUD-08 §4, DT-06).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.environmentalObservation.findMany({
        where,
        orderBy: observationListOrder(query.sort),
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        select: LIST_SELECT,
      }),
      prisma.environmentalObservation.count({ where }),
    ],
    SNAPSHOT,
  );

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.reportedByMemberId, row.assignedToMemberId]),
  );

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getObservation(
  context: UserContext,
  observationId: string,
): Promise<ObservationDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.environment.view");

  const row = assertFound(
    await prisma.environmentalObservation.findFirst({
      where: { AND: [buildObservationScopeWhere(context), { id: observationId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, actions] = await Promise.all([
    loadMembers(context.companyId, [row.reportedByMemberId, row.assignedToMemberId, row.closedByMemberId]),
    loadMemberRef(context.companyId, row.createdByMemberId),
    can(context, "hse.action.view")
      ? import("../actions/action.service").then((m) =>
          m.listForParent(context, { environmentalObservationId: observationId }),
        )
      : Promise.resolve([]),
  ]);

  return {
    ...toSummaryDTO(row, members),
    description: row.description,
    locationText: row.locationText,
    immediateAction: row.immediateAction,
    closedBy: row.closedByMemberId ? (members.get(row.closedByMemberId) ?? null) : null,
    closedAt: dateString(row.closedAt),
    closureNote: row.closureNote,
    cancelledAt: dateString(row.cancelledAt),
    actions,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: {
      canEdit: isObservationEditable(row.status) && can(context, "hse.environment.update"),
      canAssign: isObservationEditable(row.status) && can(context, "hse.environment.update"),
      canClose: isObservationClosable(row.status) && can(context, "hse.environment.close"),
      canReopen: isObservationReopenable(row.status) && can(context, "hse.environment.close"),
      canRaiseAction: isObservationEditable(row.status) && can(context, "hse.action.create"),
      canViewDocuments: can(context, "hse.document.view") && can(context, "document.view"),
      canViewActivity: can(context, "hse.activity.view"),
    },
  };
}

/**
 * A project's observations for its HSE tab: the first `limit`, most recently
 * observed first (the register's `observed-desc`), and the true total
 * (AUD-08 §4).
 */
export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<ListPreview<ObservationSummaryDTO>> {
  if (!can(context, "hse.environment.view")) return { data: [], total: 0 };

  const where: Prisma.EnvironmentalObservationWhereInput = {
    AND: [buildObservationScopeWhere(context), { projectId }],
  };
  const [rows, total] = await prisma.$transaction(
    [
      prisma.environmentalObservation.findMany({
        where,
        orderBy: observationListOrder("observed-desc"),
        take: limit,
        select: LIST_SELECT,
      }),
      prisma.environmentalObservation.count({ where }),
    ],
    SNAPSHOT,
  );

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.reportedByMemberId, row.assignedToMemberId]),
  );
  return { data: rows.map((row) => toSummaryDTO(row, members)), total };
}

export async function observationFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.environment.view");

  const scope = buildObservationScopeWhere(context);

  const projects = await prisma.project.findMany({
    where: {
      AND: [buildHseProjectWhere(context), { environmentalObservations: { some: scope } }],
    },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { projects };
}

export async function observationFormOptions(context: UserContext) {
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

export async function createObservation(
  context: UserContext,
  input: ObservationInput,
): Promise<ObservationDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.environment.create");

  if (input.projectId) await requireProject(context, input.projectId);
  if (input.assignedToMemberId) await requireMember(context, input.assignedToMemberId);

  const id = await prisma.$transaction(async (tx) => {
    const observationNumber = await nextHseNumber(
      tx,
      "environmentalObservation",
      context.companyId,
    );

    const observation = await tx.environmentalObservation.create({
      data: {
        companyId: context.companyId,
        observationNumber,
        projectId: input.projectId ?? null,
        category: input.category,
        title: input.title,
        description: input.description,
        observedAt: input.observedAt,
        locationText: input.locationText ?? null,
        severity: input.severity,
        status: "OPEN",
        reportedByMemberId: context.membershipId,
        assignedToMemberId: input.assignedToMemberId ?? null,
        immediateAction: input.immediateAction ?? null,
        dueDate: input.dueDate ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, observationNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: observation.id,
      action: "HSE_ENVIRONMENT_CREATED",
      message: `reported environmental observation ${observation.observationNumber}`,
    });

    return observation.id;
  });

  return getObservation(context, id);
}

export async function updateObservation(
  context: UserContext,
  observationId: string,
  input: ObservationInput,
): Promise<ObservationDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.environment.update");

  const existing = await requireObservation(context, observationId);

  if (!isObservationEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed observation cannot be edited.", {
      code: "OBSERVATION_CLOSED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  if (input.projectId) await requireProject(context, input.projectId);
  if (input.assignedToMemberId) await requireMember(context, input.assignedToMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.environmentalObservation.update({
      where: { id: observationId },
      data: {
        projectId: input.projectId ?? null,
        category: input.category,
        title: input.title,
        description: input.description,
        observedAt: input.observedAt,
        locationText: input.locationText ?? null,
        severity: input.severity,
        assignedToMemberId: input.assignedToMemberId ?? null,
        status:
          input.assignedToMemberId && existing.status === "OPEN"
            ? "IN_PROGRESS"
            : existing.status,
        immediateAction: input.immediateAction ?? null,
        dueDate: input.dueDate ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: observationId,
      action: "HSE_ENVIRONMENT_UPDATED",
      message: `updated environmental observation ${existing.observationNumber}`,
    });
  });

  return getObservation(context, observationId);
}

export async function closeObservation(
  context: UserContext,
  observationId: string,
  closureNote: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.environment.close");

  const existing = assertFound(
    await prisma.environmentalObservation.findFirst({
      where: { AND: [buildObservationScopeWhere(context), { id: observationId }] },
      select: {
        id: true,
        observationNumber: true,
        status: true,
        // Only this company's actions count towards closing (PRD #47 §20).
        actions: { where: { companyId: context.companyId }, select: { status: true } },
      },
    }),
  );

  if (!isObservationClosable(existing.status)) {
    throw new AccessError("CONFLICT", "This observation is already closed.", {
      code: "NOT_OPEN",
    });
  }

  // The same rule as a hazard: an observation whose actions are still open has
  // not actually been dealt with (PRD #22 §168).
  const live = existing.actions.filter((action) => action.status !== "CANCELLED");
  if (live.some((action) => action.status !== "VERIFIED")) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Every action raised against this observation must be verified first.",
      { code: "UNVERIFIED_ACTION" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.environmentalObservation.update({
      where: { id: observationId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedByMemberId: context.membershipId,
        closureNote,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: observationId,
      action: "HSE_ENVIRONMENT_CLOSED",
      message: `closed environmental observation ${existing.observationNumber}`,
    });
  });
}

export async function reopenObservation(
  context: UserContext,
  observationId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.environment.close");

  const existing = await requireObservation(context, observationId);

  if (!isObservationReopenable(existing.status)) {
    throw new AccessError("CONFLICT", "This observation is not closed.", {
      code: "NOT_CLOSED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.environmentalObservation.update({
      where: { id: observationId },
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
      entityId: observationId,
      action: "HSE_ENVIRONMENT_UPDATED",
      message: `reopened environmental observation ${existing.observationNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireObservation(context: UserContext, observationId: string) {
  return assertFound(
    await prisma.environmentalObservation.findFirst({
      where: { AND: [buildObservationScopeWhere(context), { id: observationId }] },
      select: { id: true, observationNumber: true, status: true, updatedAt: true },
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
      "Somebody else changed this observation while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): ObservationSummaryDTO {
  const open = OPEN_ENVIRONMENTAL_STATUSES.includes(row.status);

  return {
    id: row.id,
    observationNumber: row.observationNumber,
    category: row.category,
    title: row.title,
    severity: row.severity,
    status: row.status,
    project: toProjectRef(row.project),
    reportedBy: members.get(row.reportedByMemberId) ?? null,
    assignedTo: row.assignedToMemberId ? (members.get(row.assignedToMemberId) ?? null) : null,
    observedAt: row.observedAt.toISOString(),
    dueDate: dateString(row.dueDate),
    overdue: isOverdue(row.dueDate, open),
    updatedAt: row.updatedAt.toISOString(),
  };
}
