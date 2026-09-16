import type { FinanceCostCategory, Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { canTransitionCommitment } from "./commitment.status";

/**
 * The Finance-owned door another module uses to keep a commitment in step with
 * its own record (PRD #48 §11, §62, §76, §77).
 *
 * Procurement raises the money undertaking; Finance owns the row it lands in.
 * These functions run inside the caller's transaction so approval and
 * commitment commit together (PRD #48 §23-§25), but the invariants are
 * Finance's: company scope, one commitment per source record, a legal status
 * transition, and a manual commitment never touched by a foreign module
 * (PRD #15 §128).
 *
 * Authorisation stays with the caller. Approving a purchase order is not a
 * Finance permission, and the buyer who holds it is not required to hold one
 * (PRD #19 §123) — what Finance enforces here is consistency, not access.
 *
 * That is also why these writes bind the status they read themselves rather
 * than going through `applyTransition`: the legality is the commitment
 * machine's, asked through `canTransitionCommitment`, but applying a
 * transition would ask the buyer for Finance's own grant (PRD #49 §64).
 */

export type CommitmentSource = {
  /** The module that raised it — `procurement`, and nothing else in V0.1. */
  module: string;
  entityType: string;
  entityId: string;
};

export type SourcedCommitmentInput = {
  source: CommitmentSource;
  projectId: string | null;
  reference: string | null;
  description: string;
  /** Snapshotted: renaming the supplier later must not rewrite what was committed (PRD #19 §120). */
  counterpartyName: string | null;
  category: FinanceCostCategory;
  currency: string;
  amount: Prisma.Decimal;
  expectedDate: Date | null;
};

/**
 * The commitment for one source record, created once and refreshed after.
 *
 * Idempotent by source reference rather than by the caller remembering an id:
 * a retry that lost its answer finds the commitment the first attempt made,
 * and the unique index on the source triple is what makes that true under
 * concurrency rather than by luck (PRD #48 §41, §44, §165).
 */
export async function ensureCommitmentForSource(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: SourcedCommitmentInput,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.commitment.findFirst({
    where: {
      companyId: context.companyId,
      sourceModule: input.source.module,
      sourceEntityType: input.source.entityType,
      sourceEntityId: input.source.entityId,
    },
    select: { id: true, status: true },
  });

  if (existing) {
    // A cancelled or closed commitment is history. Re-approving the order does
    // not reopen it — Finance would be claiming money it had written off
    // (PRD #48 §132, §133).
    if (!canTransitionCommitment(existing.status, "APPROVED")) {
      throw new AccessError(
        "CONFLICT",
        `The commitment for this record is ${existing.status.toLowerCase()} and cannot be reopened. Raise a new order.`,
        { code: "COMMITMENT_NOT_REOPENABLE" },
      );
    }
    const refreshed = await tx.commitment.updateMany({
      // Conditional on the status it was read in: another transaction that
      // cancelled it between the read and here must not be overwritten
      // (PRD #48 §49, §244).
      where: { id: existing.id, companyId: context.companyId, status: existing.status },
      data: {
        projectId: input.projectId,
        reference: input.reference,
        description: input.description,
        counterpartyName: input.counterpartyName,
        currency: input.currency,
        amount: input.amount,
        expectedDate: input.expectedDate,
        status: "APPROVED",
        updatedByMemberId: context.membershipId,
      },
    });
    if (refreshed.count === 0) {
      throw new AccessError("CONFLICT", "The commitment for this record changed while it was being written. Try again.", {
        code: "COMMITMENT_CHANGED",
      });
    }
    return { id: existing.id, created: false };
  }

  const commitment = await tx.commitment.create({
    data: {
      companyId: context.companyId,
      projectId: input.projectId,
      reference: input.reference,
      description: input.description,
      counterpartyName: input.counterpartyName,
      category: input.category,
      currency: input.currency,
      amount: input.amount,
      expectedDate: input.expectedDate,
      status: "APPROVED",
      sourceModule: input.source.module,
      sourceEntityType: input.source.entityType,
      sourceEntityId: input.source.entityId,
      createdByMemberId: context.membershipId,
    },
    select: { id: true },
  });

  return { id: commitment.id, created: true };
}

/**
 * Closes or cancels the commitment a source record raised.
 *
 * Answers whether anything moved, so the caller can tell "already settled"
 * from "settled by me" without reading Finance's tables. A commitment that is
 * not this source's is never touched, whatever id the caller passes.
 */
export async function settleCommitmentForSource(
  tx: Prisma.TransactionClient,
  context: UserContext,
  source: CommitmentSource,
  next: "CLOSED" | "CANCELLED",
): Promise<boolean> {
  const existing = await tx.commitment.findFirst({
    where: {
      companyId: context.companyId,
      sourceModule: source.module,
      sourceEntityType: source.entityType,
      sourceEntityId: source.entityId,
    },
    select: { id: true, status: true },
  });
  if (!existing) return false;
  // Settling twice is not an error — the second caller wanted what it found
  // (PRD #48 §39, §54).
  if (existing.status === next) return false;
  if (!canTransitionCommitment(existing.status, next)) return false;

  const moved = await tx.commitment.updateMany({
    where: { id: existing.id, companyId: context.companyId, status: existing.status },
    data: { status: next, updatedByMemberId: context.membershipId },
  });
  return moved.count > 0;
}
