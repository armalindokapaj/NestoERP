import { Prisma, type ContractStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import {
  canSeeCommercial,
  commercialDTO,
  confidential,
  dateString,
  loadMemberRef,
  moduleLink,
  toMemberRef,
} from "../contract.dto";
import type {
  ContractAttentionDTO,
  ContractCapabilities,
  ContractDetailDTO,
  ContractSummaryDTO,
} from "../contract.types";
import * as amendments from "../amendments/amendment.service";
import * as repository from "./contract.repository";
import type {
  ContractListQuery,
  ContractSignedInput,
  ContractTerminationInput,
  CreateContractInput,
  UpdateContractInput,
  UpdateContractMetadataInput,
} from "./contract.schema";
import {
  acceptsAmendments,
  acceptsObligations,
  arePartiesEditable,
  canTransitionContractStatus,
  contractEditMode,
  daysBetween,
  getEffectiveContractStatus,
  isContractArchivable,
  isContractCancellable,
  isExpiringSoon,
  isPartyRemovable,
  isRenewalNoticeDue,
  renewalAlertDate,
} from "./contract.status";

/**
 * Contracts (PRD #18 §99, §189, §282).
 *
 * Four rules are enforced here and nowhere else:
 *
 *   1. **Status moves only through named actions.** There is no path from a
 *      generic update to `status`, so a lifecycle cannot be skipped by a
 *      well-formed PATCH (PRD #18 §192).
 *   2. **Approval freezes the terms.** Past APPROVED the value, dates, parties
 *      and legal terms are changed by amendment, which leaves a record of who
 *      agreed to the change (PRD #18 §106).
 *   3. **Redaction happens on the way out.** A reader without commercial or
 *      confidential permission never receives the field, rather than receiving
 *      it and being asked not to look (PRD #18 §255, §257).
 *   4. **Every transition is conditional on the status that was read**, so two
 *      people acting at the same moment cannot both win (PRD #18 §320).
 */

const MODULE = "contracts" as const;
const ENTITY = "Contract";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listContracts(context: UserContext, query: ContractListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.view");

  const today = new Date();
  const { rows, total } = await repository.listContracts(context, query, today);
  const overdue = await overdueObligationCounts(rows.map((row) => row.id), today);

  return {
    data: rows.map((row) => toSummaryDTO(context, row, today, overdue)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getContract(
  context: UserContext,
  contractId: string,
): Promise<ContractDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.view");

  // Out of scope answers "not found", so the response cannot confirm that a
  // contract exists to somebody who may not open it (PRD #18 §288).
  const row = assertFound(await repository.findContractInScope(context, contractId));
  const today = new Date();

  const [overdue, counts, documents, history, createdBy, links, activeAmendment] =
    await Promise.all([
      overdueObligationCounts([row.id], today),
      recordCounts(row.id),
      repository.countDocuments(row.id),
      approvals.approvalHistory(context, "CONTRACT", row.id),
      loadMemberRef(row.createdByMemberId),
      resolveLinks(context, row),
      amendments.latestAmendment(context, row.id),
    ]);

  const summary = toSummaryDTO(context, row, today, overdue);

  return {
    ...summary,
    commercialNotes: canSeeCommercial(context) ? row.commercialNotes : null,
    dates: {
      sentAt: row.sentAt?.toISOString() ?? null,
      signedDate: dateString(row.signedDate),
      effectiveDate: dateString(row.effectiveDate),
      expiryDate: dateString(row.expiryDate),
      terminationDate: dateString(row.terminationDate),
    },
    renewal: {
      type: row.renewalType,
      noticeDays: row.renewalNoticeDays,
      autoRenewalPeriodMonths: row.autoRenewalPeriodMonths,
      alertDate: dateString(renewalAlertDate(row)),
    },
    legal: {
      governingLaw: row.governingLaw,
      jurisdiction: row.jurisdiction,
      summary: row.summary,
      legalNotes: confidential(context, row.legalNotes),
      terminationReason: confidential(context, row.terminationReason),
    },
    salesSource: links.salesSource,
    clientLink: links.clientLink,
    projectLink: links.projectLink,
    counts: {
      parties: counts.parties,
      openObligations: counts.openObligations,
      amendments: counts.amendments,
      documents,
    },
    approvals: history,
    activeAmendment,
    createdBy,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    // The pending decision, so the page does not offer an Approve button to
    // the person who submitted it (PRD #18 §116, §353).
    capabilities: capabilitiesFor(context, row, history.find((entry) => entry.status === "PENDING")),
  };
}

export async function contractFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.view");
  return repository.contractFilterOptions(context);
}

/**
 * The choices a create or edit form may offer (PRD #18 §95–§97).
 *
 * Gated on `legal.contract.create` rather than `.view`: this is the picker for
 * writing a contract, and everything in it is resolved through the caller's own
 * access to the module it came from (PRD #18 §297).
 */
export async function contractFormOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.create");
  return repository.contractFormOptions(context);
}

/**
 * The same picker, for editing a contract that already exists.
 *
 * Separated only by which grant opens it: somebody may hold `legal.contract.update`
 * without `.create` (PRD #18 §104).
 */
export async function contractEditOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.update");
  return repository.contractFormOptions(context);
}

/** The contracts on one client record (PRD #18 §10, §439). */
export async function listForClient(
  context: UserContext,
  clientId: string,
): Promise<ContractSummaryDTO[]> {
  if (!can(context, "legal.contract.view")) return [];
  const today = new Date();
  const rows = await repository.listContractsFor(context, { clientId });
  const overdue = await overdueObligationCounts(rows.map((row) => row.id), today);
  return rows.map((row) => toSummaryDTO(context, row, today, overdue));
}

/** The contracts on one project record (PRD #18 §11, §440). */
export async function listForProject(
  context: UserContext,
  projectId: string,
): Promise<ContractSummaryDTO[]> {
  if (!can(context, "legal.contract.view")) return [];
  const today = new Date();
  const rows = await repository.listContractsFor(context, { projectId });
  const overdue = await overdueObligationCounts(rows.map((row) => row.id), today);
  return rows.map((row) => toSummaryDTO(context, row, today, overdue));
}

/**
 * The contracts already drawn from one sales record (PRD #18 §213, §506, §507).
 *
 * Shown on the handoff so a second click on "Create contract" meets the first
 * contract rather than making another one. A warning, not a unique constraint:
 * one accepted proposal can legitimately produce two agreements.
 */
export async function listForSalesSource(
  context: UserContext,
  source: { opportunityId?: string; proposalId?: string },
): Promise<ContractSummaryDTO[]> {
  if (!can(context, "legal.contract.view")) return [];
  const today = new Date();
  const rows = await repository.listContractsForSalesSource(context, source);
  const overdue = await overdueObligationCounts(rows.map((row) => row.id), today);
  return rows.map((row) => toSummaryDTO(context, row, today, overdue));
}

/**
 * Contracts whose renewal notice has fallen due (PRD #18 §194, §339).
 *
 * The candidate set comes from the database — active, expiring within a year —
 * and the exact rule is applied here, because it compares two columns against
 * each other and a Prisma filter cannot. Bounded by the calendar rather than
 * by a page of results.
 */
export async function listRenewalNoticeDue(
  context: UserContext,
  limit: number,
): Promise<ContractSummaryDTO[]> {
  if (!can(context, "legal.contract.view")) return [];

  const today = new Date();
  const candidates = await repository.renewalNoticeCandidates(context, today);
  const due = candidates.filter((row) => isRenewalNoticeDue(row, today)).slice(0, limit);
  const overdue = await overdueObligationCounts(due.map((row) => row.id), today);

  return due.map((row) => toSummaryDTO(context, row, today, overdue));
}

/** Active contracts whose owner is no longer active (PRD #18 §339). */
export async function listInactiveOwnerContracts(
  context: UserContext,
  limit: number,
): Promise<ContractSummaryDTO[]> {
  if (!can(context, "legal.contract.view")) return [];

  const today = new Date();
  const rows = await repository.contractsWithInactiveOwner(context, limit);
  const overdue = await overdueObligationCounts(rows.map((row) => row.id), today);

  return rows.map((row) => toSummaryDTO(context, row, today, overdue));
}

/* -------------------------------------------------------------------------- */
/* Create and edit                                                             */
/* -------------------------------------------------------------------------- */

export async function createContract(
  context: UserContext,
  input: CreateContractInput,
): Promise<ContractDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.create");

  const related = await resolveRelated(context, input);

  const contractId = await prisma.$transaction(async (tx) => {
    await assertNumberIsFree(tx, context, input.contractNumber, null);

    const contract = await tx.contract.create({
      data: {
        companyId: context.companyId,
        contractNumber: input.contractNumber,
        title: input.title,
        contractType: input.contractType,
        clientId: related.clientId,
        projectId: related.projectId,
        opportunityId: related.opportunityId,
        proposalId: related.proposalId,
        ownerMemberId: related.ownerMemberId,
        status: "DRAFT",
        counterpartyName: input.counterpartyName ?? related.defaultCounterpartyName,
        currency: input.currency ?? null,
        contractValue: input.contractValue ? new Prisma.Decimal(input.contractValue) : null,
        effectiveDate: input.effectiveDate ?? null,
        expiryDate: input.expiryDate ?? null,
        signedDate: input.signedDate ?? null,
        renewalType: input.renewalType,
        renewalNoticeDays: input.renewalNoticeDays ?? null,
        autoRenewalPeriodMonths: input.autoRenewalPeriodMonths ?? null,
        governingLaw: input.governingLaw ?? null,
        jurisdiction: input.jurisdiction ?? null,
        summary: input.summary ?? null,
        commercialNotes: input.commercialNotes ?? null,
        legalNotes: input.legalNotes ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contract.id,
      action: "LEGAL_CONTRACT_CREATED",
      // The message names the record and nothing confidential: it is read by
      // everybody who can see the contract at all (PRD #18 §210).
      message: `drafted contract ${input.contractNumber}`,
      metadata: {
        contractType: input.contractType,
        clientId: related.clientId,
        projectId: related.projectId,
      } as Prisma.InputJsonValue,
    });

    return contract.id;
  });

  return getContract(context, contractId);
}

export async function updateContract(
  context: UserContext,
  contractId: string,
  input: UpdateContractInput,
): Promise<ContractDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.update");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  assertEditable(existing.status, "FULL");
  assertVersion(existing.updatedAt, input.versionUpdatedAt);

  const related = await resolveRelated(context, input);

  await prisma.$transaction(async (tx) => {
    await assertNumberIsFree(tx, context, input.contractNumber, contractId);

    await tx.contract.update({
      where: { id: contractId },
      data: {
        contractNumber: input.contractNumber,
        title: input.title,
        contractType: input.contractType,
        clientId: related.clientId,
        projectId: related.projectId,
        opportunityId: related.opportunityId,
        proposalId: related.proposalId,
        ownerMemberId: related.ownerMemberId,
        counterpartyName: input.counterpartyName ?? null,
        currency: input.currency ?? null,
        contractValue: input.contractValue ? new Prisma.Decimal(input.contractValue) : null,
        effectiveDate: input.effectiveDate ?? null,
        expiryDate: input.expiryDate ?? null,
        signedDate: input.signedDate ?? null,
        renewalType: input.renewalType,
        renewalNoticeDays: input.renewalNoticeDays ?? null,
        autoRenewalPeriodMonths: input.autoRenewalPeriodMonths ?? null,
        governingLaw: input.governingLaw ?? null,
        jurisdiction: input.jurisdiction ?? null,
        summary: input.summary ?? null,
        commercialNotes: input.commercialNotes ?? null,
        legalNotes: input.legalNotes ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_UPDATED",
      message: `updated contract ${input.contractNumber}`,
      metadata: changeMetadata({
        title: { from: existing.title, to: input.title },
        expiryDate: { from: dateString(existing.expiryDate), to: dateString(input.expiryDate ?? null) },
      }),
    });
  });

  return getContract(context, contractId);
}

/**
 * The correction an approved contract still allows (PRD #18 §107).
 *
 * Owner and internal summary. Everything else is a term of the agreement, and a
 * term changes by amendment.
 */
export async function updateContractMetadata(
  context: UserContext,
  contractId: string,
  input: UpdateContractMetadataInput,
): Promise<ContractDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.update");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  assertEditable(existing.status, "METADATA");
  assertVersion(existing.updatedAt, input.versionUpdatedAt);

  const owner = await resolveOwner(context, input.ownerMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contractId },
      data: {
        ownerMemberId: owner,
        summary: input.summary ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_UPDATED",
      message: `updated contract ${existing.contractNumber}`,
      metadata: changeMetadata({
        ownerMemberId: { from: existing.ownerMemberId, to: owner },
      }),
    });
  });

  return getContract(context, contractId);
}

/** Ownership is a business fact and may be reassigned at any point (PRD #18 §52, §323). */
export async function assignOwner(
  context: UserContext,
  contractId: string,
  ownerMemberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.owner.assign");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  const owner = await resolveOwner(context, ownerMemberId);
  if (owner === existing.ownerMemberId) return;

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contractId },
      data: { ownerMemberId: owner, updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_OWNER_CHANGED",
      message: `reassigned contract ${existing.contractNumber}`,
      metadata: changeMetadata({
        ownerMemberId: { from: existing.ownerMemberId, to: owner },
      }),
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Review and approval                                                         */
/* -------------------------------------------------------------------------- */

export async function submitForReview(context: UserContext, contractId: string): Promise<void> {
  await runTransition(context, contractId, {
    permission: "legal.contract.submit_review",
    next: "IN_REVIEW",
    action: "LEGAL_CONTRACT_SUBMITTED_REVIEW",
    message: (contract) => `sent contract ${contract.contractNumber} for review`,
  });
}

export async function returnToDraft(
  context: UserContext,
  contractId: string,
  note: string | null,
): Promise<void> {
  await runTransition(context, contractId, {
    permission: "legal.contract.review",
    next: "DRAFT",
    action: "LEGAL_CONTRACT_RETURNED_DRAFT",
    message: (contract) => `returned contract ${contract.contractNumber} to draft`,
    metadata: note ? ({ note } as Prisma.InputJsonValue) : undefined,
  });
}

/**
 * Sends a reviewed contract for a decision (PRD #18 §111, §112).
 *
 * Only from IN_REVIEW. A draft that has never been read by anybody cannot be
 * pushed straight at an approver, which is what the transition table says and
 * what makes the review step worth having (PRD #18 §112).
 */
export async function submitForApproval(context: UserContext, contractId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.submit_approval");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  assertNotArchived(existing.archivedAt);

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "PENDING_APPROVAL");
    await approvals.openApproval(tx, context, "CONTRACT", contractId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_SUBMITTED_APPROVAL",
      message: `submitted contract ${existing.contractNumber} for approval`,
    });
  });
}

export async function approveContract(
  context: UserContext,
  contractId: string,
  note: string | null,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "CONTRACT");

  const existing = assertFound(await repository.findContractInScope(context, contractId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "CONTRACT", contractId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "APPROVED");
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_APPROVED",
      message: `approved contract ${existing.contractNumber}`,
    });
  });
}

export async function rejectContract(
  context: UserContext,
  contractId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "CONTRACT");

  const existing = assertFound(await repository.findContractInScope(context, contractId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "CONTRACT", contractId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    // Back to review rather than to draft: the reviewer's work is not undone by
    // a rejected approval (PRD #18 §114).
    await moveStatus(tx, context, existing, "IN_REVIEW");
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_REJECTED",
      message: `rejected contract ${existing.contractNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Returns a contract for revision (PRD #41 §48). Unlike a rejection, which
 * sends it back to review, this puts it back in draft with the approver's
 * reason: the terms themselves need rewriting, and the revised draft goes
 * through review again before a new approval cycle.
 */
export async function returnContractForRevision(
  context: UserContext,
  contractId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "CONTRACT");

  const existing = assertFound(await repository.findContractInScope(context, contractId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "CONTRACT", contractId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "DRAFT");
    await approvals.decideApproval(tx, context, approval.id, "RETURNED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_RETURNED",
      message: `returned contract ${existing.contractNumber} for revision`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

export async function markSent(context: UserContext, contractId: string): Promise<void> {
  await runTransition(context, contractId, {
    permission: "legal.contract.mark_sent",
    next: "SENT",
    extra: { sentAt: new Date() },
    action: "LEGAL_CONTRACT_MARKED_SENT",
    message: (contract) => `marked contract ${contract.contractNumber} as sent`,
  });
}

/**
 * Records that the agreement has been signed (PRD #18 §118, §119).
 *
 * A signed file is expected but not required. Somebody holding a scanned
 * signature page they cannot upload yet still has a signed contract, and
 * refusing to record that makes the system disagree with reality — so the
 * missing document is a confirmation, not a block.
 */
export async function markSigned(
  context: UserContext,
  contractId: string,
  input: ContractSignedInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.mark_signed");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  assertNotArchived(existing.archivedAt);

  if (!input.acknowledgeMissingDocument) {
    const documents = await repository.countDocuments(contractId);
    if (documents === 0) {
      throw new AccessError(
        "CONFLICT",
        "No signed contract document is attached. Attach one, or confirm to record the signature without it.",
        { code: "SIGNED_DOCUMENT_MISSING" },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "SIGNED", { signedDate: input.signedDate });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_MARKED_SIGNED",
      message: `recorded contract ${existing.contractNumber} as signed`,
      metadata: { signedDate: dateString(input.signedDate) } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Brings a signed contract into force (PRD #18 §120, §121).
 *
 * An effective date is required, and a future one is refused: a contract that
 * is "active from next month" is not active, and saying it is would put it into
 * every active-value total a month early.
 */
export async function activateContract(
  context: UserContext,
  contractId: string,
  effectiveDate: Date | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.activate");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  assertNotArchived(existing.archivedAt);

  const effective = effectiveDate ?? existing.effectiveDate;
  if (!effective) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Set an effective date before activating this contract.",
    );
  }

  if (daysBetween(new Date(), effective) > 0) {
    throw new AccessError(
      "CONFLICT",
      `This contract takes effect on ${dateString(effective)}. It can be activated from that date.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "ACTIVE", { effectiveDate: effective });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_ACTIVATED",
      message: `activated contract ${existing.contractNumber}`,
      metadata: { effectiveDate: dateString(effective) } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Writes down what the calendar already decided (PRD #18 §122, §123).
 *
 * Reporting has treated this contract as expired since the day it ended. This
 * action makes the stored status agree, and refuses while the end date is still
 * in the future.
 */
export async function expireContract(context: UserContext, contractId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.expire");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  assertNotArchived(existing.archivedAt);

  if (!existing.expiryDate) {
    throw new AccessError(
      "CONFLICT",
      "This contract has no expiry date, so it runs until it is terminated.",
    );
  }
  if (daysBetween(new Date(), existing.expiryDate) >= 0) {
    throw new AccessError(
      "CONFLICT",
      `This contract runs until ${dateString(existing.expiryDate)}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "EXPIRED");

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_EXPIRED",
      message: `recorded contract ${existing.contractNumber} as expired`,
    });
  });
}

/**
 * Ends an agreement before its natural end (PRD #18 §130–§133).
 *
 * Documents, obligations and amendments are all preserved: termination is the
 * end of the agreement, not the deletion of its history (PRD #18 §133).
 */
export async function terminateContract(
  context: UserContext,
  contractId: string,
  input: ContractTerminationInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.terminate");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  assertNotArchived(existing.archivedAt);

  const today = new Date();
  if (daysBetween(today, input.terminationDate) > 0) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "A termination date cannot be in the future. Record it on the day it takes effect.",
    );
  }
  if (
    existing.effectiveDate &&
    daysBetween(existing.effectiveDate, input.terminationDate) < 0
  ) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "A contract cannot be terminated before it took effect.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "TERMINATED", {
      terminationDate: input.terminationDate,
      terminationReason: input.terminationReason,
      terminatedByMemberId: context.membershipId,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_TERMINATED",
      // The reason is confidential and stays in metadata, which the activity
      // reader does not return (PRD #18 §210).
      message: `terminated contract ${existing.contractNumber}`,
      metadata: {
        terminationDate: dateString(input.terminationDate),
        terminationReason: input.terminationReason,
      } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelContract(
  context: UserContext,
  contractId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.cancel");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  assertNotArchived(existing.archivedAt);

  if (!isContractCancellable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      existing.status === "ACTIVE" || existing.status === "SIGNED"
        ? "A signed contract is ended by terminating it, not by cancelling it."
        : `A ${existing.status.toLowerCase().replace(/_/g, " ")} contract cannot be cancelled.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "CANCELLED");
    // A cancelled contract has nothing left to decide (PRD #18 §129).
    await approvals.cancelPendingApprovals(tx, context, "CONTRACT", contractId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_CANCELLED",
      message: `cancelled contract ${existing.contractNumber}`,
      metadata: note ? ({ note } as Prisma.InputJsonValue) : undefined,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Archive                                                                     */
/* -------------------------------------------------------------------------- */

export async function archiveContract(context: UserContext, contractId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.archive");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  if (existing.archivedAt) throw new AccessError("CONFLICT", "This contract is already archived.");

  if (!isContractArchivable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "A contract that is live or on its way to signature stays visible. Cancel or terminate it first.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contractId },
      data: {
        status: "ARCHIVED",
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await approvals.cancelPendingApprovals(tx, context, "CONTRACT", contractId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_CONTRACT_ARCHIVED",
      message: `archived contract ${existing.contractNumber}`,
    });
  });
}

export async function restoreContract(context: UserContext, contractId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.contract.restore");

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  if (!existing.archivedAt) throw new AccessError("CONFLICT", "This contract is not archived.");

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contractId },
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
      entityId: contractId,
      action: "LEGAL_CONTRACT_RESTORED",
      message: `restored contract ${existing.contractNumber}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

type TransitionSpec = {
  permission: Parameters<typeof assertPermission>[1];
  next: ContractStatus;
  extra?: Prisma.ContractUpdateInput;
  action: string;
  message: (contract: { contractNumber: string }) => string;
  metadata?: Prisma.InputJsonValue;
};

async function runTransition(
  context: UserContext,
  contractId: string,
  spec: TransitionSpec,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, spec.permission);

  const existing = assertFound(await repository.findContractInScope(context, contractId));
  assertNotArchived(existing.archivedAt);

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, spec.next, spec.extra);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: spec.action,
      message: spec.message(existing),
      metadata: spec.metadata,
    });
  });
}

/**
 * One status change, conditional on the status that was read (PRD #18 §320).
 *
 * Two people terminating and expiring the same contract at the same moment
 * cannot both succeed: the second `updateMany` matches nothing and the caller
 * is told the record moved.
 */
async function moveStatus(
  tx: Prisma.TransactionClient,
  context: UserContext,
  existing: { id: string; status: ContractStatus; contractNumber: string },
  next: ContractStatus,
  extra: Prisma.ContractUpdateInput = {},
): Promise<void> {
  if (!canTransitionContractStatus(existing.status, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A contract cannot move from ${existing.status} to ${next}.`,
    );
  }

  const result = await tx.contract.updateMany({
    where: { id: existing.id, status: existing.status },
    data: {
      status: next,
      updatedByMemberId: context.membershipId,
      ...(extra as Prisma.ContractUpdateManyMutationInput),
    },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This contract changed while you were working on it.");
  }
}

function assertNotArchived(archivedAt: Date | null): void {
  if (archivedAt) {
    throw new AccessError("CONFLICT", "This contract is archived. Restore it before changing it.");
  }
}

function assertEditable(status: ContractStatus, required: "FULL" | "METADATA"): void {
  const mode = contractEditMode(status);
  if (mode === "NONE") {
    throw new AccessError(
      "CONFLICT",
      status === "PENDING_APPROVAL"
        ? "This contract is waiting for a decision. Return it to review before editing it."
        : "This contract is closed and read-only.",
    );
  }
  if (required === "FULL" && mode === "METADATA") {
    throw new AccessError(
      "CONFLICT",
      "An approved contract's terms change by amendment, not by editing. The owner and summary can still be corrected.",
    );
  }
}

function assertVersion(current: Date, supplied: Date | undefined): void {
  if (supplied && current.getTime() !== supplied.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This contract was updated by another user. Refresh before saving.",
    );
  }
}

async function assertNumberIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  contractNumber: string,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.contract.findFirst({
    where: {
      companyId: context.companyId,
      contractNumber,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError(
      "CONFLICT",
      `Contract number ${contractNumber} is already used in this company.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Related-record validation                                                   */
/* -------------------------------------------------------------------------- */

type RelatedInput = {
  ownerMemberId: string;
  clientId?: string;
  projectId?: string;
  opportunityId?: string;
  proposalId?: string;
};

/**
 * Everything a contract points at, validated together (PRD #18 §53–§60, §98).
 *
 * The consistency rules are checked here because they are about the *set* of
 * links, not any one of them: a proposal that belongs to a different
 * opportunity, or names a different client, describes a contract that could not
 * have happened (PRD #18 §59, §60).
 */
async function resolveRelated(context: UserContext, input: RelatedInput) {
  const ownerMemberId = await resolveOwner(context, input.ownerMemberId);

  const client = input.clientId ? await resolveClient(context, input.clientId) : null;
  const project = input.projectId ? await resolveProject(context, input.projectId) : null;

  /*
   * A contract on a project for a different customer is legitimate — a
   * subcontract on somebody else's job is exactly that — but it is unusual
   * enough that it must be deliberate, and `legal.manage` is who decides
   * (PRD #18 §55).
   */
  if (project?.clientId && client && project.clientId !== client.id && !can(context, "legal.manage")) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That project belongs to a different client. Clear one of the two, or ask somebody who manages Legal to record the exception.",
      { code: "CLIENT_PROJECT_MISMATCH" },
    );
  }

  const opportunity = input.opportunityId
    ? await resolveOpportunity(context, input.opportunityId)
    : null;
  const proposal = input.proposalId ? await resolveProposal(context, input.proposalId) : null;

  if (proposal && opportunity && proposal.opportunityId !== opportunity.id) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That proposal belongs to a different opportunity.",
      { code: "SALES_SOURCE_MISMATCH" },
    );
  }

  if (proposal && client && proposal.clientId !== client.id) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That proposal was addressed to a different client.",
      { code: "SALES_SOURCE_MISMATCH" },
    );
  }

  return {
    ownerMemberId,
    clientId: client?.id ?? null,
    projectId: project?.id ?? null,
    opportunityId: opportunity?.id ?? proposal?.opportunityId ?? null,
    proposalId: proposal?.id ?? null,
    defaultCounterpartyName: client?.legalName ?? client?.name ?? null,
  };
}

async function resolveOwner(context: UserContext, ownerMemberId: string): Promise<string> {
  const member = await prisma.companyMember.findFirst({
    where: {
      id: ownerMemberId,
      companyId: context.companyId,
      status: "ACTIVE",
      archivedAt: null,
    },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Choose an active member of this company as the contract owner.",
      { code: "INVALID_OWNER" },
    );
  }

  return member.id;
}

async function resolveClient(context: UserContext, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId: context.companyId, archivedAt: null },
    select: { id: true, name: true, legalName: true },
  });
  if (!client) throw new AccessError("VALIDATION_ERROR", "That client does not exist.");
  return client;
}

async function resolveProject(context: UserContext, projectId: string) {
  // Inside the caller's project scope: a contract must not become a way to
  // attach work to a project they cannot open (PRD #18 §54, §283).
  const project = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId, archivedAt: null }] },
    select: { id: true, clientId: true },
  });
  if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.");
  return project;
}

/**
 * The sales lineage (PRD #18 §57, §58, §285).
 *
 * Validated against the company rather than the caller's Sales scope: a lawyer
 * with no Sales access still has to be able to record which deal an agreement
 * came from. What their permissions decide is whether they can *see* it
 * afterwards, which is `legal.sales_source.view` plus the Sales grant
 * (PRD #18 §252).
 */
async function resolveOpportunity(context: UserContext, opportunityId: string) {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId: context.companyId },
    select: { id: true, clientId: true },
  });
  if (!opportunity) throw new AccessError("VALIDATION_ERROR", "That opportunity does not exist.");
  return opportunity;
}

async function resolveProposal(context: UserContext, proposalId: string) {
  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, companyId: context.companyId },
    select: { id: true, opportunityId: true, clientId: true },
  });
  if (!proposal) throw new AccessError("VALIDATION_ERROR", "That proposal does not exist.");
  return proposal;
}

/* -------------------------------------------------------------------------- */
/* Counting and linking                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Overdue obligations for a page of contracts, in one query (PRD #18 §303).
 *
 * Batched rather than counted per row: a list of twenty-five contracts must not
 * become twenty-six queries (PRD #18 §449).
 */
export async function overdueObligationCounts(
  contractIds: string[],
  today: Date,
): Promise<Map<string, number>> {
  if (contractIds.length === 0) return new Map();

  const rows = await prisma.contractObligation.groupBy({
    by: ["contractId"],
    where: { contractId: { in: contractIds }, status: "OPEN", dueDate: { lt: today } },
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.contractId, row._count._all]));
}

async function recordCounts(contractId: string) {
  const [parties, openObligations, amendmentCount] = await Promise.all([
    prisma.contractParty.count({ where: { contractId } }),
    prisma.contractObligation.count({ where: { contractId, status: "OPEN" } }),
    prisma.contractAmendment.count({ where: { contractId, archivedAt: null } }),
  ]);
  return { parties, openObligations, amendments: amendmentCount };
}

/**
 * The cross-module links, each answered by the target's own access rules
 * (PRD #18 §252, §496, §497).
 */
async function resolveLinks(context: UserContext, row: repository.ContractDetailRow) {
  const clientLink =
    row.client && can(context, "legal.client_link.view")
      ? moduleLink(
          row.client.id,
          row.client.name,
          `/clients/${row.client.id}`,
          can(context, "client.view"),
        )
      : null;

  const projectLink = row.project && can(context, "legal.project_link.view")
    ? moduleLink(
        row.project.id,
        `${row.project.code} — ${row.project.name}`,
        `/projects/${row.project.id}`,
        await isProjectReachable(context, row.project.id),
      )
    : null;

  if (!can(context, "legal.sales_source.view") || (!row.opportunity && !row.proposal)) {
    return { clientLink, projectLink, salesSource: null };
  }

  const canOpenOpportunity = can(context, "sales.opportunity.view");
  const canOpenProposal = can(context, "sales.proposal.view");

  return {
    clientLink,
    projectLink,
    salesSource: {
      opportunity: row.opportunity
        ? moduleLink(
            row.opportunity.id,
            row.opportunity.name,
            `/sales/opportunities/${row.opportunity.id}`,
            canOpenOpportunity,
          )
        : null,
      proposal: row.proposal
        ? moduleLink(
            row.proposal.id,
            `${row.proposal.proposalNumber} — ${row.proposal.title}`,
            `/sales/proposals/${row.proposal.id}`,
            canOpenProposal,
          )
        : null,
    },
  };
}

async function isProjectReachable(context: UserContext, projectId: string): Promise<boolean> {
  if (!can(context, "project.view")) return false;
  const found = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: { id: true },
  });
  return Boolean(found);
}

/* -------------------------------------------------------------------------- */
/* DTOs                                                                        */
/* -------------------------------------------------------------------------- */

export function toSummaryDTO(
  context: UserContext,
  row: repository.ContractRow,
  today: Date,
  overdue: Map<string, number>,
): ContractSummaryDTO {
  return {
    id: row.id,
    contractNumber: row.contractNumber,
    title: row.title,
    contractType: row.contractType,
    status: row.status,
    client: can(context, "legal.client_link.view") ? row.client : null,
    project: can(context, "legal.project_link.view") ? row.project : null,
    counterpartyName: row.counterpartyName,
    owner: toMemberRef(row.owner)!,
    commercial: commercialDTO(context, row),
    effectiveDate: dateString(row.effectiveDate),
    expiryDate: dateString(row.expiryDate),
    renewalType: row.renewalType,
    attention: attentionFor(row, today, overdue.get(row.id) ?? 0),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function attentionFor(
  row: repository.ContractRow,
  today: Date,
  overdueObligations: number,
): ContractAttentionDTO {
  return {
    effectiveStatus: getEffectiveContractStatus(row, today),
    expiringSoon: isExpiringSoon(row, today),
    daysToExpiry: row.expiryDate ? daysBetween(today, row.expiryDate) : null,
    renewalNoticeDue: isRenewalNoticeDue(row, today),
    readyToActivate:
      row.status === "SIGNED" && row.effectiveDate !== null && daysBetween(today, row.effectiveDate) <= 0,
    unsigned: row.status === "APPROVED" || row.status === "SENT",
    overdueObligations,
    ownerInactive: row.owner.status !== "ACTIVE",
  };
}

function capabilitiesFor(
  context: UserContext,
  row: repository.ContractDetailRow,
  pending?: { submittedBy: { memberId: string } | null },
): ContractCapabilities {
  const archived = row.archivedAt !== null;
  const mode = contractEditMode(row.status);
  const live = !archived;

  /*
   * Nobody decides on what they submitted (PRD #18 §116).
   *
   * The service refuses it either way. This is so the button is not drawn in
   * the first place: offering somebody an action that is certain to fail is a
   * worse answer than not offering it (PRD #18 §353). The approval queue has
   * always worked this way; the record page now agrees with it.
   *
   * Undefined `pending` means the caller did not load the approval cycle — a
   * list row, say — and the optimistic answer is the right one there, because
   * the list does not draw decision buttons.
   */
  const selfSubmitted = pending?.submittedBy?.memberId === context.membershipId;

  const allow = (permission: Parameters<typeof can>[1], condition: boolean) =>
    live && condition && can(context, permission);

  return {
    canEdit: allow("legal.contract.update", mode !== "NONE"),
    canEditTerms: allow("legal.contract.update", mode === "FULL"),
    canAssignOwner: allow("legal.contract.owner.assign", true),
    canSubmitReview: allow("legal.contract.submit_review", row.status === "DRAFT"),
    canReturnToDraft: allow("legal.contract.review", row.status === "IN_REVIEW"),
    canSubmitApproval: allow("legal.contract.submit_approval", row.status === "IN_REVIEW"),
    canApprove:
      live &&
      row.status === "PENDING_APPROVAL" &&
      !selfSubmitted &&
      approvals.canApproveType(context, "CONTRACT"),
    canReject:
      live &&
      row.status === "PENDING_APPROVAL" &&
      !selfSubmitted &&
      approvals.canRejectType(context, "CONTRACT"),
    canMarkSent: allow("legal.contract.mark_sent", row.status === "APPROVED"),
    canMarkSigned: allow("legal.contract.mark_signed", row.status === "SENT"),
    canActivate: allow("legal.contract.activate", row.status === "SIGNED"),
    canExpire: allow("legal.contract.expire", row.status === "ACTIVE" && row.expiryDate !== null),
    canTerminate: allow(
      "legal.contract.terminate",
      row.status === "ACTIVE" || row.status === "SIGNED",
    ),
    canCancel: allow("legal.contract.cancel", isContractCancellable(row.status)),
    canArchive: allow("legal.contract.archive", isContractArchivable(row.status)),
    canRestore: archived && can(context, "legal.contract.restore"),
    canManageParties: allow("legal.party.manage", arePartiesEditable(row.status)),
    canRemoveParties: allow("legal.party.manage", isPartyRemovable(row.status)),
    canCreateObligation: allow("legal.obligation.create", acceptsObligations(row.status)),
    canCreateAmendment: allow("legal.amendment.create", acceptsAmendments(row.status)),
    canViewParties: can(context, "legal.party.view"),
    canViewObligations: can(context, "legal.obligation.view"),
    canViewAmendments: can(context, "legal.amendment.view"),
    canViewDocuments: can(context, "legal.document.view") && can(context, "document.view"),
    canViewTasks: can(context, "legal.task.view") && can(context, "task.view"),
    canViewActivity: can(context, "legal.activity.view"),
    canUploadDocuments:
      live && can(context, "legal.document.create") && can(context, "document.create"),
  };
}
