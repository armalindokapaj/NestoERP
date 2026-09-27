import { Prisma, type CommitmentStatus } from "@prisma/client";
import { targetsOf, transitionFor } from "@/lib/core/state/machine";
import { applyTransition, type TransitionOutcome } from "@/lib/core/state/transition";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { businessDateString } from "../finance.fields";
import { toAmountString } from "../finance.money";
import {
  buildCommitmentScopeWhere,
  buildFinanceProjectWhere,
  hasCompanyFinanceScope,
} from "../finance.scope";
import type {
  CommitmentDetailDTO,
  CommitmentSummaryDTO,
  RecordCapabilities,
} from "../finance.types";
import type {
  CommitmentListQuery,
  CreateCommitmentInput,
  UpdateCommitmentInput,
} from "./commitment.schema";
import { commitmentMachine, type CommitmentTransitionAction } from "./commitment.machine";
import {
  CANCELLABLE_COMMITMENT_STATUSES,
  isCommitmentArchivable,
  isCommitmentEditable,
  isCommitmentSubmittable,
  isSourced,
} from "./commitment.status";

/**
 * Commitments (PRD #15 §124–§136).
 *
 * A commitment is money the company has undertaken to spend but has not yet
 * incurred. Only an APPROVED one counts toward forecast; closing it is how it
 * stops counting once the work has been done and billed as an expense
 * (PRD #15 §119, §134).
 *
 * A commitment another module created — a purchase order, later — carries its
 * source and is not edited here. Finance would otherwise hold one number while
 * Procurement held another, for the same obligation (PRD #15 §128).
 */

const MODULE = "finance" as const;
const ENTITY = "Commitment";

const SUMMARY_SELECT = {
  id: true,
  reference: true,
  description: true,
  counterpartyName: true,
  category: true,
  currency: true,
  amount: true,
  expectedDate: true,
  status: true,
  sourceModule: true,
  sourceEntityType: true,
  sourceEntityId: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CommitmentSelect;

type CommitmentRow = Prisma.CommitmentGetPayload<{ select: typeof SUMMARY_SELECT }>;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  preArchiveStatus: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
  createdByMemberId: true,
} satisfies Prisma.CommitmentSelect;

type CommitmentDetailRow = Prisma.CommitmentGetPayload<{ select: typeof DETAIL_SELECT }>;

const ORDER: Record<string, Prisma.CommitmentOrderByWithRelationInput[]> = {
  "expected-asc": [{ expectedDate: { sort: "asc", nulls: "last" } }],
  "expected-desc": [{ expectedDate: { sort: "desc", nulls: "last" } }],
  "amount-desc": [{ amount: "desc" }],
  "amount-asc": [{ amount: "asc" }],
  "updated-desc": [{ updatedAt: "desc" }],
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listCommitments(context: UserContext, query: CommitmentListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "finance.commitment.view");

  const filters: Prisma.CommitmentWhereInput[] = [buildCommitmentScopeWhere(context)];

  filters.push(
    query.archived
      ? { status: "ARCHIVED" }
      : { archivedAt: null, status: { not: "ARCHIVED" } },
  );

  const search = searchClause(query.search, [
    "description",
    "reference",
    "counterpartyName",
    "notes",
  ]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.CommitmentWhereInput),
        { project: { name: { contains: term, mode: "insensitive" } } },
        { project: { code: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  if (query.status?.length && !query.archived) filters.push({ status: { in: query.status } });
  if (query.category?.length) filters.push({ category: { in: query.category } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.currency) filters.push({ currency: query.currency });
  // "Open" means what forecast counts: approved and not yet closed
  // (PRD #15 §119).
  if (query.openOnly) filters.push({ status: "APPROVED" });

  const where: Prisma.CommitmentWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.commitment.findMany({
      where,
      orderBy: ORDER[query.sort] ?? ORDER["expected-asc"],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SUMMARY_SELECT,
    }),
    prisma.commitment.count({ where }),
  ]);

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getCommitment(
  context: UserContext,
  commitmentId: string,
): Promise<CommitmentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.commitment.view");

  const commitment = await requireCommitment(context, commitmentId);

  const [history, creator] = await Promise.all([
    approvals.approvalHistory(context, "COMMITMENT", commitment.id),
    memberRef(commitment.createdByMemberId),
  ]);

  return {
    ...toSummaryDTO(commitment),
    notes: commitment.notes,
    archivedAt: commitment.archivedAt?.toISOString() ?? null,
    approvals: history,
    createdBy: creator,
    createdAt: commitment.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, commitment),
  };
}

export async function commitmentFilterOptions(context: UserContext) {
  const scope = buildCommitmentScopeWhere(context);

  const [projects, currencies] = await Promise.all([
    prisma.project.findMany({
      where: { companyId: context.companyId, commitments: { some: scope } },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.commitment.findMany({
      where: scope,
      select: { currency: true },
      distinct: ["currency"],
      orderBy: { currency: "asc" },
    }),
  ]);

  return { projects, currencies: currencies.map((row) => row.currency) };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createCommitment(
  context: UserContext,
  input: CreateCommitmentInput,
): Promise<CommitmentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.commitment.create");

  const project = await validateProject(context, input.projectId, input.currency);

  const commitmentId = await prisma.$transaction(async (tx) => {
    const commitment = await tx.commitment.create({
      data: {
        companyId: context.companyId,
        projectId: project?.id ?? null,
        reference: input.reference ?? null,
        description: input.description,
        counterpartyName: input.counterpartyName ?? null,
        category: input.category,
        currency: input.currency,
        amount: input.amount,
        expectedDate: input.expectedDate ?? null,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitment.id,
      action: "FINANCE_COMMITMENT_CREATED",
      message: `created commitment ${input.reference ?? input.description}`,
      metadata: {
        currency: input.currency,
        amount: input.amount,
        category: input.category,
      } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.FINANCE_COMMITMENT_CREATED,
        entity: {
          type: ENTITY,
          id: commitment.id,
          label: input.reference ?? input.description,
        },
        after: {
          amount: String(input.amount),
          currency: input.currency,
          status: "DRAFT",
        },
      },
      { tx },
    );

    return commitment.id;
  });

  return getCommitment(context, commitmentId);
}

export async function updateCommitment(
  context: UserContext,
  commitmentId: string,
  input: UpdateCommitmentInput,
): Promise<CommitmentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.commitment.update");

  const existing = await requireCommitment(context, commitmentId);

  if (isSourced(existing)) {
    throw new AccessError(
      "CONFLICT",
      `This commitment is owned by ${existing.sourceModule}. Change it there so both modules stay in step.`,
    );
  }

  if (!isCommitmentEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An approved commitment is fixed. Close it and raise a new one if the obligation changed.",
    );
  }

  if (
    input.versionUpdatedAt &&
    existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This commitment was updated by another user. Refresh and review the latest changes.",
    );
  }

  const project = await validateProject(context, input.projectId, input.currency);

  await prisma.$transaction(async (tx) => {
    // Conditional on the status the edit was checked against, so a commitment
    // submitted or approved in the meantime is not rewritten (PRD #47 §66).
    const written = await tx.commitment.updateMany({
      where: { id: commitmentId, companyId: context.companyId, status: existing.status },
      data: {
        projectId: project?.id ?? null,
        reference: input.reference ?? null,
        description: input.description,
        counterpartyName: input.counterpartyName ?? null,
        category: input.category,
        currency: input.currency,
        amount: input.amount,
        expectedDate: input.expectedDate ?? null,
        notes: input.notes ?? null,
        updatedByMemberId: context.membershipId,
      },
    });
    if (written.count === 0) {
      throw stateDenied("This commitment changed while you were working on it. Refresh and review it.");
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitmentId,
      action: "FINANCE_COMMITMENT_UPDATED",
      message: `updated commitment ${input.reference ?? input.description}`,
    });
  });

  return getCommitment(context, commitmentId);
}

export async function submitCommitment(
  context: UserContext,
  commitmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.commitment.submit");

  const existing = await requireCommitment(context, commitmentId);

  if (!isCommitmentSubmittable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      `A ${existing.status.toLowerCase()} commitment cannot be submitted.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "submit");
    await approvals.openApproval(tx, context, "COMMITMENT", commitmentId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitmentId,
      action: "FINANCE_COMMITMENT_SUBMITTED",
      message: `submitted commitment ${label(existing)} for approval`,
    });
  });
}

export async function approveCommitment(
  context: UserContext,
  commitmentId: string,
  note: string | null,
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "COMMITMENT");

  const existing = await requireCommitment(context, commitmentId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "COMMITMENT", commitmentId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "approve");
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitmentId,
      action: "FINANCE_COMMITMENT_APPROVED",
      message: `approved commitment ${label(existing)}`,
    });
  });
}

export async function rejectCommitment(
  context: UserContext,
  commitmentId: string,
  reason: string,
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "COMMITMENT");

  const existing = await requireCommitment(context, commitmentId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "COMMITMENT", commitmentId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "reject", { reason });
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitmentId,
      action: "FINANCE_COMMITMENT_REJECTED",
      message: `rejected commitment ${label(existing)}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Returns the commitment for revision (PRD #41 §48): back to draft with the
 * approver's reason, so the requester can correct it and submit it again as a
 * new approval cycle. The decision history keeps the returned cycle.
 */
export async function returnCommitment(
  context: UserContext,
  commitmentId: string,
  reason: string,
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "COMMITMENT");

  const existing = await requireCommitment(context, commitmentId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "COMMITMENT", commitmentId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "return", { reason });
    await approvals.decideApproval(tx, context, approval.id, "RETURNED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitmentId,
      action: "FINANCE_COMMITMENT_RETURNED",
      message: `returned commitment ${label(existing)} for revision`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/** Closing stops the commitment contributing to forecast (PRD #15 §134). */
export async function closeCommitment(
  context: UserContext,
  commitmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.commitment.close");

  const existing = await requireCommitment(context, commitmentId);

  // Closing a closed commitment is the same request arriving twice, and
  // settles without writing it — or its activity — a second time.
  if (existing.status === "CLOSED") return;

  await prisma.$transaction(async (tx) => {
    const outcome = await moveStatus(tx, context, existing, "close", { idempotent: true });
    if (outcome === "ALREADY_THERE") return;

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitmentId,
      action: "FINANCE_COMMITMENT_CLOSED",
      message: `closed commitment ${label(existing)}`,
    });
  });
}

export async function cancelCommitment(
  context: UserContext,
  commitmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.commitment.cancel");

  const existing = await requireCommitment(context, commitmentId);

  if (!CANCELLABLE_COMMITMENT_STATUSES.includes(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      `A ${existing.status.toLowerCase()} commitment cannot be cancelled.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "cancel");
    await approvals.cancelPendingApprovals(tx, context, "COMMITMENT", commitmentId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitmentId,
      action: "FINANCE_COMMITMENT_CANCELLED",
      message: `cancelled commitment ${label(existing)}`,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.FINANCE_COMMITMENT_CANCELLED,
        entity: { type: ENTITY, id: commitmentId, label: label(existing) },
        before: { status: existing.status },
        after: { status: "CANCELLED" },
      },
      { tx },
    );
  });
}

export async function archiveCommitment(
  context: UserContext,
  commitmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.commitment.archive");

  const existing = await requireCommitment(context, commitmentId);

  if (!isCommitmentArchivable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An active approved commitment is live forecast and stays visible. Close or cancel it first.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: commitmentMachine,
      action: "archive",
      id: commitmentId,
      context,
      from: existing.status,
      data: {
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await approvals.cancelPendingApprovals(tx, context, "COMMITMENT", commitmentId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitmentId,
      action: "FINANCE_COMMITMENT_ARCHIVED",
      message: `archived commitment ${label(existing)}`,
    });
  });
}

export async function restoreCommitment(
  context: UserContext,
  commitmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.commitment.restore");

  const existing = await requireCommitment(context, commitmentId);

  if (existing.status !== "ARCHIVED") {
    throw new AccessError("CONFLICT", "This commitment is not archived.");
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: commitmentMachine,
      action: "restore",
      id: commitmentId,
      context,
      from: existing.status,
      to: existing.preArchiveStatus ?? "DRAFT",
      data: { preArchiveStatus: null, archivedAt: null, archivedByMemberId: null },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: commitmentId,
      action: "FINANCE_COMMITMENT_RESTORED",
      message: `restored commitment ${label(existing)}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireCommitment(context: UserContext, commitmentId: string) {
  return assertFound(
    await prisma.commitment.findFirst({
      where: { AND: [buildCommitmentScopeWhere(context), { id: commitmentId }] },
      select: DETAIL_SELECT,
    }),
  );
}

/**
 * Moves a commitment by one of its machine's actions, from the status it was read in.
 *
 * A move the workflow never makes is refused as the validation error it has
 * always been, before anything is written. The write goes through
 * `applyTransition`, conditional on the status we read, so two people acting at
 * once cannot both win (PRD #49 §64).
 */
async function moveStatus(
  tx: Prisma.TransactionClient,
  context: UserContext,
  existing: { id: string; status: CommitmentStatus },
  action: CommitmentTransitionAction,
  options: { reason?: string; idempotent?: boolean } = {},
): Promise<TransitionOutcome> {
  const transition = transitionFor(commitmentMachine, action)!;
  if (!transition.from.includes(existing.status)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A commitment cannot move from ${existing.status} to ${targetsOf(transition)[0]}.`,
    );
  }

  return applyTransition(tx, {
    machine: commitmentMachine,
    action,
    id: existing.id,
    context,
    from: existing.status,
    reason: options.reason,
    idempotent: options.idempotent,
    data: { updatedByMemberId: context.membershipId },
  });
}

async function validateProject(
  context: UserContext,
  projectId: string | undefined,
  currency: string,
) {
  if (!projectId) {
    if (!hasCompanyFinanceScope(context)) {
      throw new AccessError(
        "FORBIDDEN",
        "Your finance access is limited to your projects, so a commitment needs a project.",
      );
    }
    return null;
  }

  const project = await prisma.project.findFirst({
    where: { AND: [buildFinanceProjectWhere(context), { id: projectId }] },
    select: { id: true, name: true },
  });
  if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.");

  // Same rule as expenses: forecast adds commitments to actual cost, so both
  // have to be in the budget's currency (PRD #15 §34, §130).
  const budget = await prisma.projectBudget.findFirst({
    where: { projectId, isCurrent: true, status: "APPROVED" },
    select: { currency: true },
  });

  if (budget && budget.currency !== currency) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `${project.name} is budgeted in ${budget.currency}. V0.1 does not convert currencies, so its commitments must be in ${budget.currency} too.`,
    );
  }

  return project;
}

function label(commitment: { reference: string | null; description: string }): string {
  return commitment.reference ?? commitment.description;
}

async function memberRef(memberId: string) {
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!member) return null;
  return { memberId: member.id, fullName: `${member.user.firstName} ${member.user.lastName}` };
}

export function toSummaryDTO(row: CommitmentRow): CommitmentSummaryDTO {
  return {
    id: row.id,
    reference: row.reference,
    description: row.description,
    project: row.project,
    counterpartyName: row.counterpartyName,
    category: row.category,
    currency: row.currency,
    amount: toAmountString(row.amount),
    expectedDate: row.expectedDate ? businessDateString(row.expectedDate) : null,
    status: row.status,
    source: {
      module: row.sourceModule,
      entityType: row.sourceEntityType,
      entityId: row.sourceEntityId,
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  commitment: CommitmentDetailRow,
): RecordCapabilities {
  const archived = commitment.status === "ARCHIVED";
  const sourced = isSourced(commitment);

  return {
    canEdit:
      !archived &&
      !sourced &&
      isCommitmentEditable(commitment.status) &&
      can(context, "finance.commitment.update"),
    canSubmit:
      !archived &&
      isCommitmentSubmittable(commitment.status) &&
      can(context, "finance.commitment.submit"),
    canApprove:
      commitment.status === "PENDING_APPROVAL" && approvals.canApproveType(context, "COMMITMENT"),
    canReject:
      commitment.status === "PENDING_APPROVAL" && approvals.canRejectType(context, "COMMITMENT"),
    canMarkSent: false,
    canRecordPayment: false,
    canCancel:
      !archived &&
      CANCELLABLE_COMMITMENT_STATUSES.includes(commitment.status) &&
      can(context, "finance.commitment.cancel"),
    canClose: commitment.status === "APPROVED" && can(context, "finance.commitment.close"),
    canRevise: false,
    canArchive:
      !archived &&
      isCommitmentArchivable(commitment.status) &&
      can(context, "finance.commitment.archive"),
    canRestore: archived && can(context, "finance.commitment.restore"),
    canViewActivity: can(context, "finance.activity.view"),
    canViewDocuments: can(context, "finance.document.view") && can(context, "document.view"),
  };
}
