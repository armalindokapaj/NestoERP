import { Prisma, type LeadStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import { createClientRecord } from "@/lib/modules/clients/client.service";
import type { CreateClientInput } from "@/lib/modules/clients/client.schema";
import { loadMemberRef, toMemberRef } from "../sales.dto";
import { buildSalesOwnerWhere } from "../sales.scope";
import type { LeadDetailDTO, LeadDuplicateMatch, LeadSummaryDTO } from "../sales.types";
import { findLeadDuplicates } from "./lead.duplicate";
import * as repository from "./lead.repository";
import type {
  ConvertLeadInput,
  CreateLeadInput,
  LeadListQuery,
  UpdateLeadInput,
} from "./lead.schema";
import {
  canTransitionLeadStatus,
  isLeadArchivable,
  isLeadConvertible,
  isLeadEditable,
} from "./lead.status";

/**
 * Leads (PRD #17 §32–§58).
 *
 * Three rules are enforced here and nowhere else:
 *
 *   1. **A lead is not a client.** Nothing in this file writes a customer
 *      record of its own; conversion calls the Clients service, in the same
 *      transaction, so there is one canonical customer (PRD #17 §4, §54).
 *   2. **Conversion happens once.** The status check and the write are the same
 *      conditional update, so two people converting at the same moment produce
 *      one opportunity and one conflict (PRD #17 §56, §255).
 *   3. **A converted lead is history.** It records what the company knew before
 *      the opportunity existed, and editing it afterwards would rewrite where
 *      the deal came from (PRD #17 §234).
 */

const MODULE = "sales" as const;
const ENTITY = "Lead";

/** Thrown when a soft duplicate needs a person's judgement (PRD #17 §44). */
export class DuplicateLeadError extends AccessError {
  readonly matches: LeadDuplicateMatch[];

  constructor(matches: LeadDuplicateMatch[]) {
    super("CONFLICT", "A similar lead or client already exists.", matches);
    this.name = "DuplicateLeadError";
    this.matches = matches;
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listLeads(context: UserContext, query: LeadListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "sales.lead.view");

  const { rows, total } = await repository.listLeads(context, query);

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getLead(context: UserContext, leadId: string): Promise<LeadDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.lead.view");

  // Out of scope answers "not found", so the response cannot confirm that a
  // lead exists to somebody who may not open it (PRD #17 §226).
  const lead = assertFound(await repository.findLeadInScope(context, leadId));
  const createdBy = await loadMemberRef(lead.createdByMemberId);

  return {
    ...toSummaryDTO(lead),
    website: lead.website,
    notes: lead.notes,
    disqualifyReason: lead.disqualifyReason,
    convertedAt: lead.convertedAt?.toISOString() ?? null,
    convertedOpportunity: lead.convertedOpportunity,
    convertedClient: lead.convertedClient,
    archivedAt: lead.archivedAt?.toISOString() ?? null,
    createdBy,
    createdAt: lead.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, lead),
  };
}

export async function leadFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "sales.lead.view");
  return repository.leadFilterOptions(context);
}

export async function checkLeadDuplicates(
  context: UserContext,
  input: Parameters<typeof findLeadDuplicates>[1],
): Promise<LeadDuplicateMatch[]> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.lead.view");
  return findLeadDuplicates(context, input);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createLead(
  context: UserContext,
  input: CreateLeadInput,
  options: { acceptDuplicate?: boolean } = {},
): Promise<LeadDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.lead.create");

  const ownerMemberId = await resolveOwner(context, input.ownerMemberId);

  if (!options.acceptDuplicate) {
    const matches = await findLeadDuplicates(context, {
      email: input.email,
      phone: input.phone,
      name: input.name,
      companyName: input.companyName,
    });
    if (matches.length > 0) throw new DuplicateLeadError(matches);
  }

  const leadId = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        companyId: context.companyId,
        ...leadData(input),
        ownerMemberId,
        status: "NEW",
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: lead.id,
      action: "SALES_LEAD_CREATED",
      message: `created the lead ${input.name}`,
      metadata: { source: input.source } as Prisma.InputJsonValue,
    });

    return lead.id;
  });

  return getLead(context, leadId);
}

export async function updateLead(
  context: UserContext,
  leadId: string,
  input: UpdateLeadInput,
): Promise<LeadDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.lead.update");

  const existing = assertFound(await repository.findLeadInScope(context, leadId));

  if (!isLeadEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      existing.status === "CONVERTED"
        ? "This lead has been converted. It stays as the record of where the opportunity came from."
        : "An archived lead must be restored before it can be edited.",
    );
  }

  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This lead was updated by another user. Refresh and review the latest changes.",
    );
  }

  // Reassigning through the edit form needs the assignment grant, not only the
  // edit one: who works a deal is a management decision (PRD #17 §47).
  const ownerChanged = (input.ownerMemberId ?? null) !== existing.ownerMemberId;
  if (ownerChanged) assertCanAssign(context, "sales.lead.assign");
  const ownerMemberId = await resolveOwner(context, input.ownerMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: { ...leadData(input), ownerMemberId, updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leadId,
      action: "SALES_LEAD_UPDATED",
      message: `updated the lead ${input.name}`,
      metadata: changeMetadata({ name: { from: existing.name, to: input.name } }),
    });

    if (ownerChanged) await recordAssignment(tx, context, leadId, ownerMemberId);
  });

  return getLead(context, leadId);
}

export async function assignLead(
  context: UserContext,
  leadId: string,
  ownerMemberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertCanAssign(context, "sales.lead.assign");

  const existing = assertFound(await repository.findLeadInScope(context, leadId));
  if (!isLeadEditable(existing.status)) {
    throw new AccessError("CONFLICT", "This lead can no longer be reassigned.");
  }

  const owner = await resolveOwner(context, ownerMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: { ownerMemberId: owner, updatedByMemberId: context.membershipId },
    });
    await recordAssignment(tx, context, leadId, owner);
  });
}

export async function markLeadContacted(context: UserContext, leadId: string): Promise<void> {
  await moveLeadStatus(context, leadId, "CONTACTED", {
    permission: "sales.lead.update",
    action: "SALES_LEAD_CONTACTED",
    message: (name) => `recorded contact with ${name}`,
  });
}

export async function qualifyLead(context: UserContext, leadId: string): Promise<void> {
  await moveLeadStatus(context, leadId, "QUALIFIED", {
    permission: "sales.lead.qualify",
    action: "SALES_LEAD_QUALIFIED",
    message: (name) => `qualified the lead ${name}`,
  });
}

export async function disqualifyLead(
  context: UserContext,
  leadId: string,
  reason: string,
): Promise<void> {
  await moveLeadStatus(context, leadId, "DISQUALIFIED", {
    permission: "sales.lead.disqualify",
    action: "SALES_LEAD_DISQUALIFIED",
    message: (name) => `disqualified the lead ${name}`,
    data: { disqualifyReason: reason },
    metadata: { reason },
  });
}

/**
 * Lead → Opportunity, and optionally → Client (PRD #17 §51–§56, §255, §260).
 *
 * Everything lands in one transaction: the client if one is being created, the
 * opportunity, the lead's new status and all three activity entries. A
 * conversion that created a client and then failed to create the opportunity
 * would leave a customer nobody asked for (PRD #17 §260).
 *
 * The lead's status change is a conditional update checked by row count, so a
 * second conversion — a double-clicked button, or two people at once — is
 * refused rather than producing a second opportunity (PRD #17 §56).
 */
export async function convertLead(
  context: UserContext,
  leadId: string,
  input: ConvertLeadInput,
): Promise<{ opportunityId: string; clientId: string | null }> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.lead.convert");

  const existing = assertFound(await repository.findLeadInScope(context, leadId));

  if (!isLeadConvertible(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      existing.status === "CONVERTED"
        ? "This lead has already been converted."
        : "Only a qualified lead can be converted. Qualify it first.",
    );
  }

  const ownerMemberId = await resolveOwner(context, input.ownerMemberId);
  if (!ownerMemberId) {
    throw new AccessError("VALIDATION_ERROR", "An opportunity needs an owner.");
  }

  // Both halves of the decision, checked before anything is written
  // (PRD #17 §53, §54, §395, §397).
  if (input.clientMode !== "NONE") {
    assertPermission(context, "sales.client.convert");
  }

  let existingClientId: string | null = null;
  if (input.clientMode === "EXISTING") {
    existingClientId = await resolveClient(context, input.clientId!);
  }

  if (input.clientMode === "NEW" && !input.acceptDuplicate) {
    const matches = await findLeadDuplicates(context, {
      email: existing.email ?? undefined,
      name: input.newClientName,
      companyName: input.newClientName,
      excludeLeadId: leadId,
    });
    const clientMatches = matches.filter((match) => match.kind === "CLIENT");
    if (clientMatches.length > 0) throw new DuplicateLeadError(clientMatches);
  }

  return prisma.$transaction(async (tx) => {
    let clientId = existingClientId;

    if (input.clientMode === "NEW") {
      // The canonical Clients service, inside this transaction: Sales never
      // writes a customer table of its own (PRD #17 §54, §154).
      const client = await createClientRecord(tx, context, clientFromLead(existing, input));
      clientId = client.id;
    }

    const opportunity = await tx.opportunity.create({
      data: {
        companyId: context.companyId,
        name: input.opportunityName,
        clientId,
        ownerMemberId,
        stage: "QUALIFIED",
        stageChangedAt: new Date(),
        estimatedValue: new Prisma.Decimal(input.estimatedValue),
        currency: input.currency,
        expectedCloseDate: input.expectedCloseDate ?? null,
        sourceLeadId: leadId,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    // Conditional on the status we read: a second conversion finds no row to
    // update and is refused (PRD #17 §56, §255).
    const moved = await tx.lead.updateMany({
      where: { id: leadId, status: "QUALIFIED" },
      data: {
        status: "CONVERTED",
        convertedAt: new Date(),
        convertedClientId: clientId,
        updatedByMemberId: context.membershipId,
      },
    });

    if (moved.count === 0) {
      throw new AccessError("CONFLICT", "This lead has already been converted.");
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leadId,
      action: "SALES_LEAD_CONVERTED",
      message: `converted the lead ${existing.name} into an opportunity`,
      metadata: {
        opportunityId: opportunity.id,
        clientId,
        clientMode: input.clientMode,
      } as Prisma.InputJsonValue,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "Opportunity",
      entityId: opportunity.id,
      action: "SALES_OPPORTUNITY_CREATED",
      message: `created ${input.opportunityName} from the lead ${existing.name}`,
      metadata: { leadId, clientId } as Prisma.InputJsonValue,
    });

    return { opportunityId: opportunity.id, clientId };
  });
}

export async function archiveLead(context: UserContext, leadId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.lead.archive");

  const existing = assertFound(await repository.findLeadInScope(context, leadId));

  if (!isLeadArchivable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      existing.status === "QUALIFIED"
        ? "Disqualify this lead first, so the reason it went nowhere is recorded."
        : "A converted lead stays visible as the record of where the opportunity came from.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        status: "ARCHIVED",
        // Remembered so restore returns the lead to where it was rather than to
        // a status somebody picked (PRD #17 §58).
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leadId,
      action: "SALES_LEAD_ARCHIVED",
      message: `archived the lead ${existing.name}`,
    });
  });
}

export async function restoreLead(context: UserContext, leadId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "sales.lead.restore");

  const existing = assertFound(await repository.findLeadInScope(context, leadId));
  if (existing.status !== "ARCHIVED") {
    throw new AccessError("CONFLICT", "This lead is not archived.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        status: existing.preArchiveStatus ?? "NEW",
        preArchiveStatus: null,
        archivedAt: null,
        archivedByMemberId: null,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leadId,
      action: "SALES_LEAD_RESTORED",
      message: `restored the lead ${existing.name}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

type StatusMove = {
  permission: Parameters<typeof assertPermission>[1];
  action: string;
  message: (name: string) => string;
  data?: Prisma.LeadUpdateManyMutationInput;
  metadata?: Record<string, unknown>;
};

async function moveLeadStatus(
  context: UserContext,
  leadId: string,
  next: LeadStatus,
  move: StatusMove,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, move.permission);

  const existing = assertFound(await repository.findLeadInScope(context, leadId));

  if (!canTransitionLeadStatus(existing.status, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A lead cannot move from ${existing.status} to ${next}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Conditional on the status we read, so two people acting at once cannot
    // both win (PRD #17 §255).
    const result = await tx.lead.updateMany({
      where: { id: leadId, status: existing.status },
      data: { status: next, updatedByMemberId: context.membershipId, ...(move.data ?? {}) },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "This lead changed while you were working on it.");
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leadId,
      action: move.action,
      message: move.message(existing.name),
      metadata: move.metadata as Prisma.InputJsonValue | undefined,
    });
  });
}

async function recordAssignment(
  tx: Prisma.TransactionClient,
  context: UserContext,
  leadId: string,
  ownerMemberId: string | null,
): Promise<void> {
  const owner = ownerMemberId
    ? await tx.companyMember.findUnique({
        where: { id: ownerMemberId },
        select: { user: { select: { firstName: true, lastName: true } } },
      })
    : null;

  await recordActivity(tx, context, {
    module: MODULE,
    entityType: ENTITY,
    entityId: leadId,
    action: "SALES_LEAD_ASSIGNED",
    message: owner
      ? `assigned the lead to ${owner.user.firstName} ${owner.user.lastName}`
      : "removed the lead's owner",
    metadata: { ownerMemberId } as Prisma.InputJsonValue,
  });
}

/** Either grant opens the assignment door (PRD #17 §47). */
function assertCanAssign(
  context: UserContext,
  specific: Parameters<typeof assertPermission>[1],
): void {
  if (can(context, "sales.owner.assign")) return;
  assertPermission(context, specific);
}

/**
 * The owner must be an active member of *this* company (PRD #17 §43, §220).
 *
 * Looked up rather than trusted: an id from a form is a claim, and a Company B
 * membership is exactly the claim this refuses.
 */
async function resolveOwner(
  context: UserContext,
  ownerMemberId: string | undefined,
): Promise<string | null> {
  if (!ownerMemberId) return null;

  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildSalesOwnerWhere(context), { id: ownerMemberId }] },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That owner is not an active member of this company.");
  }
  return member.id;
}

/** The client must be inside the caller's own Clients scope (PRD #17 §53, §218). */
async function resolveClient(context: UserContext, clientId: string): Promise<string> {
  assertPermission(context, "client.view");

  const { buildSalesClientWhere } = await import("../sales.scope");
  const client = await prisma.client.findFirst({
    where: { AND: [buildSalesClientWhere(context), { id: clientId }] },
    select: { id: true },
  });

  if (!client) throw new AccessError("VALIDATION_ERROR", "That client does not exist.");
  return client.id;
}

/**
 * The canonical client a lead becomes (PRD #17 §155–§158).
 *
 * A lead with a company name is that company, and the person named on the lead
 * becomes its primary contact. A lead without one is an individual, and there
 * is no second person to record (PRD #17 §156, §157).
 *
 * `acceptDuplicate` is true because the duplicate check already ran, in front
 * of the user, before the conversion dialog was confirmed.
 */
function clientFromLead(
  lead: repository.LeadDetailRow,
  input: ConvertLeadInput,
): CreateClientInput {
  const isCompany = Boolean(lead.companyName);
  const parts = lead.name.trim().split(/\s+/);
  const hasContactName = isCompany && parts.length >= 2;

  return {
    code: undefined,
    name: input.newClientName!,
    legalName: undefined,
    type: isCompany ? "COMPANY" : "INDIVIDUAL",
    status: "ACTIVE",
    email: lead.email ?? undefined,
    phone: lead.phone ?? undefined,
    website: lead.website ?? undefined,
    address: undefined,
    city: undefined,
    country: undefined,
    contactFirstName: hasContactName ? parts[0] : undefined,
    contactLastName: hasContactName ? parts.slice(1).join(" ") : undefined,
    contactJobTitle: undefined,
    contactEmail: hasContactName ? (lead.email ?? undefined) : undefined,
    contactPhone: hasContactName ? (lead.phone ?? undefined) : undefined,
    acceptDuplicate: true,
  };
}

function leadData(input: CreateLeadInput | UpdateLeadInput) {
  const amount = Number.parseFloat(input.estimatedValue ?? "0");
  return {
    name: input.name,
    companyName: input.companyName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    website: input.website ?? null,
    source: input.source,
    notes: input.notes ?? null,
    // A zero estimate is "no estimate", not "a deal worth nothing": storing it
    // as null keeps it out of every pipeline total (PRD #17 §31).
    estimatedValue: amount > 0 ? new Prisma.Decimal(input.estimatedValue!) : null,
    currency: amount > 0 ? (input.currency ?? null) : null,
  };
}

export function toSummaryDTO(row: repository.LeadRow): LeadSummaryDTO {
  return {
    id: row.id,
    name: row.name,
    companyName: row.companyName,
    email: row.email,
    phone: row.phone,
    source: row.source,
    status: row.status,
    owner: toMemberRef(row.owner),
    estimatedValue: row.estimatedValue ? toAmountString(row.estimatedValue) : null,
    currency: row.currency,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, lead: repository.LeadDetailRow) {
  const archived = lead.status === "ARCHIVED";
  const editable = isLeadEditable(lead.status);
  const open = lead.status === "NEW" || lead.status === "CONTACTED";

  return {
    canEdit: editable && can(context, "sales.lead.update"),
    canAssign:
      editable && (can(context, "sales.lead.assign") || can(context, "sales.owner.assign")),
    canQualify: open && can(context, "sales.lead.qualify"),
    canDisqualify:
      (open || lead.status === "QUALIFIED") && can(context, "sales.lead.disqualify"),
    canMarkContacted: lead.status === "NEW" && can(context, "sales.lead.update"),
    canConvert: isLeadConvertible(lead.status) && can(context, "sales.lead.convert"),
    canArchive: !archived && isLeadArchivable(lead.status) && can(context, "sales.lead.archive"),
    canRestore: archived && can(context, "sales.lead.restore"),
    canViewActivity: can(context, "sales.activity.view"),
    canViewDocuments: can(context, "sales.document.view") && can(context, "document.view"),
  };
}
