import { Prisma, type ProcurementApprovalRecordType } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { assertDecisionGuard, requireDecisionGuard, singlePending, type ApprovalGuard, type PendingCycle } from "@/lib/core/approvals/approval-guard";
import {
  closeOpenSteps,
  createApprovalSteps,
  currentStepOf,
  eligibleMembersForStep,
  loadApprovalSteps,
  loadApprovalStepsFor,
  stepEligibility,
  type StepPlan,
  type StepRow,
} from "@/lib/core/approvals/approval-steps";
import {
  notifyApprovalDecided,
  notifyApprovalRequested,
  recordApprovalCancelled,
  recordApprovalStepApproved,
} from "@/lib/core/notifications/approval-notifications";
import { orderReadableBy, PROVIDER_KEY } from "./approval.policy";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import type { RecordType } from "@/lib/core/records/record.types";
import type { Permission } from "@/config/permissions";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { toAmountString, toMemberRef, toSupplierRef } from "../procurement.dto";
import { buildOrderScopeWhere, buildRequestScopeWhere } from "../procurement.scope";
import type { MemberRef, ProcurementApprovalDTO } from "../procurement.types";

/**
 * Procurement approvals (PRD #19 §148–§157).
 *
 * One cycle per submission, on a request or an order. Three rules live here:
 *
 *   1. **Nobody decides what they submitted** (PRD #19 §21). The service
 *      refuses it and the queue withholds the buttons, so an approver is never
 *      offered an action that is certain to fail.
 *   2. **One pending cycle per record** (PRD #19 §213). A second submission
 *      while one is open is a conflict, not a second row.
 *   3. **The queue is scoped** (PRD #19 §153). It lists only decisions on
 *      records the reader could open directly — the queue is not a back door
 *      into another project's buying.
 */

const MODULE = "procurement" as const;

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
} satisfies Prisma.ProcurementApprovalSelect;

type ApprovalRow = Prisma.ProcurementApprovalGetPayload<{ select: typeof APPROVAL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Permission helpers                                                          */
/* -------------------------------------------------------------------------- */

export function canApproveType(
  context: UserContext,
  type: ProcurementApprovalRecordType,
): boolean {
  return can(
    context,
    type === "PURCHASE_REQUEST" ? "procurement.request.approve" : "procurement.order.approve",
  );
}

export function canRejectType(
  context: UserContext,
  type: ProcurementApprovalRecordType,
): boolean {
  return can(
    context,
    type === "PURCHASE_REQUEST" ? "procurement.request.reject" : "procurement.order.reject",
  );
}

export function assertCanApprove(
  context: UserContext,
  type: ProcurementApprovalRecordType,
): void {
  if (!canApproveType(context, type)) throw new AccessError("FORBIDDEN");
}

export function assertCanReject(context: UserContext, type: ProcurementApprovalRecordType): void {
  if (!canRejectType(context, type)) throw new AccessError("FORBIDDEN");
}

/**
 * Nobody decides on what they submitted (PRD #19 §21).
 *
 * `procurement.approval.self` exists so a one-person company can still operate,
 * and is held by nobody by default. Separation of duties is the rule; the grant
 * is the documented exception.
 */
export function assertNotSelfApproval(context: UserContext, submittedByMemberId: string): void {
  if (submittedByMemberId !== context.membershipId) return;
  if (can(context, "procurement.approval.self")) return;
  throw new AccessError(
    "FORBIDDEN",
    "You submitted this, so somebody else has to decide on it.",
    { code: "SELF_APPROVAL" },
  );
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

type Tx = Prisma.TransactionClient;

/** How each approval record type is named to the record registry (PRD #38 §74). */
const APPROVAL_RECORD: Record<ProcurementApprovalRecordType, { recordType: RecordType; noun: string; approve: Permission }> = {
  PURCHASE_REQUEST: { recordType: "purchase_request", noun: "Purchase request", approve: "procurement.request.approve" },
  PURCHASE_ORDER: { recordType: "purchase_order", noun: "Purchase order", approve: "procurement.order.approve" },
};

/**
 * Opens a cycle, refusing a second one while the first is still open (§213).
 *
 * `steps` is the chain the order's value calls for under the company's
 * approval policy (PRD #41 §21, §27); none means one Procurement decision.
 */
export async function openApproval(
  tx: Tx,
  context: UserContext,
  type: ProcurementApprovalRecordType,
  recordId: string,
  options: { steps?: StepPlan[] } = {},
): Promise<string> {
  const existing = await tx.procurementApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    select: { id: true },
  });

  if (existing) {
    throw new AccessError(
      "CONFLICT",
      "This is already waiting for a decision.",
      { code: "APPROVAL_PENDING" },
    );
  }

  const approval = await tx.procurementApproval.create({
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

  const steps = options.steps ?? [];
  await createApprovalSteps(tx, { companyId: context.companyId, providerKey: PROVIDER_KEY, approvalId: approval.id, steps });

  await notifyApprovalRequested(tx, context, {
    approvalId: approval.id,
    moduleKey: MODULE,
    recordId,
    recordType: APPROVAL_RECORD[type].recordType,
    noun: APPROVAL_RECORD[type].noun,
    approvePermissions: [APPROVAL_RECORD[type].approve],
    // A purchase order has its own event: it commits money to a supplier.
    eventType: type === "PURCHASE_ORDER" ? NotificationEvent.PO_APPROVAL_REQUIRED : undefined,
    ...(steps.length > 0 ? { step: { number: 1, total: steps.length, label: steps[0].label } } : {}),
  });

  return approval.id;
}

export async function requirePendingApproval(
  tx: Tx,
  context: UserContext,
  type: ProcurementApprovalRecordType,
  recordId: string,
  guard: ApprovalGuard | undefined,
): Promise<{ id: string; submittedByMemberId: string }> {
  requireDecisionGuard(guard);
  // Newest first, and never one of two at random (AUD-10 §4, A6).
  const approval = singlePending(
    await tx.procurementApproval.findMany({
      where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      take: 2,
      select: { id: true, submittedByMemberId: true },
    }),
  );

  if (!approval) {
    throw new AccessError(
      "CONFLICT",
      "There is no decision waiting on this record.",
      { code: "NO_PENDING_APPROVAL" },
    );
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
  type: ProcurementApprovalRecordType,
  recordId: string,
): Promise<PendingCycle | null> {
  const row = await prisma.procurementApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!row) return null;
  // In a chain the step shown is the step decided (AUD-10 §4, CW-04).
  const current = currentStepOf(await loadApprovalSteps(PROVIDER_KEY, row.id));
  return { approvalId: row.id, stepNumber: current?.stepNumber ?? null };
}

export async function decideApproval(
  tx: Tx,
  context: UserContext,
  approvalId: string,
  status: "APPROVED" | "REJECTED" | "RETURNED",
  note: string | null,
  chain: { step?: number; onBehalfOfMemberId?: string | null } = {},
): Promise<void> {
  // Conditional on PENDING, so two decisions racing each other settle once.
  const result = await tx.procurementApproval.updateMany({
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

  // Whatever the outcome, no step of this cycle is left waiting.
  await closeOpenSteps(tx, PROVIDER_KEY, approvalId);

  const approval = await tx.procurementApproval.findUnique({
    where: { id: approvalId },
    select: { recordType: true, recordId: true, submittedByMemberId: true },
  });
  if (approval) {
    await notifyApprovalDecided(tx, context, {
      approvalId,
      moduleKey: MODULE,
      recordId: approval.recordId,
      recordType: APPROVAL_RECORD[approval.recordType].recordType,
      noun: APPROVAL_RECORD[approval.recordType].noun,
      decision: status,
      note,
      submittedByMemberId: approval.submittedByMemberId,
      step: chain.step,
      onBehalfOfMemberId: chain.onBehalfOfMemberId,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Chains (PRD #41 §20-§26)                                                    */
/* -------------------------------------------------------------------------- */

export type ActionableStep = { steps: StepRow[]; step: StepRow; onBehalfOfMemberId: string | null };

/**
 * The chain on a cycle, and the step this person may decide now — or null
 * when the cycle is a single decision. Only the current step is ever
 * actionable; the requester and anybody who decided an earlier step are
 * refused here, inside the deciding transaction (PRD #41 §21, §29, §30).
 */
export async function requireActionableStep(
  tx: Tx,
  context: UserContext,
  approval: { id: string; submittedByMemberId: string },
  orderId: string,
  guard: ApprovalGuard | undefined,
): Promise<ActionableStep | null> {
  const steps = await loadApprovalSteps(PROVIDER_KEY, approval.id, tx);
  if (steps.length === 0) return null;

  const step = currentStepOf(steps);
  if (!step) {
    throw new AccessError("CONFLICT", "That decision has already been made.", { code: "APPROVAL_ALREADY_DECIDED" });
  }
  // A chain step is named as well as the cycle: a page that showed step one
  // cannot approve step two (AUD-10 §4, CW-04).
  assertDecisionGuard(guard, approval, step.stepNumber);

  const verdict = await stepEligibility(context, step, {
    providerKey: PROVIDER_KEY,
    steps,
    submittedByMemberId: approval.submittedByMemberId,
    allowSelf: can(context, "procurement.approval.self"),
    canReadAs: orderReadableBy(orderId),
  });
  if (!verdict.eligible) {
    if (verdict.reason === "SELF_APPROVAL") {
      throw new AccessError("FORBIDDEN", "You submitted this, so somebody else has to decide on it.", { code: "SELF_APPROVAL" });
    }
    if (verdict.reason === "RESERVED_FOR_LATER_STEP") {
      const later = steps.find((row) => row.stepNumber > step.stepNumber && row.status === "PENDING" && (row.approverMemberId === context.membershipId || row.approverRoleKey === context.role));
      throw new AccessError("FORBIDDEN", `You take the ${later?.label ?? "later"} decision on this order, so the ${step.label} step goes to somebody else.`, {
        code: "APPROVAL_STEP_SEPARATION",
      });
    }
    if (verdict.reason === "ALREADY_DECIDED_STEP") {
      throw new AccessError("FORBIDDEN", "You decided an earlier step of this order, so somebody else takes this one.", {
        code: "APPROVAL_STEP_SEPARATION",
      });
    }
    throw new AccessError("FORBIDDEN", `This order is waiting for the ${step.label} decision (step ${step.stepNumber} of ${steps.length}).`, {
      code: "APPROVAL_NOT_CURRENT_APPROVER",
    });
  }
  return { steps, step, onBehalfOfMemberId: verdict.onBehalfOfMemberId };
}

/**
 * After a step is approved: when another step remains, the cycle carries on
 * and that step's approvers are asked. Returns false when the approved step
 * was the last, and the caller finalises the order.
 */
export async function advanceChain(
  tx: Tx,
  context: UserContext,
  input: {
    approvalId: string;
    orderId: string;
    submittedByMemberId: string;
    actionable: ActionableStep;
    note: string | null;
  },
): Promise<boolean> {
  const { steps, step, onBehalfOfMemberId } = input.actionable;
  const next = steps.find((row) => row.stepNumber > step.stepNumber && row.status === "PENDING");
  if (!next) return false;

  const record = { moduleKey: MODULE, recordType: APPROVAL_RECORD.PURCHASE_ORDER.recordType, recordId: input.orderId, noun: APPROVAL_RECORD.PURCHASE_ORDER.noun, approvalId: input.approvalId };
  await recordApprovalStepApproved(tx, context, { ...record, step: step.stepNumber, stepLabel: step.label, note: input.note, onBehalfOfMemberId });

  // Nobody decides two steps: the requester and everyone who has decided are left out.
  const exclude = [
    ...new Set([
      input.submittedByMemberId,
      context.membershipId,
      ...(onBehalfOfMemberId ? [onBehalfOfMemberId] : []),
      ...steps.flatMap((row) => [row.decidedByMemberId, row.onBehalfOfMemberId]).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const named = next.approverPermission
    ? undefined
    : await eligibleMembersForStep(context.companyId, next, { exclude, canReadAs: orderReadableBy(input.orderId) });

  const submitter = await tx.companyMember.findUnique({
    where: { id: input.submittedByMemberId },
    select: { user: { select: { firstName: true, lastName: true } } },
  });
  await notifyApprovalRequested(tx, context, {
    ...record,
    approvePermissions: next.approverPermission ? [next.approverPermission as Permission] : [],
    step: { number: next.stepNumber, total: steps.length, label: next.label },
    recipientMemberIds: named,
    excludeMemberIds: exclude,
    submittedBy: submitter ? { memberId: input.submittedByMemberId, name: `${submitter.user.firstName} ${submitter.user.lastName}` } : undefined,
  });
  return true;
}

/**
 * The current chain step of each pending cycle, for the module's own queue:
 * a row names the step it showed when it is decided, so it cannot approve the
 * next one (AUD-10 §4, CW-04). Cycles without a chain are absent.
 */
export async function currentStepNumbers(approvalIds: string[]): Promise<Record<string, number>> {
  const chains = await loadApprovalStepsFor(PROVIDER_KEY, approvalIds);
  const result: Record<string, number> = {};
  for (const [approvalId, steps] of chains) {
    const current = currentStepOf(steps);
    if (current) result[approvalId] = current.stepNumber;
  }
  return result;
}

/** Whether this person could decide the current step of each chain, for the module's own queue. */
async function chainCapabilities(context: UserContext, rows: ApprovalRow[]): Promise<Map<string, boolean>> {
  const pendingOrders = rows.filter((row) => row.status === "PENDING" && row.recordType === "PURCHASE_ORDER");
  const chains = await loadApprovalStepsFor(PROVIDER_KEY, pendingOrders.map((row) => row.id));
  const result = new Map<string, boolean>();
  for (const row of pendingOrders) {
    const steps = chains.get(row.id);
    if (!steps?.length) continue;
    const step = currentStepOf(steps);
    const verdict = step
      ? await stepEligibility(context, step, {
          providerKey: PROVIDER_KEY,
          steps,
          submittedByMemberId: row.submittedByMemberId,
          allowSelf: can(context, "procurement.approval.self"),
        })
      : null;
    result.set(row.id, Boolean(verdict?.eligible));
  }
  return result;
}

/** Cancelling the record cancels whatever was waiting on it (PRD #19 §59). */
export async function cancelPendingApprovals(
  tx: Tx,
  context: UserContext,
  type: ProcurementApprovalRecordType,
  recordId: string,
): Promise<void> {
  const pending = await tx.procurementApproval.findMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    select: { id: true },
  });
  const { count } = await tx.procurementApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context.membershipId },
  });
  for (const row of pending) await closeOpenSteps(tx, PROVIDER_KEY, row.id);
  await recordApprovalCancelled(tx, context, { moduleKey: MODULE, recordType: APPROVAL_RECORD[type].recordType, noun: APPROVAL_RECORD[type].noun, recordId, count });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

type RecordRef = {
  reference: string;
  title: string;
  project: { id: string; code: string; name: string } | null;
  supplier: { id: string; name: string; status: "ACTIVE" | "INACTIVE" | "ARCHIVED" } | null;
  currency: string | null;
  amount: Prisma.Decimal | null;
};

/**
 * The records the queue may mention, resolved once (PRD #19 §153).
 *
 * Both maps come from the caller's own scope queries, so an approval is exactly
 * as reachable as the record it decides — never more. Resolved in two queries
 * rather than one per row (PRD #19 §304).
 */
async function reachableRecords(context: UserContext): Promise<{
  requests: Map<string, RecordRef>;
  orders: Map<string, RecordRef>;
}> {
  const [requests, orders] = await Promise.all([
    can(context, "procurement.request.view")
      ? prisma.purchaseRequest.findMany({
          where: buildRequestScopeWhere(context),
          select: {
            id: true,
            requestNumber: true,
            title: true,
            currency: true,
            estimatedTotal: true,
            project: { select: { id: true, code: true, name: true } },
          },
        })
      : Promise.resolve([]),
    can(context, "procurement.order.view")
      ? prisma.purchaseOrder.findMany({
          where: buildOrderScopeWhere(context),
          select: {
            id: true,
            poNumber: true,
            currency: true,
            totalAmount: true,
            project: { select: { id: true, code: true, name: true } },
            supplier: { select: { id: true, name: true, status: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    requests: new Map(
      requests.map((row) => [
        row.id,
        {
          reference: row.requestNumber,
          title: row.title,
          project: row.project,
          supplier: null,
          currency: row.currency,
          amount: row.estimatedTotal,
        },
      ]),
    ),
    orders: new Map(
      orders.map((row) => [
        row.id,
        {
          reference: row.poNumber,
          title: `Order to ${row.supplier.name}`,
          project: row.project,
          supplier: row.supplier,
          currency: row.currency,
          amount: row.totalAmount,
        },
      ]),
    ),
  };
}

async function hydrate(
  context: UserContext,
  rows: ApprovalRow[],
  reachable: Awaited<ReturnType<typeof reachableRecords>>,
): Promise<ProcurementApprovalDTO[]> {
  // The people named on these cycles, resolved once rather than per row
  // (PRD #19 §304).
  const memberIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.decidedByMemberId ? [row.submittedByMemberId, row.decidedByMemberId] : [row.submittedByMemberId],
      ),
    ),
  ];

  const members = await prisma.companyMember.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });

  const byMember = new Map<string, MemberRef>(
    members.map((member) => [member.id, toMemberRef(member)!]),
  );
  // An order in a chain is decided by whoever holds its current step, not by the queue's permission.
  const chained = await chainCapabilities(context, rows);

  return rows.flatMap((row) => {
    const ref =
      row.recordType === "PURCHASE_REQUEST"
        ? reachable.requests.get(row.recordId)
        : reachable.orders.get(row.recordId);

    // Out of scope: the row is dropped rather than rendered as a stub, so the
    // queue cannot be used to learn that a record exists.
    if (!ref) return [];

    const pending = row.status === "PENDING";
    const selfBlocked =
      row.submittedByMemberId === context.membershipId &&
      !can(context, "procurement.approval.self");

    return [
      {
        id: row.id,
        recordType: row.recordType,
        recordId: row.recordId,
        recordReference: ref.reference,
        recordTitle: ref.title,
        project: ref.project,
        supplier: toSupplierRef(ref.supplier),
        value:
          ref.currency && ref.amount !== null
            ? { currency: ref.currency, amount: toAmountString(ref.amount) }
            : null,
        status: row.status,
        submittedBy: byMember.get(row.submittedByMemberId) ?? null,
        submittedAt: row.submittedAt.toISOString(),
        decidedBy: row.decidedByMemberId ? (byMember.get(row.decidedByMemberId) ?? null) : null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decisionNote: row.decisionNote,
        capabilities: chained.has(row.id)
          ? { canApprove: chained.get(row.id)!, canReject: chained.get(row.id)! }
          : {
              canApprove: pending && !selfBlocked && canApproveType(context, row.recordType),
              canReject: pending && !selfBlocked && canRejectType(context, row.recordType),
            },
      },
    ];
  });
}

export async function listApprovals(
  context: UserContext,
  options: { status?: "PENDING" | "DECIDED"; page?: number; limit?: number } = {},
) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.approval.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const reachable = await reachableRecords(context);
  const recordIds = [...reachable.requests.keys(), ...reachable.orders.keys()];

  const where: Prisma.ProcurementApprovalWhereInput = {
    companyId: context.companyId,
    ...(options.status === "PENDING" ? { status: "PENDING" } : {}),
    ...(options.status === "DECIDED" ? { status: { not: "PENDING" } } : {}),
    recordId: { in: recordIds },
  };

  const [rows, total] = await Promise.all([
    prisma.procurementApproval.findMany({
      where,
      orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
      skip: skipFor(page, limit),
      take: limit,
      select: APPROVAL_SELECT,
    }),
    prisma.procurementApproval.count({ where }),
  ]);

  return {
    data: await hydrate(context, rows, reachable),
    pagination: paginationMeta(total, page, limit),
  };
}

/** How many decisions are waiting, for the overview (PRD #19 §22). */
export async function pendingApprovalCount(context: UserContext): Promise<number> {
  if (!can(context, "procurement.approval.view")) return 0;

  const reachable = await reachableRecords(context);
  const recordIds = [...reachable.requests.keys(), ...reachable.orders.keys()];
  if (recordIds.length === 0) return 0;

  return prisma.procurementApproval.count({
    where: { companyId: context.companyId, status: "PENDING", recordId: { in: recordIds } },
  });
}

/** One record's approval history, newest first (PRD #19 §156, §157). */
export async function approvalHistory(
  context: UserContext,
  type: ProcurementApprovalRecordType,
  recordId: string,
): Promise<ProcurementApprovalDTO[]> {
  if (!can(context, "procurement.view")) return [];

  const rows = await prisma.procurementApproval.findMany({
    where: { companyId: context.companyId, recordType: type, recordId },
    orderBy: { submittedAt: "desc" },
    select: APPROVAL_SELECT,
  });

  if (rows.length === 0) return [];
  return hydrate(context, rows, await reachableRecords(context));
}
