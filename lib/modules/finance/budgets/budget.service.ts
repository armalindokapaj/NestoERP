import { Prisma, type BudgetStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { AccessError, assertFound, assertModule, assertPermission, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { toAmountString } from "../finance.money";
import { buildBudgetScopeWhere, buildFinanceProjectWhere } from "../finance.scope";
import { baseCurrency } from "../finance.settings";
import type {
  BudgetDetailDTO,
  BudgetSummaryDTO,
  ProjectFinanceSummaryDTO,
  RecordCapabilities,
} from "../finance.types";
import { calculateBudgetTotal } from "../invoices/invoice.calculation";
import { projectFinanceNumbers, type ProjectFinanceNumbers } from "./budget.summary";
import type { BudgetListQuery, CreateBudgetInput, UpdateBudgetInput } from "./budget.schema";
import {
  canTransitionBudget,
  isBudgetArchivable,
  isBudgetEditable,
  isBudgetOpen,
  isBudgetSubmittable,
} from "./budget.status";

/**
 * Project budgets (PRD #15 §103–§123).
 *
 * A budget is versioned and an approved one is immutable. Changing an approved
 * budget means creating the next version, which starts as a draft copy and goes
 * through approval like any other (PRD #15 §111, §115).
 *
 * Approval is the interesting transaction: the new version becomes current and
 * the previous current version stands down, in one step. A partial application
 * would leave a project with two current budgets or none, and every variance
 * figure on it would be wrong (PRD #15 §113, §201).
 */

const MODULE = "finance" as const;
const ENTITY = "ProjectBudget";

const SUMMARY_SELECT = {
  id: true,
  version: true,
  name: true,
  currency: true,
  status: true,
  isCurrent: true,
  totalAmount: true,
  updatedAt: true,
  projectId: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ProjectBudgetSelect;

type BudgetRow = Prisma.ProjectBudgetGetPayload<{ select: typeof SUMMARY_SELECT }>;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  preArchiveStatus: true,
  notes: true,
  approvedAt: true,
  archivedAt: true,
  createdAt: true,
  createdByMemberId: true,
  lineItems: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      category: true,
      description: true,
      plannedAmount: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.ProjectBudgetSelect;

type BudgetDetailRow = Prisma.ProjectBudgetGetPayload<{ select: typeof DETAIL_SELECT }>;

const ORDER: Record<string, Prisma.ProjectBudgetOrderByWithRelationInput[]> = {
  "updated-desc": [{ updatedAt: "desc" }],
  "project-asc": [{ project: { name: "asc" } }, { version: "desc" }],
  "amount-desc": [{ totalAmount: "desc" }],
  "amount-asc": [{ totalAmount: "asc" }],
  "version-desc": [{ version: "desc" }],
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listBudgets(context: UserContext, query: BudgetListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "finance.budget.view");

  const filters: Prisma.ProjectBudgetWhereInput[] = [buildBudgetScopeWhere(context)];

  filters.push(
    query.archived
      ? { status: "ARCHIVED" }
      : { archivedAt: null, status: { not: "ARCHIVED" } },
  );

  const search = searchClause(query.search, ["name", "notes"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.ProjectBudgetWhereInput),
        { project: { name: { contains: term, mode: "insensitive" } } },
        { project: { code: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  if (query.status?.length && !query.archived) filters.push({ status: { in: query.status } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.currency) filters.push({ currency: query.currency });
  if (query.currentOnly) filters.push({ isCurrent: true });

  const where: Prisma.ProjectBudgetWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.projectBudget.findMany({
      where,
      orderBy: ORDER[query.sort] ?? ORDER["updated-desc"],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SUMMARY_SELECT,
    }),
    prisma.projectBudget.count({ where }),
  ]);

  const fallback = await baseCurrency(context.companyId);
  const numbers = await projectFinanceNumbers(
    [...new Set(rows.map((row) => row.projectId))],
    fallback,
  );

  return {
    data: rows.map((row) => toSummaryDTO(row, numbers.get(row.projectId))),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getBudget(
  context: UserContext,
  budgetId: string,
): Promise<BudgetDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.budget.view");

  const budget = assertFound(
    await prisma.projectBudget.findFirst({
      where: { AND: [buildBudgetScopeWhere(context), { id: budgetId }] },
      select: DETAIL_SELECT,
    }),
  );

  const fallback = await baseCurrency(context.companyId);
  const [numbers, history, creator] = await Promise.all([
    projectFinanceNumbers([budget.projectId], fallback),
    approvals.approvalHistory(context, "BUDGET", budget.id),
    memberRef(budget.createdByMemberId),
  ]);

  return {
    ...toSummaryDTO(budget, numbers.get(budget.projectId)),
    notes: budget.notes,
    approvedAt: budget.approvedAt?.toISOString() ?? null,
    archivedAt: budget.archivedAt?.toISOString() ?? null,
    lineItems: budget.lineItems.map((line) => ({
      id: line.id,
      category: line.category,
      description: line.description,
      plannedAmount: toAmountString(line.plannedAmount),
      sortOrder: line.sortOrder,
    })),
    approvals: history,
    createdBy: creator,
    createdAt: budget.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, budget),
  };
}

/**
 * The project finance summary (PRD #15 §258, §259).
 *
 * One service, called by the Projects finance tab, the Finance overview and the
 * budget-vs-actual report alike — so the same project never shows a different
 * variance in two places.
 */
export async function getProjectFinanceSummary(
  context: UserContext,
  projectId: string,
): Promise<ProjectFinanceSummaryDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.project_budget.view");

  // Read through the project scope resolver, so a project the caller cannot
  // open has no finance summary to read (PRD #15 §210).
  const project = assertFound(
    await prisma.project.findFirst({
      where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
      select: { id: true },
    }),
  );

  const fallback = await baseCurrency(context.companyId);
  const numbers = await projectFinanceNumbers([project.id], fallback);

  return toSummaryPayload(project.id, numbers.get(project.id)!);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The currency a project's approved budget has settled, for the budget form
 * (PRD #15 §117).
 *
 * Read through the budget scope, never by project id alone: the form takes its
 * project from the query string, and an unscoped lookup would confirm that
 * another company's — or another team's — project has an approved budget, and
 * in which currency (PRD #47 §17, §40). A project out of reach reads as having
 * none.
 */
export async function approvedBudgetCurrency(
  context: UserContext,
  projectId: string,
): Promise<string | null> {
  assertModule(context, MODULE);
  if (!can(context, "finance.budget.create") && !can(context, "finance.budget.update")) {
    throw new AccessError("FORBIDDEN");
  }

  const approved = await prisma.projectBudget.findFirst({
    where: { AND: [buildBudgetScopeWhere(context), { projectId, status: "APPROVED" }] },
    select: { currency: true },
  });
  return approved?.currency ?? null;
}

export async function createBudget(
  context: UserContext,
  input: CreateBudgetInput,
): Promise<BudgetDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.budget.create");

  const project = await validateProject(context, input.projectId);
  const total = calculateBudgetTotal(input.lineItems);

  const budgetId = await prisma.$transaction(async (tx) => {
    await assertNoOpenVersion(tx, project.id);
    await assertCurrencyIsFixed(tx, project.id, input.currency);

    const version = await nextVersion(tx, project.id);

    const budget = await tx.projectBudget.create({
      data: {
        companyId: context.companyId,
        projectId: project.id,
        version,
        name: input.name ?? null,
        currency: input.currency,
        status: "DRAFT",
        isCurrent: false,
        totalAmount: total,
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        lineItems: {
          create: input.lineItems.map((line, index) => ({
            category: line.category,
            description: line.description,
            plannedAmount: line.plannedAmount,
            sortOrder: index,
          })),
        },
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: budget.id,
      action: "FINANCE_BUDGET_CREATED",
      message: `drafted budget v${version} for ${project.name}`,
      metadata: {
        projectId: project.id,
        version,
        currency: input.currency,
        totalAmount: toAmountString(total),
      } as Prisma.InputJsonValue,
    });

    return budget.id;
  });

  return getBudget(context, budgetId);
}

export async function updateBudget(
  context: UserContext,
  budgetId: string,
  input: UpdateBudgetInput,
): Promise<BudgetDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.budget.update");

  const existing = assertFound(
    await prisma.projectBudget.findFirst({
      where: { AND: [buildBudgetScopeWhere(context), { id: budgetId }] },
      select: DETAIL_SELECT,
    }),
  );

  if (!isBudgetEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An approved budget is never edited. Create a revision instead.",
    );
  }

  if (
    input.versionUpdatedAt &&
    existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This budget was updated by another user. Refresh and review the latest changes.",
    );
  }

  const total = calculateBudgetTotal(input.lineItems);

  await prisma.$transaction(async (tx) => {
    // Claimed on the status it was read with, and locked to the end of the
    // transaction: a budget submitted or approved in the meantime turns this
    // save into a conflict instead of rewriting its lines (PRD #47 §66).
    const claimed = await tx.projectBudget.updateMany({
      where: { id: budgetId, companyId: context.companyId, status: existing.status },
      data: { updatedByMemberId: context.membershipId },
    });
    if (claimed.count === 0) {
      throw stateDenied("This budget changed while you were working on it. Refresh and review it.");
    }

    await assertCurrencyIsFixed(tx, existing.projectId, input.currency, existing.id);

    await tx.projectBudgetLineItem.deleteMany({ where: { budgetId } });

    await tx.projectBudget.update({
      where: { id: budgetId },
      data: {
        name: input.name ?? null,
        currency: input.currency,
        totalAmount: total,
        notes: input.notes ?? null,
        updatedByMemberId: context.membershipId,
        lineItems: {
          create: input.lineItems.map((line, index) => ({
            category: line.category,
            description: line.description,
            plannedAmount: line.plannedAmount,
            sortOrder: index,
          })),
        },
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: budgetId,
      action: "FINANCE_BUDGET_UPDATED",
      message: `updated budget v${existing.version} for ${existing.project.name}`,
    });
  });

  return getBudget(context, budgetId);
}

export async function submitBudget(context: UserContext, budgetId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.budget.submit");

  const existing = await requireBudget(context, budgetId);

  if (!isBudgetSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", `A ${existing.status.toLowerCase()} budget cannot be submitted.`);
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "PENDING_APPROVAL");
    await approvals.openApproval(tx, context, "BUDGET", budgetId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: budgetId,
      action: "FINANCE_BUDGET_SUBMITTED",
      message: `submitted budget v${existing.version} for ${existing.project.name}`,
    });
  });
}

/**
 * Approves a budget and makes it the project's current one (PRD #15 §113).
 *
 * Standing the previous version down happens in the same transaction as the
 * approval, which is what the `project_budget_one_current` partial unique index
 * is there to guarantee if this code is ever wrong.
 */
export async function approveBudget(
  context: UserContext,
  budgetId: string,
  note: string | null,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "BUDGET");

  const existing = await requireBudget(context, budgetId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "BUDGET", budgetId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "APPROVED");

    await tx.projectBudget.updateMany({
      where: { projectId: existing.projectId, isCurrent: true, id: { not: budgetId } },
      data: { isCurrent: false },
    });

    await tx.projectBudget.update({
      where: { id: budgetId },
      data: {
        isCurrent: true,
        approvedAt: new Date(),
        approvedByMemberId: context.membershipId,
      },
    });

    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: budgetId,
      action: "FINANCE_BUDGET_APPROVED",
      message: `approved budget v${existing.version} for ${existing.project.name}`,
      metadata: {
        projectId: existing.projectId,
        totalAmount: toAmountString(existing.totalAmount),
      } as Prisma.InputJsonValue,
    });

    // `required`: an approved budget is what every later commitment is checked
    // against, so it may not become approved unaudited (PRD #28 §102, §136).
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.FINANCE_BUDGET_APPROVED,
        entity: {
          type: ENTITY,
          id: budgetId,
          label: `v${existing.version} — ${existing.project.name}`,
        },
        projectId: existing.projectId,
        before: { status: existing.status },
        after: {
          status: "APPROVED",
          amount: toAmountString(existing.totalAmount),
          currency: existing.currency,
        },
        reason: note,
      },
      { tx },
    );
  });
}

export async function rejectBudget(
  context: UserContext,
  budgetId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "BUDGET");

  const existing = await requireBudget(context, budgetId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "BUDGET", budgetId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "REJECTED");
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: budgetId,
      action: "FINANCE_BUDGET_REJECTED",
      message: `rejected budget v${existing.version} for ${existing.project.name}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Returns the budget for revision (PRD #41 §48): back to draft with the
 * approver's reason, so the requester can correct it and submit it again as a
 * new approval cycle. The decision history keeps the returned cycle.
 */
export async function returnBudget(
  context: UserContext,
  budgetId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "BUDGET");

  const existing = await requireBudget(context, budgetId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "BUDGET", budgetId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "DRAFT");
    await approvals.decideApproval(tx, context, approval.id, "RETURNED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: budgetId,
      action: "FINANCE_BUDGET_RETURNED",
      message: `returned budget v${existing.version} for ${existing.project.name} for revision`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Opens the next version as a draft copy (PRD #15 §115).
 *
 * The currency is copied rather than offered: once a project has an approved
 * budget, its costs are recorded in that currency, and a revision in another
 * one would make them unaddable (PRD #15 §117).
 */
export async function reviseBudget(context: UserContext, budgetId: string): Promise<string> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.budget.revise");

  const source = assertFound(
    await prisma.projectBudget.findFirst({
      where: { AND: [buildBudgetScopeWhere(context), { id: budgetId }] },
      select: DETAIL_SELECT,
    }),
  );

  if (source.status !== "APPROVED") {
    throw new AccessError("CONFLICT", "Only an approved budget is revised. Edit a draft directly.");
  }

  return prisma.$transaction(async (tx) => {
    await assertNoOpenVersion(tx, source.projectId);
    const version = await nextVersion(tx, source.projectId);

    const revision = await tx.projectBudget.create({
      data: {
        companyId: context.companyId,
        projectId: source.projectId,
        version,
        name: source.name,
        currency: source.currency,
        status: "DRAFT",
        isCurrent: false,
        totalAmount: source.totalAmount,
        notes: source.notes,
        createdByMemberId: context.membershipId,
        lineItems: {
          create: source.lineItems.map((line) => ({
            category: line.category,
            description: line.description,
            plannedAmount: line.plannedAmount,
            sortOrder: line.sortOrder,
          })),
        },
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: revision.id,
      action: "FINANCE_BUDGET_REVISED",
      message: `opened budget v${version} for ${source.project.name}, revising v${source.version}`,
      metadata: { projectId: source.projectId, revisedFrom: source.id } as Prisma.InputJsonValue,
    });

    return revision.id;
  });
}

export async function archiveBudget(context: UserContext, budgetId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.budget.archive");

  const existing = await requireBudget(context, budgetId);

  if (!isBudgetArchivable(existing)) {
    throw new AccessError(
      "CONFLICT",
      existing.isCurrent
        ? "The current budget cannot be archived — every variance figure on the project is measured against it."
        : "Only a draft or rejected budget can be archived.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectBudget.update({
      where: { id: budgetId },
      data: {
        status: "ARCHIVED",
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await approvals.cancelPendingApprovals(tx, context, "BUDGET", budgetId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: budgetId,
      action: "FINANCE_BUDGET_ARCHIVED",
      message: `archived budget v${existing.version} for ${existing.project.name}`,
    });
  });
}

export async function restoreBudget(context: UserContext, budgetId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.budget.restore");

  const existing = await requireBudget(context, budgetId);

  if (existing.status !== "ARCHIVED") {
    throw new AccessError("CONFLICT", "This budget is not archived.");
  }

  await prisma.$transaction(async (tx) => {
    await assertNoOpenVersion(tx, existing.projectId);

    await tx.projectBudget.update({
      where: { id: budgetId },
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
      entityId: budgetId,
      action: "FINANCE_BUDGET_RESTORED",
      message: `restored budget v${existing.version} for ${existing.project.name}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireBudget(context: UserContext, budgetId: string) {
  return assertFound(
    await prisma.projectBudget.findFirst({
      where: { AND: [buildBudgetScopeWhere(context), { id: budgetId }] },
      select: DETAIL_SELECT,
    }),
  );
}

async function moveStatus(
  tx: Prisma.TransactionClient,
  context: UserContext,
  existing: { id: string; status: BudgetStatus },
  next: BudgetStatus,
): Promise<void> {
  if (!canTransitionBudget(existing.status, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A budget cannot move from ${existing.status} to ${next}.`,
    );
  }

  const result = await tx.projectBudget.updateMany({
    where: { id: existing.id, status: existing.status },
    data: { status: next, updatedByMemberId: context.membershipId },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This budget changed while you were working on it.");
  }
}

/** At most one draft or pending version per project (PRD #15 §110). */
async function assertNoOpenVersion(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  const open = await tx.projectBudget.findFirst({
    where: { projectId, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
    select: { version: true, status: true },
  });

  if (open) {
    throw new AccessError(
      "CONFLICT",
      `Budget v${open.version} is already ${open.status === "DRAFT" ? "in draft" : "awaiting approval"}. Finish it before starting another.`,
    );
  }
}

/**
 * Budget currency is fixed by the first approved version (PRD #15 §117).
 *
 * By then the project's expenses and commitments are recorded in it, and V0.1
 * cannot convert them.
 */
async function assertCurrencyIsFixed(
  tx: Prisma.TransactionClient,
  projectId: string,
  currency: string,
  exceptBudgetId?: string,
): Promise<void> {
  const approved = await tx.projectBudget.findFirst({
    where: {
      projectId,
      status: "APPROVED",
      ...(exceptBudgetId ? { id: { not: exceptBudgetId } } : {}),
    },
    select: { currency: true },
  });

  if (approved && approved.currency !== currency) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `This project is budgeted in ${approved.currency}. V0.1 does not convert currencies, so its budget stays in ${approved.currency}.`,
    );
  }
}

async function nextVersion(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
  const latest = await tx.projectBudget.findFirst({
    where: { projectId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

async function validateProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildFinanceProjectWhere(context), { id: projectId }] },
    select: { id: true, name: true },
  });
  if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.");
  return project;
}

async function memberRef(memberId: string) {
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!member) return null;
  return { memberId: member.id, fullName: `${member.user.firstName} ${member.user.lastName}` };
}

function toSummaryDTO(
  row: BudgetRow,
  numbers: ProjectFinanceNumbers | undefined,
): BudgetSummaryDTO {
  return {
    id: row.id,
    project: row.project,
    version: row.version,
    name: row.name,
    currency: row.currency,
    status: row.status,
    isCurrent: row.isCurrent,
    budgetAmount: toAmountString(row.totalAmount),
    // Actual and commitment are the *project's*, not this version's: a
    // superseded budget shows what the project has actually spent, which is the
    // only meaningful comparison.
    actualCost: toAmountString(numbers?.actualCost ?? 0),
    openCommitments: toAmountString(numbers?.openCommitments ?? 0),
    forecastCost: toAmountString(numbers?.forecastCost ?? 0),
    variance: toAmountString(
      numbers ? row.totalAmount.minus(numbers.forecastCost) : row.totalAmount,
    ),
    utilizationPercent: numbers?.utilizationPercent ?? null,
    risk: numbers?.risk ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSummaryPayload(
  projectId: string,
  numbers: ProjectFinanceNumbers,
): ProjectFinanceSummaryDTO {
  return {
    projectId,
    currency: numbers.currency,
    budgetAmount: toAmountString(numbers.budgetAmount),
    actualCost: toAmountString(numbers.actualCost),
    openCommitments: toAmountString(numbers.openCommitments),
    forecastCost: toAmountString(numbers.forecastCost),
    remaining: toAmountString(numbers.remaining),
    variance: toAmountString(numbers.variance),
    utilizationPercent: numbers.utilizationPercent,
    risk: numbers.risk,
    hasApprovedBudget: numbers.hasApprovedBudget,
  };
}

function capabilitiesFor(context: UserContext, budget: BudgetDetailRow): RecordCapabilities {
  const archived = budget.status === "ARCHIVED";

  return {
    canEdit: !archived && isBudgetEditable(budget.status) && can(context, "finance.budget.update"),
    canSubmit:
      !archived && isBudgetSubmittable(budget.status) && can(context, "finance.budget.submit"),
    canApprove: budget.status === "PENDING_APPROVAL" && approvals.canApproveType(context, "BUDGET"),
    canReject: budget.status === "PENDING_APPROVAL" && approvals.canRejectType(context, "BUDGET"),
    canMarkSent: false,
    canRecordPayment: false,
    canCancel: false,
    canClose: false,
    canRevise: budget.status === "APPROVED" && can(context, "finance.budget.revise"),
    canArchive: !archived && isBudgetArchivable(budget) && can(context, "finance.budget.archive"),
    canRestore: archived && can(context, "finance.budget.restore"),
    canViewActivity: can(context, "finance.activity.view"),
    canViewDocuments: can(context, "finance.document.view") && can(context, "document.view"),
  };
}

export { isBudgetOpen };
