import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
  stateDenied,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { pageWindow, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import * as tasks from "@/lib/modules/tasks/task.service";
import { dateString, toMemberRef } from "../contract.dto";
import { buildContractScopeWhere } from "../contract.scope";
import type { ContractObligationDTO } from "../contract.types";
import { acceptsObligations } from "../contracts/contract.status";
import { contractObligationMachine, type ContractObligationAction } from "./obligation.machine";
import type { ObligationInput, ObligationListQuery, ObligationTaskInput } from "./obligation.schema";
import { canCloseObligation, daysOverdue, isObligationOverdue } from "./obligation.status";

/**
 * Contract obligations (PRD #18 §148–§158).
 *
 * An obligation is what the agreement requires. A Task is work somebody does to
 * satisfy it, and it lives in Tasks with every other piece of work — there is
 * no obligation-shaped task table here (PRD #18 §154, §208).
 *
 * Obligations inherit the contract's scope entirely: there is one answer to
 * "may this person see this agreement?", and the obligation list is not a
 * second one (PRD #18 §164).
 */

const MODULE = "contracts" as const;
const ENTITY = "Contract";

const OBLIGATION_SELECT = {
  id: true,
  contractId: true,
  title: true,
  description: true,
  obligationType: true,
  dueDate: true,
  status: true,
  completedAt: true,
  sourceAmendmentId: true,
  responsibleMember: {
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  },
  contract: { select: { status: true, archivedAt: true, contractNumber: true } },
} satisfies Prisma.ContractObligationSelect;

type ObligationRow = Prisma.ContractObligationGetPayload<{ select: typeof OBLIGATION_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

export async function listForContract(
  context: UserContext,
  contractId: string,
): Promise<ContractObligationDTO[]> {
  if (!can(context, "legal.obligation.view")) return [];

  const rows = await prisma.contractObligation.findMany({
    where: { contractId, contract: { is: buildContractScopeWhere(context) } },
    orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    select: OBLIGATION_SELECT,
  });

  const today = new Date();
  return rows.map((row) => toDTO(context, row, today));
}

/**
 * Who an obligation may be made responsible (PRD #18 §153).
 *
 * Active members of this company. Responsibility is a company fact rather than
 * a scoped one — somebody outside the contract's scope can still be the person
 * who owes the deliverable — but never another company's people.
 */
export async function responsibleOptions(
  context: UserContext,
): Promise<{ value: string; label: string }[]> {
  if (!can(context, "legal.obligation.view")) return [];

  const members = await prisma.companyMember.findMany({
    where: { companyId: context.companyId, status: "ACTIVE", archivedAt: null },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
  });

  return members.map((member) => ({
    value: member.id,
    label: `${member.user.firstName} ${member.user.lastName}`,
  }));
}

/** The open-obligation register across every contract in scope (PRD #18 §222). */
export async function listObligations(context: UserContext, query: ObligationListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "legal.obligation.view");

  const today = new Date();
  const where: Prisma.ContractObligationWhereInput = {
    AND: [
      { contract: { is: buildContractScopeWhere(context) } },
      query.status?.length ? { status: { in: query.status } } : {},
      query.obligationType?.length ? { obligationType: { in: query.obligationType } } : {},
      query.responsibleMemberId ? { responsibleMemberId: query.responsibleMemberId } : {},
      query.contractId ? { contractId: query.contractId } : {},
      query.overdueOnly ? { status: "OPEN", dueDate: { lt: today } } : {},
    ],
  };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "contracts.obligations.list",
    async (tx) => {
      const window = pageWindow(await tx.contractObligation.count({ where }), query.page, query.limit);
      const rows = await tx.contractObligation.findMany({
        where,
        orderBy: withTieBreaker([{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }]),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: OBLIGATION_SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  return {
    data: rows.map((row) => toDTO(context, row, today)),
    pagination: window,
  };
}

export async function getObligation(
  context: UserContext,
  obligationId: string,
): Promise<ContractObligationDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.obligation.view");

  const row = assertFound(await findInScope(context, obligationId));
  return toDTO(context, row, new Date());
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createObligation(
  context: UserContext,
  contractId: string,
  input: ObligationInput,
  sourceAmendmentId: string | null = null,
): Promise<ContractObligationDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.obligation.create");

  const contract = await requireContract(context, contractId);
  const responsibleMemberId = input.responsibleMemberId
    ? await resolveResponsible(context, input.responsibleMemberId)
    : null;

  const obligationId = await prisma.$transaction(async (tx) => {
    const obligation = await tx.contractObligation.create({
      data: {
        companyId: context.companyId,
        contractId,
        title: input.title,
        description: input.description ?? null,
        obligationType: input.obligationType,
        responsibleMemberId,
        dueDate: input.dueDate ?? null,
        status: "OPEN",
        sourceAmendmentId,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_OBLIGATION_CREATED",
      message: `recorded obligation "${input.title}" on contract ${contract.contractNumber}`,
      metadata: { obligationId: obligation.id, dueDate: dateString(input.dueDate ?? null) } as Prisma.InputJsonValue,
    });

    return obligation.id;
  });

  return getObligation(context, obligationId);
}

export async function updateObligation(
  context: UserContext,
  obligationId: string,
  input: ObligationInput,
): Promise<ContractObligationDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.obligation.update");

  const existing = assertFound(await findInScope(context, obligationId));
  assertOpen(existing, "changed");

  const responsibleMemberId = input.responsibleMemberId
    ? await resolveResponsible(context, input.responsibleMemberId)
    : null;

  await prisma.$transaction(async (tx) => {
    // Conditional on the obligation still being open: one completed or
    // cancelled while this form was open is closed, and stays as it was closed.
    const saved = await tx.contractObligation.updateMany({
      where: { id: obligationId, companyId: context.companyId, status: existing.status },
      data: {
        title: input.title,
        description: input.description ?? null,
        obligationType: input.obligationType,
        responsibleMemberId,
        dueDate: input.dueDate ?? null,
        updatedByMemberId: context.membershipId,
      },
    });
    if (saved.count === 0) {
      throw new AccessError("CONFLICT", "This obligation changed since you opened it. Reload to see the latest.", {
        code: "CONTRACT_OBLIGATION_STALE",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: "LEGAL_OBLIGATION_UPDATED",
      message: `updated obligation "${input.title}" on contract ${existing.contract.contractNumber}`,
      metadata: { obligationId } as Prisma.InputJsonValue,
    });
  });

  return getObligation(context, obligationId);
}

export async function completeObligation(
  context: UserContext,
  obligationId: string,
  note: string | null,
): Promise<void> {
  await closeObligation(context, obligationId, {
    permission: "legal.obligation.complete",
    transition: "complete",
    action: "LEGAL_OBLIGATION_COMPLETED",
    verb: "completed",
    note,
  });
}

export async function cancelObligation(
  context: UserContext,
  obligationId: string,
  note: string | null,
): Promise<void> {
  await closeObligation(context, obligationId, {
    permission: "legal.obligation.cancel",
    transition: "cancel",
    action: "LEGAL_OBLIGATION_CANCELLED",
    verb: "cancelled",
    note,
  });
}

/**
 * Raises the work that satisfies an obligation (PRD #18 §154, §155, §431).
 *
 * The canonical Task service does the writing, so the task appears in `/tasks`
 * like any other and obeys the Tasks module's own permissions. Legal contributes
 * the context that points back here. The task is written in a transaction that
 * first re-reads the actor and share-locks the obligation, still open: one
 * completed or cancelled in the meantime gets no new work, and a close that
 * arrives later waits for this commit (AUD-10 §7, CW-12).
 */
export async function createTaskForObligation(
  context: UserContext,
  obligationId: string,
  input: ObligationTaskInput,
): Promise<{ id: string }> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.task.create");

  const obligation = assertFound(await findInScope(context, obligationId));
  // Work is raised for an obligation still owed. A completed or cancelled one
  // has nothing left to do, and the record page offers no button for it
  // (PRD #18 §154, PRD #47 §85).
  if (obligation.status !== "OPEN") {
    throw stateDenied(`This obligation is already ${obligation.status.toLowerCase()}.`, { code: "OBLIGATION_CLOSED" });
  }
  const contract = await prisma.contract.findUnique({
    where: { id: obligation.contractId },
    select: { projectId: true },
  });

  return runInTransaction(
    "contracts.obligation.task.create",
    async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status"::text AS "status" FROM "contract_obligations" WHERE "id" = ${obligationId} AND "companyId" = ${context.companyId} FOR SHARE`;
      if (!locked) throw new AccessError("NOT_FOUND");
      if (locked.status !== "OPEN") throw stateDenied(`This obligation is already ${locked.status.toLowerCase()}.`, { code: "OBLIGATION_CLOSED" });

      const task = await tasks.createTaskFromContextIn(tx, context, {
        title: input.title,
        description: input.description,
        projectId: contract?.projectId ?? undefined,
        assigneeMemberId: input.assigneeMemberId,
        startDate: undefined,
        dueDate: input.dueDate,
        status: "TODO",
        priority: "MEDIUM",
        parentType: "obligation",
        parentId: obligationId,
      });
      return { id: task.id };
    },
    { actor: context },
  );
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function closeObligation(
  context: UserContext,
  obligationId: string,
  spec: {
    permission: Parameters<typeof assertPermission>[1];
    transition: ContractObligationAction;
    action: string;
    verb: string;
    note: string | null;
  },
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, spec.permission);

  const existing = assertFound(await findInScope(context, obligationId));
  if (!canCloseObligation(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      `This obligation is already ${existing.status.toLowerCase()}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Conditional on the status that was read, so two people closing at once
    // cannot both win (PRD #18 §320).
    await applyTransition(tx, {
      machine: contractObligationMachine,
      action: spec.transition,
      id: obligationId,
      context,
      from: existing.status,
      data: {
        completedAt: spec.transition === "complete" ? new Date() : null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.contractId,
      action: spec.action,
      message: `${spec.verb} obligation "${existing.title}" on contract ${existing.contract.contractNumber}`,
      metadata: { obligationId, ...(spec.note ? { note: spec.note } : {}) } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Confirms an obligation named in a URL belongs to the contract named beside it
 * (PRD #47 §17, §47).
 *
 * `/contracts/A/obligations/X` must not act on X when X belongs to contract B:
 * the path is what the caller and the audit trail read, so a mismatch answers
 * "not found" rather than quietly acting on another contract's obligation.
 */
export async function assertObligationOnContract(
  context: UserContext,
  contractId: string,
  obligationId: string,
): Promise<void> {
  assertFound(
    await prisma.contractObligation.findFirst({
      where: { id: obligationId, contractId, contract: { is: buildContractScopeWhere(context) } },
      select: { id: true },
    }),
  );
}

function findInScope(context: UserContext, obligationId: string) {
  return prisma.contractObligation.findFirst({
    where: { id: obligationId, contract: { is: buildContractScopeWhere(context) } },
    select: OBLIGATION_SELECT,
  });
}

async function requireContract(context: UserContext, contractId: string) {
  const contract = assertFound(
    await prisma.contract.findFirst({
      where: { AND: [buildContractScopeWhere(context), { id: contractId }] },
      select: { id: true, contractNumber: true, status: true, archivedAt: true },
    }),
  );

  if (contract.archivedAt || !acceptsObligations(contract.status)) {
    throw new AccessError(
      "CONFLICT",
      "This contract is closed, so no further obligations can be recorded against it.",
    );
  }

  return contract;
}

function assertOpen(row: ObligationRow, verb: string): void {
  if (row.contract.archivedAt) {
    throw new AccessError("CONFLICT", "This contract is archived and read-only.");
  }
  if (row.status !== "OPEN") {
    throw new AccessError("CONFLICT", `A closed obligation cannot be ${verb}.`);
  }
}

async function resolveResponsible(context: UserContext, memberId: string): Promise<string> {
  const member = await prisma.companyMember.findFirst({
    where: { id: memberId, companyId: context.companyId, status: "ACTIVE", archivedAt: null },
    select: { id: true },
  });
  if (!member) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Choose an active member of this company as the responsible person.",
    );
  }
  return member.id;
}

function toDTO(
  context: UserContext,
  row: ObligationRow,
  today: Date,
): ContractObligationDTO {
  const open = row.status === "OPEN" && !row.contract.archivedAt;

  return {
    id: row.id,
    contractId: row.contractId,
    title: row.title,
    description: row.description,
    type: row.obligationType,
    responsible: toMemberRef(row.responsibleMember),
    dueDate: dateString(row.dueDate),
    status: row.status,
    isOverdue: isObligationOverdue(row, today),
    daysOverdue: daysOverdue(row, today),
    completedAt: row.completedAt?.toISOString() ?? null,
    sourceAmendmentId: row.sourceAmendmentId,
    capabilities: {
      canEdit: open && can(context, "legal.obligation.update"),
      canComplete: open && can(context, "legal.obligation.complete"),
      canCancel: open && can(context, "legal.obligation.cancel"),
      canCreateTask:
        open && can(context, "legal.task.create") && can(context, "task.create"),
    },
  };
}
