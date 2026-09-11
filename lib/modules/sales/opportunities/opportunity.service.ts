import { Prisma, type OpportunityStage } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { businessDateString } from "@/lib/modules/finance/finance.fields";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import { createClientRecord } from "@/lib/modules/clients/client.service";
import type { CreateClientInput } from "@/lib/modules/clients/client.schema";
import { createProjectRecord } from "@/lib/modules/projects/project.service";
import { contactFullName, loadMemberRef, toMemberRef } from "../sales.dto";
import {
  buildSalesClientWhere,
  buildSalesOwnerWhere,
  buildSalesProjectWhere,
} from "../sales.scope";
import type { OpportunityDetailDTO, OpportunitySummaryDTO } from "../sales.types";
import * as repository from "./opportunity.repository";
import type {
  CreateOpportunityInput,
  OpportunityListQuery,
  OpportunityLostInput,
  OpportunityWonInput,
  UpdateOpportunityInput,
} from "./opportunity.schema";
import {
  REOPEN_STAGE,
  canTransitionOpportunityStage,
  effectiveProbability,
  isClosedStage,
  weightedValue,
} from "./opportunity.stage";

/**
 * Opportunities (PRD #17 §59–§97).
 *
 * Four rules are enforced here and nowhere else:
 *
 *   1. **The server owns the forecast.** The probability and the weighted value
 *      are derived on every read from the stage and the override; nothing
 *      arrives from the browser (PRD #17 §29, §224).
 *   2. **A deal cannot be won without a canonical client.** A won opportunity
 *      is a customer relationship, and Finance, Legal and delivery all need the
 *      same Client record to point at (PRD #17 §87).
 *   3. **A closed deal closes once.** WON and LOST are conditional updates
 *      checked by row count, so two people pressing at the same moment produce
 *      one outcome and one conflict (PRD #17 §92, §256).
 *   4. **Conversion reuses the canonical services.** The Client and the Project
 *      are written by the Clients and Projects services, in this transaction —
 *      Sales owns no second copy of either (PRD #17 §154, §160, §259).
 */

const MODULE = "sales" as const;
const ENTITY = "Opportunity";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listOpportunities(context: UserContext, query: OpportunityListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.view");

  const { rows, total } = await repository.listOpportunities(context, query);

  let data = rows.map(toSummaryDTO);

  // Probability and weighted value are derived, so they cannot be SQL filters
  // or SQL sorts. Applying them after the page is read narrows the page rather
  // than the query — honest about what it is, and correct for what is shown.
  if (query.minProbability !== undefined) {
    data = data.filter((row) => Number.parseFloat(row.probability) >= query.minProbability!);
  }
  if (query.maxProbability !== undefined) {
    data = data.filter((row) => Number.parseFloat(row.probability) <= query.maxProbability!);
  }
  if (query.sort === "weighted-desc") {
    data = [...data].sort(
      (a, b) => Number.parseFloat(b.weightedValue) - Number.parseFloat(a.weightedValue),
    );
  }
  if (query.sort === "probability-desc") {
    data = [...data].sort(
      (a, b) => Number.parseFloat(b.probability) - Number.parseFloat(a.probability),
    );
  }

  return { data, pagination: paginationMeta(total, query.page, query.limit) };
}

export async function getOpportunity(
  context: UserContext,
  opportunityId: string,
): Promise<OpportunityDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.view");

  // Out of scope answers "not found", so the response cannot confirm that a
  // deal exists to somebody who may not open it (PRD #17 §226).
  const row = assertFound(await repository.findOpportunityInScope(context, opportunityId));
  const createdBy = await loadMemberRef(row.createdByMemberId);

  return {
    ...toSummaryDTO(row),
    contact: row.contact
      ? {
          id: row.contact.id,
          fullName: contactFullName(row.contact),
          email: row.contact.email,
          phone: row.contact.phone,
        }
      : null,
    description: row.description,
    actualCloseDate: row.actualCloseDate ? businessDateString(row.actualCloseDate) : null,
    stageChangedAt: row.stageChangedAt.toISOString(),
    sourceLead: row.sourceLead,
    convertedProject: row.convertedProject,
    wonReason: row.wonReason,
    lostReason: row.lostReason,
    lostNote: row.lostNote,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    proposalCount: row._count.proposals,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row),
  };
}

export async function opportunityFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.view");
  return repository.opportunityFilterOptions(context);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createOpportunity(
  context: UserContext,
  input: CreateOpportunityInput,
): Promise<OpportunityDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.create");

  const { ownerMemberId, clientId, contactId } = await validateRelationships(context, input);

  const opportunityId = await prisma.$transaction(async (tx) => {
    const created = await tx.opportunity.create({
      data: {
        companyId: context.companyId,
        ...opportunityData(input),
        ownerMemberId,
        clientId,
        contactId,
        stage: input.stage,
        stageChangedAt: new Date(),
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: created.id,
      action: "SALES_OPPORTUNITY_CREATED",
      message: `created the opportunity ${input.name}`,
      metadata: {
        currency: input.currency,
        estimatedValue: toAmountString(input.estimatedValue),
      } as Prisma.InputJsonValue,
    });

    return created.id;
  });

  return getOpportunity(context, opportunityId);
}

export async function updateOpportunity(
  context: UserContext,
  opportunityId: string,
  input: UpdateOpportunityInput,
): Promise<OpportunityDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.update");

  const existing = assertFound(await repository.findOpportunityInScope(context, opportunityId));
  assertEditable(existing);

  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This opportunity was updated by another user. Refresh and review the latest changes.",
    );
  }

  // Reassigning through the edit form needs the assignment grant, not only the
  // edit one: who works a deal is a management decision (PRD #17 §80).
  const ownerChanged = input.ownerMemberId !== existing.ownerMemberId;
  if (ownerChanged) assertCanAssign(context);

  // Moving stage through the edit form needs the stage grant for the same
  // reason: the pipeline is not a text field (PRD #17 §81).
  const stageChanged = input.stage !== existing.stage;
  if (stageChanged) {
    assertPermission(context, "sales.opportunity.stage.update");
    if (!canTransitionOpportunityStage(existing.stage, input.stage)) {
      throw new AccessError(
        "VALIDATION_ERROR",
        `An opportunity cannot move from ${existing.stage} to ${input.stage}.`,
      );
    }
  }

  const { ownerMemberId, clientId, contactId } = await validateRelationships(context, input);

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({
      where: { id: opportunityId },
      data: {
        ...opportunityData(input),
        ownerMemberId,
        clientId,
        contactId,
        stage: input.stage,
        ...(stageChanged ? { stageChangedAt: new Date() } : {}),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: opportunityId,
      action: "SALES_OPPORTUNITY_UPDATED",
      message: `updated the opportunity ${input.name}`,
      metadata: changeMetadata({
        estimatedValue: {
          from: toAmountString(existing.estimatedValue),
          to: toAmountString(input.estimatedValue),
        },
      }),
    });

    if (stageChanged) {
      await recordStageChange(tx, context, opportunityId, existing.stage, input.stage);
    }
    if (ownerChanged) await recordAssignment(tx, context, opportunityId, ownerMemberId);
  });

  return getOpportunity(context, opportunityId);
}

export async function assignOpportunity(
  context: UserContext,
  opportunityId: string,
  ownerMemberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertCanAssign(context);

  const existing = assertFound(await repository.findOpportunityInScope(context, opportunityId));
  assertEditable(existing);

  const owner = await resolveOwner(context, ownerMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({
      where: { id: opportunityId },
      data: { ownerMemberId: owner, updatedByMemberId: context.membershipId },
    });
    await recordAssignment(tx, context, opportunityId, owner);
  });
}

/** The Kanban drag, and the keyboard alternative behind it (PRD #17 §101, §297). */
export async function changeStage(
  context: UserContext,
  opportunityId: string,
  stage: OpportunityStage,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.stage.update");

  const existing = assertFound(await repository.findOpportunityInScope(context, opportunityId));
  assertEditable(existing);

  if (!canTransitionOpportunityStage(existing.stage, stage)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      isClosedStage(stage)
        ? "Closing a deal is its own action, so the outcome is recorded properly."
        : `An opportunity cannot move from ${existing.stage} to ${stage}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Conditional on the stage we read, so a stale board cannot overwrite
    // somebody else's move (PRD #17 §101, §254).
    const result = await tx.opportunity.updateMany({
      where: { id: opportunityId, stage: existing.stage },
      data: { stage, stageChangedAt: new Date(), updatedByMemberId: context.membershipId },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "This opportunity moved while you were working on it.");
    }

    await recordStageChange(tx, context, opportunityId, existing.stage, stage);
  });
}

/**
 * Winning a deal (PRD #17 §84–§92).
 *
 * The client is resolved or created first, because a won opportunity without
 * one is a customer relationship nobody can bill, deliver or contract against
 * (PRD #17 §87). The project is optional and may be linked later (PRD #17 §88).
 */
export async function markWon(
  context: UserContext,
  opportunityId: string,
  input: OpportunityWonInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.mark_won");

  const existing = assertFound(await repository.findOpportunityInScope(context, opportunityId));

  if (isClosedStage(existing.stage)) {
    throw new AccessError("CONFLICT", `This opportunity is already ${existing.stage.toLowerCase()}.`);
  }
  if (existing.archivedAt) {
    throw new AccessError("CONFLICT", "Restore this opportunity before closing it.");
  }

  // Both halves of each conversion decision, checked before anything is written
  // (PRD #17 §395, §396, §397).
  if (input.clientMode !== "KEEP") assertPermission(context, "sales.client.convert");
  if (input.projectMode !== "NONE") assertPermission(context, "sales.project.convert");

  let resolvedClientId: string | null = existing.clientId;
  if (input.clientMode === "EXISTING") {
    resolvedClientId = await resolveClient(context, input.clientId!);
  }

  if (input.clientMode === "KEEP" && !resolvedClientId) {
    throw new AccessError(
      "CONFLICT",
      "An opportunity cannot be won without a client. Link an existing client or create one.",
    );
  }

  let existingProject: { id: string; clientId: string | null } | null = null;
  if (input.projectMode === "EXISTING") {
    existingProject = await resolveProject(context, input.projectId!);
  }

  await prisma.$transaction(async (tx) => {
    let clientId = resolvedClientId;

    if (input.clientMode === "NEW") {
      const client = await createClientRecord(tx, context, newClientInput(input.newClientName!));
      clientId = client.id;
    }

    if (!clientId) {
      throw new AccessError("CONFLICT", "An opportunity cannot be won without a client.");
    }

    // Billing one client's work to another's project is the kind of mistake
    // that survives into a ledger (PRD #17 §89).
    if (existingProject && existingProject.clientId && existingProject.clientId !== clientId) {
      throw new AccessError(
        "VALIDATION_ERROR",
        "That project belongs to a different client. A won deal must hand over to its own client's project.",
      );
    }

    let projectId = existingProject?.id ?? null;

    if (input.projectMode === "NEW") {
      // The canonical Projects service, inside this transaction: Sales owns no
      // project table of its own (PRD #17 §160).
      const project = await createProjectRecord(tx, context, {
        code: input.newProjectCode!,
        name: input.newProjectName!,
        description: existing.description ?? undefined,
        // A project handed over from a won deal has not started yet: DRAFT is
        // where the delivery team picks it up (PRD #10 §14, PRD #17 §90).
        status: "DRAFT",
        priority: undefined,
        startDate: undefined,
        endDate: undefined,
        address: undefined,
        city: undefined,
        country: undefined,
        clientId,
        projectManagerMemberId: null,
      });
      projectId = project.id;
    }

    // Conditional on the stage we read: a second mark-won finds no row and is
    // refused (PRD #17 §92, §256).
    const result = await tx.opportunity.updateMany({
      where: { id: opportunityId, stage: existing.stage },
      data: {
        stage: "WON",
        stageChangedAt: new Date(),
        clientId,
        convertedProjectId: projectId,
        actualCloseDate: input.actualCloseDate,
        estimatedValue: new Prisma.Decimal(input.finalValue),
        wonReason: input.wonReason ?? null,
        lostReason: null,
        lostNote: null,
        updatedByMemberId: context.membershipId,
      },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "This opportunity has already been closed.");
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: opportunityId,
      action: "SALES_OPPORTUNITY_WON",
      message: `marked ${existing.name} as won`,
      // Cross-linked ids, so the lineage survives in the audit trail
      // (PRD #17 §445).
      metadata: {
        clientId,
        projectId,
        currency: existing.currency,
        finalValue: toAmountString(input.finalValue),
      } as Prisma.InputJsonValue,
    });

    if (projectId && input.projectMode === "NEW") {
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: "Project",
        entityId: projectId,
        action: "SALES_PROJECT_CREATED_FROM_OPPORTUNITY",
        message: `created the project from the won opportunity ${existing.name}`,
        metadata: { opportunityId } as Prisma.InputJsonValue,
      });
    }
  });
}

export async function markLost(
  context: UserContext,
  opportunityId: string,
  input: OpportunityLostInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.mark_lost");

  const existing = assertFound(await repository.findOpportunityInScope(context, opportunityId));

  if (isClosedStage(existing.stage)) {
    throw new AccessError("CONFLICT", `This opportunity is already ${existing.stage.toLowerCase()}.`);
  }
  if (existing.archivedAt) {
    throw new AccessError("CONFLICT", "Restore this opportunity before closing it.");
  }

  await prisma.$transaction(async (tx) => {
    const result = await tx.opportunity.updateMany({
      where: { id: opportunityId, stage: existing.stage },
      data: {
        stage: "LOST",
        stageChangedAt: new Date(),
        actualCloseDate: input.actualCloseDate,
        lostReason: input.lostReason,
        lostNote: input.lostNote ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "This opportunity has already been closed.");
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: opportunityId,
      action: "SALES_OPPORTUNITY_LOST",
      message: `marked ${existing.name} as lost`,
      metadata: { reason: input.lostReason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Reopening a lost deal (PRD #17 §96, §422).
 *
 * Only LOST reopens. A won deal has a client, possibly a project and possibly
 * an invoice behind it, and unwinding that is a correction workflow V0.1
 * deliberately does not have.
 */
export async function reopenOpportunity(
  context: UserContext,
  opportunityId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.reopen");

  const existing = assertFound(await repository.findOpportunityInScope(context, opportunityId));

  if (existing.stage === "WON") {
    throw new AccessError(
      "CONFLICT",
      "A won opportunity cannot be reopened. The client and project it created still stand.",
    );
  }
  if (existing.stage !== "LOST") {
    throw new AccessError("CONFLICT", "This opportunity is not closed.");
  }

  await prisma.$transaction(async (tx) => {
    const result = await tx.opportunity.updateMany({
      where: { id: opportunityId, stage: "LOST" },
      data: {
        stage: REOPEN_STAGE,
        stageChangedAt: new Date(),
        // The close is undone, so the figures that described it go with it
        // (PRD #17 §422).
        actualCloseDate: null,
        lostReason: null,
        lostNote: null,
        updatedByMemberId: context.membershipId,
      },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "This opportunity changed while you were working on it.");
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: opportunityId,
      action: "SALES_OPPORTUNITY_REOPENED",
      message: `reopened ${existing.name}`,
      metadata: { stage: REOPEN_STAGE } as Prisma.InputJsonValue,
    });
  });
}

/** Linking a project to a deal that was won before the project existed (PRD #17 §423). */
export async function linkProject(
  context: UserContext,
  opportunityId: string,
  projectId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.project.convert");

  const existing = assertFound(await repository.findOpportunityInScope(context, opportunityId));
  if (existing.stage !== "WON") {
    throw new AccessError("CONFLICT", "Only a won opportunity hands over to a project.");
  }

  const project = await resolveProject(context, projectId);
  if (project.clientId && project.clientId !== existing.clientId) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That project belongs to a different client. A won deal must hand over to its own client's project.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({
      where: { id: opportunityId },
      data: { convertedProjectId: project.id, updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: opportunityId,
      action: "SALES_OPPORTUNITY_PROJECT_LINKED",
      message: `linked ${existing.name} to its delivery project`,
      metadata: { projectId: project.id } as Prisma.InputJsonValue,
    });
  });
}

export async function archiveOpportunity(
  context: UserContext,
  opportunityId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.archive");

  const existing = assertFound(await repository.findOpportunityInScope(context, opportunityId));

  if (existing.archivedAt) throw new AccessError("CONFLICT", "This opportunity is already archived.");

  // Won commercial history stays visible: it is the record of where a client,
  // a project and an invoice came from (PRD #17 §97).
  if (existing.stage === "WON") {
    throw new AccessError(
      "CONFLICT",
      "Won opportunities stay visible. They are the record of where the client and project came from.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({
      where: { id: opportunityId },
      data: {
        // The stage is preserved, not overwritten: archiving is a filing
        // decision and the commercial outcome is a fact (PRD #17 §62).
        preArchiveStage: existing.stage,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: opportunityId,
      action: "SALES_OPPORTUNITY_ARCHIVED",
      message: `archived the opportunity ${existing.name}`,
    });
  });
}

export async function restoreOpportunity(
  context: UserContext,
  opportunityId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.opportunity.restore");

  const existing = assertFound(await repository.findOpportunityInScope(context, opportunityId));
  if (!existing.archivedAt) throw new AccessError("CONFLICT", "This opportunity is not archived.");

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({
      where: { id: opportunityId },
      data: { preArchiveStage: null, archivedAt: null, archivedByMemberId: null },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: opportunityId,
      action: "SALES_OPPORTUNITY_RESTORED",
      message: `restored the opportunity ${existing.name}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function assertEditable(existing: repository.OpportunityDetailRow): void {
  if (existing.archivedAt) {
    throw new AccessError("CONFLICT", "Restore this opportunity before editing it.");
  }
  // A closed deal is history except for an explicit reopen (PRD #17 §79, §233).
  if (isClosedStage(existing.stage)) {
    throw new AccessError(
      "CONFLICT",
      existing.stage === "WON"
        ? "A won opportunity is a historical record and cannot be edited."
        : "Reopen this opportunity before editing it.",
    );
  }
}

async function recordStageChange(
  tx: Prisma.TransactionClient,
  context: UserContext,
  opportunityId: string,
  from: OpportunityStage,
  to: OpportunityStage,
): Promise<void> {
  await recordActivity(tx, context, {
    module: MODULE,
    entityType: ENTITY,
    entityId: opportunityId,
    action: "SALES_OPPORTUNITY_STAGE_CHANGED",
    message: `moved the opportunity from ${from} to ${to}`,
    metadata: changeMetadata({ stage: { from, to } }),
  });
}

async function recordAssignment(
  tx: Prisma.TransactionClient,
  context: UserContext,
  opportunityId: string,
  ownerMemberId: string,
): Promise<void> {
  const owner = await tx.companyMember.findUnique({
    where: { id: ownerMemberId },
    select: { user: { select: { firstName: true, lastName: true } } },
  });

  await recordActivity(tx, context, {
    module: MODULE,
    entityType: ENTITY,
    entityId: opportunityId,
    action: "SALES_OPPORTUNITY_ASSIGNED",
    message: owner
      ? `assigned the opportunity to ${owner.user.firstName} ${owner.user.lastName}`
      : "reassigned the opportunity",
    metadata: { ownerMemberId } as Prisma.InputJsonValue,
  });
}

function assertCanAssign(context: UserContext): void {
  if (can(context, "sales.owner.assign")) return;
  assertPermission(context, "sales.opportunity.assign");
}

/**
 * Every related record an opportunity names (PRD #17 §77, §219, §220).
 *
 * All three are looked up *inside the caller's own scope*, so an unreachable
 * record reads as "does not exist" rather than being quietly accepted — and a
 * contact that belongs to a different client is refused outright.
 */
async function validateRelationships(
  context: UserContext,
  input: CreateOpportunityInput | UpdateOpportunityInput,
) {
  const ownerMemberId = await resolveOwner(context, input.ownerMemberId);

  if (!input.clientId) return { ownerMemberId, clientId: null, contactId: null };

  const clientId = await resolveClient(context, input.clientId);
  if (!input.contactId) return { ownerMemberId, clientId, contactId: null };

  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, companyId: context.companyId, archivedAt: null },
    select: { id: true, clientId: true },
  });
  if (!contact) throw new AccessError("VALIDATION_ERROR", "That contact does not exist.");

  if (contact.clientId !== clientId) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That contact belongs to a different client.",
    );
  }

  return { ownerMemberId, clientId, contactId: contact.id };
}

async function resolveOwner(context: UserContext, ownerMemberId: string): Promise<string> {
  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildSalesOwnerWhere(context), { id: ownerMemberId }] },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That owner is not an active member of this company.");
  }
  return member.id;
}

async function resolveClient(context: UserContext, clientId: string): Promise<string> {
  assertPermission(context, "client.view");

  const client = await prisma.client.findFirst({
    where: { AND: [buildSalesClientWhere(context), { id: clientId }] },
    select: { id: true },
  });

  if (!client) throw new AccessError("VALIDATION_ERROR", "That client does not exist.");
  return client.id;
}

async function resolveProject(
  context: UserContext,
  projectId: string,
): Promise<{ id: string; clientId: string | null }> {
  assertPermission(context, "project.view");

  const project = await prisma.project.findFirst({
    where: { AND: [buildSalesProjectWhere(context), { id: projectId }] },
    select: { id: true, clientId: true },
  });

  if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.");
  return project;
}

function newClientInput(name: string): CreateClientInput {
  return {
    code: undefined,
    name,
    legalName: undefined,
    type: "COMPANY",
    status: "ACTIVE",
    email: undefined,
    phone: undefined,
    website: undefined,
    address: undefined,
    city: undefined,
    country: undefined,
    contactFirstName: undefined,
    contactLastName: undefined,
    contactJobTitle: undefined,
    contactEmail: undefined,
    contactPhone: undefined,
    // The duplicate check already ran in front of the user, on the dialog that
    // offered to create this client (PRD #17 §158).
    acceptDuplicate: true,
  };
}

function opportunityData(input: CreateOpportunityInput | UpdateOpportunityInput) {
  return {
    name: input.name,
    estimatedValue: new Prisma.Decimal(input.estimatedValue),
    currency: input.currency,
    probabilityOverride:
      input.probabilityOverride === undefined
        ? null
        : new Prisma.Decimal(input.probabilityOverride),
    expectedCloseDate: input.expectedCloseDate ?? null,
    description: input.description ?? null,
    nextStep: input.nextStep ?? null,
  };
}

export function toSummaryDTO(row: repository.OpportunityRow): OpportunitySummaryDTO {
  const probability = effectiveProbability(row.stage, row.probabilityOverride);

  return {
    id: row.id,
    name: row.name,
    client: row.client,
    owner: toMemberRef(row.owner)!,
    stage: row.stage,
    estimatedValue: toAmountString(row.estimatedValue),
    currency: row.currency,
    probability: probability.toFixed(0),
    probabilityIsOverride: row.probabilityOverride !== null,
    weightedValue: toAmountString(weightedValue(row.estimatedValue, probability)),
    expectedCloseDate: row.expectedCloseDate ? businessDateString(row.expectedCloseDate) : null,
    nextStep: row.nextStep,
    // Derived, never stored: an opportunity does not change when a date passes
    // (PRD #17 §405).
    expectedCloseOverdue:
      !isClosedStage(row.stage) &&
      row.expectedCloseDate !== null &&
      row.expectedCloseDate.getTime() < Date.now(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, row: repository.OpportunityDetailRow) {
  const archived = row.archivedAt !== null;
  const open = !isClosedStage(row.stage) && !archived;

  return {
    canEdit: open && can(context, "sales.opportunity.update"),
    canAssign:
      open && (can(context, "sales.opportunity.assign") || can(context, "sales.owner.assign")),
    canChangeStage: open && can(context, "sales.opportunity.stage.update"),
    canMarkWon: open && can(context, "sales.opportunity.mark_won"),
    canMarkLost: open && can(context, "sales.opportunity.mark_lost"),
    canReopen: row.stage === "LOST" && !archived && can(context, "sales.opportunity.reopen"),
    canArchive: !archived && row.stage !== "WON" && can(context, "sales.opportunity.archive"),
    canRestore: archived && can(context, "sales.opportunity.restore"),
    // A proposal needs a client to be addressed to (PRD #17 §110).
    canCreateProposal:
      open && row.clientId !== null && can(context, "sales.proposal.create"),
    canLinkProject:
      row.stage === "WON" &&
      row.convertedProjectId === null &&
      can(context, "sales.project.convert"),
    canViewActivity: can(context, "sales.activity.view"),
    canViewDocuments: can(context, "sales.document.view") && can(context, "document.view"),
    canViewTasks: can(context, "sales.task.view") && can(context, "task.view"),
  };
}
