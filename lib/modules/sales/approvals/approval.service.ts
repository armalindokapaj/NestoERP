import { Prisma, type SalesApprovalRecordType } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";
import { assertDecisionGuard, requireDecisionGuard, singlePending, type ApprovalGuard, type PendingCycle } from "@/lib/core/approvals/approval-guard";
import { notifyApprovalDecided, notifyApprovalRequested, recordApprovalCancelled } from "@/lib/core/notifications/approval-notifications";
import type { RecordType } from "@/lib/core/records/record.types";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import { boundedLimit, boundedPage } from "../sales.query";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import { buildProposalScopeWhere } from "../sales.scope";
import type { MemberRef, SalesApprovalDTO } from "../sales.types";

/**
 * Sales approvals (PRD #17 §128–§133).
 *
 * One approval row per submission, never reopened: a rejected proposal that is
 * repriced and resubmitted gets a *new* row, so the record's history reads as
 * the sequence of decisions it actually was (PRD #17 §119, §132).
 *
 * Two rules live here and nowhere else:
 *
 *   1. Approval authority is a permission, not a consequence of being able to
 *      write the proposal (PRD #17 §19).
 *   2. The submitter cannot decide their own submission unless they hold
 *      `sales.approval.self` — because "who checked the price?" must have an
 *      answer other than "the person who quoted it" (PRD #17 §20).
 */

const MODULE = "sales" as const;

const APPROVE_PERMISSION: Record<SalesApprovalRecordType, Permission> = {
  PROPOSAL: "sales.proposal.approve",
};

const REJECT_PERMISSION: Record<SalesApprovalRecordType, Permission> = {
  PROPOSAL: "sales.proposal.reject",
};

export function canApproveType(context: UserContext, type: SalesApprovalRecordType): boolean {
  return can(context, APPROVE_PERMISSION[type]);
}

export function canRejectType(context: UserContext, type: SalesApprovalRecordType): boolean {
  return can(context, REJECT_PERMISSION[type]);
}

export function assertCanApprove(context: UserContext, type: SalesApprovalRecordType): void {
  assertPermission(context, APPROVE_PERMISSION[type]);
}

export function assertCanReject(context: UserContext, type: SalesApprovalRecordType): void {
  assertPermission(context, REJECT_PERMISSION[type]);
}

/**
 * Separation of duties (PRD #17 §20, §329).
 *
 * Checked against the *submission*, not the proposal's author: the person who
 * put the price forward is the one who must not wave it through.
 */
export function assertNotSelfApproval(context: UserContext, submittedByMemberId: string): void {
  if (submittedByMemberId !== context.membershipId) return;
  if (can(context, "sales.approval.self")) return;

  throw new AccessError(
    "FORBIDDEN",
    "You submitted this proposal, so somebody else has to decide it.",
  );
}

/* -------------------------------------------------------------------------- */
/* Writes, used inside the proposal service's transaction                      */
/* -------------------------------------------------------------------------- */

/** How each approval record type is named to the record registry (PRD #38 §74). */
const APPROVAL_RECORD: Record<SalesApprovalRecordType, { recordType: RecordType; noun: string }> = {
  PROPOSAL: { recordType: "proposal", noun: "Proposal" },
};

/**
 * Opens an approval cycle.
 *
 * Any cycle still pending on this record is cancelled first, so a proposal can
 * never carry two live approvals — which is what a double-clicked submit button
 * would otherwise produce (PRD #17 §238).
 */
export async function openApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  type: SalesApprovalRecordType,
  recordId: string,
): Promise<string> {
  await tx.salesApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context.membershipId },
  });

  const approval = await tx.salesApproval.create({
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
    moduleKey: "sales",
    recordId,
    recordType: APPROVAL_RECORD[type].recordType,
    noun: APPROVAL_RECORD[type].noun,
    approvePermissions: [APPROVE_PERMISSION[type]],
  });

  return approval.id;
}

export async function requirePendingApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  type: SalesApprovalRecordType,
  recordId: string,
  guard: ApprovalGuard | undefined,
) {
  requireDecisionGuard(guard);
  // Newest first, and never one of two at random (AUD-10 §4, A6).
  const approval = singlePending(
    await tx.salesApproval.findMany({
      where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      take: 2,
      select: { id: true, submittedByMemberId: true },
    }),
  );

  if (!approval) {
    throw new AccessError("CONFLICT", "This proposal is not waiting for a decision.");
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
  type: SalesApprovalRecordType,
  recordId: string,
): Promise<PendingCycle | null> {
  const row = await prisma.salesApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!row) return null;
  return { approvalId: row.id };
}

/**
 * Closes an approval cycle.
 *
 * Conditional on the row still being PENDING and checked by row count, so two
 * approvers pressing at the same moment cannot both succeed (PRD #17 §133,
 * §257).
 */
export async function decideApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  approvalId: string,
  decision: "APPROVED" | "REJECTED" | "RETURNED",
  note: string | null,
): Promise<void> {
  const result = await tx.salesApproval.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: {
      status: decision,
      decidedByMemberId: context.membershipId,
      decidedAt: new Date(),
      decisionNote: note,
    },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This proposal has already been decided.");
  }

  const approval = await tx.salesApproval.findUnique({
    where: { id: approvalId },
    select: { recordType: true, recordId: true, submittedByMemberId: true },
  });
  if (approval) {
    await notifyApprovalDecided(tx, context, {
      approvalId,
      moduleKey: "sales",
      recordId: approval.recordId,
      recordType: APPROVAL_RECORD[approval.recordType].recordType,
      noun: APPROVAL_RECORD[approval.recordType].noun,
      decision,
      note,
      submittedByMemberId: approval.submittedByMemberId,
    });
  }
}

export async function cancelPendingApprovals(
  tx: Prisma.TransactionClient,
  context: UserContext,
  type: SalesApprovalRecordType,
  recordId: string,
): Promise<void> {
  const { count } = await tx.salesApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context.membershipId },
  });
  await recordApprovalCancelled(tx, context, { moduleKey: "sales", recordType: APPROVAL_RECORD[type].recordType, noun: APPROVAL_RECORD[type].noun, recordId, count });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

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
} satisfies Prisma.SalesApprovalSelect;

type ApprovalRow = Prisma.SalesApprovalGetPayload<{ select: typeof APPROVAL_SELECT }>;

/**
 * The approval queue (PRD #17 §21, §132).
 *
 * Scope is applied by resolving the proposals the caller can reach and listing
 * only the approvals whose record survived, so the queue cannot become a back
 * door onto deals the reader may not open.
 */
export async function listApprovals(
  context: UserContext,
  options: { status?: "PENDING" | "DECIDED"; page?: number; limit?: number } = {},
) {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.view");

  const page = boundedPage(options.page);
  const limit = boundedLimit(options.limit);

  const reachable = await reachableProposalIds(context);

  const where: Prisma.SalesApprovalWhereInput = {
    companyId: context.companyId,
    ...(options.status === "PENDING" ? { status: "PENDING" } : {}),
    ...(options.status === "DECIDED" ? { status: { not: "PENDING" } } : {}),
    recordType: "PROPOSAL",
    recordId: { in: reachable },
  };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "sales.approvals.list",
    async (tx) => {
      const window = pageWindow(await tx.salesApproval.count({ where }), page, limit);
      const rows = await tx.salesApproval.findMany({
        where,
        orderBy: withTieBreaker([{ status: "asc" }, { submittedAt: "desc" }]),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: APPROVAL_SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const data = await hydrate(context, rows);
  return { data, pagination: window };
}

/** How many decisions are waiting, for the overview (PRD #17 §21). */
export async function pendingApprovalCount(context: UserContext): Promise<number> {
  if (!can(context, "sales.proposal.view")) return 0;

  const reachable = await reachableProposalIds(context);
  if (reachable.length === 0) return 0;

  return prisma.salesApproval.count({
    where: {
      companyId: context.companyId,
      recordType: "PROPOSAL",
      status: "PENDING",
      recordId: { in: reachable },
    },
  });
}

/** Every approval cycle for one proposal, newest first (PRD #17 §132). */
export async function approvalHistory(
  context: UserContext,
  type: SalesApprovalRecordType,
  recordId: string,
): Promise<SalesApprovalDTO[]> {
  if (!can(context, "sales.proposal.view")) return [];

  const rows = await prisma.salesApproval.findMany({
    where: { companyId: context.companyId, recordType: type, recordId },
    orderBy: { submittedAt: "desc" },
    select: APPROVAL_SELECT,
  });

  return hydrate(context, rows);
}

async function reachableProposalIds(context: UserContext): Promise<string[]> {
  const rows = await prisma.proposal.findMany({
    where: buildProposalScopeWhere(context),
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function hydrate(
  context: UserContext,
  rows: ApprovalRow[],
): Promise<SalesApprovalDTO[]> {
  if (rows.length === 0) return [];

  const memberIds = new Set<string>();
  for (const row of rows) {
    memberIds.add(row.submittedByMemberId);
    if (row.decidedByMemberId) memberIds.add(row.decidedByMemberId);
  }

  const [members, proposals] = await Promise.all([
    prisma.companyMember.findMany({
      where: { id: { in: [...memberIds] } },
      select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.proposal.findMany({
      where: { id: { in: rows.map((row) => row.recordId) } },
      select: { id: true, proposalNumber: true, title: true, currency: true, totalAmount: true },
    }),
  ]);

  const byMember = new Map<string, MemberRef>(
    members.map((member) => [
      member.id,
      {
        memberId: member.id,
        fullName: `${member.user.firstName} ${member.user.lastName}`,
        active: member.status === "ACTIVE",
      },
    ]),
  );
  const byProposal = new Map(proposals.map((proposal) => [proposal.id, proposal]));

  return rows.map((row) => {
    const proposal = byProposal.get(row.recordId);
    const pending = row.status === "PENDING";
    const mine = row.submittedByMemberId === context.membershipId;
    const selfBlocked = mine && !can(context, "sales.approval.self");

    return {
      id: row.id,
      recordType: row.recordType,
      recordId: row.recordId,
      recordReference: proposal?.proposalNumber ?? "—",
      recordTitle: proposal?.title ?? "—",
      currency: proposal?.currency ?? null,
      amount: proposal ? toAmountString(proposal.totalAmount) : null,
      status: row.status,
      submittedBy: byMember.get(row.submittedByMemberId) ?? null,
      submittedAt: row.submittedAt.toISOString(),
      decidedBy: row.decidedByMemberId ? (byMember.get(row.decidedByMemberId) ?? null) : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
      capabilities: {
        canApprove: pending && !selfBlocked && canApproveType(context, row.recordType),
        canReject: pending && !selfBlocked && canRejectType(context, row.recordType),
      },
    };
  });
}
