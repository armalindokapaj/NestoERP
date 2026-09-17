import { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { assertApprovalGuard, type ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import type { UserContext } from "@/lib/context/types";
import { notifyApprovalDecided, notifyApprovalRequested, recordApprovalCancelled } from "@/lib/core/notifications/approval-notifications";

/**
 * Publishing requests (E-05D §21, §47; PRD #41 §48-§52).
 *
 * One row per submission, read by the Approvals Center; the unit's own state
 * machine stays the authority on what a unit is. A unit Ready for Publishing has
 * exactly one open request, and a published unit may carry one for its
 * unpublished changes — a partial unique index keeps it to one either way.
 * Deciding is conditional on the row still being open, so two reviewers pressing
 * at once cannot both succeed.
 */

type Tx = Prisma.TransactionClient;

const RECORD = { moduleKey: "projects", recordType: "project_unit", noun: "Unit" } as const;

export type PendingRequest = { id: string; submittedByMemberId: string; submittedAt: Date };

export async function pendingRequest(tx: Tx | Prisma.TransactionClient, companyId: string, unitId: string): Promise<PendingRequest | null> {
  return tx.unitPublicationApproval.findFirst({
    where: { companyId, recordType: "UNIT", recordId: unitId, status: "PENDING" },
    orderBy: { submittedAt: "desc" },
    select: { id: true, submittedByMemberId: true, submittedAt: true },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Opens a request, and asks everybody who may publish the unit and can open it (PRD #41 §40). */
export async function openRequest(tx: Tx, context: UserContext, unit: { id: string; projectId: string }): Promise<string> {
  const request = await tx.unitPublicationApproval
    .create({
      data: { companyId: context.companyId, projectId: unit.projectId, recordType: "UNIT", recordId: unit.id, status: "PENDING", submittedByMemberId: context.membershipId },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new AccessError("CONFLICT", "This unit is already waiting for review.", { code: "UNIT_ALREADY_SUBMITTED" });
      throw error;
    });
  await notifyApprovalRequested(tx, context, { ...RECORD, approvalId: request.id, recordId: unit.id, approvePermissions: ["project.unit.publish"] });
  return request.id;
}

/**
 * The open request a decision acts on. With a guard — the Approvals Center — it
 * must be the one the reviewer opened; without one, whatever is open, if anything.
 */
export async function requestForDecision(tx: Tx, companyId: string, unitId: string, guard: ApprovalGuard | undefined): Promise<PendingRequest | null> {
  const pending = await pendingRequest(tx, companyId, unitId);
  if (guard) {
    if (!pending) throw new AccessError("CONFLICT", "This unit is not waiting for a decision.", { code: "APPROVAL_ALREADY_DECIDED" });
    assertApprovalGuard(guard, pending);
  }
  return pending;
}

export async function decideRequest(tx: Tx, context: UserContext, request: PendingRequest, unitId: string, decision: "APPROVED" | "RETURNED", note: string | null): Promise<void> {
  const decided = await tx.unitPublicationApproval.updateMany({
    where: { companyId: context.companyId, id: request.id, status: "PENDING" },
    data: { status: decision, decidedByMemberId: context.membershipId, decidedAt: new Date(), decisionNote: note },
  });
  if (decided.count === 0) throw new AccessError("CONFLICT", "This request has already been decided.", { code: "APPROVAL_ALREADY_DECIDED" });
  await notifyApprovalDecided(tx, context, { ...RECORD, approvalId: request.id, recordId: unitId, decision, note, submittedByMemberId: request.submittedByMemberId });
}

/** Archiving closes whatever was waiting: nobody should publish a unit taken out of use (§32). */
export async function cancelRequests(tx: Tx, context: UserContext, unitId: string): Promise<void> {
  const cancelled = await tx.unitPublicationApproval.updateMany({
    where: { companyId: context.companyId, recordType: "UNIT", recordId: unitId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context.membershipId },
  });
  await recordApprovalCancelled(tx, context, { ...RECORD, recordId: unitId, count: cancelled.count });
}
