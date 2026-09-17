import { Prisma } from "@prisma/client";

import { db } from "./db";

/**
 * Approvals Center fixtures for E2E (PRD #41 §279-§282).
 *
 * The seeded purchase order in a chain is put back exactly as the seed leaves
 * it — Procurement and Finance approved, the CEO's step pending — and every
 * record a spec creates is removed with the trail it left, so the next run
 * tests the same world.
 */

const COMPANY = "company_demo_a";
/** The amended contract is Nova's, so the amendment and its approval are Nova's too (E-06 §45). */
export const AMENDMENT_COMPANY = "company_demo_e";
export const CHAIN = { order: "order_approval_chain", approval: "procurement_approval_chain", poNumber: "PO-2026-142" } as const;

export async function memberId(email: string, companyId = COMPANY): Promise<string> {
  const member = await db.companyMember.findFirstOrThrow({ where: { companyId, user: { email } }, select: { id: true } });
  return member.id;
}

async function removeTrail(entityIds: string[], since: Date) {
  await db.notification.deleteMany({ where: { entityId: { in: entityIds }, createdAt: { gte: since } } });
  await db.notificationEventOutbox.deleteMany({ where: { entityId: { in: entityIds }, createdAt: { gte: since } } });
  await db.attentionItem.deleteMany({ where: { entityId: { in: entityIds }, createdAt: { gte: since } } });
  await db.activity.deleteMany({ where: { entityId: { in: entityIds }, createdAt: { gte: since } } });
}

export async function resetChainFixture(since = new Date(Date.now() - 60 * 60_000)): Promise<void> {
  await db.purchaseOrder.update({
    where: { id: CHAIN.order },
    data: { status: "PENDING_APPROVAL", approvedAt: null, approvedByMemberId: null, rejectedAt: null, rejectedByMemberId: null, rejectionReason: null, financeCommitmentId: null },
  });
  await db.procurementApproval.update({ where: { id: CHAIN.approval }, data: { status: "PENDING", decidedAt: null, decidedByMemberId: null, decisionNote: null } });
  await db.approvalStep.updateMany({
    where: { approvalId: CHAIN.approval, stepNumber: 3 },
    data: { status: "PENDING", decidedByMemberId: null, onBehalfOfMemberId: null, decidedAt: null, decisionNote: null },
  });
  await db.commitment.deleteMany({ where: { sourceEntityId: CHAIN.order } });
  await db.approvalDecisionReceipt.deleteMany({ where: { approvalId: CHAIN.approval } });
  await removeTrail([CHAIN.order], since);
}

/** A pending expense Finance submitted, so the CEO decides it. */
export async function createPendingExpense(description: string): Promise<{ expenseId: string; approvalId: string }> {
  const finance = await memberId("finance@nesto.test");
  const expense = await db.expense.create({
    data: {
      companyId: COMPANY,
      expenseNumber: `EXP-E2E-${Date.now().toString(36).toUpperCase()}`,
      projectId: "project_a",
      expenseDate: new Date(),
      category: "MATERIALS",
      description,
      payeeName: "Delta Equipment",
      currency: "EUR",
      netAmount: new Prisma.Decimal(4200),
      taxAmount: new Prisma.Decimal(840),
      totalAmount: new Prisma.Decimal(5040),
      status: "PENDING_APPROVAL",
      createdByMemberId: finance,
    },
    select: { id: true },
  });
  const approval = await db.financeApproval.create({
    data: { companyId: COMPANY, recordType: "EXPENSE", recordId: expense.id, status: "PENDING", submittedByMemberId: finance, submittedAt: new Date(Date.now() - 3 * 86_400_000) },
    select: { id: true },
  });
  return { expenseId: expense.id, approvalId: approval.id };
}

export async function removeExpenses(descriptionPrefix: string): Promise<void> {
  const rows = await db.expense.findMany({ where: { companyId: COMPANY, description: { startsWith: descriptionPrefix } }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  if (!ids.length) return;
  await removeTrail(ids, new Date(0));
  await db.financeApproval.deleteMany({ where: { recordId: { in: ids } } });
  await db.expense.deleteMany({ where: { id: { in: ids } } });
}

/** A pending amendment the Owner submitted on an active contract, for Legal to decide. */
export async function createPendingAmendment(title: string): Promise<{ amendmentId: string; approvalId: string }> {
  const owner = await memberId("owner@nesto.test", AMENDMENT_COMPANY);
  const amendment = await db.contractAmendment.create({
    data: {
      companyId: AMENDMENT_COMPANY,
      contractId: "contract_005",
      amendmentNumber: `AMD-E2E-${Date.now().toString(36).toUpperCase()}`,
      title,
      summary: "Adds the second basement level to the scope.",
      status: "PENDING_APPROVAL",
      newContractValue: new Prisma.Decimal(1_450_000),
      createdByMemberId: owner,
    },
    select: { id: true },
  });
  const approval = await db.contractApproval.create({
    data: { companyId: AMENDMENT_COMPANY, recordType: "AMENDMENT", recordId: amendment.id, status: "PENDING", submittedByMemberId: owner, submittedAt: new Date(Date.now() - 86_400_000) },
    select: { id: true },
  });
  return { amendmentId: amendment.id, approvalId: approval.id };
}

export async function removeAmendments(titlePrefix: string): Promise<void> {
  const rows = await db.contractAmendment.findMany({ where: { companyId: AMENDMENT_COMPANY, title: { startsWith: titlePrefix } }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  if (!ids.length) return;
  await removeTrail([...ids, "contract_005"], new Date(Date.now() - 60 * 60_000));
  await db.contractApproval.deleteMany({ where: { recordId: { in: ids } } });
  await db.contractAmendment.deleteMany({ where: { id: { in: ids } } });
}
