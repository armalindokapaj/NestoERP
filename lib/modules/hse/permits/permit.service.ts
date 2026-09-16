import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
  invalidRecordLink,
} from "@/lib/access/guards";
import { assertSameProject } from "@/lib/access/references";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { dateString, loadMemberRef, loadMembers, toProjectRef } from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import {
  buildHseMemberWhere,
  buildHseProjectWhere,
  buildPermitScopeWhere,
  buildRiskAssessmentScopeWhere,
} from "../hse.scope";
import type { PermitInput, PermitListQuery } from "../hse.schema";
import {
  effectivePermitStatus,
  isPermitActivatable,
  isPermitCancellable,
  isPermitClosable,
  isPermitDecidable,
  isPermitEditable,
  isPermitSubmittable,
  isPermitSuspendable,
  isWithinValidity,
  LIVE_PERMIT_STATUSES,
} from "../hse.status";
import type { PermitDetailDTO, PermitSummaryDTO } from "../hse.types";

/**
 * Work permits (PRD #22 §140–§157).
 *
 * Authorisation for controlled or high-risk work — hot work, confined space,
 * work at height. Three rules shape this file.
 *
 * **A permit is what its window says, not what its column says** (PRD #22 §151,
 * §360). Every read runs the stored status through `effectivePermitStatus`, so a
 * permit whose validity ran out last night reads as EXPIRED everywhere, at once,
 * without waiting for a background job. A dashboard that still said ACTIVE would
 * be telling somebody they may start cutting.
 *
 * **Nobody approves their own permit** (PRD #22 §149). That is the difference
 * between a permit-to-work system and a form.
 *
 * **Activation only inside the window** (PRD #22 §150). An approved permit for
 * next Tuesday does not authorise work today.
 */

const MODULE = "hse" as const;
const ENTITY = "HseWorkPermit";

const LIST_SELECT = {
  id: true,
  permitNumber: true,
  permitType: true,
  title: true,
  status: true,
  locationText: true,
  requestedByMemberId: true,
  responsibleMemberId: true,
  validFrom: true,
  validUntil: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.HseWorkPermitSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  hazardsSummary: true,
  controlsSummary: true,
  ppeRequirements: true,
  specialConditions: true,
  suspensionReason: true,
  submittedAt: true,
  approvedAt: true,
  approvedByMemberId: true,
  activatedAt: true,
  suspendedAt: true,
  closedAt: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
  riskAssessment: { select: { id: true, assessmentNumber: true, version: true } },
} satisfies Prisma.HseWorkPermitSelect;

type ListRow = Prisma.HseWorkPermitGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.HseWorkPermitGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listPermits(context: UserContext, query: PermitListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.view");

  const now = new Date();
  const filters: Prisma.HseWorkPermitWhereInput[] = [buildPermitScopeWhere(context)];

  if (query.view === "active") {
    filters.push({ status: "ACTIVE", validUntil: { gte: now } });
  }
  if (query.view === "expiring") {
    // The next seven days, which is the window the register buckets by (§211).
    const horizon = new Date(now.getTime() + 7 * 86_400_000);
    filters.push({
      status: { in: ["ACTIVE", "APPROVED", "SUSPENDED"] },
      validUntil: { gte: now, lte: horizon },
    });
  }
  if (query.view === "pending") filters.push({ status: "PENDING_APPROVAL" });
  if (query.view === "mine") {
    filters.push({
      OR: [
        { requestedByMemberId: context.membershipId },
        { responsibleMemberId: context.membershipId },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.permitType?.length) filters.push({ permitType: { in: query.permitType } });
  if (query.projectId) filters.push({ projectId: query.projectId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { permitNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.HseWorkPermitWhereInput = { AND: filters };

  const orderBy: Prisma.HseWorkPermitOrderByWithRelationInput[] =
    query.sort === "expiry-asc"
      ? [{ validUntil: "asc" }]
      : query.sort === "number-asc"
        ? [{ permitNumber: "asc" }]
        : [{ updatedAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.hseWorkPermit.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.hseWorkPermit.count({ where }),
  ]);

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.requestedByMemberId, row.responsibleMemberId]),
  );

  return {
    data: rows.map((row) => toSummaryDTO(row, members, now)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getPermit(
  context: UserContext,
  permitId: string,
): Promise<PermitDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.view");

  const row = assertFound(
    await prisma.hseWorkPermit.findFirst({
      where: { AND: [buildPermitScopeWhere(context), { id: permitId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, actions, pending] = await Promise.all([
    loadMembers(context.companyId, [row.requestedByMemberId, row.responsibleMemberId, row.approvedByMemberId]),
    loadMemberRef(context.companyId, row.createdByMemberId),
    can(context, "hse.action.view")
      ? import("../actions/action.service").then((m) => m.listForParent(context, { permitId }))
      : Promise.resolve([]),
    approvals.pendingFor(context, "WORK_PERMIT", permitId),
  ]);

  const now = new Date();

  return {
    ...toSummaryDTO(row, members, now),
    hazardsSummary: row.hazardsSummary,
    controlsSummary: row.controlsSummary,
    ppeRequirements: row.ppeRequirements,
    specialConditions: row.specialConditions,
    suspensionReason: row.suspensionReason,
    riskAssessment: row.riskAssessment
      ? {
          id: row.riskAssessment.id,
          label: `${row.riskAssessment.assessmentNumber} v${row.riskAssessment.version}`,
          href: can(context, "hse.risk.view")
            ? `/hse/risk-assessments/${row.riskAssessment.id}`
            : null,
        }
      : null,
    submittedAt: dateString(row.submittedAt),
    approvedBy: row.approvedByMemberId ? (members.get(row.approvedByMemberId) ?? null) : null,
    approvedAt: dateString(row.approvedAt),
    activatedAt: dateString(row.activatedAt),
    suspendedAt: dateString(row.suspendedAt),
    closedAt: dateString(row.closedAt),
    cancelledAt: dateString(row.cancelledAt),
    actions,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row, pending?.submittedByMemberId ?? null, now),
  };
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<PermitSummaryDTO[]> {
  if (!can(context, "hse.permit.view")) return [];

  const rows = await prisma.hseWorkPermit.findMany({
    where: { AND: [buildPermitScopeWhere(context), { projectId }] },
    orderBy: [{ validUntil: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.requestedByMemberId, row.responsibleMemberId]),
  );
  return rows.map((row) => toSummaryDTO(row, members, new Date()));
}

/** Permits about to run out, for the overview (PRD #22 §211). */
export async function expiringPermits(
  context: UserContext,
  withinHours = 72,
): Promise<PermitSummaryDTO[]> {
  if (!can(context, "hse.permit.view")) return [];

  const now = new Date();
  const horizon = new Date(now.getTime() + withinHours * 3_600_000);

  const rows = await prisma.hseWorkPermit.findMany({
    where: {
      AND: [
        buildPermitScopeWhere(context),
        { status: { in: ["ACTIVE", "APPROVED"] }, validUntil: { gte: now, lte: horizon } },
      ],
    },
    orderBy: [{ validUntil: "asc" }],
    take: 10,
    select: LIST_SELECT,
  });

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.requestedByMemberId, row.responsibleMemberId]),
  );
  return rows.map((row) => toSummaryDTO(row, members, now));
}

export async function permitFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.view");

  const scope = buildPermitScopeWhere(context);

  const projects = await prisma.project.findMany({
    where: { AND: [buildHseProjectWhere(context), { hseWorkPermits: { some: scope } }] },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { projects };
}

export async function permitFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members, assessments] = await Promise.all([
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
    can(context, "hse.risk.view")
      ? prisma.hseRiskAssessment.findMany({
          where: { AND: [buildRiskAssessmentScopeWhere(context), { status: "APPROVED" }] },
          select: { id: true, assessmentNumber: true, title: true, version: true },
          orderBy: { assessmentNumber: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return { projects, members, assessments };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createPermit(
  context: UserContext,
  input: PermitInput,
): Promise<PermitDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.create");

  await requireProject(context, input.projectId);
  if (input.responsibleMemberId) await requireMember(context, input.responsibleMemberId);
  if (input.riskAssessmentId) {
    await requireAssessment(context, input.riskAssessmentId, input.projectId, { mustBeApproved: true });
  }

  const id = await prisma.$transaction(async (tx) => {
    const permitNumber = await nextHseNumber(tx, "hseWorkPermit", context.companyId);

    const permit = await tx.hseWorkPermit.create({
      data: {
        companyId: context.companyId,
        permitNumber,
        permitType: input.permitType,
        title: input.title,
        projectId: input.projectId,
        locationText: input.locationText,
        riskAssessmentId: input.riskAssessmentId ?? null,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        requestedByMemberId: context.membershipId,
        responsibleMemberId: input.responsibleMemberId ?? null,
        status: "DRAFT",
        hazardsSummary: input.hazardsSummary ?? null,
        controlsSummary: input.controlsSummary ?? null,
        ppeRequirements: input.ppeRequirements ?? null,
        specialConditions: input.specialConditions ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, permitNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: permit.id,
      action: "HSE_PERMIT_CREATED",
      message: `raised work permit ${permit.permitNumber}`,
    });

    return permit.id;
  });

  return getPermit(context, id);
}

/** Only a draft. An ACTIVE permit's terms are frozen (PRD #22 §351). */
export async function updatePermit(
  context: UserContext,
  permitId: string,
  input: PermitInput,
): Promise<PermitDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.update");

  const existing = await requirePermit(context, permitId);

  if (!isPermitEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "A permit can only be changed while it is a draft. Cancel it and raise a new one.",
      { code: "PERMIT_ISSUED" },
    );
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  await requireProject(context, input.projectId);
  if (input.responsibleMemberId) await requireMember(context, input.responsibleMemberId);
  if (input.riskAssessmentId) {
    // A link the draft already had may since have been superseded; it still has
    // to be for this site, but only a newly chosen one must be approved today.
    await requireAssessment(context, input.riskAssessmentId, input.projectId, {
      mustBeApproved: input.riskAssessmentId !== existing.riskAssessmentId,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseWorkPermit.update({
      where: { id: permitId },
      data: {
        permitType: input.permitType,
        title: input.title,
        projectId: input.projectId,
        locationText: input.locationText,
        riskAssessmentId: input.riskAssessmentId ?? null,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        responsibleMemberId: input.responsibleMemberId ?? null,
        hazardsSummary: input.hazardsSummary ?? null,
        controlsSummary: input.controlsSummary ?? null,
        ppeRequirements: input.ppeRequirements ?? null,
        specialConditions: input.specialConditions ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: permitId,
      action: "HSE_PERMIT_CREATED",
      message: `updated work permit ${existing.permitNumber}`,
    });
  });

  return getPermit(context, permitId);
}

export async function submitPermit(context: UserContext, permitId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.submit");

  const existing = await requirePermit(context, permitId);

  if (!isPermitSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a draft permit can be submitted.", {
      code: "NOT_DRAFT",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseWorkPermit.update({
      where: { id: permitId },
      data: {
        status: "PENDING_APPROVAL",
        submittedAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await approvals.openApproval(tx, context, "WORK_PERMIT", permitId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: permitId,
      action: "HSE_PERMIT_SUBMITTED",
      message: `submitted work permit ${existing.permitNumber}`,
    });
  });
}

export async function approvePermit(
  context: UserContext,
  permitId: string,
  decisionNote: string | null,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "WORK_PERMIT");

  const existing = await requirePermit(context, permitId);

  if (!isPermitDecidable(existing.status)) {
    throw new AccessError("CONFLICT", "This permit is not waiting for a decision.", {
      code: "NOT_PENDING",
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "WORK_PERMIT", permitId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId, existing.requestedByMemberId);

    await approvals.decideApproval(tx, context, approval.id, "APPROVED", decisionNote);

    await tx.hseWorkPermit.update({
      where: { id: permitId },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: permitId,
      action: "HSE_PERMIT_APPROVED",
      message: `approved work permit ${existing.permitNumber}`,
    });
  });
}

export async function rejectPermit(
  context: UserContext,
  permitId: string,
  decisionNote: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "WORK_PERMIT");

  const existing = await requirePermit(context, permitId);

  if (!isPermitDecidable(existing.status)) {
    throw new AccessError("CONFLICT", "This permit is not waiting for a decision.", {
      code: "NOT_PENDING",
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "WORK_PERMIT", permitId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId, existing.requestedByMemberId);

    await approvals.decideApproval(tx, context, approval.id, "REJECTED", decisionNote);

    await tx.hseWorkPermit.update({
      where: { id: permitId },
      data: { status: "DRAFT", submittedAt: null, updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: permitId,
      action: "HSE_PERMIT_SUBMITTED",
      message: `sent work permit ${existing.permitNumber} back`,
    });
  });
}

/**
 * Letting the work begin — or begin again (PRD #22 §150, §153).
 *
 * Only inside the window it authorises. An approved permit for next Tuesday
 * does not authorise cutting today, and a permit whose window has already closed
 * cannot be revived: that needs a new permit, not a reactivation.
 */
export async function activatePermit(context: UserContext, permitId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.activate");

  const existing = assertFound(
    await prisma.hseWorkPermit.findFirst({
      where: { AND: [buildPermitScopeWhere(context), { id: permitId }] },
      select: {
        id: true,
        permitNumber: true,
        status: true,
        validFrom: true,
        validUntil: true,
      },
    }),
  );

  if (!isPermitActivatable(existing.status)) {
    throw new AccessError("CONFLICT", "This permit cannot be activated now.", {
      code: "NOT_ACTIVATABLE",
    });
  }

  if (!isWithinValidity(existing.validFrom, existing.validUntil)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "This permit is outside the window it authorises.",
      { code: "OUTSIDE_VALIDITY" },
    );
  }

  const reactivating = existing.status === "SUSPENDED";

  await prisma.$transaction(async (tx) => {
    await tx.hseWorkPermit.update({
      where: { id: permitId },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(),
        suspendedAt: null,
        suspensionReason: null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: permitId,
      action: reactivating ? "HSE_PERMIT_REACTIVATED" : "HSE_PERMIT_ACTIVATED",
      message: `${reactivating ? "reactivated" : "activated"} work permit ${existing.permitNumber}`,
    });
  });
}

export async function suspendPermit(
  context: UserContext,
  permitId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.suspend");

  const existing = await requirePermit(context, permitId);

  if (!isPermitSuspendable(existing.status)) {
    throw new AccessError("CONFLICT", "Only an active permit can be suspended.", {
      code: "NOT_ACTIVE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseWorkPermit.update({
      where: { id: permitId },
      data: {
        status: "SUSPENDED",
        suspendedAt: new Date(),
        suspensionReason: reason,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: permitId,
      action: "HSE_PERMIT_SUSPENDED",
      message: `suspended work permit ${existing.permitNumber}`,
    });
  });
}

export async function closePermit(context: UserContext, permitId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.close");

  const existing = assertFound(
    await prisma.hseWorkPermit.findFirst({
      where: { AND: [buildPermitScopeWhere(context), { id: permitId }] },
      select: { id: true, permitNumber: true, status: true, validUntil: true },
    }),
  );

  // An expired permit is still closable — that is how the paperwork gets
  // finished on a job that ran to its end (PRD #22 §154).
  const effective = effectivePermitStatus(existing.status, existing.validUntil);

  if (!isPermitClosable(effective)) {
    throw new AccessError("CONFLICT", "This permit cannot be closed now.", {
      code: "NOT_CLOSABLE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseWorkPermit.update({
      where: { id: permitId },
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
      entityId: permitId,
      action: "HSE_PERMIT_CLOSED",
      message: `closed work permit ${existing.permitNumber}`,
    });
  });
}

export async function cancelPermit(
  context: UserContext,
  permitId: string,
  reason: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.permit.cancel");

  const existing = await requirePermit(context, permitId);

  if (!isPermitCancellable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "A permit that has been activated is closed, not cancelled.",
      { code: "NOT_CANCELLABLE" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await approvals.cancelPendingApprovals(tx, context, "WORK_PERMIT", permitId);

    await tx.hseWorkPermit.update({
      where: { id: permitId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: permitId,
      action: "HSE_PERMIT_CANCELLED",
      message: `cancelled work permit ${existing.permitNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requirePermit(context: UserContext, permitId: string) {
  return assertFound(
    await prisma.hseWorkPermit.findFirst({
      where: { AND: [buildPermitScopeWhere(context), { id: permitId }] },
      select: {
        id: true,
        permitNumber: true,
        status: true,
        requestedByMemberId: true,
        riskAssessmentId: true,
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

/**
 * The risk assessment a permit relies on (PRD #22 §146, PRD #47 §51).
 *
 * It has to be one the requester can see, for this permit's site — or a
 * company-level assessment that names no project, such as a standard method
 * statement — and approved. A draft or another site's assessment would put a
 * permit-to-work on paper that nobody signed off for this job.
 */
async function requireAssessment(
  context: UserContext,
  assessmentId: string,
  projectId: string,
  options: { mustBeApproved: boolean },
) {
  const assessment = await prisma.hseRiskAssessment.findFirst({
    where: { AND: [buildRiskAssessmentScopeWhere(context), { id: assessmentId }] },
    select: { id: true, projectId: true, status: true },
  });

  if (!assessment) {
    throw new AccessError("VALIDATION_ERROR", "That risk assessment does not exist.", {
      code: "INVALID_RISK_ASSESSMENT",
    });
  }

  assertSameProject("riskAssessmentId", projectId, assessment.projectId, { allowUnlinked: true });

  if (options.mustBeApproved && assessment.status !== "APPROVED") {
    throw invalidRecordLink(
      "riskAssessmentId",
      "SCOPE_DENIED",
      "A permit relies on an approved risk assessment.",
    );
  }

  return assessment;
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this permit while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
  now: Date,
): PermitSummaryDTO {
  return {
    id: row.id,
    permitNumber: row.permitNumber,
    permitType: row.permitType,
    title: row.title,
    status: row.status,
    effectiveStatus: effectivePermitStatus(row.status, row.validUntil, now),
    project: toProjectRef(row.project)!,
    locationText: row.locationText,
    requestedBy: members.get(row.requestedByMemberId) ?? null,
    responsible: row.responsibleMemberId
      ? (members.get(row.responsibleMemberId) ?? null)
      : null,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil.toISOString(),
    hoursRemaining: Math.round((row.validUntil.getTime() - now.getTime()) / 3_600_000),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  row: DetailRow,
  submittedByMemberId: string | null,
  now: Date,
) {
  const notSelf = !approvals.isSelfDecision(context, submittedByMemberId, row.requestedByMemberId);
  const effective = effectivePermitStatus(row.status, row.validUntil, now);

  return {
    canEdit: isPermitEditable(row.status) && can(context, "hse.permit.update"),
    canSubmit: isPermitSubmittable(row.status) && can(context, "hse.permit.submit"),
    canApprove: isPermitDecidable(row.status) && can(context, "hse.permit.approve") && notSelf,
    canReject: isPermitDecidable(row.status) && can(context, "hse.permit.approve") && notSelf,
    // Offered only while the window is genuinely open, so the button is never
    // one that is certain to fail (PRD #22 §150).
    canActivate:
      isPermitActivatable(effective) &&
      isWithinValidity(row.validFrom, row.validUntil, now) &&
      can(context, "hse.permit.activate"),
    canSuspend: isPermitSuspendable(effective) && can(context, "hse.permit.suspend"),
    canClose: isPermitClosable(effective) && can(context, "hse.permit.close"),
    canCancel: isPermitCancellable(row.status) && can(context, "hse.permit.cancel"),
    canViewDocuments: can(context, "hse.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "hse.activity.view"),
  };
}

export { LIVE_PERMIT_STATUSES };
