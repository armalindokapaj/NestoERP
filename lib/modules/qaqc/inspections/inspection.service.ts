import { Prisma, type QualityInspectionStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import {
  dateString,
  loadMemberRef,
  loadMembers,
  procurementLink,
  toProjectRef,
} from "../qaqc.dto";
import { nextQualityNumber } from "../qaqc.numbering";
import {
  buildInspectionScopeWhere,
  buildQaqcMemberWhere,
  buildQaqcProjectWhere,
} from "../qaqc.scope";
import type {
  ChecklistInput,
  InspectionInput,
  InspectionListQuery,
  ReinspectionInput,
  SubmitInspectionInput,
} from "../qaqc.schema";
import {
  allowedOverallResults,
  checklistProblems,
  closesWithoutFollowUp,
  hasQualityEffect,
  isInspectionCancellable,
  isInspectionCloseable,
  isInspectionDecidable,
  isInspectionEditable,
  isInspectionExecutable,
  isInspectionReopenable,
  isInspectionReworkable,
  isInspectionSubmittable,
  isVerdictResponse,
} from "../qaqc.status";
import type {
  ChecklistItemDTO,
  InspectionDetailDTO,
  InspectionSummaryDTO,
} from "../qaqc.types";
import { syncRequestStatus } from "../requests/request.service";

/**
 * Quality inspections (PRD #21 §59–§88).
 *
 * The act of looking, and its verdict. Four rules shape this file:
 *
 *   1. **Status and result are different things** (PRD #21 §65). An inspection
 *      at PENDING_APPROVAL with a result of FAIL is an ordinary, important
 *      state: the inspector finished and found a problem, and somebody still
 *      has to sign it off.
 *   2. **The checklist is a snapshot** (PRD #21 §69). Template items are copied
 *      onto the inspection when it is created, so editing the template later
 *      never rewrites what somebody actually checked.
 *   3. **Nobody approves their own** (PRD #21 §165). Enforced in the approval
 *      service, and mirrored in the capabilities so the button is absent rather
 *      than merely refused.
 *   4. **A closed inspection stays closed** (PRD #21 §88). Looking again means
 *      a reinspection — a new record with its own verdict, linked to the old
 *      one — not an edit to a signed result.
 */

const MODULE = "qaqc" as const;
const ENTITY = "QualityInspection";

const LIST_SELECT = {
  id: true,
  inspectionNumber: true,
  inspectionType: true,
  status: true,
  result: true,
  assignedInspectorMemberId: true,
  inspectionDate: true,
  reinspectionSequence: true,
  parentInspectionId: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  template: { select: { name: true } },
} satisfies Prisma.QualityInspectionSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  templateId: true,
  templateVersion: true,
  requestId: true,
  projectId: true,
  goodsReceiptId: true,
  goodsReceiptItemId: true,
  executedByMemberId: true,
  locationText: true,
  workReference: true,
  drawingReference: true,
  specificationReference: true,
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
  request: { select: { requestNumber: true } },
  goodsReceipt: { select: { id: true, receiptNumber: true, purchaseOrderId: true } },
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
      passCriteriaText: true,
      requiresEvidenceOnFail: true,
    },
  },
} satisfies Prisma.QualityInspectionSelect;

type ListRow = Prisma.QualityInspectionGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.QualityInspectionGetPayload<{ select: typeof DETAIL_SELECT }>;

const OPEN_STATUSES: QualityInspectionStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "PENDING_APPROVAL",
  "REJECTED",
];

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listInspections(
  context: UserContext,
  query: InspectionListQuery & { requestId?: string },
) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.view");

  const filters: Prisma.QualityInspectionWhereInput[] = [buildInspectionScopeWhere(context)];

  if (query.view === "open") filters.push({ status: { in: OPEN_STATUSES } });
  if (query.view === "awaiting-approval") filters.push({ status: "PENDING_APPROVAL" });
  if (query.view === "mine") {
    filters.push({
      OR: [
        { assignedInspectorMemberId: context.membershipId },
        { executedByMemberId: context.membershipId },
      ],
    });
  }
  if (query.view === "reinspections") filters.push({ parentInspectionId: { not: null } });

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.result?.length) filters.push({ result: { in: query.result } });
  if (query.inspectionType?.length) {
    filters.push({ inspectionType: { in: query.inspectionType } });
  }
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.goodsReceiptId) filters.push({ goodsReceiptId: query.goodsReceiptId });
  if (query.requestId) filters.push({ requestId: query.requestId });
  if (query.assignedInspectorMemberId) {
    filters.push({ assignedInspectorMemberId: query.assignedInspectorMemberId });
  }

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { inspectionNumber: { contains: term, mode: "insensitive" } },
        { summary: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
        { workReference: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.QualityInspectionWhereInput = { AND: filters };

  const orderBy: Prisma.QualityInspectionOrderByWithRelationInput[] =
    query.sort === "date-desc"
      ? [{ inspectionDate: { sort: "desc", nulls: "last" } }]
      : query.sort === "date-asc"
        ? [{ inspectionDate: { sort: "asc", nulls: "last" } }]
        : query.sort === "number-asc"
          ? [{ inspectionNumber: "asc" }]
          : query.sort === "updated-desc"
            ? [{ updatedAt: "desc" }]
            : [{ createdAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.qualityInspection.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.qualityInspection.count({ where }),
  ]);

  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedInspectorMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getInspection(
  context: UserContext,
  inspectionId: string,
): Promise<InspectionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.view");

  const row = assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: DETAIL_SELECT,
    }),
  );

  const { materialDecisions, release } = await import("../materials/material.service").then(
    async (materials) => ({
      materialDecisions: await materials.listDecisions(context, inspectionId),
      release: await materials.getRelease(context, inspectionId),
    }),
  );

  const [members, createdBy, pending, related, reinspections] = await Promise.all([
    loadMembers(context.companyId, [
      row.assignedInspectorMemberId,
      row.executedByMemberId,
      row.approvedByMemberId,
      row.rejectedByMemberId,
    ]),
    loadMemberRef(context.companyId, row.createdByMemberId),
    approvals.pendingFor(context, "INSPECTION", inspectionId),
    loadRelated(context, inspectionId),
    listReinspections(context, inspectionId),
  ]);

  const checklist = row.checklistItems.map(toChecklistDTO);
  const answers = row.checklistItems.map((item) => ({
    required: item.required,
    responseType: item.responseType,
    result: item.result,
    responseValue: item.responseValue,
    note: item.note,
    requiresEvidenceOnFail: item.requiresEvidenceOnFail,
    label: item.label,
  }));

  return {
    ...toSummaryDTO(row, members),
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    requestId: row.requestId,
    requestNumber: row.request?.requestNumber ?? null,
    locationText: row.locationText,
    workReference: row.workReference,
    drawingReference: row.drawingReference,
    specificationReference: row.specificationReference,
    summary: row.summary,
    decisionNote: row.decisionNote,
    source: procurementLink(context, row.goodsReceipt),
    checklist,
    blockers: checklistProblems(answers).map(describeProblem),
    allowedResults: allowedOverallResults(answers),
    materialDecisions,
    release,
    defects: related.defects,
    ncrs: related.ncrs,
    correctiveActions: related.actions,
    reinspections,
    executedBy: row.executedByMemberId ? (members.get(row.executedByMemberId) ?? null) : null,
    submittedAt: dateString(row.submittedAt),
    approvedBy: row.approvedByMemberId ? (members.get(row.approvedByMemberId) ?? null) : null,
    approvedAt: dateString(row.approvedAt),
    rejectedBy: row.rejectedByMemberId ? (members.get(row.rejectedByMemberId) ?? null) : null,
    rejectedAt: dateString(row.rejectedAt),
    closedAt: dateString(row.closedAt),
    cancelledAt: dateString(row.cancelledAt),
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row, {
      pendingSubmitter: pending?.submittedByMemberId ?? null,
      hasFollowUp:
        related.defects.length > 0 ||
        related.ncrs.length > 0 ||
        related.actions.length > 0,
      hasDecisionNote: (row.decisionNote ?? "").trim() !== "",
      releaseExists: release !== null,
    }),
  };
}

async function listReinspections(
  context: UserContext,
  parentInspectionId: string,
): Promise<InspectionSummaryDTO[]> {
  const rows = await prisma.qualityInspection.findMany({
    where: { AND: [buildInspectionScopeWhere(context), { parentInspectionId }] },
    orderBy: { reinspectionSequence: "asc" },
    select: LIST_SELECT,
  });

  const members = await loadMembers(context.companyId, rows.map((row) => row.assignedInspectorMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

async function loadRelated(context: UserContext, inspectionId: string) {
  const [defects, ncrs, actions] = await Promise.all([
    can(context, "qaqc.defect.view")
      ? import("../defects/defect.service").then((m) => m.listForInspection(context, inspectionId))
      : Promise.resolve([]),
    can(context, "qaqc.ncr.view")
      ? import("../ncrs/ncr.service").then((m) => m.listForInspection(context, inspectionId))
      : Promise.resolve([]),
    can(context, "qaqc.corrective_action.view")
      ? import("../corrective-actions/action.service").then((m) =>
          m.listForParent(context, { inspectionId }),
        )
      : Promise.resolve([]),
  ]);

  return { defects, ncrs, actions };
}

export async function inspectionFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.view");

  const scope = buildInspectionScopeWhere(context);

  const [projects, inspectors] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [buildQaqcProjectWhere(context), { qualityInspections: { some: scope } }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, assignedInspections: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, inspectors };
}

export async function inspectionFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members, templates, receipts, requests] = await Promise.all([
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
    import("../templates/template.service").then((m) => m.selectableTemplates(context)),
    can(context, "qaqc.material.view")
      ? prisma.goodsReceipt.findMany({
          where: { companyId: context.companyId, status: "RECORDED" },
          select: {
            id: true,
            receiptNumber: true,
            supplier: { select: { name: true } },
          },
          orderBy: { receiptDate: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
    can(context, "qaqc.request.view")
      ? prisma.inspectionRequest.findMany({
          where: {
            companyId: context.companyId,
            status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] },
          },
          select: {
            id: true,
            requestNumber: true,
            title: true,
            inspectionType: true,
            projectId: true,
            goodsReceiptId: true,
            assignedInspectorMemberId: true,
            locationText: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  return { projects, members, templates, receipts, requests };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createInspection(
  context: UserContext,
  input: InspectionInput,
): Promise<InspectionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.create");

  const projectId = input.projectId ? (await requireProject(context, input.projectId)).id : null;
  const inspector = await requireMember(context, input.assignedInspectorMemberId);
  const receipt = input.goodsReceiptId
    ? await requireGoodsReceipt(context, input.goodsReceiptId)
    : null;

  const template = input.templateId ? await requireTemplate(context, input.templateId) : null;

  const id = await prisma.$transaction(async (tx) => {
    const inspectionNumber = await nextQualityNumber(
      tx,
      "qualityInspection",
      context.companyId,
    );

    const inspection = await tx.qualityInspection.create({
      data: {
        companyId: context.companyId,
        inspectionNumber,
        inspectionType: input.inspectionType,
        requestId: input.requestId ?? null,
        templateId: template?.id ?? null,
        templateVersion: template?.version ?? null,
        projectId,
        goodsReceiptId: receipt?.id ?? null,
        goodsReceiptItemId: input.goodsReceiptItemId ?? null,
        assignedInspectorMemberId: inspector.id,
        status: "DRAFT",
        result: "NOT_SET",
        inspectionDate: input.inspectionDate ?? null,
        locationText: input.locationText ?? null,
        workReference: input.workReference ?? null,
        drawingReference: input.drawingReference ?? null,
        specificationReference: input.specificationReference ?? null,
        summary: input.summary ?? null,
        createdByMemberId: context.membershipId,
        /*
         * The checklist is copied, not referenced (PRD #21 §69). Editing the
         * template afterwards must never rewrite what somebody checked.
         */
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
                passCriteriaText: item.passCriteriaText,
                requiresEvidenceOnFail: item.requiresEvidenceOnFail,
              })),
            }
          : undefined,
      },
      select: { id: true, inspectionNumber: true },
    });

    if (input.requestId) await syncRequestStatus(tx, context, input.requestId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspection.id,
      action: "QAQC_INSPECTION_CREATED",
      message: `created inspection ${inspection.inspectionNumber}`,
    });

    // The inspector hears it is theirs (PRD #38 §74).
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.QA_INSPECTION_REQUIRED,
      moduleKey: MODULE,
      entityType: "quality_inspection",
      entityId: inspection.id,
      actorMemberId: context.membershipId,
      projectId: projectId,
      payload: {
        inspectorMemberId: inspector.id,
        inspectionNumber: inspection.inspectionNumber,
        scheduledDate: input.inspectionDate ? new Date(input.inspectionDate).toISOString().slice(0, 10) : null,
      },
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
  assertPermission(context, "qaqc.inspection.update_draft");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "This inspection has already started, so its header cannot be changed.",
      { code: "INSPECTION_LOCKED" },
    );
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const projectId = input.projectId ? (await requireProject(context, input.projectId)).id : null;
  const inspector = await requireMember(context, input.assignedInspectorMemberId);
  const receipt = input.goodsReceiptId
    ? await requireGoodsReceipt(context, input.goodsReceiptId)
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.qualityInspection.update({
      where: { id: inspectionId },
      data: {
        inspectionType: input.inspectionType,
        projectId,
        goodsReceiptId: receipt?.id ?? null,
        goodsReceiptItemId: input.goodsReceiptItemId ?? null,
        assignedInspectorMemberId: inspector.id,
        inspectionDate: input.inspectionDate ?? null,
        locationText: input.locationText ?? null,
        workReference: input.workReference ?? null,
        drawingReference: input.drawingReference ?? null,
        specificationReference: input.specificationReference ?? null,
        summary: input.summary ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    if (inspector.id !== existing.assignedInspectorMemberId) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.QA_INSPECTION_REQUIRED,
        moduleKey: MODULE,
        entityType: "quality_inspection",
        entityId: inspectionId,
        actorMemberId: context.membershipId,
        projectId,
        payload: { inspectorMemberId: inspector.id, inspectionNumber: existing.inspectionNumber },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_INSPECTION_UPDATED",
      message: `updated inspection ${existing.inspectionNumber}`,
    });
  });

  return getInspection(context, inspectionId);
}

/** Assigning the work to a different inspector (PRD #21 §74). */
export async function assignInspection(
  context: UserContext,
  inspectionId: string,
  memberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.assign");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionExecutable(existing.status)) {
    throw new AccessError("CONFLICT", "This inspection can no longer be reassigned.", {
      code: "INSPECTION_LOCKED",
    });
  }

  const member = await requireMember(context, memberId);

  await prisma.$transaction(async (tx) => {
    await tx.qualityInspection.update({
      where: { id: inspectionId },
      data: {
        assignedInspectorMemberId: member.id,
        updatedByMemberId: context.membershipId,
      },
    });

    if (member.id !== existing.assignedInspectorMemberId) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.QA_INSPECTION_REQUIRED,
        moduleKey: MODULE,
        entityType: "quality_inspection",
        entityId: inspectionId,
        actorMemberId: context.membershipId,
        payload: { inspectorMemberId: member.id, inspectionNumber: existing.inspectionNumber },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_INSPECTION_ASSIGNED",
      message: `assigned inspection ${existing.inspectionNumber}`,
      metadata: { memberId: member.id } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Recording answers on the checklist (PRD #21 §71, §72, §73).
 *
 * Saving answers moves a DRAFT to IN_PROGRESS, because an inspection somebody
 * has started writing on is under way whether or not they said so.
 */
export async function saveChecklist(
  context: UserContext,
  inspectionId: string,
  input: ChecklistInput,
): Promise<InspectionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.execute");

  const existing = assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        assignedInspectorMemberId: true,
        checklistItems: { select: { id: true, responseType: true } },
      },
    }),
  );

  if (!isInspectionExecutable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "This inspection has been submitted, so its answers can no longer be changed.",
      { code: "INSPECTION_SUBMITTED" },
    );
  }

  assertMayExecute(context, existing.assignedInspectorMemberId);

  const known = new Map(existing.checklistItems.map((item) => [item.id, item.responseType]));

  await prisma.$transaction(async (tx) => {
    for (const answer of input.answers) {
      const responseType = known.get(answer.itemId);
      // An answer for an item that is not on this inspection is dropped rather
      // than written: the checklist is the snapshot, and nothing adds to it.
      if (!responseType) continue;

      await tx.inspectionChecklistItem.update({
        where: { id: answer.itemId },
        data: {
          result: isVerdictResponse(responseType) ? (answer.result ?? null) : null,
          responseValue: isVerdictResponse(responseType) ? null : (answer.responseValue ?? null),
          note: answer.note ?? null,
        },
      });
    }

    if (existing.status === "DRAFT") {
      await tx.qualityInspection.update({
        where: { id: inspectionId },
        data: {
          status: "IN_PROGRESS",
          executedByMemberId: context.membershipId,
          inspectionDate: new Date(),
          updatedByMemberId: context.membershipId,
        },
      });

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: inspectionId,
        action: "QAQC_INSPECTION_STARTED",
        message: `started inspection ${existing.inspectionNumber}`,
      });
    } else {
      await tx.qualityInspection.update({
        where: { id: inspectionId },
        data: { executedByMemberId: context.membershipId, updatedByMemberId: context.membershipId },
      });
    }
  });

  return getInspection(context, inspectionId);
}

/**
 * Finishing an inspection and sending it for approval (PRD #21 §75–§79).
 *
 * Three things are checked, in this order: every required item answered, every
 * failure explained, and the overall verdict consistent with the answers. A
 * required item that failed makes an overall PASS impossible (§77).
 */
export async function submitInspection(
  context: UserContext,
  inspectionId: string,
  input: SubmitInspectionInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.submit");

  const existing = assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        requestId: true,
        assignedInspectorMemberId: true,
        checklistItems: {
          select: {
            label: true,
            required: true,
            responseType: true,
            result: true,
            responseValue: true,
            note: true,
            requiresEvidenceOnFail: true,
          },
        },
      },
    }),
  );

  if (!isInspectionSubmittable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "Only an inspection that is under way can be submitted.",
      { code: "INSPECTION_NOT_IN_PROGRESS" },
    );
  }

  assertMayExecute(context, existing.assignedInspectorMemberId);

  const problems = checklistProblems(existing.checklistItems);
  if (problems.length > 0) {
    throw new AccessError("VALIDATION_ERROR", problems.map(describeProblem).join(" "), {
      code: "CHECKLIST_INCOMPLETE",
    });
  }

  const allowed = allowedOverallResults(existing.checklistItems);
  if (!allowed.includes(input.result)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "A required check failed, so this inspection cannot be recorded as a pass.",
      { code: "RESULT_INCONSISTENT" },
    );
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.qualityInspection.updateMany({
      where: { id: inspectionId, status: "IN_PROGRESS" },
      data: {
        status: "PENDING_APPROVAL",
        result: input.result,
        summary: input.summary ?? undefined,
        decisionNote: input.decisionNote ?? null,
        submittedAt: new Date(),
        executedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    if (updated.count === 0) {
      throw new AccessError("CONFLICT", "Somebody else has already submitted this.", {
        code: "ALREADY_SUBMITTED",
      });
    }

    await approvals.openApproval(tx, context, "INSPECTION", inspectionId);
    if (existing.requestId) await syncRequestStatus(tx, context, existing.requestId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_INSPECTION_SUBMITTED",
      message: `submitted inspection ${existing.inspectionNumber} as ${input.result.toLowerCase()}`,
      metadata: { result: input.result } as Prisma.InputJsonValue,
    });
  });
}

export async function approveInspection(
  context: UserContext,
  inspectionId: string,
  note: string | null,
  guard?: ApprovalGuard,
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
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    const updated = await tx.qualityInspection.updateMany({
      where: { id: inspectionId, status: "PENDING_APPROVAL" },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByMemberId: context.membershipId,
        rejectedAt: null,
        rejectedByMemberId: null,
        updatedByMemberId: context.membershipId,
      },
    });

    if (updated.count === 0) {
      throw new AccessError("CONFLICT", "That decision has already been made.", {
        code: "ALREADY_DECIDED",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_INSPECTION_APPROVED",
      message: `approved inspection ${existing.inspectionNumber}`,
    });
  });
}

export async function rejectInspection(
  context: UserContext,
  inspectionId: string,
  note: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "INSPECTION");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionDecidable(existing.status)) {
    throw new AccessError("CONFLICT", "This inspection is not waiting for a decision.", {
      code: "NOT_PENDING",
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "INSPECTION", inspectionId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", note);

    const updated = await tx.qualityInspection.updateMany({
      where: { id: inspectionId, status: "PENDING_APPROVAL" },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    if (updated.count === 0) {
      throw new AccessError("CONFLICT", "That decision has already been made.", {
        code: "ALREADY_DECIDED",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_INSPECTION_REJECTED",
      message: `rejected inspection ${existing.inspectionNumber}`,
      metadata: { note } as Prisma.InputJsonValue,
    });
  });
}

/** Sending a rejected inspection back to be redone (PRD #21 §82). */
export async function reworkInspection(
  context: UserContext,
  inspectionId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.execute");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionReworkable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a rejected inspection can be reworked.", {
      code: "NOT_REJECTED",
    });
  }

  await prisma.$transaction(async (tx) => {
    // The rejection stays on the record: rework does not erase who said no
    // and why (PRD #21 §82).
    await tx.qualityInspection.update({
      where: { id: inspectionId },
      data: {
        status: "IN_PROGRESS",
        result: "NOT_SET",
        submittedAt: null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_INSPECTION_REWORK",
      message: `reopened inspection ${existing.inspectionNumber} for rework`,
    });
  });
}

/**
 * Closing out an approved inspection (PRD #21 §83–§86).
 *
 * A pass closes on its own. A failure or a conditional acceptance has to have
 * somewhere for the problem to go first — a defect, an NCR or a corrective
 * action — or somebody has to state in writing that nothing will be done.
 * Closing a failure with neither records that a problem stopped being discussed.
 */
export async function closeInspection(
  context: UserContext,
  inspectionId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.close");

  const existing = assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        result: true,
        decisionNote: true,
        requestId: true,
        _count: { select: { defects: true, ncrs: true, correctiveActions: true } },
      },
    }),
  );

  if (!isInspectionCloseable(existing.status)) {
    throw new AccessError("CONFLICT", "Only an approved inspection can be closed.", {
      code: "NOT_APPROVED",
    });
  }

  if (!closesWithoutFollowUp(existing.result)) {
    const followUps =
      existing._count.defects + existing._count.ncrs + existing._count.correctiveActions;
    const disposition = (note ?? existing.decisionNote ?? "").trim();

    if (followUps === 0 && disposition === "") {
      throw new AccessError(
        "VALIDATION_ERROR",
        "Raise a defect, an NCR or a corrective action first — or say in writing why none is needed.",
        { code: "FOLLOW_UP_REQUIRED" },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.qualityInspection.update({
      where: { id: inspectionId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedByMemberId: context.membershipId,
        decisionNote: note ?? existing.decisionNote,
        updatedByMemberId: context.membershipId,
      },
    });

    if (existing.requestId) await syncRequestStatus(tx, context, existing.requestId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_INSPECTION_CLOSED",
      message: `closed inspection ${existing.inspectionNumber}`,
    });
  });
}

export async function cancelInspection(
  context: UserContext,
  inspectionId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.cancel");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionCancellable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An inspection that has been submitted cannot be cancelled — reject it instead.",
      { code: "INSPECTION_SUBMITTED" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.qualityInspection.update({
      where: { id: inspectionId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await approvals.cancelPendingApprovals(tx, context, "INSPECTION", inspectionId);
    if (existing.requestId) await syncRequestStatus(tx, context, existing.requestId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_INSPECTION_CANCELLED",
      message: `cancelled inspection ${existing.inspectionNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Reopening a closed inspection (PRD #21 §88).
 *
 * Deliberately rare and separately granted. The normal answer to "it needs
 * looking at again" is a reinspection, which is a new record with its own
 * verdict — not a rewrite of the one somebody signed.
 */
export async function reopenInspection(
  context: UserContext,
  inspectionId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.inspection.reopen");

  const existing = await requireInspection(context, inspectionId);

  if (!isInspectionReopenable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a closed inspection can be reopened.", {
      code: "NOT_CLOSED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.qualityInspection.update({
      where: { id: inspectionId },
      data: {
        status: "APPROVED",
        closedAt: null,
        closedByMemberId: null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_INSPECTION_REOPENED",
      message: `reopened inspection ${existing.inspectionNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * A fresh look at work that failed or passed with a condition
 * (PRD #21 §154–§158).
 *
 * A new inspection with its own number, its own checklist snapshot and its own
 * verdict, linked back to the one it re-examines. It never edits the parent:
 * the point of a reinspection is that both verdicts are on the record.
 */
export async function createReinspection(
  context: UserContext,
  parentInspectionId: string,
  input: ReinspectionInput,
): Promise<InspectionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.reinspection.create");

  const parent = assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: parentInspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        inspectionType: true,
        status: true,
        result: true,
        projectId: true,
        goodsReceiptId: true,
        goodsReceiptItemId: true,
        templateId: true,
        templateVersion: true,
        locationText: true,
        workReference: true,
        drawingReference: true,
        specificationReference: true,
        reinspectionSequence: true,
        checklistItems: {
          orderBy: { sortOrder: "asc" },
          select: {
            templateItemId: true,
            code: true,
            label: true,
            description: true,
            responseType: true,
            required: true,
            sortOrder: true,
            passCriteriaText: true,
            requiresEvidenceOnFail: true,
          },
        },
      },
    }),
  );

  if (!hasQualityEffect(parent.status)) {
    throw new AccessError(
      "CONFLICT",
      "A reinspection follows a decided inspection. Finish this one first.",
      { code: "PARENT_NOT_DECIDED" },
    );
  }

  if (parent.result === "PASS") {
    throw new AccessError(
      "CONFLICT",
      "This inspection passed, so there is nothing to re-inspect.",
      { code: "PARENT_PASSED" },
    );
  }

  const inspector = await requireMember(context, input.assignedInspectorMemberId);

  const id = await prisma.$transaction(async (tx) => {
    const siblings = await tx.qualityInspection.count({
      where: { parentInspectionId: parent.id },
    });

    const inspectionNumber = await nextQualityNumber(
      tx,
      "qualityInspection",
      context.companyId,
    );

    const created = await tx.qualityInspection.create({
      data: {
        companyId: context.companyId,
        inspectionNumber,
        inspectionType: parent.inspectionType,
        parentInspectionId: parent.id,
        reinspectionSequence: siblings + 1,
        templateId: parent.templateId,
        templateVersion: parent.templateVersion,
        projectId: parent.projectId,
        goodsReceiptId: parent.goodsReceiptId,
        goodsReceiptItemId: parent.goodsReceiptItemId,
        assignedInspectorMemberId: inspector.id,
        status: "DRAFT",
        result: "NOT_SET",
        inspectionDate: input.inspectionDate ?? null,
        locationText: parent.locationText,
        workReference: parent.workReference,
        drawingReference: parent.drawingReference,
        specificationReference: parent.specificationReference,
        summary: input.summary ?? null,
        createdByMemberId: context.membershipId,
        // The same checklist the parent was held to, so the two verdicts are
        // genuinely comparable (PRD #21 §69).
        checklistItems: { create: parent.checklistItems },
      },
      select: { id: true, inspectionNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: created.id,
      action: "QAQC_REINSPECTION_CREATED",
      message: `raised ${created.inspectionNumber} as reinspection ${siblings + 1} of ${parent.inspectionNumber}`,
      metadata: { parentInspectionId: parent.id } as Prisma.InputJsonValue,
    });

    // The inspector hears it is theirs (PRD #38 §74).
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.QA_INSPECTION_REQUIRED,
      moduleKey: MODULE,
      entityType: "quality_inspection",
      entityId: created.id,
      actorMemberId: context.membershipId,
      projectId: parent.projectId,
      payload: {
        inspectorMemberId: inspector.id,
        inspectionNumber: created.inspectionNumber,
        scheduledDate: input.inspectionDate ? new Date(input.inspectionDate).toISOString().slice(0, 10) : null,
      },
    });

    return created.id;
  });

  return getInspection(context, id);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The assigned inspector may always execute their own work; anybody else needs
 * company-scope quality access (PRD #21 §74).
 */
function assertMayExecute(context: UserContext, assignedInspectorMemberId: string): void {
  if (assignedInspectorMemberId === context.membershipId) return;
  if (can(context, "qaqc.manage")) return;
  if (can(context, "qaqc.inspection.assign")) return;

  throw new AccessError(
    "FORBIDDEN",
    "This inspection is assigned to somebody else.",
    { code: "NOT_ASSIGNED_INSPECTOR" },
  );
}

async function requireInspection(context: UserContext, inspectionId: string) {
  return assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        result: true,
        requestId: true,
        assignedInspectorMemberId: true,
        updatedAt: true,
      },
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

async function requireGoodsReceipt(context: UserContext, goodsReceiptId: string) {
  if (!can(context, "qaqc.material.view")) {
    throw new AccessError("VALIDATION_ERROR", "That delivery does not exist.", {
      code: "INVALID_RECEIPT",
    });
  }

  const receipt = await prisma.goodsReceipt.findFirst({
    where: { id: goodsReceiptId, companyId: context.companyId, status: "RECORDED" },
    select: { id: true },
  });

  if (!receipt) {
    throw new AccessError("VALIDATION_ERROR", "That delivery does not exist.", {
      code: "INVALID_RECEIPT",
    });
  }

  return receipt;
}

async function requireTemplate(context: UserContext, templateId: string) {
  const template = await prisma.inspectionTemplate.findFirst({
    where: { id: templateId, companyId: context.companyId, status: "ACTIVE", archivedAt: null },
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
          passCriteriaText: true,
          requiresEvidenceOnFail: true,
        },
      },
    },
  });

  if (!template) {
    throw new AccessError("VALIDATION_ERROR", "That template is not available.", {
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
      "Somebody else changed this inspection while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function describeProblem(problem: { kind: string; label: string }): string {
  return problem.kind === "UNANSWERED"
    ? `"${problem.label}" has not been answered.`
    : `"${problem.label}" failed and needs a note explaining why.`;
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): InspectionSummaryDTO {
  return {
    id: row.id,
    inspectionNumber: row.inspectionNumber,
    inspectionType: row.inspectionType,
    status: row.status,
    result: row.result,
    project: toProjectRef(row.project),
    assignedInspector: members.get(row.assignedInspectorMemberId) ?? null,
    inspectionDate: dateString(row.inspectionDate),
    templateName: row.template?.name ?? null,
    reinspectionSequence: row.reinspectionSequence,
    parentInspectionId: row.parentInspectionId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toChecklistDTO(row: DetailRow["checklistItems"][number]): ChecklistItemDTO {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    description: row.description,
    responseType: row.responseType,
    required: row.required,
    sortOrder: row.sortOrder,
    responseValue: row.responseValue,
    result: row.result,
    note: row.note,
    passCriteriaText: row.passCriteriaText,
    requiresEvidenceOnFail: row.requiresEvidenceOnFail,
  };
}

function capabilitiesFor(
  context: UserContext,
  row: DetailRow,
  state: {
    pendingSubmitter: string | null;
    hasFollowUp: boolean;
    hasDecisionNote: boolean;
    releaseExists: boolean;
  },
) {
  const mine = row.assignedInspectorMemberId === context.membershipId;
  const mayExecuteOthers = can(context, "qaqc.manage") || can(context, "qaqc.inspection.assign");

  /*
   * Withheld for whoever submitted it, so the page never offers a decision
   * that is certain to fail (PRD #21 §165). The service checks again.
   */
  const selfSubmitted = state.pendingSubmitter === context.membershipId;
  const mayDecide =
    isInspectionDecidable(row.status) &&
    (!selfSubmitted || can(context, "qaqc.approval.self"));

  const closeable =
    isInspectionCloseable(row.status) &&
    (closesWithoutFollowUp(row.result) || state.hasFollowUp || state.hasDecisionNote);

  return {
    canEdit: isInspectionEditable(row.status) && can(context, "qaqc.inspection.update_draft"),
    canExecute:
      isInspectionExecutable(row.status) &&
      can(context, "qaqc.inspection.execute") &&
      (mine || mayExecuteOthers),
    canSubmit:
      isInspectionSubmittable(row.status) &&
      can(context, "qaqc.inspection.submit") &&
      (mine || mayExecuteOthers),
    canApprove: mayDecide && can(context, "qaqc.inspection.approve"),
    canReject: mayDecide && can(context, "qaqc.inspection.reject"),
    canClose: closeable && can(context, "qaqc.inspection.close"),
    canCancel: isInspectionCancellable(row.status) && can(context, "qaqc.inspection.cancel"),
    canRework: isInspectionReworkable(row.status) && can(context, "qaqc.inspection.execute"),
    canReopen: isInspectionReopenable(row.status) && can(context, "qaqc.inspection.reopen"),
    canRecordMaterialDecision:
      row.inspectionType === "MATERIAL" &&
      isInspectionExecutable(row.status) &&
      can(context, "qaqc.material.inspect"),
    canRelease:
      row.inspectionType === "MATERIAL" &&
      hasQualityEffect(row.status) &&
      !state.releaseExists &&
      can(context, "qaqc.material.release"),
    canRaiseReinspection:
      hasQualityEffect(row.status) &&
      row.result !== "PASS" &&
      can(context, "qaqc.reinspection.create"),
    canViewDocuments: can(context, "qaqc.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "qaqc.activity.view"),
  };
}
