import { Prisma, type QualityDefectStatus } from "@prisma/client";

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
import {
  dateString,
  isOverdue,
  loadMemberRef,
  loadMembers,
  toProjectRef,
} from "../qaqc.dto";
import { nextQualityNumber } from "../qaqc.numbering";
import {
  buildDefectScopeWhere,
  buildQaqcMemberWhere,
  buildQaqcProjectWhere,
} from "../qaqc.scope";
import type { DefectInput, DefectListQuery } from "../qaqc.schema";
import {
  isDefectCancellable,
  isDefectCloseable,
  isDefectEditable,
  isDefectReopenable,
  isDefectResolvable,
} from "../qaqc.status";
import type { DefectDetailDTO, DefectSummaryDTO } from "../qaqc.types";

/**
 * Defects, also called snags (PRD #21 §111–§121).
 *
 * A fault on a job that somebody must fix. Two rules shape this file:
 *
 *   1. **A defect always has a project** (PRD #21 §222). A defect with no site
 *      is nobody's to close.
 *   2. **Resolving and closing are different acts** (PRD #21 §118, §119).
 *      Whoever fixed it says RESOLVED; somebody else agrees it is actually
 *      fixed and says CLOSED. One person doing both makes the status
 *      meaningless, so closing needs its own grant.
 *
 * A defect is not an NCR. A defect is "this needs fixing"; an NCR is a formal
 * statement that a requirement was not met, which cannot close without a root
 * cause. Escalating a defect creates an NCR and links the two (PRD #21 §170).
 */

const MODULE = "qaqc" as const;
const ENTITY = "QualityDefect";

const LIST_SELECT = {
  id: true,
  defectNumber: true,
  title: true,
  severity: true,
  status: true,
  assignedToMemberId: true,
  dueDate: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.QualityDefectSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  locationText: true,
  inspectionId: true,
  resolutionNote: true,
  resolvedAt: true,
  resolvedByMemberId: true,
  closedAt: true,
  closedByMemberId: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
  inspection: { select: { id: true, inspectionNumber: true } },
} satisfies Prisma.QualityDefectSelect;

type ListRow = Prisma.QualityDefectGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.QualityDefectGetPayload<{ select: typeof DETAIL_SELECT }>;

const OPEN_STATUSES: QualityDefectStatus[] = ["OPEN", "IN_PROGRESS", "REOPENED", "RESOLVED"];

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listDefects(context: UserContext, query: DefectListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.view");

  const filters: Prisma.QualityDefectWhereInput[] = [buildDefectScopeWhere(context)];

  if (query.view === "open") filters.push({ status: { in: OPEN_STATUSES } });
  if (query.view === "mine") filters.push({ assignedToMemberId: context.membershipId });
  if (query.view === "overdue") {
    filters.push({ status: { in: OPEN_STATUSES }, dueDate: { lt: startOfToday() } });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.severity?.length) filters.push({ severity: { in: query.severity } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.assignedToMemberId) filters.push({ assignedToMemberId: query.assignedToMemberId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { defectNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.QualityDefectWhereInput = { AND: filters };

  const orderBy: Prisma.QualityDefectOrderByWithRelationInput[] =
    query.sort === "due-asc"
      ? [{ dueDate: { sort: "asc", nulls: "last" } }]
      : query.sort === "severity-desc"
        ? [{ severity: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }]
        : query.sort === "number-asc"
          ? [{ defectNumber: "asc" }]
          : [{ createdAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.qualityDefect.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.qualityDefect.count({ where }),
  ]);

  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedToMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getDefect(
  context: UserContext,
  defectId: string,
): Promise<DefectDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.view");

  const row = assertFound(
    await prisma.qualityDefect.findFirst({
      where: { AND: [buildDefectScopeWhere(context), { id: defectId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, ncrs, actions] = await Promise.all([
    loadMembers(context.companyId, [row.assignedToMemberId, row.resolvedByMemberId, row.closedByMemberId]),
    loadMemberRef(context.companyId, row.createdByMemberId),
    can(context, "qaqc.ncr.view")
      ? import("../ncrs/ncr.service").then((m) => m.listForDefect(context, defectId))
      : Promise.resolve([]),
    can(context, "qaqc.corrective_action.view")
      ? import("../corrective-actions/action.service").then((m) =>
          m.listForParent(context, { defectId }),
        )
      : Promise.resolve([]),
  ]);

  return {
    ...toSummaryDTO(row, members),
    description: row.description,
    locationText: row.locationText,
    inspection: row.inspection,
    resolutionNote: row.resolutionNote,
    resolvedBy: row.resolvedByMemberId ? (members.get(row.resolvedByMemberId) ?? null) : null,
    resolvedAt: dateString(row.resolvedAt),
    closedBy: row.closedByMemberId ? (members.get(row.closedByMemberId) ?? null) : null,
    closedAt: dateString(row.closedAt),
    cancelledAt: dateString(row.cancelledAt),
    ncrs,
    correctiveActions: actions,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row),
  };
}

export async function listForInspection(
  context: UserContext,
  inspectionId: string,
): Promise<DefectSummaryDTO[]> {
  if (!can(context, "qaqc.defect.view")) return [];

  const rows = await prisma.qualityDefect.findMany({
    where: { AND: [buildDefectScopeWhere(context), { inspectionId }] },
    orderBy: { createdAt: "desc" },
    select: LIST_SELECT,
  });

  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<DefectSummaryDTO[]> {
  if (!can(context, "qaqc.defect.view")) return [];

  const rows = await prisma.qualityDefect.findMany({
    where: { AND: [buildDefectScopeWhere(context), { projectId }] },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function defectFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.view");

  const scope = buildDefectScopeWhere(context);

  const [projects, assignees] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [buildQaqcProjectWhere(context), { qualityDefects: { some: scope } }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, assignedDefects: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, assignees };
}

export async function defectFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: buildQaqcProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: buildQaqcMemberWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, members };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createDefect(
  context: UserContext,
  input: DefectInput,
): Promise<DefectDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.create");

  const project = await requireProject(context, input.projectId);
  if (input.assignedToMemberId) await requireMember(context, input.assignedToMemberId);

  const id = await prisma.$transaction(async (tx) => {
    const defectNumber = await nextQualityNumber(tx, "qualityDefect", context.companyId);

    const defect = await tx.qualityDefect.create({
      data: {
        companyId: context.companyId,
        defectNumber,
        title: input.title,
        description: input.description,
        projectId: project.id,
        inspectionId: input.inspectionId ?? null,
        severity: input.severity,
        status: "OPEN",
        locationText: input.locationText ?? null,
        assignedToMemberId: input.assignedToMemberId ?? null,
        dueDate: input.dueDate ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, defectNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: defect.id,
      action: "QAQC_DEFECT_CREATED",
      message: `raised defect ${defect.defectNumber}`,
    });

    return defect.id;
  });

  return getDefect(context, id);
}

export async function updateDefect(
  context: UserContext,
  defectId: string,
  input: DefectInput,
): Promise<DefectDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.update");

  const existing = await requireDefect(context, defectId);

  if (!isDefectEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed defect cannot be edited.", {
      code: "DEFECT_CLOSED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const project = await requireProject(context, input.projectId);
  if (input.assignedToMemberId) await requireMember(context, input.assignedToMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.qualityDefect.update({
      where: { id: defectId },
      data: {
        title: input.title,
        description: input.description,
        projectId: project.id,
        inspectionId: input.inspectionId ?? null,
        severity: input.severity,
        locationText: input.locationText ?? null,
        assignedToMemberId: input.assignedToMemberId ?? null,
        dueDate: input.dueDate ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: defectId,
      action: "QAQC_DEFECT_UPDATED",
      message: `updated defect ${existing.defectNumber}`,
    });
  });

  return getDefect(context, defectId);
}

export async function assignDefect(
  context: UserContext,
  defectId: string,
  memberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.assign");

  const existing = await requireDefect(context, defectId);

  if (!isDefectEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed defect cannot be reassigned.", {
      code: "DEFECT_CLOSED",
    });
  }

  const member = await requireMember(context, memberId);

  await prisma.$transaction(async (tx) => {
    await tx.qualityDefect.update({
      where: { id: defectId },
      data: {
        assignedToMemberId: member.id,
        status: existing.status === "OPEN" ? "IN_PROGRESS" : existing.status,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: defectId,
      action: "QAQC_DEFECT_ASSIGNED",
      message: `assigned defect ${existing.defectNumber}`,
      metadata: { memberId: member.id } as Prisma.InputJsonValue,
    });
  });
}

/** Whoever fixed it says what they did (PRD #21 §118). */
export async function resolveDefect(
  context: UserContext,
  defectId: string,
  resolutionNote: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.resolve");

  const existing = await requireDefect(context, defectId);

  if (!isDefectResolvable(existing.status)) {
    throw new AccessError("CONFLICT", "This defect is not open.", { code: "NOT_OPEN" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.qualityDefect.update({
      where: { id: defectId },
      data: {
        status: "RESOLVED",
        resolutionNote,
        resolvedAt: new Date(),
        resolvedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: defectId,
      action: "QAQC_DEFECT_RESOLVED",
      message: `resolved defect ${existing.defectNumber}`,
    });
  });
}

/**
 * Somebody else agrees it is actually fixed (PRD #21 §119).
 *
 * The person who resolved it may not close it: that is the whole point of
 * having two states. `qaqc.defect.close` is an APPROVE-level grant, and this
 * check makes it mean something even for somebody who holds both.
 */
export async function closeDefect(context: UserContext, defectId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.close");

  const existing = assertFound(
    await prisma.qualityDefect.findFirst({
      where: { AND: [buildDefectScopeWhere(context), { id: defectId }] },
      select: { id: true, defectNumber: true, status: true, resolvedByMemberId: true },
    }),
  );

  if (!isDefectCloseable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "A defect is closed once somebody has recorded how it was fixed.",
      { code: "NOT_RESOLVED" },
    );
  }

  if (
    existing.resolvedByMemberId === context.membershipId &&
    !can(context, "qaqc.approval.self")
  ) {
    throw new AccessError(
      "FORBIDDEN",
      "You recorded the fix, so somebody else has to confirm it.",
      { code: "SELF_CLOSE" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.qualityDefect.update({
      where: { id: defectId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: defectId,
      action: "QAQC_DEFECT_CLOSED",
      message: `closed defect ${existing.defectNumber}`,
    });
  });
}

export async function reopenDefect(
  context: UserContext,
  defectId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.reopen");

  const existing = await requireDefect(context, defectId);

  if (!isDefectReopenable(existing.status)) {
    throw new AccessError("CONFLICT", "This defect is not resolved or closed.", {
      code: "NOT_SETTLED",
    });
  }

  await prisma.$transaction(async (tx) => {
    // The earlier resolution stays on the record: reopening says the fix did
    // not hold, not that it never happened.
    await tx.qualityDefect.update({
      where: { id: defectId },
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
      entityId: defectId,
      action: "QAQC_DEFECT_REOPENED",
      message: `reopened defect ${existing.defectNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelDefect(
  context: UserContext,
  defectId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.defect.cancel");

  const existing = await requireDefect(context, defectId);

  if (!isDefectCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This defect has already been settled.", {
      code: "DEFECT_SETTLED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.qualityDefect.update({
      where: { id: defectId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: defectId,
      action: "QAQC_DEFECT_CANCELLED",
      message: `cancelled defect ${existing.defectNumber}`,
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

async function requireDefect(context: UserContext, defectId: string) {
  return assertFound(
    await prisma.qualityDefect.findFirst({
      where: { AND: [buildDefectScopeWhere(context), { id: defectId }] },
      select: { id: true, defectNumber: true, status: true, updatedAt: true },
    }),
  );
}

async function requireProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildQaqcProjectWhere(context), { id: projectId }] },
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
    where: { AND: [buildQaqcMemberWhere(context), { id: memberId }] },
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
      "Somebody else changed this defect while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): DefectSummaryDTO {
  const open = OPEN_STATUSES.includes(row.status);

  return {
    id: row.id,
    defectNumber: row.defectNumber,
    title: row.title,
    severity: row.severity,
    status: row.status,
    project: toProjectRef(row.project)!,
    assignedTo: row.assignedToMemberId ? (members.get(row.assignedToMemberId) ?? null) : null,
    dueDate: dateString(row.dueDate),
    overdue: isOverdue(row.dueDate, open),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, row: DetailRow) {
  return {
    canEdit: isDefectEditable(row.status) && can(context, "qaqc.defect.update"),
    canAssign: isDefectEditable(row.status) && can(context, "qaqc.defect.assign"),
    canResolve: isDefectResolvable(row.status) && can(context, "qaqc.defect.resolve"),
    canClose:
      isDefectCloseable(row.status) &&
      can(context, "qaqc.defect.close") &&
      (row.resolvedByMemberId !== context.membershipId ||
        can(context, "qaqc.approval.self")),
    canReopen: isDefectReopenable(row.status) && can(context, "qaqc.defect.reopen"),
    canCancel: isDefectCancellable(row.status) && can(context, "qaqc.defect.cancel"),
    // Escalating turns "this needs fixing" into a formal non-conformance
    // (PRD #21 §170, §172).
    canEscalate: isDefectEditable(row.status) && can(context, "qaqc.ncr.create"),
    canViewDocuments: can(context, "qaqc.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "qaqc.activity.view"),
  };
}
