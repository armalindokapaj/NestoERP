import { PrismaClient } from "@prisma/client";

/**
 * Direct database access for E2E setup and teardown (PRD #9 §126).
 *
 * A spec that changes seeded state must put it back, or the second run of the
 * suite tests a different world from the first. Approving the last pending
 * invoice and leaving it approved is exactly how a suite quietly stops
 * asserting anything.
 */
export const db = new PrismaClient();

/**
 * Returns the approval fixtures to the state the seed documents.
 *
 * Procurement runs its own approval service now (PRD #19), so this resets the
 * real records rather than the shell's: the requests and orders the seed leaves
 * awaiting a decision, and the approval cycles attached to them.
 */
export async function resetApprovalFixtures(): Promise<void> {
  await db.procurementApproval.updateMany({
    where: {
      id: {
        in: [
          "procurement_approval_001",
          "procurement_approval_002",
          "procurement_approval_003",
          "procurement_approval_008",
        ],
      },
    },
    data: { status: "PENDING", decidedByMemberId: null, decidedAt: null, decisionNote: null },
  });

  await db.purchaseRequest.updateMany({
    where: { id: { in: ["request_005", "request_009", "request_016"] } },
    data: {
      status: "PENDING_APPROVAL",
      approvedAt: null,
      approvedByMemberId: null,
      rejectedAt: null,
      rejectedByMemberId: null,
      rejectionReason: null,
    },
  });

  await db.purchaseOrder.updateMany({
    where: { id: "order_009" },
    data: {
      status: "PENDING_APPROVAL",
      approvedAt: null,
      approvedByMemberId: null,
      rejectedAt: null,
      rejectedByMemberId: null,
      rejectionReason: null,
      issuedAt: null,
    },
  });
}

/** Removes the projects a spec created, so a rerun starts from the seed. */
export async function removeTestProjects(codePrefix: string): Promise<void> {
  const projects = await db.project.findMany({
    where: { code: { startsWith: codePrefix } },
    select: { id: true },
  });

  if (projects.length === 0) return;
  const ids = projects.map((project) => project.id);

  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.projectMember.deleteMany({ where: { projectId: { in: ids } } });
  await db.project.deleteMany({ where: { id: { in: ids } } });
}

/** Removes the tasks a spec created, so a rerun starts from the seed. */
export async function removeTestTasks(titlePrefix: string): Promise<void> {
  const tasks = await db.task.findMany({
    where: { title: { startsWith: titlePrefix } },
    select: { id: true },
  });

  if (tasks.length === 0) return;
  const ids = tasks.map((task) => task.id);

  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.task.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Returns the ACME primary-contact fixture to the state the seed documents.
 *
 * The primary-contact spec necessarily changes seeded data, so it puts it back
 * here rather than by clicking through the UI a second time — a restore step
 * that can itself fail is not a restore step.
 */
export async function resetPrimaryContactFixture(): Promise<void> {
  await db.contact.updateMany({
    where: { clientId: "client_acme", isPrimary: true },
    data: { isPrimary: false },
  });
  await db.contact.updateMany({
    where: { clientId: "client_acme", firstName: "Ana", lastName: "Beqiri" },
    data: { isPrimary: true },
  });
}

/** Removes the clients a spec created, so a rerun starts from the seed. */
export async function removeTestClients(namePrefix: string): Promise<void> {
  const clients = await db.client.findMany({
    where: { name: { startsWith: namePrefix } },
    select: { id: true },
  });

  if (clients.length === 0) return;
  const ids = clients.map((client) => client.id);

  const contacts = await db.contact.findMany({
    where: { clientId: { in: ids } },
    select: { id: true },
  });

  await db.activity.deleteMany({
    where: { entityId: { in: [...ids, ...contacts.map((contact) => contact.id)] } },
  });
  await db.contact.deleteMany({ where: { clientId: { in: ids } } });
  await db.client.deleteMany({ where: { id: { in: ids } } });
}

/** Removes the documents a spec uploaded, so a rerun starts from the seed. */
export async function removeTestDocuments(namePrefix: string): Promise<void> {
  const documents = await db.document.findMany({
    where: { name: { startsWith: namePrefix } },
    select: { id: true },
  });

  if (documents.length === 0) return;
  const ids = documents.map((document) => document.id);

  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.document.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Returns the Team fixtures to the state the seed documents.
 *
 * The membership specs necessarily change access, so they put it back here
 * rather than by clicking through the UI a second time — a restore step that
 * can itself fail is not a restore step.
 */
export async function resetTeamFixtures(): Promise<void> {
  await db.companyMember.updateMany({
    where: { user: { email: "viewer@nesto.test" } },
    data: { status: "ACTIVE", deactivatedAt: null, deactivatedByMemberId: null },
  });

  await db.companyMember.updateMany({
    where: { user: { email: "invited-consultant@nesto.test" } },
    data: { status: "INVITED", joinedAt: null },
  });

  await db.companyInvite.updateMany({
    where: { id: "invite_pending" },
    data: { status: "PENDING", acceptedAt: null, cancelledAt: null },
  });
}

/** Removes the invitations a spec created, so a rerun starts from the seed. */
export async function removeTestInvitations(emailPrefix: string): Promise<void> {
  const invites = await db.companyInvite.findMany({
    where: { email: { startsWith: emailPrefix } },
    select: { id: true, companyMemberId: true },
  });

  if (invites.length === 0) return;
  const ids = invites.map((invite) => invite.id);
  const memberIds = invites
    .map((invite) => invite.companyMemberId)
    .filter((id): id is string => id !== null);

  await db.activity.deleteMany({ where: { entityId: { in: [...ids, ...memberIds] } } });
  await db.companyInvite.deleteMany({ where: { id: { in: ids } } });
  if (memberIds.length > 0) {
    await db.session.deleteMany({ where: { membershipId: { in: memberIds } } });
    await db.companyMember.deleteMany({ where: { id: { in: memberIds } } });
  }
}

/** Removes the departments a spec created, so a rerun starts from the seed. */
export async function removeTestDepartments(namePrefix: string): Promise<void> {
  const rows = await db.department.findMany({
    where: { name: { startsWith: namePrefix } },
    select: { id: true },
  });

  if (rows.length === 0) return;
  const ids = rows.map((row) => row.id);

  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.companyMember.updateMany({
    where: { departmentId: { in: ids } },
    data: { departmentId: null },
  });
  await db.department.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Returns the Finance fixtures to the state the seed documents.
 *
 * The approval and payment specs necessarily change money, so they put it back
 * here rather than by clicking through the UI a second time.
 */
export async function resetFinanceFixtures(): Promise<void> {
  await db.invoice.updateMany({
    where: { id: "invoice_008" },
    data: { status: "PENDING_APPROVAL", sentAt: null },
  });
  await db.invoice.updateMany({
    where: { id: "invoice_009" },
    data: { status: "APPROVED", sentAt: null },
  });
  await db.expense.updateMany({
    where: { id: { in: ["expense_011", "expense_012"] } },
    data: { status: "PENDING_APPROVAL" },
  });
  await db.commitment.updateMany({
    where: { id: "commitment_006" },
    data: { status: "PENDING_APPROVAL" },
  });
  await db.projectBudget.updateMany({
    where: { id: "budget_c_v2" },
    data: { status: "PENDING_APPROVAL", isCurrent: false, approvedAt: null },
  });
  await db.projectBudget.updateMany({
    where: { id: "budget_c_v1" },
    data: { isCurrent: true },
  });

  await db.financeApproval.updateMany({
    where: {
      id: { in: ["approval_001", "approval_002", "approval_003", "approval_004", "approval_005"] },
    },
    data: { status: "PENDING", decidedByMemberId: null, decidedAt: null, decisionNote: null },
  });
}

/** Removes the finance records a spec created, so a rerun starts from the seed. */
export async function removeTestFinanceRecords(prefix: string): Promise<void> {
  const invoices = await db.invoice.findMany({
    where: { invoiceNumber: { startsWith: prefix } },
    select: { id: true },
  });
  const expenses = await db.expense.findMany({
    where: { description: { startsWith: prefix } },
    select: { id: true },
  });
  const commitments = await db.commitment.findMany({
    where: { description: { startsWith: prefix } },
    select: { id: true },
  });

  const ids = [
    ...invoices.map((row) => row.id),
    ...expenses.map((row) => row.id),
    ...commitments.map((row) => row.id),
  ];
  if (ids.length === 0) return;

  // Payments first: a record with one cannot be deleted.
  await db.payment.deleteMany({
    where: {
      OR: [
        { invoiceId: { in: invoices.map((row) => row.id) } },
        { expenseId: { in: expenses.map((row) => row.id) } },
      ],
    },
  });
  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.financeApproval.deleteMany({ where: { recordId: { in: ids } } });
  await db.invoiceLineItem.deleteMany({
    where: { invoiceId: { in: invoices.map((row) => row.id) } },
  });
  await db.invoice.deleteMany({ where: { id: { in: invoices.map((row) => row.id) } } });
  await db.expense.deleteMany({ where: { id: { in: expenses.map((row) => row.id) } } });
  await db.commitment.deleteMany({ where: { id: { in: commitments.map((row) => row.id) } } });
}

/**
 * Returns the HR fixtures to the state the seed documents (PRD #16 §330).
 *
 * Deciding a leave request changes it, and a decided request also writes and
 * removes attendance days — so the reset puts the request, its decision and the
 * attendance it generated back where the seed left them.
 */
export async function resetHrFixtures(): Promise<void> {
  const decided = ["leave_008", "leave_009", "leave_010", "leave_011"];

  // The attendance an approval would have written for these requests.
  await db.attendanceRecord.deleteMany({ where: { sourceEntityId: { in: decided } } });

  await db.leaveRequest.updateMany({
    where: { id: { in: decided } },
    data: {
      status: "PENDING",
      approvedByMemberId: null,
      approvedAt: null,
      rejectedByMemberId: null,
      rejectedAt: null,
      cancelledByMemberId: null,
      cancelledAt: null,
      decisionNote: null,
    },
  });

  await db.leaveRequest.updateMany({
    where: { id: { in: ["leave_012", "leave_013"] } },
    data: { status: "DRAFT", submittedAt: null },
  });

  // usedDays is derived from approved leave, so it is recomputed rather than
  // restored to a number written down somewhere (PRD #16 §219).
  const balances = await db.leaveBalance.findMany({
    select: { id: true, employeeProfileId: true, leaveType: true, year: true },
  });

  for (const balance of balances) {
    const used = await db.leaveRequest.aggregate({
      where: {
        employeeProfileId: balance.employeeProfileId,
        leaveType: balance.leaveType,
        status: "APPROVED",
        startDate: {
          gte: new Date(Date.UTC(balance.year, 0, 1)),
          lte: new Date(Date.UTC(balance.year, 11, 31, 23, 59, 59)),
        },
      },
      _sum: { days: true },
    });

    await db.leaveBalance.update({
      where: { id: balance.id },
      data: { usedDays: used._sum.days ?? 0 },
    });
  }
}

/** Removes the HR records a spec created, so a rerun starts from the seed. */
export async function removeTestHrRecords(prefix: string): Promise<void> {
  const requests = await db.leaveRequest.findMany({
    where: { reason: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = requests.map((row) => row.id);

  if (ids.length > 0) {
    await db.attendanceRecord.deleteMany({ where: { sourceEntityId: { in: ids } } });
    await db.activity.deleteMany({ where: { entityId: { in: ids } } });
    await db.leaveRequest.deleteMany({ where: { id: { in: ids } } });
  }

  await db.attendanceRecord.deleteMany({ where: { notes: { startsWith: prefix } } });

  const pay = await db.compensation.findMany({
    where: { notes: { startsWith: prefix } },
    select: { id: true, employeeProfileId: true },
  });

  if (pay.length > 0) {
    await db.compensation.deleteMany({ where: { id: { in: pay.map((row) => row.id) } } });
    // Reopen the record each deleted one had closed, so every employee is left
    // with exactly one current pay level again (PRD #16 §189).
    await db.$executeRawUnsafe(
      `UPDATE "compensations" c SET "effectiveTo" = NULL
       WHERE c."effectiveTo" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "compensations" o
           WHERE o."employeeProfileId" = c."employeeProfileId" AND o."effectiveTo" IS NULL
         )`,
    );
  }
}

/**
 * Returns the Sales fixtures to the state the seed documents (PRD #17 §313).
 *
 * A spec that approves the last pending proposal and leaves it approved is
 * exactly how a suite quietly stops asserting anything about the approval
 * queue.
 */
export async function resetSalesFixtures(): Promise<void> {
  await db.salesApproval.updateMany({
    where: { id: { in: ["sales_approval_001", "sales_approval_002"] } },
    data: { status: "PENDING", decidedByMemberId: null, decidedAt: null, decisionNote: null },
  });

  await db.proposal.updateMany({
    where: { id: { in: ["proposal_004", "proposal_005"] } },
    data: { status: "PENDING_APPROVAL", sentAt: null, acceptedAt: null, declinedAt: null },
  });

  await db.proposal.updateMany({
    where: { id: "proposal_006" },
    data: { status: "APPROVED", sentAt: null, acceptedAt: null, declinedAt: null },
  });

  await db.proposal.updateMany({
    where: { id: "proposal_003" },
    data: { status: "DRAFT", sentAt: null },
  });

  await db.lead.updateMany({
    where: { id: { in: ["lead_001", "lead_004", "lead_012"] } },
    data: { status: "QUALIFIED", disqualifyReason: null, convertedAt: null, convertedClientId: null },
  });

  await db.lead.updateMany({
    where: { id: { in: ["lead_002", "lead_005"] } },
    data: { status: "NEW", disqualifyReason: null },
  });

  await db.opportunity.updateMany({
    where: { id: "opportunity_003" },
    data: { stage: "QUALIFIED", actualCloseDate: null, lostReason: null, lostNote: null },
  });
}

/**
 * Removes the Sales records a spec created, so a rerun starts from the seed.
 *
 * Deleted in dependency order: a proposal restrains its opportunity, and an
 * opportunity restrains its lead.
 */
export async function removeTestSalesRecords(prefix: string): Promise<void> {
  const proposals = await db.proposal.findMany({
    where: { OR: [{ title: { startsWith: prefix } }, { proposalNumber: { startsWith: prefix } }] },
    select: { id: true },
  });
  const proposalIds = proposals.map((row) => row.id);

  if (proposalIds.length > 0) {
    await db.salesApproval.deleteMany({ where: { recordId: { in: proposalIds } } });
    await db.activity.deleteMany({ where: { entityId: { in: proposalIds } } });
    await db.proposal.deleteMany({ where: { id: { in: proposalIds } } });
  }

  const opportunities = await db.opportunity.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true },
  });
  const opportunityIds = opportunities.map((row) => row.id);

  if (opportunityIds.length > 0) {
    await db.proposal.deleteMany({ where: { opportunityId: { in: opportunityIds } } });
    await db.activity.deleteMany({ where: { entityId: { in: opportunityIds } } });
    await db.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  }

  const leads = await db.lead.findMany({
    where: { OR: [{ name: { startsWith: prefix } }, { companyName: { startsWith: prefix } }] },
    select: { id: true, convertedClientId: true },
  });

  if (leads.length > 0) {
    await db.activity.deleteMany({ where: { entityId: { in: leads.map((row) => row.id) } } });
    await db.lead.deleteMany({ where: { id: { in: leads.map((row) => row.id) } } });
  }

  // Clients and projects a conversion created, addressed by the same prefix.
  const projects = await db.project.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true },
  });
  if (projects.length > 0) {
    const ids = projects.map((row) => row.id);
    await db.projectMember.deleteMany({ where: { projectId: { in: ids } } });
    await db.activity.deleteMany({ where: { entityId: { in: ids } } });
    await db.project.deleteMany({ where: { id: { in: ids } } });
  }

  const clients = await db.client.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true },
  });
  if (clients.length > 0) {
    const ids = clients.map((row) => row.id);
    await db.contact.deleteMany({ where: { clientId: { in: ids } } });
    await db.activity.deleteMany({ where: { entityId: { in: ids } } });
    await db.client.deleteMany({ where: { id: { in: ids } } });
  }
}

/**
 * Puts the Legal fixtures back the way the seed left them (PRD #18 §406–§417).
 *
 * The contracts spec walks real lifecycle actions — submitting for review,
 * approving, signing, activating, terminating — so the records it touches end
 * the run in a different state than they started. Restoring them keeps a rerun
 * honest rather than dependent on the order the last one happened to take.
 */
export async function resetContractFixtures(): Promise<void> {
  await db.contractApproval.updateMany({
    where: { id: { in: ["contract_approval_001", "contract_approval_002"] } },
    data: { status: "PENDING", decidedByMemberId: null, decidedAt: null, decisionNote: null },
  });

  await db.contract.updateMany({
    where: { id: "contract_010" },
    data: { status: "DRAFT" },
  });

  await db.contract.updateMany({
    where: { id: "contract_011" },
    data: { status: "IN_REVIEW" },
  });

  await db.contract.updateMany({
    where: { id: { in: ["contract_012", "contract_013"] } },
    data: { status: "PENDING_APPROVAL" },
  });

  await db.contract.updateMany({
    where: { id: "contract_014" },
    data: { status: "APPROVED", sentAt: null, signedDate: null },
  });

  await db.contract.updateMany({
    where: { id: "contract_015" },
    data: { status: "SENT", signedDate: null },
  });

  await db.contract.updateMany({
    where: { id: "contract_016" },
    data: { status: "SIGNED" },
  });

  await db.contract.updateMany({
    where: { id: "contract_019" },
    data: { status: "CANCELLED", archivedAt: null },
  });
}

/** Removes the Legal records a spec created, so a rerun starts from the seed. */
export async function removeTestContractRecords(prefix: string): Promise<void> {
  const contracts = await db.contract.findMany({
    where: { OR: [{ title: { startsWith: prefix } }, { contractNumber: { startsWith: prefix } }] },
    select: { id: true },
  });
  const contractIds = contracts.map((row) => row.id);

  const amendments = await db.contractAmendment.findMany({
    where: {
      OR: [
        { contractId: { in: contractIds } },
        { title: { startsWith: prefix } },
        { amendmentNumber: { startsWith: prefix } },
      ],
    },
    select: { id: true },
  });
  const amendmentIds = amendments.map((row) => row.id);

  // Obligations a spec created against a *seeded* contract go too, matched by
  // title — otherwise they accumulate on every run.
  await db.contractObligation.deleteMany({
    where: { OR: [{ contractId: { in: contractIds } }, { title: { startsWith: prefix } }] },
  });

  await db.contractApproval.deleteMany({
    where: { recordId: { in: [...contractIds, ...amendmentIds] } },
  });
  await db.contractAmendment.deleteMany({ where: { id: { in: amendmentIds } } });
  await db.contractParty.deleteMany({
    where: { OR: [{ contractId: { in: contractIds } }, { name: { startsWith: prefix } }] },
  });
  await db.task.deleteMany({ where: { title: { startsWith: prefix } } });
  await db.activity.deleteMany({ where: { entityId: { in: contractIds } } });
  await db.contract.deleteMany({ where: { id: { in: contractIds } } });
}

/**
 * Puts the Procurement fixtures back the way the seed left them (PRD #19 §294).
 *
 * The procurement spec walks real lifecycle actions — submitting, approving,
 * issuing, receiving — so the records it touches end the run in a different
 * state than they started.
 */
export async function resetProcurementFixtures(): Promise<void> {
  await db.procurementApproval.updateMany({
    where: {
      id: {
        in: [
          "procurement_approval_001",
          "procurement_approval_002",
          "procurement_approval_003",
          "procurement_approval_008",
        ],
      },
    },
    data: { status: "PENDING", decidedByMemberId: null, decidedAt: null, decisionNote: null },
  });

  await db.purchaseRequest.updateMany({
    where: { id: { in: ["request_005", "request_009", "request_016"] } },
    data: {
      status: "PENDING_APPROVAL",
      approvedAt: null,
      approvedByMemberId: null,
      rejectedAt: null,
      rejectedByMemberId: null,
      rejectionReason: null,
    },
  });

  await db.purchaseRequest.updateMany({
    where: { id: { in: ["request_007", "request_019"] } },
    data: { status: "DRAFT", submittedAt: null },
  });

  await db.purchaseOrder.updateMany({
    where: { id: "order_009" },
    data: {
      status: "PENDING_APPROVAL",
      approvedAt: null,
      approvedByMemberId: null,
      issuedAt: null,
      rejectedAt: null,
      rejectedByMemberId: null,
      rejectionReason: null,
    },
  });

  await db.purchaseOrder.updateMany({
    where: { id: "order_010" },
    data: { status: "DRAFT", submittedAt: null, financeCommitmentId: null },
  });

  await db.rFQ.updateMany({ where: { id: "rfq_007" }, data: { status: "DRAFT", issuedAt: null } });

  /*
   * An order a run booked goods against.
   *
   * Deleting the receipt does not re-derive the order — receiving status is
   * computed when a receipt is written or voided, not on read — so the order
   * has to be put back explicitly (PRD #19 §141).
   */
  await db.goodsReceiptItem.deleteMany({
    where: { goodsReceipt: { purchaseOrderId: "order_004", id: { notIn: SEEDED_RECEIPTS } } },
  });
  await db.goodsReceipt.deleteMany({
    where: { purchaseOrderId: "order_004", id: { notIn: SEEDED_RECEIPTS } },
  });
  await db.purchaseOrder.updateMany({
    where: { id: "order_004" },
    data: { status: "ISSUED" },
  });

  /*
   * Approval cycles a run opened on a seeded record.
   *
   * Putting the record back to DRAFT is not enough: one pending cycle per
   * record is the rule, so a leftover cycle makes the next run's submit
   * conflict rather than fail informatively (PRD #19 §213).
   */
  await db.procurementApproval.deleteMany({
    where: {
      recordId: { in: ["request_007", "request_019", "order_010"] },
      id: { notIn: SEEDED_PROCUREMENT_APPROVALS },
    },
  });
}

/** The receipts the seed itself creates, which must survive a reset. */
const SEEDED_RECEIPTS = Array.from(
  { length: 18 },
  (_, index) => `receipt_${String(index + 1).padStart(3, "0")}`,
);

/** The approval cycles the seed itself creates, which must survive a reset. */
const SEEDED_PROCUREMENT_APPROVALS = [
  "procurement_approval_001",
  "procurement_approval_002",
  "procurement_approval_003",
  "procurement_approval_004",
  "procurement_approval_005",
  "procurement_approval_006",
  "procurement_approval_007",
  "procurement_approval_008",
  "procurement_approval_009",
  "procurement_approval_010",
  "procurement_approval_011",
];

/** Removes the Procurement records a spec created, so a rerun starts from the seed. */
export async function removeTestProcurementRecords(prefix: string): Promise<void> {
  const orders = await db.purchaseOrder.findMany({
    where: { OR: [{ notes: { startsWith: prefix } }, { items: { some: { description: { startsWith: prefix } } } }] },
    select: { id: true },
  });
  const orderIds = orders.map((row) => row.id);

  const rfqs = await db.rFQ.findMany({
    where: { title: { startsWith: prefix } },
    select: { id: true },
  });
  const rfqIds = rfqs.map((row) => row.id);

  const requests = await db.purchaseRequest.findMany({
    where: { title: { startsWith: prefix } },
    select: { id: true },
  });
  const requestIds = requests.map((row) => row.id);

  await db.goodsReceiptItem.deleteMany({
    where: { OR: [{ goodsReceipt: { purchaseOrderId: { in: orderIds } } }, { goodsReceipt: { deliveryReference: { startsWith: prefix } } }] },
  });
  await db.goodsReceipt.deleteMany({
    where: { OR: [{ purchaseOrderId: { in: orderIds } }, { deliveryReference: { startsWith: prefix } }] },
  });
  await db.supplierQuoteItem.deleteMany({
    where: { supplierQuote: { rfqId: { in: rfqIds } } },
  });
  await db.supplierQuote.deleteMany({ where: { rfqId: { in: rfqIds } } });
  await db.rFQSupplier.deleteMany({ where: { rfqId: { in: rfqIds } } });
  await db.rFQItem.deleteMany({ where: { rfqId: { in: rfqIds } } });
  await db.procurementApproval.deleteMany({
    where: { recordId: { in: [...orderIds, ...requestIds] } },
  });
  await db.commitment.deleteMany({ where: { sourceEntityId: { in: orderIds } } });
  await db.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
  await db.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: { in: requestIds } } });
  await db.activity.deleteMany({ where: { entityId: { in: [...orderIds, ...rfqIds, ...requestIds] } } });
  await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  await db.rFQ.deleteMany({ where: { id: { in: rfqIds } } });
  await db.purchaseRequest.deleteMany({ where: { id: { in: requestIds } } });
  await db.supplier.deleteMany({ where: { name: { startsWith: prefix } } });
}
