import { Prisma, type ProposalStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { businessDateString } from "@/lib/modules/finance/finance.fields";
import { toAmountString, toRateString } from "@/lib/modules/finance/finance.money";
import * as approvals from "../approvals/approval.service";
import { loadMemberRef } from "../sales.dto";
import { buildOpportunityScopeWhere } from "../sales.scope";
import type { ProposalDetailDTO, ProposalSummaryDTO } from "../sales.types";
import { isClosedStage } from "../opportunities/opportunity.stage";
import { calculateProposal } from "./proposal.calculation";
import * as repository from "./proposal.repository";
import type {
  CreateProposalInput,
  ProposalListQuery,
  UpdateProposalInput,
} from "./proposal.schema";
import {
  canTransitionProposalStatus,
  isProposalArchivable,
  isProposalCancellable,
  isProposalEditable,
  isProposalSubmittable,
  proposalExpiry,
} from "./proposal.status";

/**
 * Proposals (PRD #17 §104–§127, §183–§186).
 *
 * Four rules are enforced here and nowhere else:
 *
 *   1. **The server owns the numbers.** Every total is recalculated from the
 *      lines on every write; nothing arrives from the browser (PRD #17 §111,
 *      §224).
 *   2. **A proposal is addressed to the opportunity's client.** It cannot name
 *      a different one and it cannot move to a different opportunity, because
 *      either would take the approval history somewhere it does not belong
 *      (PRD #17 §217, §426).
 *   3. **A sent proposal is immutable.** Past DRAFT/REJECTED the price is
 *      frozen; the way to change terms is a new proposal (PRD #17 §184).
 *   4. **One accepted proposal per opportunity.** Checked inside the
 *      transaction, so two acceptances cannot both win (PRD #17 §186, §258).
 */

const MODULE = "sales" as const;
const ENTITY = "Proposal";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listProposals(context: UserContext, query: ProposalListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.view");

  const { rows, total } = await repository.listProposals(context, query);

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getProposal(
  context: UserContext,
  proposalId: string,
): Promise<ProposalDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.view");

  // Out of scope answers "not found", so the response cannot confirm that a
  // proposal exists to somebody who may not open it (PRD #17 §226).
  const row = assertFound(await repository.findProposalInScope(context, proposalId));

  const [history, createdBy] = await Promise.all([
    approvals.approvalHistory(context, "PROPOSAL", row.id),
    loadMemberRef(row.createdByMemberId),
  ]);

  return {
    ...toSummaryDTO(row),
    subtotal: toAmountString(row.subtotal),
    taxAmount: toAmountString(row.taxAmount),
    notes: row.notes,
    lineItems: row.lineItems.map((line) => ({
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
    sentAt: row.sentAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    approvals: history,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row),
  };
}

/** The proposals on one opportunity's detail page (PRD #17 §415). */
export async function listForOpportunity(
  context: UserContext,
  opportunityId: string,
): Promise<ProposalSummaryDTO[]> {
  if (!can(context, "sales.proposal.view")) return [];
  const rows = await repository.listProposalsForOpportunity(context, opportunityId);
  return rows.map(toSummaryDTO);
}

export async function proposalFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.view");
  return repository.proposalFilterOptions(context);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createProposal(
  context: UserContext,
  input: CreateProposalInput,
): Promise<ProposalDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.create");

  const opportunity = await resolveOpportunity(context, input.opportunityId);
  const totals = calculateProposal(input.lineItems);

  const proposalId = await prisma.$transaction(async (tx) => {
    await assertNumberIsFree(tx, context, input.proposalNumber, null);

    const proposal = await tx.proposal.create({
      data: {
        companyId: context.companyId,
        proposalNumber: input.proposalNumber,
        opportunityId: opportunity.id,
        // Derived from the opportunity, never accepted from the form: the two
        // cannot be made to disagree (PRD #17 §110, §217).
        clientId: opportunity.clientId!,
        title: input.title,
        currency: input.currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        validUntil: input.validUntil ?? null,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        lineItems: { create: totals.lines.map(toLineData) },
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposal.id,
      action: "SALES_PROPOSAL_CREATED",
      message: `drafted proposal ${input.proposalNumber} for ${opportunity.name}`,
      metadata: {
        opportunityId: opportunity.id,
        currency: input.currency,
        totalAmount: toAmountString(totals.totalAmount),
      } as Prisma.InputJsonValue,
    });

    return proposal.id;
  });

  return getProposal(context, proposalId);
}

export async function updateProposal(
  context: UserContext,
  proposalId: string,
  input: UpdateProposalInput,
): Promise<ProposalDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.update");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));

  if (!isProposalEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      existing.status === "ACCEPTED"
        ? "An accepted proposal is the deal the client agreed to. Raise a new one instead."
        : "Only a draft or rejected proposal can be edited. Raise a new one instead.",
    );
  }

  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This proposal was updated by another user. Refresh and review the latest changes.",
    );
  }

  const totals = calculateProposal(input.lineItems);

  await prisma.$transaction(async (tx) => {
    await assertNumberIsFree(tx, context, input.proposalNumber, proposalId);

    // Lines are replaced rather than diffed: a proposal's lines are one
    // document, and a partial update is how a total stops matching its parts.
    await tx.proposalLineItem.deleteMany({ where: { proposalId } });

    await tx.proposal.update({
      where: { id: proposalId },
      data: {
        proposalNumber: input.proposalNumber,
        title: input.title,
        currency: input.currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        validUntil: input.validUntil ?? null,
        notes: input.notes ?? null,
        updatedByMemberId: context.membershipId,
        lineItems: { create: totals.lines.map(toLineData) },
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_UPDATED",
      message: `updated proposal ${input.proposalNumber}`,
      metadata: changeMetadata({
        totalAmount: {
          from: toAmountString(existing.totalAmount),
          to: toAmountString(totals.totalAmount),
        },
      }),
    });
  });

  return getProposal(context, proposalId);
}

export async function submitProposal(context: UserContext, proposalId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.submit");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));

  if (!isProposalSubmittable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      `A ${existing.status.toLowerCase().replace("_", " ")} proposal cannot be submitted.`,
    );
  }
  if (existing.lineItems.length === 0) {
    throw new AccessError("CONFLICT", "A proposal needs at least one line before it goes for approval.");
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "PENDING_APPROVAL");
    await approvals.openApproval(tx, context, "PROPOSAL", proposalId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_SUBMITTED",
      message: `submitted proposal ${existing.proposalNumber} for approval`,
    });
  });
}

export async function approveProposal(
  context: UserContext,
  proposalId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "PROPOSAL");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "PROPOSAL", proposalId);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "APPROVED");
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_APPROVED",
      message: `approved proposal ${existing.proposalNumber}`,
    });
  });
}

export async function rejectProposal(
  context: UserContext,
  proposalId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "PROPOSAL");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "PROPOSAL", proposalId);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "REJECTED");
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_REJECTED",
      message: `rejected proposal ${existing.proposalNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Marks an approved proposal as sent (PRD #17 §120).
 *
 * This records that somebody sent it, by whatever means they actually used.
 * V0.1 delivers no email, and pretending otherwise would be a lie in the
 * activity trail (PRD #17 §120).
 */
export async function markProposalSent(context: UserContext, proposalId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.mark_sent");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "SENT", { sentAt: new Date() });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_MARKED_SENT",
      message: `marked proposal ${existing.proposalNumber} as sent`,
    });
  });
}

/**
 * The client said yes (PRD #17 §121, §123, §186, §258).
 *
 * At most one proposal per opportunity may be accepted, checked inside the
 * transaction. The opportunity is nudged to NEGOTIATION but never marked won:
 * that decision needs a client, a close date and a person to confirm it
 * (PRD #17 §123).
 */
export async function acceptProposal(context: UserContext, proposalId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.accept");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));

  await prisma.$transaction(async (tx) => {
    // Lock the opportunity first, then look for an accepted proposal on it.
    // Checking a fact another transaction is about to change is the same as not
    // checking it: without this, two acceptances land at once and the
    // opportunity ends up with two agreed prices (PRD #17 §186, §258).
    await lockOpportunity(tx, existing.opportunityId);

    const alreadyAccepted = await tx.proposal.findFirst({
      where: {
        companyId: context.companyId,
        opportunityId: existing.opportunityId,
        status: "ACCEPTED",
        id: { not: proposalId },
      },
      select: { proposalNumber: true },
    });

    if (alreadyAccepted) {
      throw new AccessError(
        "CONFLICT",
        `Proposal ${alreadyAccepted.proposalNumber} is already accepted on this opportunity.`,
      );
    }

    await moveStatus(tx, context, existing, "ACCEPTED", { acceptedAt: new Date() });

    // A nudge, not an outcome: the opportunity stays open until somebody says
    // it is won (PRD #17 §123).
    if (!isClosedStage(existing.opportunity.stage) && existing.opportunity.stage !== "NEGOTIATION") {
      await tx.opportunity.updateMany({
        where: { id: existing.opportunityId, stage: existing.opportunity.stage },
        data: { stage: "NEGOTIATION", stageChangedAt: new Date() },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_ACCEPTED",
      message: `recorded proposal ${existing.proposalNumber} as accepted`,
      metadata: {
        opportunityId: existing.opportunityId,
        currency: existing.currency,
        totalAmount: toAmountString(existing.totalAmount),
      } as Prisma.InputJsonValue,
    });
  });
}

export async function declineProposal(
  context: UserContext,
  proposalId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.decline");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "DECLINED", { declinedAt: new Date() });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_DECLINED",
      message: `recorded proposal ${existing.proposalNumber} as declined`,
      metadata: note ? ({ note } as Prisma.InputJsonValue) : undefined,
    });
  });
}

export async function cancelProposal(context: UserContext, proposalId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.cancel");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));

  if (!isProposalCancellable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      existing.status === "ACCEPTED"
        ? "An accepted proposal is the deal the client agreed to and cannot be cancelled."
        : `A ${existing.status.toLowerCase().replace("_", " ")} proposal cannot be cancelled.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "CANCELLED");
    await approvals.cancelPendingApprovals(tx, context, "PROPOSAL", proposalId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_CANCELLED",
      message: `cancelled proposal ${existing.proposalNumber}`,
    });
  });
}

export async function archiveProposal(context: UserContext, proposalId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.archive");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));

  if (!isProposalArchivable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      existing.status === "ACCEPTED"
        ? "An accepted proposal stays visible. It is the commercial record behind the deal."
        : "Cancel this proposal first if it should not stand.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.proposal.update({
      where: { id: proposalId },
      data: {
        status: "ARCHIVED",
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await approvals.cancelPendingApprovals(tx, context, "PROPOSAL", proposalId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_ARCHIVED",
      message: `archived proposal ${existing.proposalNumber}`,
    });
  });
}

export async function restoreProposal(context: UserContext, proposalId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.proposal.restore");

  const existing = assertFound(await repository.findProposalInScope(context, proposalId));
  if (existing.status !== "ARCHIVED") {
    throw new AccessError("CONFLICT", "This proposal is not archived.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.proposal.update({
      where: { id: proposalId },
      data: {
        status: existing.preArchiveStatus ?? "DRAFT",
        preArchiveStatus: null,
        archivedAt: null,
        archivedByMemberId: null,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: proposalId,
      action: "SALES_PROPOSAL_RESTORED",
      message: `restored proposal ${existing.proposalNumber}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function moveStatus(
  tx: Prisma.TransactionClient,
  context: UserContext,
  existing: { id: string; status: ProposalStatus },
  next: ProposalStatus,
  extra: Prisma.ProposalUpdateInput = {},
): Promise<void> {
  if (!canTransitionProposalStatus(existing.status, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A proposal cannot move from ${existing.status} to ${next}.`,
    );
  }

  // Conditional on the status we read, so two people acting at once cannot both
  // win (PRD #17 §133, §257).
  const result = await tx.proposal.updateMany({
    where: { id: existing.id, status: existing.status },
    data: { status: next, updatedByMemberId: context.membershipId, ...extra },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This proposal changed while you were working on it.");
  }
}

/**
 * The opportunity a proposal may be raised against (PRD #17 §109, §110, §216).
 *
 * Looked up inside the caller's own scope, open, not archived, and carrying a
 * client — because a commercial document with nobody to address it to is not a
 * document anybody can send.
 */
async function resolveOpportunity(context: UserContext, opportunityId: string) {
  const opportunity = await prisma.opportunity.findFirst({
    where: { AND: [buildOpportunityScopeWhere(context), { id: opportunityId }] },
    select: { id: true, name: true, clientId: true, stage: true, archivedAt: true },
  });

  if (!opportunity) {
    throw new AccessError("VALIDATION_ERROR", "That opportunity does not exist.");
  }
  if (opportunity.archivedAt || isClosedStage(opportunity.stage)) {
    throw new AccessError(
      "CONFLICT",
      "A proposal belongs to an open opportunity. This one is already closed.",
    );
  }
  if (!opportunity.clientId) {
    throw new AccessError(
      "CONFLICT",
      "Link a client to this opportunity first — a proposal has to be addressed to somebody.",
    );
  }

  return opportunity;
}

/**
 * Serialises the transactions that decide one opportunity's accepted proposal.
 *
 * A row lock rather than a unique index: "at most one ACCEPTED per opportunity"
 * is a partial constraint Prisma cannot declare, and the lock keeps the rule in
 * the one place that enforces it (PRD #17 §237, §258).
 */
async function lockOpportunity(
  tx: Prisma.TransactionClient,
  opportunityId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "opportunities" WHERE id = ${opportunityId} FOR UPDATE`;
}

async function assertNumberIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  proposalNumber: string,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.proposal.findFirst({
    where: {
      companyId: context.companyId,
      proposalNumber,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError(
      "CONFLICT",
      `Proposal number ${proposalNumber} is already used in this company.`,
    );
  }
}

function toLineData(line: ReturnType<typeof calculateProposal>["lines"][number]) {
  return {
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxRate: line.taxRate,
    subtotal: line.subtotal,
    taxAmount: line.taxAmount,
    totalAmount: line.totalAmount,
    sortOrder: line.sortOrder,
  };
}

export function toSummaryDTO(row: repository.ProposalRow): ProposalSummaryDTO {
  return {
    id: row.id,
    proposalNumber: row.proposalNumber,
    title: row.title,
    opportunity: row.opportunity,
    client: row.client,
    currency: row.currency,
    totalAmount: toAmountString(row.totalAmount),
    validUntil: row.validUntil ? businessDateString(row.validUntil) : null,
    status: row.status,
    expiry: proposalExpiry({ status: row.status, validUntil: row.validUntil }),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, row: repository.ProposalDetailRow) {
  const archived = row.status === "ARCHIVED";

  return {
    canEdit: !archived && isProposalEditable(row.status) && can(context, "sales.proposal.update"),
    canSubmit:
      !archived && isProposalSubmittable(row.status) && can(context, "sales.proposal.submit"),
    canApprove:
      row.status === "PENDING_APPROVAL" && approvals.canApproveType(context, "PROPOSAL"),
    canReject: row.status === "PENDING_APPROVAL" && approvals.canRejectType(context, "PROPOSAL"),
    canMarkSent: row.status === "APPROVED" && can(context, "sales.proposal.mark_sent"),
    canAccept: row.status === "SENT" && can(context, "sales.proposal.accept"),
    canDecline: row.status === "SENT" && can(context, "sales.proposal.decline"),
    canCancel: !archived && isProposalCancellable(row.status) && can(context, "sales.proposal.cancel"),
    canArchive:
      !archived && isProposalArchivable(row.status) && can(context, "sales.proposal.archive"),
    canRestore: archived && can(context, "sales.proposal.restore"),
    canViewActivity: can(context, "sales.activity.view"),
    canViewDocuments: can(context, "sales.document.view") && can(context, "document.view"),
  };
}
