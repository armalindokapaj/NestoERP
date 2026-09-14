import { Prisma, type ContractAmendmentStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { canSeeCommercial, dateString } from "../contract.dto";
import { buildContractScopeWhere } from "../contract.scope";
import type { ContractAmendmentDTO } from "../contract.types";
import { acceptsAmendments, daysBetween } from "../contracts/contract.status";
import type { AmendmentInput, AmendmentSignedInput } from "./amendment.schema";
import {
  canTransitionAmendmentStatus,
  isAmendmentArchivable,
  isAmendmentCancellable,
  isAmendmentEditable,
  isAmendmentInFlight,
  isAmendmentSubmittable,
  IN_FLIGHT_AMENDMENT_STATUSES,
} from "./amendment.status";

/**
 * Contract amendments (PRD #18 §159–§180).
 *
 * An amendment is how an approved agreement changes. It runs its own approval
 * and signing cycle, and then — exactly once — applies its result to the
 * contract (PRD #18 §174).
 *
 * Three rules live here:
 *
 *   1. **One in flight at a time.** Two amendments changing the same value
 *      concurrently is not a race the product can settle afterwards
 *      (PRD #18 §178, §238).
 *   2. **Activation locks the contract first**, then reads the value it is
 *      about to replace. Reading before locking is the same as not checking
 *      (PRD #18 §318).
 *   3. **Activation is idempotent by construction**: the status move is
 *      conditional on SIGNED, so a second attempt changes nothing and says so
 *      (PRD #18 §511).
 */

const MODULE = "contracts" as const;
const ENTITY = "Contract";

const AMENDMENT_SELECT = {
  id: true,
  contractId: true,
  amendmentNumber: true,
  title: true,
  summary: true,
  status: true,
  effectiveDate: true,
  signedDate: true,
  valueDelta: true,
  newContractValue: true,
  newExpiryDate: true,
  previousContractValue: true,
  previousExpiryDate: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
  contract: {
    select: { id: true, contractNumber: true, status: true, archivedAt: true, currency: true },
  },
} satisfies Prisma.ContractAmendmentSelect;

type AmendmentRow = Prisma.ContractAmendmentGetPayload<{ select: typeof AMENDMENT_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listForContract(
  context: UserContext,
  contractId: string,
): Promise<ContractAmendmentDTO[]> {
  if (!can(context, "legal.amendment.view")) return [];

  const rows = await prisma.contractAmendment.findMany({
    where: { contractId, contract: { is: buildContractScopeWhere(context) } },
    orderBy: [{ amendmentNumber: "asc" }],
    select: AMENDMENT_SELECT,
  });

  const history = await historyFor(context, rows);
  return rows.map((row) => toDTO(context, row, history));
}

/** The amendment worth showing on the contract header, if any (PRD #18 §103). */
export async function latestAmendment(
  context: UserContext,
  contractId: string,
): Promise<ContractAmendmentDTO | null> {
  if (!can(context, "legal.amendment.view")) return null;

  const row = await prisma.contractAmendment.findFirst({
    where: {
      contractId,
      contract: { is: buildContractScopeWhere(context) },
      status: { in: [...IN_FLIGHT_AMENDMENT_STATUSES, "ACTIVE"] },
    },
    orderBy: [{ activatedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    select: AMENDMENT_SELECT,
  });

  if (!row) return null;
  return toDTO(context, row, await historyFor(context, [row]));
}

export async function getAmendment(
  context: UserContext,
  amendmentId: string,
): Promise<ContractAmendmentDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.amendment.view");

  const row = assertFound(await findInScope(context, amendmentId));
  return toDTO(context, row, await historyFor(context, [row]));
}

/** Every amendment in scope, for the amendment report (PRD #18 §224). */
export async function listAllAmendments(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "legal.amendment.view");

  return prisma.contractAmendment.findMany({
    where: { contract: { is: buildContractScopeWhere(context) } },
    orderBy: [{ createdAt: "desc" }],
    select: AMENDMENT_SELECT,
  });
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createAmendment(
  context: UserContext,
  contractId: string,
  input: AmendmentInput,
): Promise<ContractAmendmentDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.amendment.create");

  const contract = await requireAmendableContract(context, contractId);
  assertReductionAcknowledged(contract, input);

  const amendmentId = await prisma.$transaction(async (tx) => {
    await assertNoAmendmentInFlight(tx, contractId, null);
    await assertNumberIsFree(tx, contractId, input.amendmentNumber, null);

    const amendment = await tx.contractAmendment.create({
      data: {
        companyId: context.companyId,
        contractId,
        amendmentNumber: input.amendmentNumber,
        title: input.title,
        summary: input.summary,
        status: "DRAFT",
        effectiveDate: input.effectiveDate ?? null,
        newContractValue: input.newContractValue
          ? new Prisma.Decimal(input.newContractValue)
          : null,
        // Derived by the server from the contract's current value, never taken
        // from the browser (PRD #18 §332).
        valueDelta: deltaFor(contract.contractValue, input.newContractValue),
        newExpiryDate: input.newExpiryDate ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_AMENDMENT_CREATED",
      message: `drafted amendment ${input.amendmentNumber} to contract ${contract.contractNumber}`,
      metadata: { amendmentId: amendment.id } as Prisma.InputJsonValue,
    });

    return amendment.id;
  });

  return getAmendment(context, amendmentId);
}

export async function updateAmendment(
  context: UserContext,
  amendmentId: string,
  input: AmendmentInput,
): Promise<ContractAmendmentDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.amendment.update");

  const existing = assertFound(await findInScope(context, amendmentId));
  if (!isAmendmentEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      existing.status === "ACTIVE"
        ? "An executed amendment is part of the contract's history. Write another one to change the terms again."
        : "Only a draft or rejected amendment can be edited.",
    );
  }

  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This amendment was updated by another user. Refresh before saving.",
    );
  }

  const contract = await loadContractFacts(context, existing.contractId);
  assertReductionAcknowledged(contract, input);

  await prisma.$transaction(async (tx) => {
    await assertNumberIsFree(tx, existing.contractId, input.amendmentNumber, amendmentId);

    await tx.contractAmendment.update({
      where: { id: amendmentId },
      data: {
        amendmentNumber: input.amendmentNumber,
        title: input.title,
        summary: input.summary,
        effectiveDate: input.effectiveDate ?? null,
        newContractValue: input.newContractValue
          ? new Prisma.Decimal(input.newContractValue)
          : null,
        valueDelta: deltaFor(contract.contractValue, input.newContractValue),
        newExpiryDate: input.newExpiryDate ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: "LEGAL_AMENDMENT_UPDATED",
      message: `updated amendment ${input.amendmentNumber} to contract ${existing.contract.contractNumber}`,
      metadata: { amendmentId } as Prisma.InputJsonValue,
    });
  });

  return getAmendment(context, amendmentId);
}

export async function submitAmendment(context: UserContext, amendmentId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.amendment.submit");

  const existing = assertFound(await findInScope(context, amendmentId));
  if (!isAmendmentSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", "This amendment is not ready to be submitted.");
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "PENDING_APPROVAL");
    await approvals.openApproval(tx, context, "AMENDMENT", amendmentId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: "LEGAL_AMENDMENT_SUBMITTED",
      message: `submitted amendment ${existing.amendmentNumber} for approval`,
      metadata: { amendmentId } as Prisma.InputJsonValue,
    });
  });
}

export async function approveAmendment(
  context: UserContext,
  amendmentId: string,
  note: string | null,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "AMENDMENT");

  const existing = assertFound(await findInScope(context, amendmentId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "AMENDMENT", amendmentId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "APPROVED");
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: "LEGAL_AMENDMENT_APPROVED",
      message: `approved amendment ${existing.amendmentNumber}`,
      metadata: { amendmentId } as Prisma.InputJsonValue,
    });
  });
}

export async function rejectAmendment(
  context: UserContext,
  amendmentId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "AMENDMENT");

  const existing = assertFound(await findInScope(context, amendmentId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "AMENDMENT", amendmentId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "REJECTED");
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: "LEGAL_AMENDMENT_REJECTED",
      message: `rejected amendment ${existing.amendmentNumber}`,
      metadata: { amendmentId, reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Returns an amendment for revision (PRD #41 §48, §281): back to draft with
 * the approver's reason; resubmitting it opens a new approval cycle and the
 * returned one stays in its history.
 */
export async function returnAmendment(
  context: UserContext,
  amendmentId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "AMENDMENT");

  const existing = assertFound(await findInScope(context, amendmentId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "AMENDMENT", amendmentId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "DRAFT");
    await approvals.decideApproval(tx, context, approval.id, "RETURNED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: "LEGAL_AMENDMENT_RETURNED",
      message: `returned amendment ${existing.amendmentNumber} for revision`,
      metadata: { amendmentId, reason } as Prisma.InputJsonValue,
    });
  });
}

export async function markAmendmentSent(context: UserContext, amendmentId: string): Promise<void> {
  await simpleTransition(context, amendmentId, {
    permission: "legal.amendment.mark_sent",
    next: "SENT",
    action: "LEGAL_AMENDMENT_MARKED_SENT",
    verb: "marked as sent",
  });
}

export async function markAmendmentSigned(
  context: UserContext,
  amendmentId: string,
  input: AmendmentSignedInput,
): Promise<void> {
  await simpleTransition(context, amendmentId, {
    permission: "legal.amendment.mark_signed",
    next: "SIGNED",
    extra: { signedDate: input.signedDate },
    action: "LEGAL_AMENDMENT_MARKED_SIGNED",
    verb: "recorded as signed",
  });
}

/**
 * Applies a signed amendment to its contract (PRD #18 §174, §318, §333).
 *
 * The contract row is locked before its current value is read, because the
 * amendment writes back a figure derived from it. Without the lock two
 * amendments activating at once would each compute a delta from the same
 * starting value and one of them would be wrong.
 *
 * What the contract held before is copied onto the amendment, so activation is
 * evidence rather than an overwrite (PRD #18 §175, §330).
 */
export async function activateAmendment(context: UserContext, amendmentId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.amendment.activate");

  const existing = assertFound(await findInScope(context, amendmentId));

  if (existing.effectiveDate && daysBetween(new Date(), existing.effectiveDate) > 0) {
    throw new AccessError(
      "CONFLICT",
      `This amendment takes effect on ${dateString(existing.effectiveDate)}. It can be activated from that date.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await lockContract(tx, existing.contractId);

    const contract = assertFound(
      await tx.contract.findUnique({
        where: { id: existing.contractId },
        select: { id: true, contractNumber: true, contractValue: true, expiryDate: true },
      }),
    );

    await moveStatus(tx, context, existing, "ACTIVE", {
      activatedAt: new Date(),
      previousContractValue: contract.contractValue,
      previousExpiryDate: contract.expiryDate,
      valueDelta: deltaFor(
        contract.contractValue,
        existing.newContractValue ? existing.newContractValue.toString() : undefined,
      ),
    });

    const data: Prisma.ContractUpdateInput = { updatedByMemberId: context.membershipId };
    if (existing.newContractValue !== null) data.contractValue = existing.newContractValue;
    if (existing.newExpiryDate !== null) data.expiryDate = existing.newExpiryDate;

    await tx.contract.update({ where: { id: existing.contractId }, data });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: "LEGAL_AMENDMENT_ACTIVATED",
      message: `applied amendment ${existing.amendmentNumber} to contract ${contract.contractNumber}`,
      metadata: changeMetadata({
        contractValue: {
          from: contract.contractValue === null ? null : toAmountString(contract.contractValue),
          to:
            existing.newContractValue === null
              ? null
              : toAmountString(existing.newContractValue),
        },
        expiryDate: {
          from: dateString(contract.expiryDate),
          to: dateString(existing.newExpiryDate),
        },
      }),
    });
  });
}

export async function cancelAmendment(
  context: UserContext,
  amendmentId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.amendment.cancel");

  const existing = assertFound(await findInScope(context, amendmentId));
  if (!isAmendmentCancellable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An executed amendment cannot be cancelled. Write another one to change the terms again.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "CANCELLED");
    await approvals.cancelPendingApprovals(tx, context, "AMENDMENT", amendmentId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: "LEGAL_AMENDMENT_CANCELLED",
      message: `cancelled amendment ${existing.amendmentNumber}`,
      metadata: { amendmentId, ...(note ? { note } : {}) } as Prisma.InputJsonValue,
    });
  });
}

export async function archiveAmendment(context: UserContext, amendmentId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.amendment.archive");

  const existing = assertFound(await findInScope(context, amendmentId));
  if (!isAmendmentArchivable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An executed amendment stays visible. It is part of the contract's history.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "ARCHIVED", {
      archivedAt: new Date(),
      archivedByMemberId: context.membershipId,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: "LEGAL_AMENDMENT_ARCHIVED",
      message: `archived amendment ${existing.amendmentNumber}`,
      metadata: { amendmentId } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function simpleTransition(
  context: UserContext,
  amendmentId: string,
  spec: {
    permission: Parameters<typeof assertPermission>[1];
    next: ContractAmendmentStatus;
    extra?: Prisma.ContractAmendmentUpdateInput;
    action: string;
    verb: string;
  },
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, spec.permission);

  const existing = assertFound(await findInScope(context, amendmentId));

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, spec.next, spec.extra);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: spec.action,
      message: `${spec.verb} amendment ${existing.amendmentNumber}`,
      metadata: { amendmentId } as Prisma.InputJsonValue,
    });
  });
}

async function moveStatus(
  tx: Prisma.TransactionClient,
  context: UserContext,
  existing: AmendmentRow,
  next: ContractAmendmentStatus,
  extra: Prisma.ContractAmendmentUpdateInput = {},
): Promise<void> {
  if (existing.contract.archivedAt) {
    throw new AccessError("CONFLICT", "This contract is archived and read-only.");
  }

  if (!canTransitionAmendmentStatus(existing.status, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `An amendment cannot move from ${existing.status} to ${next}.`,
    );
  }

  const result = await tx.contractAmendment.updateMany({
    where: { id: existing.id, status: existing.status },
    data: {
      status: next,
      updatedByMemberId: context.membershipId,
      ...(extra as Prisma.ContractAmendmentUpdateManyMutationInput),
    },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This amendment changed while you were working on it.");
  }
}

/**
 * Serialises the transactions that change one contract's value (PRD #18 §318).
 *
 * A row lock rather than a constraint: "the delta must be computed from the
 * value this transaction is about to replace" is a sequencing rule, and no
 * index expresses it.
 */
async function lockContract(tx: Prisma.TransactionClient, contractId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${contractId} FOR UPDATE`;
}

function findInScope(context: UserContext, amendmentId: string) {
  return prisma.contractAmendment.findFirst({
    where: { id: amendmentId, contract: { is: buildContractScopeWhere(context) } },
    select: AMENDMENT_SELECT,
  });
}

async function loadContractFacts(context: UserContext, contractId: string) {
  return assertFound(
    await prisma.contract.findFirst({
      where: { AND: [buildContractScopeWhere(context), { id: contractId }] },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        archivedAt: true,
        contractValue: true,
        expiryDate: true,
      },
    }),
  );
}

async function requireAmendableContract(context: UserContext, contractId: string) {
  const contract = await loadContractFacts(context, contractId);

  if (contract.archivedAt || !acceptsAmendments(contract.status)) {
    throw new AccessError(
      "CONFLICT",
      "An amendment changes an agreement that has been approved. Edit the contract itself while it is still a draft.",
    );
  }

  return contract;
}

/**
 * One material amendment at a time (PRD #18 §178, §238, §435).
 *
 * Checked inside the transaction that creates the next one, so two people
 * drafting simultaneously produce one amendment and one explanation.
 */
async function assertNoAmendmentInFlight(
  tx: Prisma.TransactionClient,
  contractId: string,
  exceptId: string | null,
): Promise<void> {
  const inFlight = await tx.contractAmendment.findFirst({
    where: {
      contractId,
      status: { in: IN_FLIGHT_AMENDMENT_STATUSES },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { amendmentNumber: true },
  });

  if (inFlight) {
    throw new AccessError(
      "CONFLICT",
      `Amendment ${inFlight.amendmentNumber} is still in progress on this contract. Finish or cancel it first.`,
      { code: "AMENDMENT_CONFLICT" },
    );
  }
}

async function assertNumberIsFree(
  tx: Prisma.TransactionClient,
  contractId: string,
  amendmentNumber: string,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.contractAmendment.findFirst({
    where: {
      contractId,
      amendmentNumber,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError(
      "CONFLICT",
      `Amendment ${amendmentNumber} already exists on this contract.`,
      { code: "AMENDMENT_NUMBER_EXISTS" },
    );
  }
}

/**
 * Cutting a value or shortening a term is legitimate and unusual (PRD #18 §168).
 *
 * The confirmation is how the person writing it says they meant to — a typo in
 * a new expiry date would otherwise quietly end an agreement early.
 */
function assertReductionAcknowledged(
  contract: { contractValue: Prisma.Decimal | null; expiryDate: Date | null },
  input: AmendmentInput,
): void {
  if (input.acknowledgeReduction) return;

  if (
    input.newContractValue !== undefined &&
    contract.contractValue !== null &&
    new Prisma.Decimal(input.newContractValue).lessThan(contract.contractValue)
  ) {
    throw new AccessError(
      "CONFLICT",
      "This amendment reduces the contract value. Confirm that the reduction is intended.",
      { code: "AMENDMENT_REDUCES_TERMS" },
    );
  }

  if (
    input.newExpiryDate &&
    contract.expiryDate &&
    input.newExpiryDate.getTime() < contract.expiryDate.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This amendment shortens the contract term. Confirm that the reduction is intended.",
      { code: "AMENDMENT_REDUCES_TERMS" },
    );
  }
}

/** `new − old`, computed by the server or not at all (PRD #18 §167, §332). */
function deltaFor(
  current: Prisma.Decimal | null,
  next: string | undefined,
): Prisma.Decimal | null {
  if (next === undefined) return null;
  return new Prisma.Decimal(next).minus(current ?? 0);
}

async function historyFor(context: UserContext, rows: AmendmentRow[]) {
  const entries = await Promise.all(
    rows.map(async (row) => [row.id, await approvals.approvalHistory(context, "AMENDMENT", row.id)] as const),
  );
  return new Map(entries);
}

function toDTO(
  context: UserContext,
  row: AmendmentRow,
  history: Map<string, Awaited<ReturnType<typeof approvals.approvalHistory>>>,
): ContractAmendmentDTO {
  const live = row.contract.archivedAt === null;

  return {
    id: row.id,
    contractId: row.contractId,
    amendmentNumber: row.amendmentNumber,
    title: row.title,
    summary: row.summary,
    status: row.status,
    effectiveDate: dateString(row.effectiveDate),
    signedDate: dateString(row.signedDate),
    commercial: canSeeCommercial(context)
      ? {
          valueDelta: row.valueDelta === null ? null : toAmountString(row.valueDelta),
          newContractValue:
            row.newContractValue === null ? null : toAmountString(row.newContractValue),
          previousContractValue:
            row.previousContractValue === null
              ? null
              : toAmountString(row.previousContractValue),
        }
      : null,
    newExpiryDate: dateString(row.newExpiryDate),
    previousExpiryDate: dateString(row.previousExpiryDate),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    approvals: history.get(row.id) ?? [],
    capabilities: {
      canEdit: live && isAmendmentEditable(row.status) && can(context, "legal.amendment.update"),
      canSubmit:
        live && isAmendmentSubmittable(row.status) && can(context, "legal.amendment.submit"),
      canApprove:
        live && row.status === "PENDING_APPROVAL" && approvals.canApproveType(context, "AMENDMENT"),
      canReject:
        live && row.status === "PENDING_APPROVAL" && approvals.canRejectType(context, "AMENDMENT"),
      canMarkSent:
        live && row.status === "APPROVED" && can(context, "legal.amendment.mark_sent"),
      canMarkSigned: live && row.status === "SENT" && can(context, "legal.amendment.mark_signed"),
      canActivate: live && row.status === "SIGNED" && can(context, "legal.amendment.activate"),
      canCancel:
        live && isAmendmentCancellable(row.status) && can(context, "legal.amendment.cancel"),
      canArchive:
        live && isAmendmentArchivable(row.status) && can(context, "legal.amendment.archive"),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { isAmendmentInFlight };
