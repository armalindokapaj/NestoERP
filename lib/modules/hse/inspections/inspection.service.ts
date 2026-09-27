import { applyTransition } from "@/lib/core/state/transition";
import { hseInspectionMachine } from "./inspection.machine";
import { Prisma, type HseInspectionStatus } from "@prisma/client";

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
import { requireDecisionNote, type ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { dateString, loadMemberRef, loadMembers, toProjectRef } from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import {
  buildHseMemberWhere,
  buildHseProjectWhere,
  buildInspectionScopeWhere,
  buildTemplateScopeWhere,
} from "../hse.scope";
import type {
  ExecuteInspectionInput,
  InspectionInput,
  InspectionListQuery,
  SubmitInspectionInput,
} from "../hse.schema";
import {
  allowedChecklistResults,
  allowedOverallResults,
  canStartInspection,
  checklistGaps,
  closureNeedsDisposition,
  isInspectionCancellable,
  isInspectionClosable,
  isInspectionDecidable,
  isInspectionEditable,
  isInspectionExecutable,
  isInspectionSubmittable,
  type ChecklistAnswer,
} from "../hse.status";
import type { InspectionDetailDTO, InspectionSummaryDTO } from "../hse.types";

/**
 * Safety inspections (PRD #22 §33–§56).
 *
 * Three rules shape this file.
 *
 * **Status and result are separate facts** (PRD #22 §37, §38). An inspection
 * sits at PENDING_APPROVAL with a result of FAIL: the inspector has finished and
 * found a problem, and somebody still has to sign it off. Every list shows two
 * columns because collapsing them would make that state impossible to express.
 *
 * **The checklist is a snapshot** (PRD #22 §47). Creating an inspection copies
 * the template's items onto it, wording and criteria and all. Editing the
 * template afterwards must never change what somebody is recorded as having
 * checked on a site last Tuesday.
 *
 * **Nobody signs off their own walk-round** (PRD #22 §52). The approve control
 * is absent for whoever submitted, and the service refuses it independently — so
 * the page is a courtesy rather than the guard.
 */

const MODULE = "hse" as const;
const ENTITY = "HseInspection";

const LIST_SELECT = {
  id: true,
  inspectionNumber: true,
  inspectionType: true,
  status: true,
  result: true,
  assignedInspectorMemberId: true,
  scheduledDate: true,
  inspectionDate: true,
  locationText: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  _count: { select: { checklistItems: true } },
} satisfies Prisma.HseInspectionSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  templateId: true,
  templateVersion: true,
  executedByMemberId: true,
  summary: true,
  decisionNote: true,
  submittedAt: true,
  approvedAt: true,
  approvedByMemberId: true,
  rejectedAt: true,
  rejectedByMemberId: true,
  closedAt: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
  template: { select: { id: true, code: true, name: true, version: true } },
  checklistItems: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      label: true,
      description: true,
      responseType: true,
      required: true,
      sortOrder: true,
      responseValue: true,
      result: true,
      note: true,
      riskIfFailed: true,
      requiresNoteOnFail: true,
    },
  },
} satisfies Prisma.HseInspectionSelect;

type ListRow = Prisma.HseInspectionGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.HseInspectionGetPayload<{ select: typeof DETAIL_SELECT }>;

const DUE_STATUSES: HseInspectionStatus[] = ["DRAFT", "SCHEDULED", "IN_PROGRESS"];

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listInspections(context: UserContext, query: InspectionListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.view");

  const filters: Prisma.HseInspectionWhereInput[] = [buildInspectionScopeWhere(context)];

  if (query.view === "mine") {
    filters.push({
      OR: [
        { assignedInspectorMemberId: context.membershipId },
        { executedByMemberId: context.membershipId },
      ],
    });
  }
  if (query.view === "due") filters.push({ status: { in: DUE_STATUSES } });
  if (query.view === "failed") filters.push({ result: { in: ["FAIL", "CONDITIONAL"] } });

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.result?.length) filters.push({ result: { in: query.result } });
  if (query.inspectionType?.length) {
    filters.push({ inspectionType: { in: query.inspectionType } });
  }
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.assignedInspectorMemberId) {
    filters.push({ assignedInspectorMemberId: query.assignedInspectorMemberId });
  }

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { inspectionNumber: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
        { summary: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.HseInspectionWhereInput = { AND: filters };

  const orderBy: Prisma.HseInspectionOrderByWithRelationInput[] =
    query.sort === "scheduled-asc"
      ? [{ scheduledDate: { sort: "asc", nulls: "last" } }]
      : query.sort === "number-asc"
        ? [{ inspectionNumber: "asc" }]
        : [{ updatedAt: "desc" }];

  const [rows, total, failedCounts] = await Promise.all([
    prisma.hseInspection.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.hseInspection.count({ where }),
    // One grouped query for every row's failed-item count, rather than one
    // query per row (PRD #22 §420).
    prisma.hseInspectionChecklistItem.groupBy({
      by: ["inspectionId"],
      where: { inspection: where, result: "FAIL" },
      _count: { _all: true },
    }),
  ]);

  const failed = new Map(failedCounts.map((row) => [row.inspectionId, row._count._all]));
  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedInspectorMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members, failed.get(row.id) ?? 0)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getInspection(
  context: UserContext,
  inspectionId: string,
): Promise<InspectionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.view");

  const row = assertFound(
    await prisma.hseInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, hazards, actions, pending] = await Promise.all([
    loadMembers(context.companyId, [
      row.assignedInspectorMemberId,
      row.executedByMemberId,
      row.approvedByMemberId,
      row.rejectedByMemberId,
    ]),
    loadMemberRef(context.companyId, row.createdByMemberId),
    can(context, "hse.hazard.view")
      ? import("../hazards/hazard.service").then((m) =>
          m.listForInspection(context, inspectionId),
        )
      : Promise.resolve([]),
    can(context, "hse.action.view")
      ? import("../actions/action.service").then((m) =>
          m.listForParent(context, { inspectionId }),
        )
      : Promise.resolve([]),
    approvals.pendingFor(context, "INSPECTION", inspectionId),
  ]);

  const answers = toAnswers(row.checklistItems);
  const failedCount = row.checklistItems.filter((item) => item.result === "FAIL").length;

  return {
    ...toSummaryDTO(row, members, failedCount),
    template: row.template,
    summary: row.summary,
    decisionNote: row.decisionNote,
    executedBy: row.executedByMemberId ? (members.get(row.executedByMemberId) ?? null) : null,
    submittedAt: dateString(row.submittedAt),
    approvedBy: row.approvedByMemberId ? (members.get(row.approvedByMemberId) ?? null) : null,
    approvedAt: dateString(row.approvedAt),
    rejectedBy: row.rejectedByMemberId ? (members.get(row.rejectedByMemberId) ?? null) : null,
    rejectedAt: dateString(row.rejectedAt),
    closedAt: dateString(row.closedAt),
    cancelledAt: dateString(row.cancelledAt),
    checklistItems: row.checklistItems,
    gaps: checklistGaps(answers),
    allowedResults: allowedOverallResults(answers),
    hazards,
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
): Promise<InspectionSummaryDTO[]> {
  if (!can(context, "hse.inspection.view")) return [];

  const rows = await prisma.hseInspection.findMany({
    where: { AND: [buildInspectionScopeWhere(context), { projectId }] },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedInspectorMemberId));
  return rows.map((row) => toSummaryDTO(row, members, 0));
}

export async function inspectionFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.view");

  const scope = buildInspectionScopeWhere(context);

  const [projects, inspectors] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [buildHseProjectWhere(context), { hseInspections: { some: scope } }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, assignedHseInspections: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, inspectors };
}

export async function inspectionFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members, templates] = await Promise.all([
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
    prisma.hseInspectionTemplate.findMany({
      where: { AND: [buildTemplateScopeWhere(context), { status: "ACTIVE" }] },
      select: { id: true, code: true, name: true, inspectionType: true, version: true },
      orderBy: [{ inspectionType: "asc" }, { code: "asc" }],
    }),
  ]);

  return { projects, members, templates };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Raises an inspection and freezes its checklist (PRD #22 §39, §47).
 *
 * The template's items are copied onto the inspection here and never read
 * through a join again. That copy is the whole reason a safety record can be
 * trusted a year later.
 */
export async function createInspection(
  context: UserContext,
  input: InspectionInput,
): Promise<InspectionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.create");

  if (input.projectId) await requireProject(context, input.projectId);
  await requireMember(context, input.assignedInspectorMemberId);
  const template = input.templateId ? await requireTemplate(context, input.templateId) : null;

  const id = await prisma.$transaction(async (tx) => {
    const inspectionNumber = await nextHseNumber(tx, "hseInspection", context.companyId);

    const inspection = await tx.hseInspection.create({
      data: {
        companyId: context.companyId,
        inspectionNumber,
        inspectionType: input.inspectionType,
        projectId: input.projectId ?? null,
        templateId: template?.id ?? null,
        templateVersion: template?.version ?? null,
        assignedInspectorMemberId: input.assignedInspectorMemberId,
        status: input.scheduledDate ? "SCHEDULED" : "DRAFT",
        result: "NOT_SET",
        scheduledDate: input.scheduledDate ?? null,
        locationText: input.locationText ?? null,
        summary: input.summary ?? null,
        createdByMemberId: context.membershipId,
        checklistItems: template
          ? {
              create: template.items.map((item) => ({
                templateItemId: item.id,
                code: item.code,
                label: item.label,
                description: item.description,
                responseType: item.responseType,
                required: item.required,
                sortOrder: item.sortOrder,
                riskIfFailed: item.riskIfFailed,
                requiresNoteOnFail: item.requiresNoteOnFail,
              })),
            }
          : undefined,
      },
      select: { id: true, inspectionNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspection.id,
      action: input.scheduledDate ? "HSE_INSPECTION_SCHEDULED" : "HSE_INSPECTION_CREATED",
      message: `raised safety inspection ${inspection.inspectionNumber}`,
    });

    return inspection.id;
  });

  return getInspection(context, id);
}

export async function updateInspection(
  context: UserContext,
  inspectionId: string,
  input: InspectionInput,
): Promise<InspectionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.create");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionEditable(existing.status)) {
    throw new AccessError("CONFLICT", "This inspection has already started.", {
      code: "INSPECTION_STARTED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  if (input.projectId) await requireProject(context, input.projectId);
  await requireMember(context, input.assignedInspectorMemberId);

  // Changing the inspector is `assign`, not `create` (PRD #47 §85).
  if (input.assignedInspectorMemberId !== existing.assignedInspectorMemberId) {
    assertPermission(context, "hse.inspection.assign");
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseInspection.update({
      where: { id: inspectionId },
      data: {
        inspectionType: input.inspectionType,
        projectId: input.projectId ?? null,
        assignedInspectorMemberId: input.assignedInspectorMemberId,
        status: input.scheduledDate ? "SCHEDULED" : existing.status,
        scheduledDate: input.scheduledDate ?? null,
        locationText: input.locationText ?? null,
        summary: input.summary ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "HSE_INSPECTION_CREATED",
      message: `updated safety inspection ${existing.inspectionNumber}`,
    });
  });

  return getInspection(context, inspectionId);
}

export async function assignInspection(
  context: UserContext,
  inspectionId: string,
  memberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.assign");

  const existing = await requireInspection(context, inspectionId);

  if (existing.status === "CLOSED" || existing.status === "CANCELLED") {
    throw new AccessError("CONFLICT", "This inspection is finished.", { code: "FINISHED" });
  }

  const member = await requireMember(context, memberId);

  await prisma.$transaction(async (tx) => {
    await tx.hseInspection.update({
      where: { id: inspectionId },
      data: { assignedInspectorMemberId: member.id, updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "HSE_INSPECTION_SCHEDULED",
      message: `assigned safety inspection ${existing.inspectionNumber}`,
      metadata: { memberId: member.id } as Prisma.InputJsonValue,
    });
  });
}

/** Starting the walk-round (PRD #22 §50, §54). */
export async function startInspection(
  context: UserContext,
  inspectionId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.execute");

  const existing = await requireInspection(context, inspectionId);

  if (!canStartInspection(existing.status)) {
    throw new AccessError("CONFLICT", "This inspection cannot be started now.", {
      code: "NOT_STARTABLE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: hseInspectionMachine,
      action: "start",
      id: inspectionId,
      context,
      from: existing.status,
      data: {
        executedByMemberId: context.membershipId,
        inspectionDate: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "HSE_INSPECTION_STARTED",
      message: `started safety inspection ${existing.inspectionNumber}`,
    });
  });
}

/**
 * Answering the checklist (PRD #22 §41, §46).
 *
 * Saved a row at a time as the inspector walks, so a phone that loses signal
 * halfway round has not lost the first half. Nothing is validated for
 * completeness here — that happens on submit, because an inspection in progress
 * is *meant* to be incomplete.
 */
export async function executeInspection(
  context: UserContext,
  inspectionId: string,
  input: ExecuteInspectionInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.execute");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionExecutable(existing.status)) {
    throw new AccessError("CONFLICT", "This inspection is not in progress.", {
      code: "NOT_IN_PROGRESS",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const items = await prisma.hseInspectionChecklistItem.findMany({
    where: { inspectionId },
    select: { id: true, responseType: true },
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const answer of input.answers) {
    const item = byId.get(answer.itemId);
    if (!item) {
      throw new AccessError("VALIDATION_ERROR", "That checklist item is not on this inspection.", {
        code: "UNKNOWN_ITEM",
      });
    }

    // A PASS_FAIL question cannot be answered N/A: the template said this one
    // always applies (PRD #22 §46).
    if (answer.result && !allowedChecklistResults(item.responseType).includes(answer.result)) {
      throw new AccessError("VALIDATION_ERROR", "That answer is not valid for this question.", {
        code: "INVALID_RESULT",
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const answer of input.answers) {
      await tx.hseInspectionChecklistItem.update({
        where: { id: answer.itemId },
        data: {
          result: answer.result ?? null,
          responseValue: answer.responseValue ?? null,
          note: answer.note ?? null,
        },
      });
    }

    await tx.hseInspection.update({
      where: { id: inspectionId },
      data: { executedByMemberId: context.membershipId, updatedByMemberId: context.membershipId },
    });
  });
}

/**
 * Handing the inspection in (PRD #22 §51).
 *
 * Everything required has to be answered, every failure that asked for a note
 * has to have one, and the overall result has to be one the answers can support
 * — a required item failed means PASS is not on the table (PRD #22 §49).
 */
export async function submitInspection(
  context: UserContext,
  inspectionId: string,
  input: SubmitInspectionInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.submit");

  const existing = assertFound(
    await prisma.hseInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        updatedAt: true,
        checklistItems: {
          select: {
            label: true,
            required: true,
            responseType: true,
            result: true,
            responseValue: true,
            note: true,
            requiresNoteOnFail: true,
          },
        },
      },
    }),
  );

  if (!isInspectionSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", "This inspection is not in progress.", {
      code: "NOT_IN_PROGRESS",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const answers = toAnswers(existing.checklistItems);

  const gaps = checklistGaps(answers);
  if (gaps.length > 0) {
    throw new AccessError("VALIDATION_ERROR", "The checklist is not finished.", {
      code: "CHECKLIST_INCOMPLETE",
      gaps,
    });
  }

  if (!allowedOverallResults(answers).includes(input.result)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "A required item failed, so this inspection cannot pass.",
      { code: "RESULT_NOT_ALLOWED" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: hseInspectionMachine,
      action: "submit",
      id: inspectionId,
      context,
      from: existing.status,
      data: {
        result: input.result,
        summary: input.summary ?? null,
        inspectionDate: input.inspectionDate ?? new Date(),
        submittedAt: new Date(),
        executedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    await approvals.openApproval(tx, context, "INSPECTION", inspectionId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "HSE_INSPECTION_SUBMITTED",
      message: `submitted safety inspection ${existing.inspectionNumber} as ${input.result.toLowerCase()}`,
    });
  });
}

export async function approveInspection(
  context: UserContext,
  inspectionId: string,
  decisionNote: string | null,
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "INSPECTION");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionDecidable(existing.status)) {
    throw new AccessError("CONFLICT", "This inspection is not waiting for a decision.", {
      code: "NOT_PENDING",
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "INSPECTION", inspectionId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId, existing.executedByMemberId);

    await approvals.decideApproval(tx, context, approval.id, "APPROVED", decisionNote);

    await applyTransition(tx, {
      machine: hseInspectionMachine,
      action: "approve",
      id: inspectionId,
      context,
      from: existing.status,
      data: {
        approvedAt: new Date(),
        approvedByMemberId: context.membershipId,
        decisionNote,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "HSE_INSPECTION_APPROVED",
      message: `approved safety inspection ${existing.inspectionNumber}`,
    });
  });
}

export async function rejectInspection(
  context: UserContext,
  inspectionId: string,
  decisionNote: string,
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  // The dialog asks for a reason; so does the service behind it (AUD-10 §4, A13).
  requireDecisionNote(decisionNote);
  approvals.assertCanReject(context, "INSPECTION");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionDecidable(existing.status)) {
    throw new AccessError("CONFLICT", "This inspection is not waiting for a decision.", {
      code: "NOT_PENDING",
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "INSPECTION", inspectionId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId, existing.executedByMemberId);

    await approvals.decideApproval(tx, context, approval.id, "REJECTED", decisionNote);

    await applyTransition(tx, {
      machine: hseInspectionMachine,
      action: "reject",
      id: inspectionId,
      context,
      from: existing.status,
      data: {
        rejectedAt: new Date(),
        rejectedByMemberId: context.membershipId,
        decisionNote,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "HSE_INSPECTION_REJECTED",
      message: `sent safety inspection ${existing.inspectionNumber} back`,
    });
  });
}

/**
 * Closing out (PRD #22 §55).
 *
 * A PASS closes on its own. A FAIL or a CONDITIONAL says something was wrong, so
 * closing it needs a hazard, an action or a written disposition — otherwise
 * "closed" means "we stopped talking about it".
 */
export async function closeInspection(
  context: UserContext,
  inspectionId: string,
  disposition: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.close");

  const existing = assertFound(
    await prisma.hseInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        result: true,
        // A follow-up counts only if it is this company's (PRD #47 §20).
        _count: {
          select: {
            hazards: { where: { companyId: context.companyId } },
            actions: { where: { companyId: context.companyId } },
          },
        },
      },
    }),
  );

  if (!isInspectionClosable(existing.status)) {
    throw new AccessError("CONFLICT", "An inspection is closed once it has been approved.", {
      code: "NOT_APPROVED",
    });
  }

  if (closureNeedsDisposition(existing.result)) {
    const hasFollowUp =
      existing._count.hazards > 0 ||
      existing._count.actions > 0 ||
      (disposition ?? "").trim().length > 0;

    if (!hasFollowUp) {
      throw new AccessError(
        "VALIDATION_ERROR",
        "This inspection did not pass. Raise a hazard or an action, or write down how it was dealt with.",
        { code: "NEEDS_DISPOSITION" },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: hseInspectionMachine,
      action: "close",
      id: inspectionId,
      context,
      from: existing.status,
      data: {
        closedAt: new Date(),
        closedByMemberId: context.membershipId,
        decisionNote: disposition ?? undefined,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "HSE_INSPECTION_CLOSED",
      message: `closed safety inspection ${existing.inspectionNumber}`,
    });
  });
}

export async function cancelInspection(
  context: UserContext,
  inspectionId: string,
  reason: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.inspection.cancel");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This inspection has gone too far to cancel.", {
      code: "NOT_CANCELLABLE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await approvals.cancelPendingApprovals(tx, context, "INSPECTION", inspectionId);

    await applyTransition(tx, {
      machine: hseInspectionMachine,
      action: "cancel",
      id: inspectionId,
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
      entityId: inspectionId,
      action: "HSE_INSPECTION_CANCELLED",
      message: `cancelled safety inspection ${existing.inspectionNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function toAnswers(
  items: {
    label: string;
    required: boolean;
    responseType: ChecklistAnswer["responseType"];
    result: ChecklistAnswer["result"];
    responseValue: string | null;
    note: string | null;
    requiresNoteOnFail: boolean;
  }[],
): ChecklistAnswer[] {
  return items.map((item) => ({
    label: item.label,
    required: item.required,
    responseType: item.responseType,
    result: item.result,
    responseValue: item.responseValue,
    note: item.note,
    requiresNoteOnFail: item.requiresNoteOnFail,
  }));
}

async function requireInspection(context: UserContext, inspectionId: string) {
  return assertFound(
    await prisma.hseInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        assignedInspectorMemberId: true,
        executedByMemberId: true,
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

async function requireTemplate(context: UserContext, templateId: string) {
  const template = await prisma.hseInspectionTemplate.findFirst({
    where: { AND: [buildTemplateScopeWhere(context), { id: templateId, status: "ACTIVE" }] },
    select: {
      id: true,
      version: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          code: true,
          label: true,
          description: true,
          responseType: true,
          required: true,
          sortOrder: true,
          riskIfFailed: true,
          requiresNoteOnFail: true,
        },
      },
    },
  });

  if (!template) {
    throw new AccessError("VALIDATION_ERROR", "That checklist is not available.", {
      code: "INVALID_TEMPLATE",
    });
  }

  return template;
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this inspection while you were working. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
  failedItemCount: number,
): InspectionSummaryDTO {
  return {
    id: row.id,
    inspectionNumber: row.inspectionNumber,
    inspectionType: row.inspectionType,
    status: row.status,
    result: row.result,
    project: toProjectRef(row.project),
    assignedInspector: members.get(row.assignedInspectorMemberId) ?? null,
    scheduledDate: dateString(row.scheduledDate),
    inspectionDate: dateString(row.inspectionDate),
    locationText: row.locationText,
    failedItemCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  row: DetailRow,
  submittedByMemberId: string | null,
) {
  // Withheld from whoever submitted it, so nobody is offered a button that is
  // certain to fail (PRD #22 §52, §182).
  const notSelf = !approvals.isSelfDecision(context, submittedByMemberId, row.executedByMemberId);

  return {
    canEdit: isInspectionEditable(row.status) && can(context, "hse.inspection.create"),
    canAssign:
      row.status !== "CLOSED" &&
      row.status !== "CANCELLED" &&
      can(context, "hse.inspection.assign"),
    canStart: canStartInspection(row.status) && can(context, "hse.inspection.execute"),
    canExecute: isInspectionExecutable(row.status) && can(context, "hse.inspection.execute"),
    canSubmit: isInspectionSubmittable(row.status) && can(context, "hse.inspection.submit"),
    canApprove:
      isInspectionDecidable(row.status) && can(context, "hse.inspection.approve") && notSelf,
    canReject:
      isInspectionDecidable(row.status) && can(context, "hse.inspection.reject") && notSelf,
    canClose: isInspectionClosable(row.status) && can(context, "hse.inspection.close"),
    canCancel: isInspectionCancellable(row.status) && can(context, "hse.inspection.cancel"),
    canRaiseHazard: can(context, "hse.hazard.create"),
    canRaiseAction: can(context, "hse.action.create"),
    canViewDocuments: can(context, "hse.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "hse.activity.view"),
  };
}
