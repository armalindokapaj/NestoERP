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
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { dateString, loadMemberRef, loadMembers, toProjectRef } from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import { assessResidualRisk, assessRisk, residualRiskExceedsInitial } from "../hse.risk";
import {
  buildHseMemberWhere,
  buildHseProjectWhere,
  buildRiskAssessmentScopeWhere,
} from "../hse.scope";
import type { RiskAssessmentInput, RiskAssessmentListQuery } from "../hse.schema";
import {
  isReviewDue,
  isRiskAssessmentArchivable,
  isRiskAssessmentDecidable,
  isRiskAssessmentEditable,
  isRiskAssessmentSubmittable,
  requiresNewVersion,
} from "../hse.status";
import type {
  RiskAssessmentDetailDTO,
  RiskAssessmentItemDTO,
  RiskAssessmentSummaryDTO,
} from "../hse.types";

/**
 * Risk assessments (PRD #22 §100–§113).
 *
 * A structured evaluation of an activity, line by line: the hazard, what is
 * already controlling it, what the risk is, what else will be done, and what
 * risk is left. Two rules shape this file.
 *
 * **An approved assessment is immutable** (PRD #22 §107, §350). Site work is
 * carried out against it and a method statement quotes it; editing the document
 * people worked to would rewrite the basis on which they were asked to do the
 * job. A material change makes version 2 and leaves version 1 readable.
 *
 * **Every score is derived** (PRD #22 §105, §243). Each line's likelihood and
 * severity come in; the score and the level are computed here, exactly as they
 * are for a hazard.
 *
 * Review dates flag for attention and never invalidate anything on their own
 * (PRD #22 §110, §359) — an assessment that silently expired would stop a site
 * with no warning.
 */

const MODULE = "hse" as const;
const ENTITY = "HseRiskAssessment";

const ITEM_SELECT = {
  id: true,
  hazardDescription: true,
  existingControls: true,
  likelihood: true,
  severityScore: true,
  riskScore: true,
  riskLevel: true,
  additionalControls: true,
  residualLikelihood: true,
  residualSeverity: true,
  residualRiskScore: true,
  residualRiskLevel: true,
  responsibleMemberId: true,
  dueDate: true,
  sortOrder: true,
} satisfies Prisma.HseRiskAssessmentItemSelect;

const LIST_SELECT = {
  id: true,
  assessmentNumber: true,
  title: true,
  version: true,
  status: true,
  ownerMemberId: true,
  assessmentDate: true,
  reviewDate: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  items: { select: { riskLevel: true } },
} satisfies Prisma.HseRiskAssessmentSelect;

const DETAIL_SELECT = {
  id: true,
  assessmentNumber: true,
  title: true,
  version: true,
  status: true,
  ownerMemberId: true,
  assessmentDate: true,
  reviewDate: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  description: true,
  activityType: true,
  locationText: true,
  submittedAt: true,
  approvedAt: true,
  approvedByMemberId: true,
  archivedAt: true,
  createdByMemberId: true,
  createdAt: true,
  items: { select: ITEM_SELECT, orderBy: { sortOrder: "asc" } },
} satisfies Prisma.HseRiskAssessmentSelect;

type ListRow = Prisma.HseRiskAssessmentGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.HseRiskAssessmentGetPayload<{ select: typeof DETAIL_SELECT }>;

const RISK_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listRiskAssessments(
  context: UserContext,
  query: RiskAssessmentListQuery,
) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.risk.view");

  const filters: Prisma.HseRiskAssessmentWhereInput[] = [
    buildRiskAssessmentScopeWhere(context),
  ];

  if (query.view === "approved") filters.push({ status: "APPROVED" });
  if (query.view === "mine") filters.push({ ownerMemberId: context.membershipId });
  if (query.view === "review-due") {
    filters.push({ status: "APPROVED", reviewDate: { lte: new Date() } });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.projectId) filters.push({ projectId: query.projectId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { assessmentNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { activityType: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.HseRiskAssessmentWhereInput = { AND: filters };

  const orderBy: Prisma.HseRiskAssessmentOrderByWithRelationInput[] =
    query.sort === "review-asc"
      ? [{ reviewDate: { sort: "asc", nulls: "last" } }]
      : query.sort === "number-asc"
        ? [{ assessmentNumber: "asc" }, { version: "desc" }]
        : [{ updatedAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.hseRiskAssessment.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.hseRiskAssessment.count({ where }),
  ]);

  const members = await loadMembers(rows.map((row) => row.ownerMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getRiskAssessment(
  context: UserContext,
  assessmentId: string,
): Promise<RiskAssessmentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.risk.view");

  const row = assertFound(
    await prisma.hseRiskAssessment.findFirst({
      where: { AND: [buildRiskAssessmentScopeWhere(context), { id: assessmentId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, actions, pending] = await Promise.all([
    loadMembers([
      row.ownerMemberId,
      row.approvedByMemberId,
      ...row.items.map((item) => item.responsibleMemberId),
    ]),
    loadMemberRef(row.createdByMemberId),
    can(context, "hse.action.view")
      ? import("../actions/action.service").then((m) =>
          m.listForParent(context, { riskAssessmentId: assessmentId }),
        )
      : Promise.resolve([]),
    approvals.pendingFor(context, "RISK_ASSESSMENT", assessmentId),
  ]);

  return {
    ...toSummaryDTO({ ...row, items: row.items }, members),
    description: row.description,
    activityType: row.activityType,
    locationText: row.locationText,
    items: row.items.map((item) => toItemDTO(item, members)),
    submittedAt: dateString(row.submittedAt),
    approvedBy: row.approvedByMemberId ? (members.get(row.approvedByMemberId) ?? null) : null,
    approvedAt: dateString(row.approvedAt),
    archivedAt: dateString(row.archivedAt),
    actions,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row, pending?.submittedByMemberId ?? null),
  };
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<RiskAssessmentSummaryDTO[]> {
  if (!can(context, "hse.risk.view")) return [];

  const rows = await prisma.hseRiskAssessment.findMany({
    where: { AND: [buildRiskAssessmentScopeWhere(context), { projectId }] },
    orderBy: [{ assessmentDate: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.ownerMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

/** Approved assessments a permit may cite (PRD #22 §156). */
export async function approvedAssessments(context: UserContext) {
  if (!can(context, "hse.risk.view")) return [];

  return prisma.hseRiskAssessment.findMany({
    where: { AND: [buildRiskAssessmentScopeWhere(context), { status: "APPROVED" }] },
    orderBy: [{ assessmentNumber: "asc" }],
    select: { id: true, assessmentNumber: true, title: true, version: true },
  });
}

export async function riskFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.risk.view");

  const scope = buildRiskAssessmentScopeWhere(context);

  const projects = await prisma.project.findMany({
    where: { AND: [buildHseProjectWhere(context), { hseRiskAssessments: { some: scope } }] },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { projects };
}

export async function riskFormOptions(context: UserContext) {
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

export async function createRiskAssessment(
  context: UserContext,
  input: RiskAssessmentInput,
): Promise<RiskAssessmentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.risk.create");

  if (input.projectId) await requireProject(context, input.projectId);
  if (input.ownerMemberId) await requireMember(context, input.ownerMemberId);

  const items = input.items.map(toItemData);

  const id = await prisma.$transaction(async (tx) => {
    const assessmentNumber = await nextHseNumber(tx, "hseRiskAssessment", context.companyId);

    const assessment = await tx.hseRiskAssessment.create({
      data: {
        companyId: context.companyId,
        assessmentNumber,
        title: input.title,
        description: input.description ?? null,
        projectId: input.projectId ?? null,
        activityType: input.activityType ?? null,
        locationText: input.locationText ?? null,
        version: 1,
        status: "DRAFT",
        ownerMemberId: input.ownerMemberId ?? null,
        assessmentDate: input.assessmentDate,
        reviewDate: input.reviewDate ?? null,
        createdByMemberId: context.membershipId,
        items: { create: items },
      },
      select: { id: true, assessmentNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: assessment.id,
      action: "HSE_RISK_ASSESSMENT_CREATED",
      message: `created risk assessment ${assessment.assessmentNumber}`,
    });

    return assessment.id;
  });

  return getRiskAssessment(context, id);
}

/**
 * Edits a draft, or versions an approved one (PRD #22 §107, §112, §350).
 *
 * The branch is the whole rule: a draft is worked on, and an approved
 * assessment gets a successor rather than being rewritten under the people
 * working to it.
 */
export async function updateRiskAssessment(
  context: UserContext,
  assessmentId: string,
  input: RiskAssessmentInput,
): Promise<RiskAssessmentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.risk.update");

  const existing = assertFound(
    await prisma.hseRiskAssessment.findFirst({
      where: { AND: [buildRiskAssessmentScopeWhere(context), { id: assessmentId }] },
      select: {
        id: true,
        assessmentNumber: true,
        version: true,
        status: true,
        updatedAt: true,
      },
    }),
  );

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  if (input.projectId) await requireProject(context, input.projectId);
  if (input.ownerMemberId) await requireMember(context, input.ownerMemberId);

  const items = input.items.map(toItemData);

  if (isRiskAssessmentEditable(existing.status)) {
    await prisma.$transaction(async (tx) => {
      await tx.hseRiskAssessmentItem.deleteMany({ where: { riskAssessmentId: assessmentId } });
      await tx.hseRiskAssessment.update({
        where: { id: assessmentId },
        data: {
          title: input.title,
          description: input.description ?? null,
          projectId: input.projectId ?? null,
          activityType: input.activityType ?? null,
          locationText: input.locationText ?? null,
          ownerMemberId: input.ownerMemberId ?? null,
          assessmentDate: input.assessmentDate,
          reviewDate: input.reviewDate ?? null,
          updatedByMemberId: context.membershipId,
          items: { create: items },
        },
      });

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: assessmentId,
        action: "HSE_RISK_ASSESSMENT_UPDATED",
        message: `updated risk assessment ${existing.assessmentNumber}`,
      });
    });

    return getRiskAssessment(context, assessmentId);
  }

  if (!requiresNewVersion(existing.status)) {
    throw new AccessError("CONFLICT", "This risk assessment cannot be edited.", {
      code: "NOT_EDITABLE",
    });
  }

  const successorId = await prisma.$transaction(async (tx) => {
    const latest = await tx.hseRiskAssessment.findFirst({
      where: { companyId: context.companyId, assessmentNumber: existing.assessmentNumber },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const successor = await tx.hseRiskAssessment.create({
      data: {
        companyId: context.companyId,
        assessmentNumber: existing.assessmentNumber,
        title: input.title,
        description: input.description ?? null,
        projectId: input.projectId ?? null,
        activityType: input.activityType ?? null,
        locationText: input.locationText ?? null,
        version: (latest?.version ?? existing.version) + 1,
        status: "DRAFT",
        ownerMemberId: input.ownerMemberId ?? null,
        assessmentDate: input.assessmentDate,
        reviewDate: input.reviewDate ?? null,
        createdByMemberId: context.membershipId,
        items: { create: items },
      },
      select: { id: true, version: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: successor.id,
      action: "HSE_RISK_ASSESSMENT_VERSIONED",
      message: `created version ${successor.version} of risk assessment ${existing.assessmentNumber}`,
      metadata: { previousAssessmentId: assessmentId } as Prisma.InputJsonValue,
    });

    return successor.id;
  });

  return getRiskAssessment(context, successorId);
}

export async function submitRiskAssessment(
  context: UserContext,
  assessmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.risk.submit");

  const existing = await requireAssessment(context, assessmentId);

  if (!isRiskAssessmentSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a draft can be submitted.", { code: "NOT_DRAFT" });
  }

  const itemCount = await prisma.hseRiskAssessmentItem.count({
    where: { riskAssessmentId: assessmentId },
  });

  if (itemCount === 0) {
    throw new AccessError("VALIDATION_ERROR", "A risk assessment needs at least one line.", {
      code: "NO_ITEMS",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseRiskAssessment.update({
      where: { id: assessmentId },
      data: {
        status: "PENDING_APPROVAL",
        submittedAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await approvals.openApproval(tx, context, "RISK_ASSESSMENT", assessmentId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: assessmentId,
      action: "HSE_RISK_ASSESSMENT_SUBMITTED",
      message: `submitted risk assessment ${existing.assessmentNumber}`,
    });
  });
}

export async function approveRiskAssessment(
  context: UserContext,
  assessmentId: string,
  decisionNote: string | null,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "RISK_ASSESSMENT");

  const existing = await requireAssessment(context, assessmentId);

  if (!isRiskAssessmentDecidable(existing.status)) {
    throw new AccessError("CONFLICT", "This assessment is not waiting for a decision.", {
      code: "NOT_PENDING",
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "RISK_ASSESSMENT", assessmentId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await approvals.decideApproval(tx, context, approval.id, "APPROVED", decisionNote);

    await tx.hseRiskAssessment.update({
      where: { id: assessmentId },
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
      entityId: assessmentId,
      action: "HSE_RISK_ASSESSMENT_APPROVED",
      message: `approved risk assessment ${existing.assessmentNumber}`,
    });
  });
}

export async function rejectRiskAssessment(
  context: UserContext,
  assessmentId: string,
  decisionNote: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "RISK_ASSESSMENT");

  const existing = await requireAssessment(context, assessmentId);

  if (!isRiskAssessmentDecidable(existing.status)) {
    throw new AccessError("CONFLICT", "This assessment is not waiting for a decision.", {
      code: "NOT_PENDING",
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "RISK_ASSESSMENT", assessmentId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await approvals.decideApproval(tx, context, approval.id, "REJECTED", decisionNote);

    // Back to DRAFT rather than a REJECTED state: the assessor picks it up and
    // carries on, which is what a rejection means here (PRD #22 §103).
    await tx.hseRiskAssessment.update({
      where: { id: assessmentId },
      data: { status: "DRAFT", submittedAt: null, updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: assessmentId,
      action: "HSE_RISK_ASSESSMENT_UPDATED",
      message: `sent risk assessment ${existing.assessmentNumber} back`,
    });
  });
}

export async function archiveRiskAssessment(
  context: UserContext,
  assessmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.risk.archive");

  const existing = await requireAssessment(context, assessmentId);

  if (!isRiskAssessmentArchivable(existing.status)) {
    throw new AccessError("CONFLICT", "Only an approved assessment can be archived.", {
      code: "NOT_APPROVED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseRiskAssessment.update({
      where: { id: assessmentId },
      data: {
        status: "ARCHIVED",
        archivedAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: assessmentId,
      action: "HSE_RISK_ASSESSMENT_ARCHIVED",
      message: `archived risk assessment ${existing.assessmentNumber}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function toItemData(item: RiskAssessmentInput["items"][number], index: number) {
  const risk = assessRisk(item.likelihood, item.severity);
  const residual = assessResidualRisk(item.residualLikelihood, item.residualSeverity);

  if (residualRiskExceedsInitial(risk.riskScore, residual.residualRiskScore)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "A residual risk cannot be higher than the risk before the control.",
      { code: "RESIDUAL_EXCEEDS_INITIAL" },
    );
  }

  return {
    hazardDescription: item.hazardDescription,
    existingControls: item.existingControls ?? null,
    likelihood: item.likelihood,
    severityScore: item.severity,
    riskScore: risk.riskScore,
    riskLevel: risk.riskLevel,
    additionalControls: item.additionalControls ?? null,
    ...residual,
    responsibleMemberId: item.responsibleMemberId ?? null,
    dueDate: item.dueDate ?? null,
    sortOrder: index,
  };
}

async function requireAssessment(context: UserContext, assessmentId: string) {
  return assertFound(
    await prisma.hseRiskAssessment.findFirst({
      where: { AND: [buildRiskAssessmentScopeWhere(context), { id: assessmentId }] },
      select: { id: true, assessmentNumber: true, status: true, updatedAt: true },
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
      "Somebody else changed this assessment while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toItemDTO(
  item: Prisma.HseRiskAssessmentItemGetPayload<{ select: typeof ITEM_SELECT }>,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): RiskAssessmentItemDTO {
  return {
    id: item.id,
    hazardDescription: item.hazardDescription,
    existingControls: item.existingControls,
    risk: {
      likelihood: item.likelihood,
      severity: item.severityScore,
      score: item.riskScore,
      level: item.riskLevel,
    },
    additionalControls: item.additionalControls,
    residualRisk:
      item.residualRiskScore != null && item.residualRiskLevel != null
        ? {
            likelihood: item.residualLikelihood!,
            severity: item.residualSeverity!,
            score: item.residualRiskScore,
            level: item.residualRiskLevel,
          }
        : null,
    responsible: item.responsibleMemberId
      ? (members.get(item.responsibleMemberId) ?? null)
      : null,
    dueDate: dateString(item.dueDate),
    sortOrder: item.sortOrder,
  };
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): RiskAssessmentSummaryDTO {
  // Ranked by its worst line, which is how anybody reading a register of them
  // decides what to look at first (PRD #22 §207).
  const highest = row.items.reduce<string | null>(
    (worst, item) =>
      worst === null || RISK_ORDER.indexOf(item.riskLevel) > RISK_ORDER.indexOf(worst)
        ? item.riskLevel
        : worst,
    null,
  );

  return {
    id: row.id,
    assessmentNumber: row.assessmentNumber,
    title: row.title,
    version: row.version,
    status: row.status,
    project: toProjectRef(row.project),
    owner: row.ownerMemberId ? (members.get(row.ownerMemberId) ?? null) : null,
    assessmentDate: row.assessmentDate.toISOString(),
    reviewDate: dateString(row.reviewDate),
    reviewDue: isReviewDue(row.status, row.reviewDate),
    highestRisk: highest as RiskAssessmentSummaryDTO["highestRisk"],
    itemCount: row.items.length,
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
    canEdit: isRiskAssessmentEditable(row.status) && can(context, "hse.risk.update"),
    canSubmit: isRiskAssessmentSubmittable(row.status) && can(context, "hse.risk.submit"),
    canApprove:
      isRiskAssessmentDecidable(row.status) && can(context, "hse.risk.approve") && notSelf,
    canReject:
      isRiskAssessmentDecidable(row.status) && can(context, "hse.risk.approve") && notSelf,
    canArchive: isRiskAssessmentArchivable(row.status) && can(context, "hse.risk.archive"),
    canVersion: requiresNewVersion(row.status) && can(context, "hse.risk.update"),
    canViewDocuments: can(context, "hse.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "hse.activity.view"),
  };
}
