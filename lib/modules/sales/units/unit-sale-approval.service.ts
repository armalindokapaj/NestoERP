import { Prisma } from "@prisma/client";

import { AccessError, assertPermission } from "@/lib/access/guards";
import { assertApprovalGuard, type ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { notifyApprovalDecided, notifyApprovalRequested, recordApprovalCancelled } from "@/lib/core/notifications/approval-notifications";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { fail } from "@/lib/modules/project-structure/structure.service";
import { resolveUnitSalesSettings } from "@/lib/modules/settings/sales-settings.service";
import { recordActivity } from "@/lib/modules/shared/activity";
import { activeReservation, findSellableUnit, lockedProfile, SALES_ACTIVITY_MODULE, UNIT_ENTITY } from "./unit-sales.core";
import { canMarkUnitSold, moneyText } from "./unit-sales.rules";

/**
 * Approving a unit's sale, where the company's Sold rule is Manual approval
 * (E-05F §42). Sales asks for approval of the reservation in front of them; the
 * Approvals Center or the unit page decides it; an approval unlocks Mark Sold for
 * that reservation and nothing else — a new reservation needs a new one, and a
 * reservation that ends takes its pending request with it.
 *
 * One row per request, the shape every approval source shares (PRD #41 §48), and
 * one pending request per unit by a partial unique index. Deciding is conditional
 * on the row still being pending, so two approvers pressing at once cannot both
 * succeed, and nobody decides their own request.
 */

type Tx = Prisma.TransactionClient;
// Audited under the Center source that owns the cycle, not unit publishing's (AUD-10 §4, A7).
const RECORD = { moduleKey: "projects", providerKey: "unit_sales", recordType: "project_unit", noun: "Unit sale" } as const;

export async function pendingSaleApproval(client: Tx | typeof prisma, companyId: string, unitId: string) {
  return client.unitSaleApproval.findFirst({ where: { companyId, recordType: "UNIT", recordId: unitId, status: "PENDING" }, orderBy: { submittedAt: "desc" }, select: { id: true, reservationId: true, submittedByMemberId: true, submittedAt: true } });
}

/** The latest request for this reservation's sale, whatever its outcome. */
export async function latestSaleApproval(client: Tx | typeof prisma, companyId: string, unitId: string, reservationId: string) {
  return client.unitSaleApproval.findFirst({
    where: { companyId, recordType: "UNIT", recordId: unitId, reservationId },
    orderBy: { submittedAt: "desc" },
    select: { id: true, status: true, submittedByMemberId: true, submittedAt: true, decidedByMemberId: true, decidedAt: true, decisionNote: true, submissionNote: true },
  });
}

export async function requestSaleApproval(context: UserContext, unitId: string, input: { note: string | null }): Promise<{ approvalId: string }> {
  const unit = await findSellableUnit(context, unitId);
  assertPermission(context, "project.unit.mark_sold");
  const settings = await resolveUnitSalesSettings(context.companyId);
  if (settings.unitSoldRule !== "MANUAL_APPROVAL") throw fail("SALE_APPROVAL_NOT_REQUIRED", "This company does not approve sales before they are marked Sold.", "CONFLICT");

  return runInTransaction("sales.unit.sale_approval.request", async (tx) => {
    const profile = await lockedProfile(tx, unit);
    const reservation = await activeReservation(tx, context.companyId, unit.id);
    // Everything but the approval itself must already be in place (§42).
    const check = canMarkUnitSold({ status: profile.status, reservation: reservation ? { status: "ACTIVE", clientId: reservation.clientId, opportunityId: reservation.opportunityId, agreedPrice: moneyText(reservation.agreedPrice), expiresAt: reservation.expiresAt } : null });
    if (!check.allowed) throw fail("UNIT_NOT_SELLABLE_YET", `This sale cannot be sent for approval yet. Missing: ${check.missing.join(", ")}.`, "VALIDATION_ERROR", { missing: check.missing });
    const approval = await tx.unitSaleApproval
      .create({
        data: { companyId: context.companyId, projectId: unit.projectId, recordType: "UNIT", recordId: unit.id, reservationId: reservation!.id, submittedByMemberId: context.membershipId, submissionNote: input.note },
        select: { id: true },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw fail("SALE_APPROVAL_PENDING", "This sale is already waiting for approval.", "CONFLICT");
        throw error;
      });
    await notifyApprovalRequested(tx, context, { ...RECORD, approvalId: approval.id, recordId: unit.id, approvePermissions: ["project.unit.sale.approve"] });
    await recordActivity(tx, context, { module: SALES_ACTIVITY_MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_SALE_APPROVAL_REQUESTED", message: `asked for approval to sell ${unit.unitCode}`, metadata: { projectId: unit.projectId } });
    await recordUserAction(context, { actionKey: AuditAction.UNIT_SALE_APPROVAL_REQUESTED, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, after: { approvalId: approval.id, reservationId: reservation!.id, note: input.note } }, { tx });
    return { approvalId: approval.id };
  });
}

async function decide(context: UserContext, unitId: string, decision: "APPROVED" | "REJECTED", note: string | null, guard?: ApprovalGuard): Promise<void> {
  const unit = await findSellableUnit(context, unitId);
  assertPermission(context, "project.unit.sale.approve");
  if (decision === "REJECTED" && !note?.trim()) throw new AccessError("VALIDATION_ERROR", "Give a reason.", { reason: ["Give a reason."] });

  await runInTransaction("sales.unit.sale_approval.decide", async (tx) => {
    await lockedProfile(tx, unit);
    const pending = await pendingSaleApproval(tx, context.companyId, unit.id);
    if (!pending) throw new AccessError("CONFLICT", "This sale is not waiting for a decision.", { code: "APPROVAL_ALREADY_DECIDED" });
    assertApprovalGuard(guard, pending);
    if (pending.submittedByMemberId === context.membershipId) throw new AccessError("FORBIDDEN", "You cannot decide your own request.", { code: "SELF_APPROVAL" });
    const reservation = await activeReservation(tx, context.companyId, unit.id);
    if (!reservation || reservation.id !== pending.reservationId) throw fail("SALE_APPROVAL_STALE", "The reservation this approval was asked for has ended.", "CONFLICT");

    const decided = await tx.unitSaleApproval.updateMany({
      where: { companyId: context.companyId, id: pending.id, status: "PENDING" },
      data: { status: decision, decidedByMemberId: context.membershipId, decidedAt: new Date(), decisionNote: note },
    });
    if (decided.count === 0) throw new AccessError("CONFLICT", "This request has already been decided.", { code: "APPROVAL_ALREADY_DECIDED" });
    await notifyApprovalDecided(tx, context, { ...RECORD, approvalId: pending.id, recordId: unit.id, decision, note, submittedByMemberId: pending.submittedByMemberId });
    await recordActivity(tx, context, { module: SALES_ACTIVITY_MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: `UNIT_SALE_${decision}`, message: decision === "APPROVED" ? `approved the sale of ${unit.unitCode}` : `rejected the sale of ${unit.unitCode}`, metadata: { projectId: unit.projectId } });
    await recordUserAction(context, { actionKey: AuditAction.UNIT_SALE_APPROVAL_DECIDED, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, before: { approvalId: pending.id, status: "PENDING" }, after: { approvalId: pending.id, reservationId: pending.reservationId, status: decision, note } }, { tx });
  });
}

export function approveUnitSale(context: UserContext, unitId: string, note: string | null, guard?: ApprovalGuard): Promise<void> {
  return decide(context, unitId, "APPROVED", note, guard);
}

export function rejectUnitSale(context: UserContext, unitId: string, note: string, guard?: ApprovalGuard): Promise<void> {
  return decide(context, unitId, "REJECTED", note, guard);
}

/** A reservation that ends takes its pending sale approval with it (§42). */
export async function cancelSaleApprovals(tx: Tx, context: UserContext | null, companyId: string, unitId: string): Promise<void> {
  const cancelled = await tx.unitSaleApproval.updateMany({
    where: { companyId, recordType: "UNIT", recordId: unitId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context?.membershipId ?? null },
  });
  if (context) await recordApprovalCancelled(tx, context, { ...RECORD, recordId: unitId, count: cancelled.count });
}
