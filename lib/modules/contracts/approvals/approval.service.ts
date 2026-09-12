import { Prisma, type ContractApprovalRecordType } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { commercialDTO, toMemberRef } from "../contract.dto";
import { buildContractScopeWhere } from "../contract.scope";
import type { ContractApprovalDTO, MemberRef } from "../contract.types";

/**
 * Contract and amendment approvals (PRD #18 §181–§190).
 *
 * One approval row per submission, never reopened: a rejected contract that is
 * revised and resubmitted gets a *new* row, so the record's history reads as
 * the sequence of decisions it actually was (PRD #18 §115, §423).
 *
 * Two rules live here and nowhere else:
 *
 *   1. Approval authority is a permission, not a consequence of being able to
 *      write the contract (PRD #18 §27).
 *   2. The submitter cannot decide their own submission unless they hold
 *      `legal.approval.self` — because "who approved this contract?" must have
 *      an answer other than "the person who drafted it" (PRD #18 §116).
 */

const MODULE = "contracts" as const;

const APPROVE_PERMISSION: Record<ContractApprovalRecordType, Permission> = {
  CONTRACT: "legal.contract.approve",
  AMENDMENT: "legal.amendment.approve",
};

const REJECT_PERMISSION: Record<ContractApprovalRecordType, Permission> = {
  CONTRACT: "legal.contract.reject",
  AMENDMENT: "legal.amendment.reject",
};

export function canApproveType(context: UserContext, type: ContractApprovalRecordType): boolean {
  return can(context, "legal.approval.decide") && can(context, APPROVE_PERMISSION[type]);
}

export function canRejectType(context: UserContext, type: ContractApprovalRecordType): boolean {
  return can(context, "legal.approval.decide") && can(context, REJECT_PERMISSION[type]);
}

export function assertCanApprove(context: UserContext, type: ContractApprovalRecordType): void {
  assertPermission(context, "legal.approval.decide");
  assertPermission(context, APPROVE_PERMISSION[type]);
}

export function assertCanReject(context: UserContext, type: ContractApprovalRecordType): void {
  assertPermission(context, "legal.approval.decide");
  assertPermission(context, REJECT_PERMISSION[type]);
}

/**
 * Separation of duties (PRD #18 §116).
 *
 * Checked against the *submission*, not the record's author: the person who put
 * the agreement forward is the one who must not wave it through.
 */
export function assertNotSelfApproval(context: UserContext, submittedByMemberId: string): void {
  if (submittedByMemberId !== context.membershipId) return;
  if (can(context, "legal.approval.self")) return;

  throw new AccessError(
    "FORBIDDEN",
    "You submitted this for approval, so somebody else has to decide it.",
  );
}

/* -------------------------------------------------------------------------- */
/* Writes, used inside the calling service's transaction                       */
/* -------------------------------------------------------------------------- */

/**
 * Opens an approval cycle.
 *
 * Any cycle still pending on this record is cancelled first, so a record can
 * never carry two live approvals — which is what a double-clicked submit button
 * would otherwise produce (PRD #18 §237, §508). The partial unique index in the
 * migration is the database's half of the same rule.
 */
export async function openApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  type: ContractApprovalRecordType,
  recordId: string,
): Promise<string> {
  await tx.contractApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context.membershipId },
  });

  const approval = await tx.contractApproval.create({
    data: {
      companyId: context.companyId,
      recordType: type,
      recordId,
      status: "PENDING",
      submittedByMemberId: context.membershipId,
      submittedAt: new Date(),
    },
    select: { id: true },
  });

  return approval.id;
}

export async function requirePendingApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  type: ContractApprovalRecordType,
  recordId: string,
) {
  const approval = await tx.contractApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    orderBy: { submittedAt: "desc" },
    select: { id: true, submittedByMemberId: true },
  });

  if (!approval) {
    throw new AccessError("CONFLICT", "This record is not waiting for a decision.");
  }

  return approval;
}

/**
 * Closes an approval cycle.
 *
 * Conditional on the row still being PENDING and checked by row count, so two
 * approvers pressing at the same moment cannot both succeed (PRD #18 §317).
 */
export async function decideApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<void> {
  const result = await tx.contractApproval.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: {
      status: decision,
      decidedByMemberId: context.membershipId,
      decidedAt: new Date(),
      decisionNote: note,
    },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This record has already been decided.");
  }
}

export async function cancelPendingApprovals(
  tx: Prisma.TransactionClient,
  context: UserContext,
  type: ContractApprovalRecordType,
  recordId: string,
): Promise<void> {
  await tx.contractApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context.membershipId },
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const APPROVAL_SELECT = {
  id: true,
  recordType: true,
  recordId: true,
  status: true,
  submittedByMemberId: true,
  submittedAt: true,
  decidedByMemberId: true,
  decidedAt: true,
  decisionNote: true,
} satisfies Prisma.ContractApprovalSelect;

type ApprovalRow = Prisma.ContractApprovalGetPayload<{ select: typeof APPROVAL_SELECT }>;

/**
 * The approval queue (PRD #18 §185–§188).
 *
 * Scope is applied by resolving the contracts the caller can reach and listing
 * only the approvals whose underlying record survived, so the queue cannot
 * become a back door onto agreements they may not open (PRD #18 §445).
 */
export async function listApprovals(
  context: UserContext,
  options: { status?: "PENDING" | "DECIDED"; page?: number; limit?: number } = {},
) {
  assertModule(context, MODULE);
  assertPermission(context, "legal.approval.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const reachable = await reachableRecordIds(context);
  const recordIds = [...reachable.contracts.keys(), ...reachable.amendments.keys()];

  const where: Prisma.ContractApprovalWhereInput = {
    companyId: context.companyId,
    ...(options.status === "PENDING" ? { status: "PENDING" } : {}),
    ...(options.status === "DECIDED" ? { status: { not: "PENDING" } } : {}),
    recordId: { in: recordIds },
  };

  const [rows, total] = await Promise.all([
    prisma.contractApproval.findMany({
      where,
      orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
      skip: skipFor(page, limit),
      take: limit,
      select: APPROVAL_SELECT,
    }),
    prisma.contractApproval.count({ where }),
  ]);

  const data = await hydrate(context, rows, reachable);
  return { data, pagination: paginationMeta(total, page, limit) };
}

/** How many decisions are waiting, for the overview (PRD #18 §32, §339). */
export async function pendingApprovalCount(context: UserContext): Promise<number> {
  if (!can(context, "legal.approval.view")) return 0;

  const reachable = await reachableRecordIds(context);
  const recordIds = [...reachable.contracts.keys(), ...reachable.amendments.keys()];
  if (recordIds.length === 0) return 0;

  return prisma.contractApproval.count({
    where: { companyId: context.companyId, status: "PENDING", recordId: { in: recordIds } },
  });
}

/** Every approval cycle for one record, newest first (PRD #18 §115). */
export async function approvalHistory(
  context: UserContext,
  type: ContractApprovalRecordType,
  recordId: string,
): Promise<ContractApprovalDTO[]> {
  if (!can(context, "legal.contract.view")) return [];

  const rows = await prisma.contractApproval.findMany({
    where: { companyId: context.companyId, recordType: type, recordId },
    orderBy: { submittedAt: "desc" },
    select: APPROVAL_SELECT,
  });

  if (rows.length === 0) return [];
  return hydrate(context, rows, await reachableRecordIds(context));
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

type RecordRef = {
  contractId: string;
  contractNumber: string;
  reference: string;
  title: string;
  currency: string | null;
  contractValue: Prisma.Decimal | null;
  client: { id: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
};

type Reachable = {
  contracts: Map<string, RecordRef>;
  amendments: Map<string, RecordRef>;
};

/**
 * The records the queue may mention, resolved once (PRD #18 §304).
 *
 * Both maps are built from the same scoped contract query, so an amendment is
 * exactly as reachable as the contract it amends — never more.
 */
async function reachableRecordIds(context: UserContext): Promise<Reachable> {
  const rows = await prisma.contract.findMany({
    where: buildContractScopeWhere(context),
    select: {
      id: true,
      contractNumber: true,
      title: true,
      currency: true,
      contractValue: true,
      client: { select: { id: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
      amendments: { select: { id: true, amendmentNumber: true, title: true } },
    },
  });

  const contracts = new Map<string, RecordRef>();
  const amendments = new Map<string, RecordRef>();

  for (const row of rows) {
    const base = {
      contractId: row.id,
      contractNumber: row.contractNumber,
      currency: row.currency,
      contractValue: row.contractValue,
      client: row.client,
      project: row.project,
    };

    contracts.set(row.id, { ...base, reference: row.contractNumber, title: row.title });

    for (const amendment of row.amendments) {
      amendments.set(amendment.id, {
        ...base,
        reference: amendment.amendmentNumber,
        title: amendment.title,
      });
    }
  }

  return { contracts, amendments };
}

async function hydrate(
  context: UserContext,
  rows: ApprovalRow[],
  reachable: Reachable,
): Promise<ContractApprovalDTO[]> {
  if (rows.length === 0) return [];

  const memberIds = new Set<string>();
  for (const row of rows) {
    memberIds.add(row.submittedByMemberId);
    if (row.decidedByMemberId) memberIds.add(row.decidedByMemberId);
  }

  const members = await prisma.companyMember.findMany({
    where: { id: { in: [...memberIds] } },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });

  const byMember = new Map<string, MemberRef>(
    members.map((member) => [member.id, toMemberRef(member)!]),
  );

  return rows.flatMap((row) => {
    const record =
      row.recordType === "CONTRACT"
        ? reachable.contracts.get(row.recordId)
        : reachable.amendments.get(row.recordId);

    // Out of scope: the approval simply is not there, rather than appearing
    // with a blanked-out reference (PRD #18 §288).
    if (!record) return [];

    const pending = row.status === "PENDING";
    const mine = row.submittedByMemberId === context.membershipId;
    const selfBlocked = mine && !can(context, "legal.approval.self");

    return [
      {
        id: row.id,
        recordType: row.recordType,
        recordId: row.recordId,
        contractId: record.contractId,
        recordReference: record.reference,
        recordTitle: record.title,
        contractNumber: record.contractNumber,
        client: record.client,
        project: record.project,
        commercial: commercialDTO(context, record),
        status: row.status,
        submittedBy: byMember.get(row.submittedByMemberId) ?? null,
        submittedAt: row.submittedAt.toISOString(),
        decidedBy: row.decidedByMemberId ? (byMember.get(row.decidedByMemberId) ?? null) : null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decisionNote: row.decisionNote,
        capabilities: {
          canApprove: pending && !selfBlocked && canApproveType(context, row.recordType),
          canReject: pending && !selfBlocked && canRejectType(context, row.recordType),
        },
      },
    ];
  });
}
