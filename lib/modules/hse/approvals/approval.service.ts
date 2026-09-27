import { Prisma, type HseApprovalRecordType } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { assertDecisionGuard, requireDecisionGuard, singlePending, type ApprovalGuard, type PendingCycle } from "@/lib/core/approvals/approval-guard";
import { notifyApprovalDecided, notifyApprovalRequested, recordApprovalCancelled } from "@/lib/core/notifications/approval-notifications";
import type { RecordType } from "@/lib/core/records/record.types";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { SNAPSHOT } from "../hse.list";
import { dateString, loadMembers, toProjectRef } from "../hse.dto";
import {
  buildIncidentScopeWhere,
  buildInspectionScopeWhere,
  buildPermitScopeWhere,
  buildRiskAssessmentScopeWhere,
} from "../hse.scope";
import { approvalRecordTypeLabels, severityLabels } from "../hse.status";
import { riskLevelLabels } from "../hse.risk";
import type { ApprovalQueueItemDTO } from "../hse.types";

/**
 * HSE approvals (PRD #22 §177–§184).
 *
 * One cycle per submission, across four kinds of record: an inspection, a risk
 * assessment, a work permit and an incident closure. Three rules live here:
 *
 *   1. **Nobody decides what they submitted** (PRD #22 §182). Approving your
 *      own hot-work permit is how a permit-to-work system stops being one. The
 *      service refuses it and the queue withholds the buttons, so an approver is
 *      never offered an action that is certain to fail.
 *   2. **One pending cycle per record** (PRD #22 §238). A second submission
 *      while one is open is a conflict, not a second row.
 *   3. **The queue is scoped** (PRD #22 §181). It lists only decisions on
 *      records the reader could open directly — the queue is not a back door
 *      into another site's incident history.
 *
 * Decided rows are kept rather than deleted, so the queue doubles as the record
 * of who signed what and when (PRD #22 §465).
 */

const MODULE = "hse" as const;

const APPROVAL_SELECT = {
  id: true,
  recordType: true,
  recordId: true,
  status: true,
  submittedByMemberId: true,
  submittedAt: true,
  decidedByMemberId: true,
  decidedAt: true,
  decisionNote: true,
} satisfies Prisma.HseApprovalSelect;

/* -------------------------------------------------------------------------- */
/* Permission helpers                                                          */
/* -------------------------------------------------------------------------- */

const APPROVE_PERMISSION = {
  INSPECTION: "hse.inspection.approve",
  RISK_ASSESSMENT: "hse.risk.approve",
  WORK_PERMIT: "hse.permit.approve",
  INCIDENT_CLOSE: "hse.incident.close",
} as const;

const REJECT_PERMISSION = {
  INSPECTION: "hse.inspection.reject",
  RISK_ASSESSMENT: "hse.risk.approve",
  WORK_PERMIT: "hse.permit.approve",
  INCIDENT_CLOSE: "hse.incident.close",
} as const;

export function canApproveType(context: UserContext, type: HseApprovalRecordType): boolean {
  return can(context, APPROVE_PERMISSION[type]);
}

export function canRejectType(context: UserContext, type: HseApprovalRecordType): boolean {
  return can(context, REJECT_PERMISSION[type]);
}

export function assertCanApprove(context: UserContext, type: HseApprovalRecordType): void {
  if (!canApproveType(context, type)) throw new AccessError("FORBIDDEN");
}

export function assertCanReject(context: UserContext, type: HseApprovalRecordType): void {
  if (!canRejectType(context, type)) throw new AccessError("FORBIDDEN");
}

/**
 * Nobody decides on what they submitted (PRD #22 §182).
 *
 * `hse.approval.self` exists so a one-person company can still operate, and is
 * held by nobody by default. Separation of duties is the rule; the grant is the
 * documented exception.
 *
 * The submitter is not the only person with a stake in the answer. A permit's
 * requester and an inspection's inspector are named by the caller too, so the
 * person who asked for the hot work cannot approve it just because a colleague
 * pressed submit (PRD #47 §85).
 */
export function assertNotSelfApproval(
  context: UserContext,
  submittedByMemberId: string,
  ...alsoConflicted: (string | null | undefined)[]
): void {
  if (!isConflicted(context, submittedByMemberId, alsoConflicted)) return;
  if (can(context, "hse.approval.self")) return;
  throw new AccessError(
    "FORBIDDEN",
    "You submitted this, so somebody else has to decide on it.",
    { code: "SELF_APPROVAL" },
  );
}

function isConflicted(
  context: UserContext,
  submittedByMemberId: string | null,
  alsoConflicted: (string | null | undefined)[],
): boolean {
  return [submittedByMemberId, ...alsoConflicted].includes(context.membershipId);
}

/** Whether a reader named on the record is barred from deciding it (§182). */
export function isSelfDecision(
  context: UserContext,
  submittedByMemberId: string | null,
  ...alsoConflicted: (string | null | undefined)[]
): boolean {
  return isConflicted(context, submittedByMemberId, alsoConflicted) && !can(context, "hse.approval.self");
}

/** Whether this reader could decide, used to withhold buttons (§182). */
export function couldDecide(
  context: UserContext,
  type: HseApprovalRecordType,
  submittedByMemberId: string,
): boolean {
  if (!canApproveType(context, type) && !canRejectType(context, type)) return false;
  if (submittedByMemberId !== context.membershipId) return true;
  return can(context, "hse.approval.self");
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

type Tx = Prisma.TransactionClient;

/** How each approval record type is named to the record registry (PRD #38 §74). */
const APPROVAL_RECORD: Record<HseApprovalRecordType, { recordType: RecordType; noun: string }> = {
  INSPECTION: { recordType: "hse_inspection", noun: "HSE inspection" },
  RISK_ASSESSMENT: { recordType: "risk_assessment", noun: "Risk assessment" },
  WORK_PERMIT: { recordType: "work_permit", noun: "Work permit" },
  INCIDENT_CLOSE: { recordType: "incident", noun: "Incident closure" },
};

/** Opens a cycle, refusing a second one while the first is still open (§238). */
export async function openApproval(
  tx: Tx,
  context: UserContext,
  type: HseApprovalRecordType,
  recordId: string,
): Promise<string> {
  const existing = await tx.hseApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    select: { id: true },
  });

  if (existing) {
    throw new AccessError("CONFLICT", "This is already waiting for a decision.", {
      code: "APPROVAL_PENDING",
    });
  }

  const approval = await tx.hseApproval.create({
    data: {
      companyId: context.companyId,
      recordType: type,
      recordId,
      status: "PENDING",
      submittedByMemberId: context.membershipId,
      submittedAt: new Date(),
    },
    select: { id: true },
  });

  await notifyApprovalRequested(tx, context, {
    approvalId: approval.id,
    moduleKey: "hse",
    recordId,
    recordType: APPROVAL_RECORD[type].recordType,
    noun: APPROVAL_RECORD[type].noun,
    approvePermissions: [APPROVE_PERMISSION[type]],
  });

  return approval.id;
}

export async function requirePendingApproval(
  tx: Tx,
  context: UserContext,
  type: HseApprovalRecordType,
  recordId: string,
  guard: ApprovalGuard | undefined,
): Promise<{ id: string; submittedByMemberId: string }> {
  requireDecisionGuard(guard);
  // Newest first, and never one of two at random (AUD-10 §4, A6).
  const approval = singlePending(
    await tx.hseApproval.findMany({
      where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      take: 2,
      select: { id: true, submittedByMemberId: true },
    }),
  );

  if (!approval) {
    throw new AccessError("CONFLICT", "There is no decision waiting on this record.", {
      code: "NO_PENDING_APPROVAL",
    });
  }

  // A resubmission since the review opened is a different cycle (PRD #41 §187).
  assertDecisionGuard(guard, approval);

  return approval;
}

/**
 * The cycle a source page puts its decision controls against (AUD-10 §4,
 * CW-02, CW-05): the page names it back when somebody decides, and the
 * decision is refused if it is no longer the pending one. Ids only — whether
 * this reader may decide is the record's capabilities' business.
 */
export async function pendingCycle(
  context: UserContext,
  type: HseApprovalRecordType,
  recordId: string,
): Promise<PendingCycle | null> {
  const row = await prisma.hseApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!row) return null;
  return { approvalId: row.id };
}

export async function decideApproval(
  tx: Tx,
  context: UserContext,
  approvalId: string,
  status: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<void> {
  // Conditional on PENDING, so two decisions racing each other settle once
  // (PRD #22 §184).
  const result = await tx.hseApproval.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: {
      status,
      decidedByMemberId: context.membershipId,
      decidedAt: new Date(),
      decisionNote: note,
    },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "That decision has already been made.", {
      code: "APPROVAL_ALREADY_DECIDED",
    });
  }

  const approval = await tx.hseApproval.findUnique({
    where: { id: approvalId },
    select: { recordType: true, recordId: true, submittedByMemberId: true },
  });
  if (approval) {
    await notifyApprovalDecided(tx, context, {
      approvalId,
      moduleKey: "hse",
      recordId: approval.recordId,
      recordType: APPROVAL_RECORD[approval.recordType].recordType,
      noun: APPROVAL_RECORD[approval.recordType].noun,
      decision: status,
      note,
      submittedByMemberId: approval.submittedByMemberId,
    });
  }
}

/** Cancelling the record cancels whatever was waiting on it (PRD #22 §155). */
export async function cancelPendingApprovals(
  tx: Tx,
  context: UserContext,
  type: HseApprovalRecordType,
  recordId: string,
): Promise<void> {
  const { count } = await tx.hseApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: {
      status: "CANCELLED",
      decidedAt: new Date(),
      decidedByMemberId: context.membershipId,
    },
  });
  await recordApprovalCancelled(tx, context, { moduleKey: MODULE, recordType: APPROVAL_RECORD[type].recordType, noun: APPROVAL_RECORD[type].noun, recordId, count });
}

export async function pendingFor(
  context: UserContext,
  type: HseApprovalRecordType,
  recordId: string,
): Promise<{ id: string; submittedByMemberId: string } | null> {
  return prisma.hseApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    select: { id: true, submittedByMemberId: true },
  });
}

/* -------------------------------------------------------------------------- */
/* The queue                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything waiting on a decision that this reader could actually open
 * (PRD #22 §181).
 *
 * The four record types are resolved in four scoped queries and then matched
 * against the approval rows, rather than listing approvals and hiding the ones
 * whose record is out of reach. Listing first and filtering after leaks a count:
 * a page that says "3 pending" and shows one is telling a site engineer there
 * are two permits elsewhere they may not see (PRD #22 §310).
 */
export async function listApprovalQueue(
  context: UserContext,
  options: { page?: number; limit?: number; includeDecided?: boolean } = {},
) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.approval.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const [inspections, assessments, permits, incidents] = await Promise.all([
    prisma.hseInspection.findMany({
      where: buildInspectionScopeWhere(context),
      select: {
        id: true,
        inspectionNumber: true,
        inspectionType: true,
        result: true,
        project: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.hseRiskAssessment.findMany({
      where: buildRiskAssessmentScopeWhere(context),
      select: {
        id: true,
        assessmentNumber: true,
        title: true,
        project: { select: { id: true, code: true, name: true } },
        items: { select: { riskLevel: true } },
      },
    }),
    prisma.hseWorkPermit.findMany({
      where: buildPermitScopeWhere(context),
      select: {
        id: true,
        permitNumber: true,
        title: true,
        permitType: true,
        project: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.hseIncident.findMany({
      where: buildIncidentScopeWhere(context),
      select: {
        id: true,
        incidentNumber: true,
        title: true,
        severity: true,
        project: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);

  type Resolved = {
    reference: string;
    title: string;
    href: string;
    project: { id: string; code: string; name: string } | null;
    riskLabel: string | null;
  };

  const byType = new Map<HseApprovalRecordType, Map<string, Resolved>>([
    ["INSPECTION", new Map()],
    ["RISK_ASSESSMENT", new Map()],
    ["WORK_PERMIT", new Map()],
    ["INCIDENT_CLOSE", new Map()],
  ]);

  const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

  for (const row of inspections) {
    byType.get("INSPECTION")!.set(row.id, {
      reference: row.inspectionNumber,
      title: row.inspectionType.replace(/_/g, " ").toLowerCase(),
      href: `/hse/inspections/${row.id}`,
      project: row.project,
      riskLabel: row.result === "NOT_SET" ? null : row.result,
    });
  }

  for (const row of assessments) {
    // An assessment is ranked by its worst line, which is how anybody reading a
    // queue of them decides what to look at first.
    const highest = row.items.reduce<string | null>(
      (worst, item) =>
        worst === null || order.indexOf(item.riskLevel) > order.indexOf(worst)
          ? item.riskLevel
          : worst,
      null,
    );
    byType.get("RISK_ASSESSMENT")!.set(row.id, {
      reference: row.assessmentNumber,
      title: row.title,
      href: `/hse/risk-assessments/${row.id}`,
      project: row.project,
      riskLabel: highest ? riskLevelLabels[highest as keyof typeof riskLevelLabels] : null,
    });
  }

  for (const row of permits) {
    byType.get("WORK_PERMIT")!.set(row.id, {
      reference: row.permitNumber,
      title: row.title,
      href: `/hse/permits/${row.id}`,
      project: row.project,
      riskLabel: null,
    });
  }

  for (const row of incidents) {
    byType.get("INCIDENT_CLOSE")!.set(row.id, {
      reference: row.incidentNumber,
      title: row.title,
      href: `/hse/incidents/${row.id}`,
      project: row.project,
      riskLabel: severityLabels[row.severity],
    });
  }

  const reachable: Prisma.HseApprovalWhereInput[] = [];
  for (const [type, map] of byType) {
    if (map.size > 0) reachable.push({ recordType: type, recordId: { in: [...map.keys()] } });
  }

  if (reachable.length === 0) {
    return { data: [], pagination: paginationMeta(0, page, limit) };
  }

  const where: Prisma.HseApprovalWhereInput = {
    companyId: context.companyId,
    OR: reachable,
    ...(options.includeDecided ? {} : { status: "PENDING" as const }),
  };

  // One snapshot for the page and its total; the oldest waiting first, then
  // the id, so equal submission times keep one order across pages (AUD-08 §4).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.hseApproval.findMany({
        where,
        orderBy: [{ status: "asc" }, { submittedAt: "asc" }, { id: "asc" }],
        skip: skipFor(page, limit),
        take: limit,
        select: APPROVAL_SELECT,
      }),
      prisma.hseApproval.count({ where }),
    ],
    SNAPSHOT,
  );

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.submittedByMemberId, row.decidedByMemberId]),
  );

  const data: ApprovalQueueItemDTO[] = rows.map((row) => {
    const resolved = byType.get(row.recordType)!.get(row.recordId);

    return {
      id: row.id,
      recordType: row.recordType,
      recordId: row.recordId,
      reference: resolved?.reference ?? approvalRecordTypeLabels[row.recordType],
      title: resolved?.title ?? "",
      href: resolved?.href ?? null,
      project: toProjectRef(resolved?.project),
      riskLabel: resolved?.riskLabel ?? null,
      status: row.status,
      submittedBy: members.get(row.submittedByMemberId) ?? null,
      submittedAt: row.submittedAt.toISOString(),
      decidedBy: row.decidedByMemberId ? (members.get(row.decidedByMemberId) ?? null) : null,
      decidedAt: dateString(row.decidedAt),
      decisionNote: row.decisionNote,
      canDecide:
        row.status === "PENDING" &&
        couldDecide(context, row.recordType, row.submittedByMemberId),
    };
  });

  return { data, pagination: paginationMeta(total, page, limit) };
}

/**
 * How many decisions are waiting on records this reader could open (PRD #22
 * §181, PRD #47 §62).
 *
 * The overview's "waiting for a decision" card used to count every pending row
 * in the company, which told a site engineer how many permits were queued on
 * sites they cannot see. Pending rows are few, so they are read first and each
 * kept only if its record passes the reader's scope for that kind.
 */
export async function countPendingApprovals(context: UserContext): Promise<number> {
  if (!can(context, "hse.approval.view")) return 0;

  const pending = await prisma.hseApproval.findMany({
    where: { companyId: context.companyId, status: "PENDING" },
    select: { recordType: true, recordId: true },
  });
  if (pending.length === 0) return 0;

  const idsOf = (type: HseApprovalRecordType) =>
    pending.filter((row) => row.recordType === type).map((row) => row.recordId);

  const [inspections, assessments, permits, incidents] = await Promise.all([
    prisma.hseInspection.count({
      where: { AND: [buildInspectionScopeWhere(context), { id: { in: idsOf("INSPECTION") } }] },
    }),
    prisma.hseRiskAssessment.count({
      where: {
        AND: [buildRiskAssessmentScopeWhere(context), { id: { in: idsOf("RISK_ASSESSMENT") } }],
      },
    }),
    prisma.hseWorkPermit.count({
      where: { AND: [buildPermitScopeWhere(context), { id: { in: idsOf("WORK_PERMIT") } }] },
    }),
    prisma.hseIncident.count({
      where: { AND: [buildIncidentScopeWhere(context), { id: { in: idsOf("INCIDENT_CLOSE") } }] },
    }),
  ]);

  return inspections + assessments + permits + incidents;
}

/** Every cycle one record has been through, newest first (PRD #22 §465). */
export async function historyFor(
  context: UserContext,
  type: HseApprovalRecordType,
  recordId: string,
) {
  if (!can(context, "hse.approval.view")) return [];

  const rows = await prisma.hseApproval.findMany({
    where: { companyId: context.companyId, recordType: type, recordId },
    orderBy: { submittedAt: "desc" },
    select: APPROVAL_SELECT,
  });

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.submittedByMemberId, row.decidedByMemberId]),
  );

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    submittedBy: members.get(row.submittedByMemberId) ?? null,
    submittedAt: row.submittedAt.toISOString(),
    decidedBy: row.decidedByMemberId ? (members.get(row.decidedByMemberId) ?? null) : null,
    decidedAt: dateString(row.decidedAt),
    decisionNote: row.decisionNote,
  }));
}
