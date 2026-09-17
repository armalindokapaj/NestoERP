import { Prisma, type InvoiceStatus } from "@prisma/client";
import { targetsOf, transitionFor } from "@/lib/core/state/machine";
import { applyTransition, type TransitionOutcome } from "@/lib/core/state/transition";
import { allocateNumber } from "@/lib/core/numbering/numbering.service";
import { IntegrationType } from "@/lib/core/integrations/integration.registry";
import { linkIntegration } from "@/lib/core/integrations/integration.service";

import { can } from "@/lib/access/can";
import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
  stateDenied,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { businessDateString } from "../finance.fields";
import { toAmountString, toRateString } from "../finance.money";
import { buildProposalScopeWhere } from "@/lib/modules/sales/sales.scope";
import { buildInvoiceScopeWhere, hasCompanyFinanceScope } from "../finance.scope";
import { resolveFinanceSettings } from "../finance.settings";
import { paidByInvoice, settlementFor } from "../finance.settlement";
import { PAYMENT_SELECT, toSummaryDTO as paymentSummaryDTO } from "../payments/payment.service";
import type { InvoiceDetailDTO, InvoiceSummaryDTO, RecordCapabilities } from "../finance.types";
import { calculateInvoice } from "./invoice.calculation";
import * as repository from "./invoice.repository";
import type {
  CreateInvoiceInput,
  InvoiceListQuery,
  UpdateInvoiceInput,
} from "./invoice.schema";
import { invoiceMachine, type InvoiceTransitionAction } from "./invoice.machine";
import {
  CANCELLABLE_INVOICE_STATUSES,
  invoiceSettlement,
  isInvoiceArchivable,
  isInvoiceEditable,
  isInvoiceSubmittable,
} from "./invoice.status";

/**
 * Invoices (PRD #15 §38–§69).
 *
 * Three rules are enforced here and nowhere else:
 *
 *   1. **The server owns the numbers.** Every total is recalculated from the
 *      lines on every write; nothing arrives from the browser (PRD #15 §52,
 *      §220).
 *   2. **Issuance and settlement are separate.** `status` is the workflow;
 *      whether an invoice has been paid is derived from its payments at read
 *      time, so a fully paid invoice stays `SENT` (PRD #15 §42, §45).
 *   3. **An issued invoice is immutable.** Past DRAFT/REJECTED the client,
 *      project, dates, currency and lines are frozen; the way to change one is
 *      a credit note, which V0.1 deliberately does not have (PRD #15 §60,
 *      §414).
 */

const MODULE = "finance" as const;
const ENTITY = "Invoice";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listInvoices(context: UserContext, query: InvoiceListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.view");

  const { rows, total } = await repository.listInvoices(context, query);
  const paid = await paidByInvoice(rows.map((row) => row.id));

  let data = rows.map((row) => toSummaryDTO(row, paid.get(row.id)));

  // Settlement is derived, so it cannot be a SQL filter. Filtering after the
  // page is read means a settlement filter narrows the page rather than the
  // query — which is honest about what it is, and correct (PRD #15 §42).
  if (query.settlement?.length) {
    const wanted = new Set(query.settlement);
    data = data.filter((invoice) => wanted.has(invoice.settlementStatus));
  }

  return { data, pagination: paginationMeta(total, query.page, query.limit) };
}

export async function getInvoice(
  context: UserContext,
  invoiceId: string,
): Promise<InvoiceDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.view");

  // Out of scope answers "not found", so the response cannot confirm that an
  // invoice exists to somebody who may not open it (PRD #15 §174).
  const invoice = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  const [paid, payments, history, creator] = await Promise.all([
    paidByInvoice([invoice.id]),
    can(context, "finance.payment.view")
      ? prisma.payment.findMany({
          // Every payment with money allocated to this invoice (E-05F §31).
          where: { allocations: { some: { invoiceId: invoice.id } } },
          orderBy: { paymentDate: "desc" },
          select: PAYMENT_SELECT,
        })
      : Promise.resolve([]),
    approvals.approvalHistory(context, "INVOICE", invoice.id),
    memberRef(invoice.createdByMemberId),
  ]);

  const settlement = settlementFor(invoice.totalAmount, paid.get(invoice.id));
  const outstanding = settlement.outstanding;

  return {
    ...toSummaryDTO(invoice, paid.get(invoice.id)),
    subtotal: toAmountString(invoice.subtotal),
    taxAmount: toAmountString(invoice.taxAmount),
    notes: invoice.notes,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    archivedAt: invoice.archivedAt?.toISOString() ?? null,
    lineItems: invoice.lineItems.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: toRateString(line.quantity),
      unitPrice: toRateString(line.unitPrice),
      taxRate: toRateString(line.taxRate),
      subtotal: toAmountString(line.subtotal),
      taxAmount: toAmountString(line.taxAmount),
      totalAmount: toAmountString(line.totalAmount),
      sortOrder: line.sortOrder,
    })),
    payments: payments.map((payment) => paymentSummaryDTO(context, payment)),
    approvals: history,
    createdBy: creator,
    createdAt: invoice.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, invoice, outstanding.greaterThan(0)),
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createInvoice(
  context: UserContext,
  input: CreateInvoiceInput,
): Promise<InvoiceDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.create");

  const { client, project } = await validateRelationships(context, input);
  const totals = calculateInvoice(input.lineItems);

  const invoiceId = await prisma.$transaction(async (tx) => {
    /*
     * The configured scheme decides the number (PRD #24 §102, §114).
     *
     * `allocateNumber` returns null when the company has set this record type
     * to MANUAL, and only then does what somebody typed apply. Under AUTO the
     * sequence is allocated under a row lock, so two invoices raised at the
     * same moment cannot take the same number — which is the whole reason the
     * setting exists rather than trusting a typed value to be unique.
     */
    const allocated = await allocateNumber(
      { companyId: context.companyId, moduleKey: MODULE, entityType: "invoice" },
      { tx, occurredAt: input.issueDate },
    );
    const invoiceNumber = allocated ?? input.invoiceNumber;

    if (!invoiceNumber) {
      throw new AccessError(
        "VALIDATION_ERROR",
        "This company numbers invoices manually, so an invoice number is required.",
      );
    }

    await assertNumberIsFree(tx, context, invoiceNumber, null);

    const invoice = await tx.invoice.create({
      data: {
        companyId: context.companyId,
        invoiceNumber,
        clientId: client.id,
        projectId: project?.id ?? null,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency: input.currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        lineItems: {
          create: totals.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            subtotal: line.subtotal,
            taxAmount: line.taxAmount,
            totalAmount: line.totalAmount,
            sortOrder: line.sortOrder,
          })),
        },
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoice.id,
      action: "FINANCE_INVOICE_CREATED",
      message: `raised invoice ${invoiceNumber} for ${client.name}`,
      metadata: {
        invoiceNumber,
        currency: input.currency,
        totalAmount: toAmountString(totals.totalAmount),
      } as Prisma.InputJsonValue,
    });

    return invoice.id;
  });

  return getInvoice(context, invoiceId);
}

/**
 * The invoice for one installment of a sale contract's schedule (E-05F §26),
 * written inside the caller's transaction. The caller — the unit's Finance
 * section — has reached the contract through a unit the person may open and
 * asserted `finance.invoice.create`; this numbers the invoice by the company's
 * scheme and writes it as a draft with one line for the installment's amount,
 * which the invoice then keeps (no tax: a sale's tax treatment is not V0.1's).
 */
export async function createInstallmentInvoiceRecord(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: {
    clientId: string;
    projectId: string;
    contractId: string;
    installmentId: string;
    issueDate: Date;
    dueDate: Date;
    currency: string;
    description: string;
    amount: Prisma.Decimal;
    notes: string;
  },
): Promise<{ id: string; invoiceNumber: string }> {
  const totals = calculateInvoice([{ description: input.description, quantity: "1", unitPrice: input.amount.toFixed(2), taxRate: "0" }]);
  const allocated = await allocateNumber({ companyId: context.companyId, moduleKey: MODULE, entityType: "invoice" }, { tx, occurredAt: input.issueDate });
  const invoiceNumber = allocated ?? `INV-${input.installmentId.slice(-8).toUpperCase()}`;
  await assertNumberIsFree(tx, context, invoiceNumber, null);

  const invoice = await tx.invoice.create({
    data: {
      companyId: context.companyId,
      invoiceNumber,
      clientId: input.clientId,
      projectId: input.projectId,
      contractId: input.contractId,
      installmentId: input.installmentId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      currency: input.currency,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      status: "DRAFT",
      notes: input.notes,
      createdByMemberId: context.membershipId,
      lineItems: {
        create: totals.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          subtotal: line.subtotal,
          taxAmount: line.taxAmount,
          totalAmount: line.totalAmount,
          sortOrder: line.sortOrder,
        })),
      },
    },
    select: { id: true, invoiceNumber: true },
  });

  await recordActivity(tx, context, {
    module: MODULE,
    entityType: ENTITY,
    entityId: invoice.id,
    action: "FINANCE_INVOICE_CREATED",
    message: `raised invoice ${invoiceNumber} for an installment of a sale contract`,
    metadata: { invoiceNumber, contractId: input.contractId, installmentId: input.installmentId, currency: input.currency, totalAmount: toAmountString(totals.totalAmount) } as Prisma.InputJsonValue,
  });
  return invoice;
}

/**
 * Raising an invoice from an accepted proposal (PRD #35 §180, PRD #23 §43).
 *
 * The commercial figures are snapshotted, not referenced. Once an invoice
 * exists it is what the client owes, and a later edit to the proposal must not
 * silently change it — the proposal is a quote, the invoice is a demand.
 *
 * Deliberately not one-invoice-per-proposal. Staged billing against a single
 * accepted quote is ordinary, so this follows the same rule Legal already
 * applies to contracts: a second invoice is allowed, and the handoff shows the
 * ones already drawn so a second click meets the first rather than making a
 * duplicate by accident (PRD #18 §213).
 *
 * The proposal is Sales' record, so it is read through Sales' door — the
 * module, `sales.proposal.view` and the proposal scope — and the client and
 * delivery project it carries are held to the same checks as a typed-in
 * invoice. Otherwise any proposal id in the company would copy its lines,
 * client and project into an invoice the caller could never have drafted
 * (PRD #47 §44, §64).
 */
export async function createInvoiceFromProposal(
  context: UserContext,
  proposalId: string,
): Promise<InvoiceDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.create");
  assertModule(context, "sales");
  assertPermission(context, "sales.proposal.view");

  const proposal = assertFound(
    await prisma.proposal.findFirst({
      where: { AND: [buildProposalScopeWhere(context), { id: proposalId, archivedAt: null }] },
      select: {
        id: true,
        proposalNumber: true,
        title: true,
        status: true,
        currency: true,
        clientId: true,
        opportunity: { select: { convertedProjectId: true } },
        lineItems: {
          orderBy: { sortOrder: "asc" },
          select: {
            description: true,
            quantity: true,
            unitPrice: true,
            taxRate: true,
            sortOrder: true,
          },
        },
      },
    }),
  );

  // Only an accepted quote becomes a demand for money (PRD #35 §180).
  if (proposal.status !== "ACCEPTED") {
    throw new AccessError(
      "CONFLICT",
      "Only an accepted proposal can be invoiced. Record the client's acceptance first.",
    );
  }

  if (proposal.lineItems.length === 0) {
    throw new AccessError("VALIDATION_ERROR", "That proposal has no lines to invoice.");
  }

  // The delivery project, when the opportunity was handed over to one — which
  // must be a project this caller's finance access reaches, and without one
  // the invoice is company-level, which needs company finance scope.
  const { client, project } = await validateRelationships(context, {
    clientId: proposal.clientId,
    projectId: proposal.opportunity?.convertedProjectId ?? undefined,
  });

  const settings = await resolveFinanceSettings(context.companyId);
  const issueDate = new Date();
  const dueDate = new Date(
    issueDate.getTime() + settings.defaultPaymentTermsDays * 24 * 60 * 60 * 1000,
  );

  const totals = calculateInvoice(
    proposal.lineItems.map((line) => ({
      description: line.description,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toString(),
      taxRate: line.taxRate.toString(),
    })),
  );

  const invoiceId = await prisma.$transaction(async (tx) => {
    const allocated = await allocateNumber(
      { companyId: context.companyId, moduleKey: MODULE, entityType: "invoice" },
      { tx, occurredAt: issueDate },
    );
    // With manual numbering there is nobody to ask at this point, so the
    // proposal's own number carries across as the obvious candidate.
    const invoiceNumber = allocated ?? `INV-${proposal.proposalNumber}`;

    await assertNumberIsFree(tx, context, invoiceNumber, null);

    const invoice = await tx.invoice.create({
      data: {
        companyId: context.companyId,
        invoiceNumber,
        clientId: client.id,
        projectId: project?.id ?? null,
        sourceProposalId: proposal.id,
        issueDate,
        dueDate,
        currency: proposal.currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        status: "DRAFT",
        notes: `Raised from proposal ${proposal.proposalNumber} — ${proposal.title}`,
        createdByMemberId: context.membershipId,
        lineItems: {
          create: totals.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            subtotal: line.subtotal,
            taxAmount: line.taxAmount,
            totalAmount: line.totalAmount,
            sortOrder: line.sortOrder,
          })),
        },
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoice.id,
      action: "FINANCE_INVOICE_CREATED",
      message: `raised invoice ${invoiceNumber} from proposal ${proposal.proposalNumber}`,
      metadata: {
        invoiceNumber,
        proposalId: proposal.id,
        currency: proposal.currency,
        totalAmount: toAmountString(totals.totalAmount),
      } as Prisma.InputJsonValue,
    });

    await linkIntegration(tx, context, {
      integrationType: IntegrationType.SALES_PROPOSAL_FINANCE_INVOICE,
      source: { id: proposal.id },
      target: { id: invoice.id },
    });

    return invoice.id;
  });

  return getInvoice(context, invoiceId);
}

/** Invoices already drawn from one proposal, so a second click meets the first. */
export async function listInvoicesForProposal(
  context: UserContext,
  proposalId: string,
): Promise<InvoiceSummaryDTO[]> {
  if (!can(context, "finance.invoice.view")) return [];

  const rows = await prisma.invoice.findMany({
    where: {
      AND: [buildInvoiceScopeWhere(context), { sourceProposalId: proposalId }],
    },
    orderBy: { createdAt: "desc" },
    select: repository.SUMMARY_SELECT,
  });

  const paid = await paidByInvoice(rows.map((row) => row.id));
  return rows.map((row) => toSummaryDTO(row, paid.get(row.id)));
}

export async function updateInvoice(
  context: UserContext,
  invoiceId: string,
  input: UpdateInvoiceInput,
): Promise<InvoiceDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.update");

  const existing = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  if (!isInvoiceEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "Only a draft or rejected invoice can be edited. Issued invoices are fixed.",
    );
  }

  if (
    input.versionUpdatedAt &&
    existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This invoice was updated by another user. Refresh and review the latest changes.",
    );
  }

  // An installment's invoice bills that installment, for its amount: its client,
  // project, currency and lines are the schedule's, not the form's (E-05F §26).
  if (existing.installmentId) {
    throw new AccessError("CONFLICT", "This invoice bills an installment of a sale contract, so its lines follow the payment schedule. Change the schedule instead.", { code: "INSTALLMENT_INVOICE_FIXED" });
  }

  const { client, project } = await validateRelationships(context, input);
  const totals = calculateInvoice(input.lineItems);

  // An auto-numbered invoice keeps the number it was allocated: the form does
  // not offer the field, so nothing is submitted for it (PRD #24 §111, §117).
  const invoiceNumber = input.invoiceNumber ?? existing.invoiceNumber;

  await prisma.$transaction(async (tx) => {
    // The edit is only allowed because the invoice was editable when read.
    // Claiming the row on that same status — and holding its lock to the end
    // of the transaction — means a submit or approval that landed in between
    // turns this save into a conflict, never into a rewrite of an invoice that
    // is already awaiting approval (PRD #15 §278, PRD #47 §66).
    await claimEditable(tx, context, existing);
    await assertNumberIsFree(tx, context, invoiceNumber, invoiceId);

    // Lines are replaced rather than diffed: an invoice's lines are one
    // document, and a partial update is how a total stops matching its parts.
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId } });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceNumber,
        clientId: client.id,
        projectId: project?.id ?? null,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency: input.currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        notes: input.notes ?? null,
        updatedByMemberId: context.membershipId,
        lineItems: {
          create: totals.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            subtotal: line.subtotal,
            taxAmount: line.taxAmount,
            totalAmount: line.totalAmount,
            sortOrder: line.sortOrder,
          })),
        },
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoiceId,
      action: "FINANCE_INVOICE_UPDATED",
      message: `updated invoice ${input.invoiceNumber}`,
      metadata: changeMetadata({
        totalAmount: {
          from: toAmountString(existing.totalAmount),
          to: toAmountString(totals.totalAmount),
        },
      }),
    });
  });

  return getInvoice(context, invoiceId);
}

export async function submitInvoice(context: UserContext, invoiceId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.submit");

  const existing = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  if (!isInvoiceSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", `A ${existing.status.toLowerCase()} invoice cannot be submitted.`);
  }
  if (existing.lineItems.length === 0) {
    throw new AccessError("CONFLICT", "An invoice needs at least one line before it can be submitted.");
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "submit");
    await approvals.openApproval(tx, context, "INVOICE", invoiceId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoiceId,
      action: "FINANCE_INVOICE_SUBMITTED",
      message: `submitted invoice ${existing.invoiceNumber} for approval`,
    });
  });
}

export async function approveInvoice(
  context: UserContext,
  invoiceId: string,
  note: string | null,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "INVOICE");

  const existing = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "INVOICE", invoiceId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "approve");
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoiceId,
      action: "FINANCE_INVOICE_APPROVED",
      message: `approved invoice ${existing.invoiceNumber}`,
    });

    // FINANCIAL policies are `required`: the evidence commits with the
    // approval or the approval does not happen (PRD #28 §102, §136).
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.FINANCE_INVOICE_APPROVED,
        entity: { type: ENTITY, id: invoiceId, label: existing.invoiceNumber },
        before: { status: existing.status },
        after: {
          status: "APPROVED",
          totalAmount: existing.totalAmount.toString(),
          currency: existing.currency,
        },
        reason: note,
      },
      { tx },
    );
  });
}

export async function rejectInvoice(
  context: UserContext,
  invoiceId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "INVOICE");

  const existing = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "INVOICE", invoiceId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "reject", { reason });
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoiceId,
      action: "FINANCE_INVOICE_REJECTED",
      message: `rejected invoice ${existing.invoiceNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.FINANCE_INVOICE_REJECTED,
        entity: { type: ENTITY, id: invoiceId, label: existing.invoiceNumber },
        before: { status: existing.status },
        after: { status: "REJECTED" },
        reason,
      },
      { tx },
    );
  });
}

/**
 * Returns the invoice for revision (PRD #41 §48): back to draft with the
 * approver's reason, so the requester can correct it and submit it again as a
 * new approval cycle. The decision history keeps the returned cycle.
 */
export async function returnInvoice(
  context: UserContext,
  invoiceId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "INVOICE");

  const existing = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "INVOICE", invoiceId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "return", { reason });
    await approvals.decideApproval(tx, context, approval.id, "RETURNED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoiceId,
      action: "FINANCE_INVOICE_RETURNED",
      message: `returned invoice ${existing.invoiceNumber} for revision`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Marks an approved invoice as sent (PRD #15 §65).
 *
 * This records that somebody sent it, by whatever means they actually used.
 * V0.1 does not deliver email, and pretending otherwise would be a lie in the
 * activity trail (PRD #15 §405).
 */
export async function markInvoiceSent(context: UserContext, invoiceId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.mark_sent");

  const existing = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  // Marking a sent invoice sent again is the same request arriving twice. It
  // settles without writing, so the date the invoice went out stays the first
  // one rather than moving to whenever somebody pressed the button again.
  if (existing.status === "SENT") return;

  await prisma.$transaction(async (tx) => {
    const outcome = await moveStatus(tx, context, existing, "mark_sent", { data: { sentAt: new Date() }, idempotent: true });
    if (outcome === "ALREADY_THERE") return;

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoiceId,
      action: "FINANCE_INVOICE_SENT",
      message: `marked invoice ${existing.invoiceNumber} as sent`,
    });
  });
}

/** Cancelling is blocked once any money has been received (PRD #15 §67). */
export async function cancelInvoice(context: UserContext, invoiceId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.cancel");

  const existing = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  if (!CANCELLABLE_INVOICE_STATUSES.includes(existing.status)) {
    throw new AccessError("CONFLICT", `A ${existing.status.toLowerCase()} invoice cannot be cancelled.`);
  }

  await prisma.$transaction(async (tx) => {
    const paid = (await paidByInvoice([invoiceId], tx)).get(invoiceId) ?? new Prisma.Decimal(0);

    if (paid.greaterThan(0)) {
      throw new AccessError(
        "CONFLICT",
        "This invoice has recorded payments. Void them before cancelling it.",
      );
    }

    await moveStatus(tx, context, existing, "cancel");
    await approvals.cancelPendingApprovals(tx, context, "INVOICE", invoiceId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoiceId,
      action: "FINANCE_INVOICE_CANCELLED",
      message: `cancelled invoice ${existing.invoiceNumber}`,
    });

    /*
     * Cancelling is how an invoice is voided in V0.1 — there is no separate
     * void — so this is the VOIDED evidence (PRD #28 §102).
     */
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.FINANCE_INVOICE_VOIDED,
        entity: { type: ENTITY, id: invoiceId, label: existing.invoiceNumber },
        before: {
          status: existing.status,
          totalAmount: existing.totalAmount.toString(),
          currency: existing.currency,
        },
        after: { status: "CANCELLED" },
      },
      { tx },
    );
  });
}

export async function archiveInvoice(context: UserContext, invoiceId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.archive");

  const existing = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  if (!isInvoiceArchivable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "Approved and sent invoices stay visible. Cancel it first if it should not stand.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: invoiceMachine,
      action: "archive",
      id: invoiceId,
      context,
      from: existing.status,
      data: {
        // Remembered so restore returns the invoice to where it was rather
        // than to a status somebody picked (PRD #15 §69).
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await approvals.cancelPendingApprovals(tx, context, "INVOICE", invoiceId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoiceId,
      action: "FINANCE_INVOICE_ARCHIVED",
      message: `archived invoice ${existing.invoiceNumber}`,
    });
  });
}

export async function restoreInvoice(context: UserContext, invoiceId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.invoice.restore");

  const existing = assertFound(await repository.findInvoiceInScope(context, invoiceId));

  if (existing.status !== "ARCHIVED") {
    throw new AccessError("CONFLICT", "This invoice is not archived.");
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: invoiceMachine,
      action: "restore",
      id: invoiceId,
      context,
      from: existing.status,
      to: existing.preArchiveStatus ?? "DRAFT",
      data: { preArchiveStatus: null, archivedAt: null, archivedByMemberId: null },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: invoiceId,
      action: "FINANCE_INVOICE_RESTORED",
      message: `restored invoice ${existing.invoiceNumber}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Moves an invoice by one of its machine's actions, from the status it was read in.
 *
 * A move the workflow never makes is refused as the validation error it has
 * always been, before anything is written. The write itself goes through
 * `applyTransition`, conditional on the status we read, so two people acting at
 * once cannot both win (PRD #15 §278, §392; PRD #49 §64).
 */
async function moveStatus(
  tx: Prisma.TransactionClient,
  context: UserContext,
  existing: { id: string; status: InvoiceStatus },
  action: InvoiceTransitionAction,
  options: { data?: Prisma.InvoiceUncheckedUpdateManyInput; reason?: string; idempotent?: boolean } = {},
): Promise<TransitionOutcome> {
  const transition = transitionFor(invoiceMachine, action)!;
  if (!transition.from.includes(existing.status)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `An invoice cannot move from ${existing.status} to ${targetsOf(transition)[0]}.`,
    );
  }

  return applyTransition(tx, {
    machine: invoiceMachine,
    action,
    id: existing.id,
    context,
    from: existing.status,
    reason: options.reason,
    idempotent: options.idempotent,
    data: { updatedByMemberId: context.membershipId, ...options.data },
  });
}

/** Locks an invoice for an edit, provided it still has the status the edit was checked against. */
async function claimEditable(
  tx: Prisma.TransactionClient,
  context: UserContext,
  existing: { id: string; status: InvoiceStatus },
): Promise<void> {
  const result = await tx.invoice.updateMany({
    where: { id: existing.id, companyId: context.companyId, status: existing.status },
    data: { updatedByMemberId: context.membershipId },
  });

  if (result.count === 0) {
    throw stateDenied("This invoice changed while you were working on it. Refresh and review it.");
  }
}

/**
 * Validates the client and project an invoice names (PRD #15 §48, §49, §50).
 *
 * Both are looked up *inside the caller's own scope*, so an unreachable record
 * reads as "does not exist" rather than being quietly accepted. And a project
 * that belongs to a different client is refused outright: billing Project A's
 * work to Client B is the kind of mistake that survives into a ledger.
 */
async function validateRelationships(
  context: UserContext,
  input: { clientId: string; projectId?: string },
) {
  const client = await prisma.client.findFirst({
    where: {
      AND: [buildClientScopeWhere(context), { id: input.clientId, archivedAt: null }],
    },
    select: { id: true, name: true },
  });
  if (!client) throw new AccessError("VALIDATION_ERROR", "That client does not exist.");

  if (!input.projectId) {
    // A company-level invoice needs company-level finance scope, as for
    // expenses and commitments: a project-scoped user has no project to
    // authorise it against, and could not open the invoice once saved
    // (PRD #15 §211, PRD #47 §64).
    if (!hasCompanyFinanceScope(context)) {
      throw new AccessError(
        "FORBIDDEN",
        "Your finance access is limited to your projects, so an invoice needs a project.",
        undefined,
        "SCOPE_DENIED",
      );
    }
    return { client, project: null };
  }

  const project = await prisma.project.findFirst({
    where: {
      AND: [
        buildProjectScopeWhere(context),
        { id: input.projectId, archivedAt: null, status: { not: "ARCHIVED" } },
      ],
    },
    select: { id: true, clientId: true, name: true },
  });
  if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.");

  if (project.clientId && project.clientId !== client.id) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That project belongs to a different client. An invoice must bill the project's own client.",
    );
  }

  return { client, project };
}

async function assertNumberIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  invoiceNumber: string,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.invoice.findFirst({
    where: {
      companyId: context.companyId,
      invoiceNumber,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError(
      "CONFLICT",
      `Invoice number ${invoiceNumber} is already used in this company.`,
    );
  }
}


async function memberRef(memberId: string) {
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!member) return null;
  return { memberId: member.id, fullName: `${member.user.firstName} ${member.user.lastName}` };
}

export function toSummaryDTO(
  row: repository.InvoiceRow,
  paidAmount: Prisma.Decimal | undefined,
): InvoiceSummaryDTO {
  const settlement = settlementFor(row.totalAmount, paidAmount);

  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    client: row.client,
    project: row.project,
    issueDate: businessDateString(row.issueDate),
    dueDate: businessDateString(row.dueDate),
    currency: row.currency,
    totalAmount: toAmountString(row.totalAmount),
    paidAmount: toAmountString(settlement.paid),
    outstandingAmount: toAmountString(settlement.outstanding),
    status: row.status,
    settlementStatus: invoiceSettlement({
      status: row.status,
      paid: settlement.paid,
      outstanding: settlement.outstanding,
      dueDate: row.dueDate,
    }),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  invoice: repository.InvoiceDetailRow,
  hasOutstanding: boolean,
): RecordCapabilities {
  const archived = invoice.status === "ARCHIVED";

  return {
    canEdit: !archived && isInvoiceEditable(invoice.status) && can(context, "finance.invoice.update"),
    canSubmit:
      !archived && isInvoiceSubmittable(invoice.status) && can(context, "finance.invoice.submit"),
    canApprove:
      invoice.status === "PENDING_APPROVAL" && approvals.canApproveType(context, "INVOICE"),
    canReject:
      invoice.status === "PENDING_APPROVAL" && approvals.canRejectType(context, "INVOICE"),
    canMarkSent: invoice.status === "APPROVED" && can(context, "finance.invoice.mark_sent"),
    canRecordPayment:
      invoice.status === "SENT" && hasOutstanding && can(context, "finance.payment.create"),
    canCancel:
      !archived &&
      CANCELLABLE_INVOICE_STATUSES.includes(invoice.status) &&
      can(context, "finance.invoice.cancel"),
    canClose: false,
    canRevise: false,
    canArchive:
      !archived && isInvoiceArchivable(invoice.status) && can(context, "finance.invoice.archive"),
    canRestore: archived && can(context, "finance.invoice.restore"),
    canViewActivity: can(context, "finance.activity.view"),
    canViewDocuments: can(context, "finance.document.view") && can(context, "document.view"),
  };
}
