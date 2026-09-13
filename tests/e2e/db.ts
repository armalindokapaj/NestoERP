import { Prisma, PrismaClient } from "@prisma/client";

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

  await removeRecordTrail("task", ids);
  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.task.deleteMany({ where: { id: { in: ids } } });
}

/**
 * What PRD #38 hangs off a record without a foreign key: its discussion,
 * watchers, notifications, queued events and attention items. A spec that
 * removes a record it created removes these too, or the next run meets orphans.
 */
export async function removeRecordTrail(entityType: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const threads = await db.collaborationThread.findMany({
    where: { parentType: entityType, parentId: { in: ids } },
    select: { id: true },
  });
  const threadIds = threads.map((thread) => thread.id);
  if (threadIds.length > 0) {
    const comments = await db.comment.findMany({ where: { threadId: { in: threadIds } }, select: { id: true } });
    await db.mention.deleteMany({ where: { commentId: { in: comments.map((comment) => comment.id) } } });
    await db.comment.updateMany({ where: { threadId: { in: threadIds } }, data: { replyToId: null } });
    await db.comment.deleteMany({ where: { threadId: { in: threadIds } } });
    await db.subscription.deleteMany({ where: { threadId: { in: threadIds } } });
    await db.collaborationThread.deleteMany({ where: { id: { in: threadIds } } });
  }
  await db.notification.deleteMany({ where: { entityType, entityId: { in: ids } } });
  await db.notificationEventOutbox.deleteMany({ where: { entityType, entityId: { in: ids } } });
  await db.attentionItem.deleteMany({ where: { entityType, entityId: { in: ids } } });
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

  await removeRecordTrail("document", ids);
  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  // An upload session holds a foreign key to its document and a quota
  // reservation, so it has to go first (PRD #29 §68).
  await db.documentUploadSession.deleteMany({ where: { documentId: { in: ids } } });
  await db.document.deleteMany({ where: { id: { in: ids } } });

  await reconcileStorageUsageProjection();
}

/**
 * Rebuilds every company's storage usage projection (PRD #29 §148).
 *
 * The E2E suite deletes its documents directly rather than through the
 * product's lifecycle, which leaves the projection ahead of the rows. The seed
 * validation checks that the two agree, so this puts it back.
 */
export async function reconcileStorageUsageProjection(): Promise<void> {
  const companies = await db.company.findMany({ select: { id: true } });

  for (const company of companies) {
    const totals = await db.document.aggregate({
      where: {
        companyId: company.id,
        storageKey: { not: null },
        storageStatus: { not: "REJECTED" },
      },
      _sum: { sizeBytes: true },
      _count: true,
    });

    await db.companyStorageUsage.upsert({
      where: { companyId: company.id },
      create: {
        companyId: company.id,
        usedBytes: totals._sum.sizeBytes ?? BigInt(0),
        fileCount: totals._count,
      },
      update: {
        usedBytes: totals._sum.sizeBytes ?? BigInt(0),
        fileCount: totals._count,
      },
    });
  }
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

/* -------------------------------------------------------------------------- */
/* Inventory (PRD #20 §418–§435)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Puts the seeded stock documents back the way the seed left them.
 *
 * A spec that posts a seeded draft has changed shared state: the next run would
 * find a document that is already posted, and the failure would look like a
 * product bug rather than leftover test state.
 */
export async function resetInventoryFixtures(): Promise<void> {
  await db.inventoryReceipt.updateMany({
    where: { id: "rcpt_draft" },
    data: { status: "DRAFT", postedAt: null, reversedAt: null },
  });

  await db.stockIssue.updateMany({
    where: { id: "iss_draft" },
    data: { status: "DRAFT", cancelledAt: null, reversedAt: null },
  });

  await db.stockTransfer.updateMany({
    where: { id: "trf_draft" },
    data: { status: "DRAFT" },
  });

  await db.stockAdjustment.updateMany({
    where: { id: "adj_draft" },
    data: { status: "DRAFT" },
  });

  await db.stockReservation.updateMany({
    where: { id: { in: ["rsv_001", "rsv_003"] } },
    data: { status: "ACTIVE" },
  });

  // Anything a posted draft wrote into the ledger has to come back out, or the
  // balances stop agreeing with it (PRD #20 §83).
  await db.stockMovement.deleteMany({
    where: { sourceEntityId: { in: ["rcpt_draft", "iss_draft", "trf_draft", "adj_draft"] } },
  });

  await reprojectInventoryBalances();
}

/** Removes anything a spec created, identified by its number prefix. */
export async function removeTestInventoryRecords(prefix: string): Promise<void> {
  const [receipts, issues, returns, transfers, adjustments, reservations] = await Promise.all([
    db.inventoryReceipt.findMany({ where: { notes: { startsWith: prefix } }, select: { id: true } }),
    db.stockIssue.findMany({ where: { notes: { startsWith: prefix } }, select: { id: true } }),
    db.stockReturn.findMany({ where: { notes: { startsWith: prefix } }, select: { id: true } }),
    db.stockTransfer.findMany({ where: { notes: { startsWith: prefix } }, select: { id: true } }),
    db.stockAdjustment.findMany({ where: { notes: { startsWith: prefix } }, select: { id: true } }),
    db.stockReservation.findMany({
      where: { inventoryItem: { sku: { startsWith: prefix } } },
      select: { id: true },
    }),
  ]);

  const ids = [
    ...receipts.map((row) => row.id),
    ...issues.map((row) => row.id),
    ...returns.map((row) => row.id),
    ...transfers.map((row) => row.id),
    ...adjustments.map((row) => row.id),
  ];

  if (ids.length > 0) {
    await db.stockMovement.deleteMany({ where: { sourceEntityId: { in: ids } } });
    await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  }

  await db.inventoryReceiptLine.deleteMany({ where: { inventoryReceiptId: { in: receipts.map((r) => r.id) } } });
  await db.inventoryReceipt.deleteMany({ where: { id: { in: receipts.map((r) => r.id) } } });
  await db.stockIssueLine.deleteMany({ where: { stockIssueId: { in: issues.map((r) => r.id) } } });
  await db.stockIssue.deleteMany({ where: { id: { in: issues.map((r) => r.id) } } });
  await db.stockReturnLine.deleteMany({ where: { stockReturnId: { in: returns.map((r) => r.id) } } });
  await db.stockReturn.deleteMany({ where: { id: { in: returns.map((r) => r.id) } } });
  await db.stockTransferLine.deleteMany({ where: { stockTransferId: { in: transfers.map((r) => r.id) } } });
  await db.stockTransfer.deleteMany({ where: { id: { in: transfers.map((r) => r.id) } } });
  await db.stockAdjustmentLine.deleteMany({ where: { stockAdjustmentId: { in: adjustments.map((r) => r.id) } } });
  await db.stockAdjustment.deleteMany({ where: { id: { in: adjustments.map((r) => r.id) } } });

  await db.stockReservation.deleteMany({ where: { id: { in: reservations.map((r) => r.id) } } });

  // Reservations the spec made against seeded items carry the prefix in a note
  // nowhere, so they are found by their number instead.
  const numbered = await db.stockReservation.findMany({
    where: { reservationNumber: { startsWith: "RSV-" }, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
    select: { id: true, reservationNumber: true },
  });
  const spare = numbered.filter((row) => !["RSV-2026-0001", "RSV-2026-0002", "RSV-2026-0003", "RSV-2026-0004", "RSV-2026-0005"].includes(row.reservationNumber));
  if (spare.length > 0) {
    await db.activity.deleteMany({ where: { entityId: { in: spare.map((r) => r.id) } } });
    await db.stockReservation.deleteMany({ where: { id: { in: spare.map((r) => r.id) } } });
  }

  await db.inventoryBalance.deleteMany({ where: { inventoryItem: { sku: { startsWith: prefix } } } });
  await db.inventoryItem.deleteMany({ where: { sku: { startsWith: prefix } } });
  await db.inventoryLocation.deleteMany({ where: { warehouse: { code: { startsWith: prefix } } } });
  await db.warehouse.deleteMany({ where: { code: { startsWith: prefix } } });

  await reprojectInventoryBalances();
}

/**
 * Reprojects every balance from the ledger, exactly as the seed does
 * (PRD #20 §79, §82).
 */
async function reprojectInventoryBalances(): Promise<void> {
  const sums = await db.stockMovement.groupBy({
    by: ["inventoryItemId", "locationId"],
    _sum: { signedQuantity: true },
  });

  for (const row of sums) {
    const held = await db.stockReservation.aggregate({
      where: {
        inventoryItemId: row.inventoryItemId,
        locationId: row.locationId,
        status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
      },
      _sum: { quantity: true, fulfilledQuantity: true },
    });

    const reserved = (held._sum.quantity ?? new Prisma.Decimal(0)).minus(
      held._sum.fulfilledQuantity ?? new Prisma.Decimal(0),
    );
    const onHand = row._sum.signedQuantity ?? new Prisma.Decimal(0);

    await db.inventoryBalance.updateMany({
      where: { inventoryItemId: row.inventoryItemId, locationId: row.locationId },
      data: {
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        availableQuantity: onHand.minus(reserved),
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* QA/QC (PRD #21 §420–§440)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Puts the seeded quality records back the way the seed left them.
 *
 * A spec that approves a seeded inspection has changed shared state: the next
 * run would find it already approved, and the failure would look like a product
 * bug rather than leftover test state.
 */
export async function resetQaqcFixtures(): Promise<void> {
  await db.qualityInspection.updateMany({
    where: { id: { in: ["ins_005", "ins_006"] } },
    data: {
      status: "PENDING_APPROVAL",
      approvedAt: null,
      approvedByMemberId: null,
      rejectedAt: null,
      rejectedByMemberId: null,
      closedAt: null,
      closedByMemberId: null,
      cancelledAt: null,
    },
  });

  await db.qualityInspection.updateMany({
    where: { id: "ins_008" },
    data: { status: "IN_PROGRESS", result: "NOT_SET", submittedAt: null },
  });

  await db.qualityInspection.updateMany({
    where: { id: "ins_009" },
    data: { status: "DRAFT", result: "NOT_SET", submittedAt: null, inspectionDate: null },
  });

  await db.nonConformanceReport.updateMany({
    where: { id: "ncr_002" },
    data: {
      status: "PENDING_APPROVAL",
      approvedAt: null,
      approvedByMemberId: null,
      rejectedAt: null,
      rejectedByMemberId: null,
      closedAt: null,
      closedByMemberId: null,
    },
  });

  await db.qualityDefect.updateMany({
    where: { id: "def_003" },
    data: { status: "RESOLVED", closedAt: null, closedByMemberId: null },
  });

  await db.qualityDefect.updateMany({
    where: { id: "def_004" },
    data: {
      status: "OPEN",
      resolutionNote: null,
      resolvedAt: null,
      resolvedByMemberId: null,
      closedAt: null,
      closedByMemberId: null,
    },
  });

  await db.correctiveAction.updateMany({
    where: { id: "ca_003" },
    data: {
      status: "PENDING_VERIFICATION",
      verificationNote: null,
      verifiedAt: null,
      verifiedByMemberId: null,
    },
  });

  await db.inspectionRequest.updateMany({
    where: { id: "ir_005" },
    data: { status: "OPEN", assignedInspectorMemberId: null, cancelledAt: null },
  });

  // A used template is versioned rather than edited, so a spec that saves one
  // leaves the original retired to INACTIVE (PRD #21 §53).
  await db.inspectionTemplate.updateMany({
    where: { id: { in: ["tpl_concrete", "tpl_material", "tpl_handover"] } },
    data: { status: "ACTIVE", archivedAt: null },
  });

  // The approval cycles those records were waiting on.
  await db.qualityApproval.updateMany({
    where: { id: { in: ["qa_appr_001", "qa_appr_002", "qa_appr_003"] } },
    data: { status: "PENDING", decidedByMemberId: null, decidedAt: null, decisionNote: null },
  });
}

/** Removes anything a spec created, identified by its title prefix. */
export async function removeTestQaqcRecords(prefix: string): Promise<void> {
  const [templates, requests, inspections, defects, ncrs, actions] = await Promise.all([
    db.inspectionTemplate.findMany({ where: { name: { startsWith: prefix } }, select: { id: true } }),
    db.inspectionRequest.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } }),
    db.qualityInspection.findMany({ where: { summary: { startsWith: prefix } }, select: { id: true } }),
    db.qualityDefect.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } }),
    db.nonConformanceReport.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } }),
    db.correctiveAction.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } }),
  ]);

  const ids = [
    ...templates.map((r) => r.id),
    ...requests.map((r) => r.id),
    ...inspections.map((r) => r.id),
    ...defects.map((r) => r.id),
    ...ncrs.map((r) => r.id),
    ...actions.map((r) => r.id),
  ];
  if (ids.length > 0) await db.activity.deleteMany({ where: { entityId: { in: ids } } });

  const actionIds = actions.map((r) => r.id);
  const ncrIds = ncrs.map((r) => r.id);
  const defectIds = defects.map((r) => r.id);
  const inspectionIds = inspections.map((r) => r.id);

  await db.correctiveAction.deleteMany({
    where: {
      OR: [
        { id: { in: actionIds } },
        { ncrId: { in: ncrIds } },
        { defectId: { in: defectIds } },
        { inspectionId: { in: inspectionIds } },
      ],
    },
  });

  await db.qualityApproval.deleteMany({
    where: { recordId: { in: [...ncrIds, ...inspectionIds] } },
  });

  await db.nonConformanceReport.deleteMany({
    where: { OR: [{ id: { in: ncrIds } }, { sourceDefectId: { in: defectIds } }] },
  });
  await db.qualityDefect.deleteMany({ where: { id: { in: defectIds } } });

  await db.materialInspectionDecision.deleteMany({ where: { inspectionId: { in: inspectionIds } } });
  await db.qualityMaterialRelease.deleteMany({ where: { inspectionId: { in: inspectionIds } } });
  await db.inspectionChecklistItem.deleteMany({ where: { inspectionId: { in: inspectionIds } } });
  await db.qualityInspection.deleteMany({ where: { parentInspectionId: { in: inspectionIds } } });
  await db.qualityInspection.deleteMany({ where: { id: { in: inspectionIds } } });

  await db.inspectionRequest.deleteMany({ where: { id: { in: requests.map((r) => r.id) } } });

  await db.inspectionTemplateItem.deleteMany({
    where: { inspectionTemplateId: { in: templates.map((r) => r.id) } },
  });
  await db.inspectionTemplate.deleteMany({ where: { id: { in: templates.map((r) => r.id) } } });

  // A spec that saved a used template left a v2 behind.
  const spares = await db.inspectionTemplate.findMany({
    where: { code: { in: ["WRK-CONC", "MAT-IN", "GEN-HAND"] }, version: { gt: 1 } },
    select: { id: true },
  });
  if (spares.length > 0) {
    await db.inspectionTemplateItem.deleteMany({
      where: { inspectionTemplateId: { in: spares.map((r) => r.id) } },
    });
    await db.inspectionTemplate.deleteMany({ where: { id: { in: spares.map((r) => r.id) } } });
  }
}

/**
 * Puts the HSE fixtures back where the seed left them (PRD #22 §374).
 *
 * The E2E suite runs against the shared development database, so a spec that
 * approves an inspection or releases a stop-work has to restore it — otherwise
 * the next run finds nothing pending and the failure looks like a product bug
 * rather than a dirty fixture.
 */
export async function resetHseFixtures(): Promise<void> {
  await db.hseInspection.updateMany({
    where: { id: { in: ["hse_ins_006", "hse_ins_007", "hse_ins_008"] } },
    data: {
      status: "PENDING_APPROVAL",
      approvedAt: null,
      approvedByMemberId: null,
      rejectedAt: null,
      rejectedByMemberId: null,
      closedAt: null,
      closedByMemberId: null,
      cancelledAt: null,
      decisionNote: null,
    },
  });

  await db.hseInspection.updateMany({
    where: { id: { in: ["hse_ins_010", "hse_ins_011", "hse_ins_030"] } },
    data: { status: "IN_PROGRESS", result: "NOT_SET", submittedAt: null },
  });

  await db.hseInspection.updateMany({
    where: { id: { in: ["hse_ins_015", "hse_ins_016"] } },
    data: { status: "DRAFT", result: "NOT_SET", submittedAt: null },
  });

  // The approvals those submissions opened, so the queue is populated again.
  await db.hseApproval.updateMany({
    where: { id: { in: ["hse_ap_001", "hse_ap_002", "hse_ap_003", "hse_ap_004", "hse_ap_005", "hse_ap_006", "hse_ap_007", "hse_ap_008", "hse_ap_009"] } },
    data: { status: "PENDING", decidedByMemberId: null, decidedAt: null, decisionNote: null },
  });

  await db.hseHazard.updateMany({
    where: { id: { in: ["hse_hz_002", "hse_hz_035"] } },
    data: {
      status: "OPEN",
      closedAt: null,
      closedByMemberId: null,
      closureNote: null,
      cancelledAt: null,
    },
  });

  await db.hseHazard.updateMany({
    where: { id: "hse_hz_004" },
    data: { status: "IN_PROGRESS", closedAt: null, closedByMemberId: null, closureNote: null },
  });

  await db.hseIncident.updateMany({
    where: { id: "hse_inc_011" },
    data: {
      status: "UNDER_INVESTIGATION",
      // Deliberately without a cause: that is what makes the closure rule
      // visible without anybody having to break one (PRD #22 §95).
      rootCause: null,
      investigationSummary: null,
      submittedForCloseAt: null,
      closedAt: null,
      closedByMemberId: null,
      closureNote: null,
    },
  });

  await db.hseIncident.updateMany({
    where: { id: "hse_inc_009" },
    data: {
      status: "PENDING_CLOSE",
      closedAt: null,
      closedByMemberId: null,
    },
  });

  await db.hseAction.updateMany({
    where: { id: "hse_act_002" },
    data: {
      status: "PENDING_VERIFICATION",
      verificationNote: null,
      verifiedAt: null,
      verifiedByMemberId: null,
    },
  });

  await db.hseAction.updateMany({
    where: { id: "hse_act_021" },
    data: {
      status: "OPEN",
      completionNote: null,
      completedAt: null,
      completedByMemberId: null,
      verificationNote: null,
      verifiedAt: null,
      verifiedByMemberId: null,
    },
  });

  await db.stopWorkRecord.updateMany({
    where: { id: { in: ["hse_sw_001", "hse_sw_002"] } },
    data: { status: "ACTIVE", releasedAt: null, releasedByMemberId: null, releaseReason: null },
  });

  await db.hseWorkPermit.updateMany({
    where: { id: "hse_ptw_007" },
    data: {
      status: "PENDING_APPROVAL",
      approvedAt: null,
      approvedByMemberId: null,
      activatedAt: null,
      closedAt: null,
      closedByMemberId: null,
    },
  });

  await db.hseRiskAssessment.updateMany({
    where: { id: "hse_ra_008" },
    data: { status: "PENDING_APPROVAL", approvedAt: null, approvedByMemberId: null },
  });

  await db.toolboxTalk.updateMany({
    where: { id: "hse_tbt_013" },
    data: { status: "DRAFT", completedAt: null, cancelledAt: null },
  });

  await db.environmentalObservation.updateMany({
    where: { id: "hse_env_005" },
    data: { status: "OPEN", closedAt: null, closedByMemberId: null, closureNote: null },
  });
}

/** Removes anything an HSE spec created, children first (PRD #9 §223). */
export async function removeTestHseRecords(prefix: string): Promise<void> {
  const like = { contains: prefix };

  const hazards = await db.hseHazard.findMany({
    where: { title: like },
    select: { id: true },
  });
  const incidents = await db.hseIncident.findMany({
    where: { title: like },
    select: { id: true },
  });
  const inspections = await db.hseInspection.findMany({
    where: { locationText: like },
    select: { id: true },
  });
  const assessments = await db.hseRiskAssessment.findMany({
    where: { title: like },
    select: { id: true },
  });
  const permits = await db.hseWorkPermit.findMany({
    where: { title: like },
    select: { id: true },
  });
  const stopWorks = await db.stopWorkRecord.findMany({
    where: { title: like },
    select: { id: true },
  });
  const observations = await db.environmentalObservation.findMany({
    where: { title: like },
    select: { id: true },
  });
  const talks = await db.toolboxTalk.findMany({ where: { title: like }, select: { id: true } });

  const ids = [
    ...hazards, ...incidents, ...inspections, ...assessments,
    ...permits, ...stopWorks, ...observations, ...talks,
  ].map((row) => row.id);

  // Actions reference every one of those, so they go first.
  await db.hseAction.deleteMany({
    where: {
      OR: [
        { title: like },
        { hazardId: { in: hazards.map((row) => row.id) } },
        { incidentId: { in: incidents.map((row) => row.id) } },
        { inspectionId: { in: inspections.map((row) => row.id) } },
        { riskAssessmentId: { in: assessments.map((row) => row.id) } },
        { permitId: { in: permits.map((row) => row.id) } },
        { stopWorkId: { in: stopWorks.map((row) => row.id) } },
        { environmentalObservationId: { in: observations.map((row) => row.id) } },
      ],
    },
  });

  await db.stopWorkRecord.deleteMany({
    where: {
      OR: [
        { id: { in: stopWorks.map((row) => row.id) } },
        { hazardId: { in: hazards.map((row) => row.id) } },
        { incidentId: { in: incidents.map((row) => row.id) } },
      ],
    },
  });

  await db.hseApproval.deleteMany({ where: { recordId: { in: ids } } });
  await db.activity.deleteMany({ where: { entityId: { in: ids } } });

  await db.hseHazard.deleteMany({
    where: {
      OR: [
        { id: { in: hazards.map((row) => row.id) } },
        { inspectionId: { in: inspections.map((row) => row.id) } },
      ],
    },
  });
  await db.hseIncident.deleteMany({ where: { id: { in: incidents.map((row) => row.id) } } });
  await db.hseInspectionChecklistItem.deleteMany({
    where: { inspectionId: { in: inspections.map((row) => row.id) } },
  });
  await db.hseInspection.deleteMany({ where: { id: { in: inspections.map((row) => row.id) } } });
  await db.hseWorkPermit.deleteMany({ where: { id: { in: permits.map((row) => row.id) } } });
  await db.hseRiskAssessmentItem.deleteMany({
    where: { riskAssessmentId: { in: assessments.map((row) => row.id) } },
  });
  await db.hseRiskAssessment.deleteMany({
    where: { id: { in: assessments.map((row) => row.id) } },
  });
  await db.environmentalObservation.deleteMany({
    where: { id: { in: observations.map((row) => row.id) } },
  });
  await db.toolboxTalkParticipant.deleteMany({
    where: { toolboxTalkId: { in: talks.map((row) => row.id) } },
  });
  await db.toolboxTalk.deleteMany({ where: { id: { in: talks.map((row) => row.id) } } });
  await db.ppeCheck.deleteMany({ where: { notes: like } });
  await db.hseInspectionTemplateItem.deleteMany({
    where: { template: { name: like } },
  });
  await db.hseInspectionTemplate.deleteMany({ where: { name: like } });
}
