import { Prisma, type PrismaClient } from "@prisma/client";

import { seedStoredDocument } from "./document-objects";
import type { SeedMembers } from "./constants";

/**
 * Approvals Center demo data (PRD #41 §302).
 *
 * Every module already seeds its own pending approvals — invoices, expenses,
 * a budget, proposals, contracts, requests, leave, inspections, permits. What
 * the Center adds is what those cannot show on their own:
 *
 *   - Procurement's approval limits, so larger orders take a chain
 *   - one order part-way through that chain: Procurement and Finance have
 *     approved, and it waits on the CEO, with the supplier's quote attached
 *   - an upcoming delegation, so the delegation panel has something in it
 *
 * Dated relative to the day the seed runs. Demo data only; nothing here is
 * created outside the seed.
 */
type Members = SeedMembers;

const COMPANY_A = "company_demo_a";
const DAY = 86_400_000;

export const APPROVAL_SEED = {
  order: "order_approval_chain",
  approval: "procurement_approval_chain",
  quote: "document_po_142_quote",
  delegation: "approval_delegation_owner_ceo",
} as const;

export async function seedApprovalRecords(prisma: PrismaClient, members: Members) {
  const id = (key: string) => members.get(key)!;
  const now = Date.now();
  const at = (offset: number) => new Date(now + offset);

  await prisma.procurementApprovalPolicy.upsert({
    where: { companyId: COMPANY_A },
    update: { financeStepAbove: new Prisma.Decimal(25_000), executiveStepAbove: new Prisma.Decimal(75_000), executiveRoleKey: "CEO", currency: "EUR" },
    create: {
      companyId: COMPANY_A,
      financeStepAbove: new Prisma.Decimal(25_000),
      executiveStepAbove: new Prisma.Decimal(75_000),
      executiveRoleKey: "CEO",
      currency: "EUR",
      updatedByMemberId: id("user_procurement"),
    },
  });

  /* An order at the executive step --------------------------------------- */

  const lines = [
    { description: "Structural steel beams HEA 300, S355", quantity: 30, unit: "t", unitPrice: 1_850 },
    { description: "Delivery, crane offload and erection support", quantity: 1, unit: "lot", unitPrice: 12_500 },
  ];
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const tax = subtotal * 0.2;

  const orderData = {
    companyId: COMPANY_A,
    poNumber: "PO-2026-142",
    supplierId: "supplier_nordsteel",
    projectId: "project_a",
    orderDate: at(-3 * DAY),
    requiredDate: at(21 * DAY),
    currency: "EUR",
    subtotal: new Prisma.Decimal(subtotal),
    taxAmount: new Prisma.Decimal(tax),
    totalAmount: new Prisma.Decimal(subtotal + tax),
    status: "PENDING_APPROVAL" as const,
    notes: "Steel for the Riverside podium frame, to the revised structural package.",
    submittedAt: at(-2 * DAY),
    approvedAt: null,
    approvedByMemberId: null,
    rejectedAt: null,
    rejectedByMemberId: null,
    rejectionReason: null,
    createdByMemberId: id("user_pm"),
  };
  await prisma.purchaseOrder.upsert({ where: { id: APPROVAL_SEED.order }, update: orderData, create: { id: APPROVAL_SEED.order, ...orderData } });
  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: APPROVAL_SEED.order } });
  await prisma.purchaseOrderItem.createMany({
    data: lines.map((line, index) => {
      const lineSubtotal = line.quantity * line.unitPrice;
      return {
        purchaseOrderId: APPROVAL_SEED.order,
        description: line.description,
        quantity: new Prisma.Decimal(line.quantity),
        unit: line.unit,
        unitPrice: new Prisma.Decimal(line.unitPrice),
        taxRate: new Prisma.Decimal(0.2),
        subtotal: new Prisma.Decimal(lineSubtotal),
        taxAmount: new Prisma.Decimal(lineSubtotal * 0.2),
        totalAmount: new Prisma.Decimal(lineSubtotal * 1.2),
        sortOrder: index,
      };
    }),
  });

  const approvalData = {
    companyId: COMPANY_A,
    recordType: "PURCHASE_ORDER" as const,
    recordId: APPROVAL_SEED.order,
    status: "PENDING" as const,
    submittedByMemberId: id("user_pm"),
    submittedAt: at(-2 * DAY),
    decidedByMemberId: null,
    decidedAt: null,
    decisionNote: null,
  };
  await prisma.procurementApproval.upsert({ where: { id: APPROVAL_SEED.approval }, update: approvalData, create: { id: APPROVAL_SEED.approval, ...approvalData } });
  await prisma.approvalStep.deleteMany({ where: { providerKey: "procurement", approvalId: APPROVAL_SEED.approval } });
  await prisma.approvalStep.createMany({
    data: [
      {
        companyId: COMPANY_A, providerKey: "procurement", approvalId: APPROVAL_SEED.approval, stepNumber: 1, label: "Procurement",
        approverPermission: "procurement.order.approve", status: "APPROVED", decidedByMemberId: id("user_procurement"), decidedAt: at(-DAY),
        decisionNote: "Nordsteel was the only bid that met the S355 certification requirement.",
      },
      {
        companyId: COMPANY_A, providerKey: "procurement", approvalId: APPROVAL_SEED.approval, stepNumber: 2, label: "Finance",
        approverPermission: "procurement.order.finance_approve", status: "APPROVED", decidedByMemberId: id("user_finance"), decidedAt: at(-4 * 3_600_000),
        decisionNote: "Within the Riverside structural budget.",
      },
      { companyId: COMPANY_A, providerKey: "procurement", approvalId: APPROVAL_SEED.approval, stepNumber: 3, label: "Executive", approverRoleKey: "CEO", status: "PENDING" },
    ],
  });

  await seedStoredDocument(prisma, {
    id: APPROVAL_SEED.quote,
    companyId: COMPANY_A,
    name: "Nordsteel quotation Q-5521.pdf",
    projectId: "project_a",
    module: "procurement",
    entityType: "purchase_order",
    entityId: APPROVAL_SEED.order,
    uploadedByMemberId: id("user_procurement"),
    createdBy: "user_procurement",
  });

  /* An upcoming delegation ------------------------------------------------- */

  const startsAt = new Date(Math.floor((now + 20 * DAY) / DAY) * DAY);
  const delegationData = {
    companyId: COMPANY_A,
    fromMemberId: id("user_owner"),
    toMemberId: id("user_ceo"),
    providerKey: "documents",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 7 * DAY),
    reason: "Annual leave",
    active: true,
    revokedAt: null,
    revokedByMemberId: null,
    createdByMemberId: id("user_owner"),
  };
  await prisma.approvalDelegation.upsert({ where: { id: APPROVAL_SEED.delegation }, update: delegationData, create: { id: APPROVAL_SEED.delegation, ...delegationData } });

  return { policies: 1, chains: 1, delegations: 1 };
}
