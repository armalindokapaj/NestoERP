import { Prisma, type ClientStatus, type ClientType, type ContactStatus } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission, stateDenied } from "@/lib/access/guards";
import { can, isModuleEnabled } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import * as repository from "./client.repository";
import {
  findPossibleDuplicates,
  normalizeName,
  type DuplicateCheckInput,
  type DuplicateMatch,
} from "./client.duplicate";
import type {
  CreateClientInput,
  CreateContactInput,
  ClientListQuery,
  UpdateClientInput,
  UpdateContactInput,
} from "./client.schema";
import {
  canTransitionClientStatus,
  canTransitionContactStatus,
  isClientArchived,
  isContactArchived,
} from "./client.status";
import type {
  ClientActivityDTO,
  ClientDetailDTO,
  ClientOverviewStats,
  ClientSummaryDTO,
  ContactDTO,
} from "./client.types";

/**
 * Clients service (PRD #12 §109, §127).
 *
 * Every entry point runs the same sequence: module enabled → permission →
 * scope → validate related records belong to this company → mutate in a
 * transaction → record activity. Nothing here trusts a field from the browser:
 * `companyId`, `createdBy`, `archivedAt` and `preArchiveStatus` come from the
 * server (PRD #12 §123, §124).
 */

const MODULE = "clients" as const;
const CLIENT_ENTITY = "Client";
const CONTACT_ENTITY = "Contact";

/** Thrown when a soft duplicate needs a person's judgement (PRD #12 §53). */
export class DuplicateClientError extends AccessError {
  readonly matches: DuplicateMatch[];

  constructor(matches: DuplicateMatch[]) {
    super("CONFLICT", "A similar client already exists.", matches);
    this.name = "DuplicateClientError";
    this.matches = matches;
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listClients(context: UserContext, query: ClientListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "client.view");

  const { rows, total } = await repository.listClients(context, query);

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getClient(
  context: UserContext,
  clientId: string,
): Promise<ClientDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "client.view");

  // Outside scope answers "not found", so the response cannot confirm that a
  // client the user may not see exists (PRD #12 §129).
  const client = assertFound(await repository.findClientInScope(context, clientId));
  const counts = await repository.clientCounts(context, clientId);

  return toDetailDTO(context, client, counts);
}

export async function getClientOverview(context: UserContext): Promise<ClientOverviewStats> {
  assertModule(context, MODULE);
  assertPermission(context, "client.view");
  return repository.clientOverviewStats(context);
}

export async function listClientProjects(context: UserContext, clientId: string) {
  assertModule(context, MODULE);
  assertPermission(context, "client.project.view");
  assertPermission(context, "project.view");
  await assertClientInScope(context, clientId);

  return repository.listClientProjects(context, clientId);
}

export async function listActivity(
  context: UserContext,
  clientId: string,
  options: { page: number; limit: number },
) {
  assertModule(context, MODULE);
  assertPermission(context, "client.activity.view");
  await assertClientInScope(context, clientId);

  // Finance activity about a shared client must not reach an Architect simply
  // because they can open the client (PRD #12 §102).
  const modules = Object.values(context.moduleAccess)
    .filter((access) => access.enabled && access.accessLevel !== "NONE")
    .map((access) => access.module as string);

  const { rows, total } = await repository.listClientActivity(context, clientId, {
    ...options,
    modules,
  });

  const data: ClientActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    actorMemberId: row.actorMemberId,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: paginationMeta(total, options.page, options.limit) };
}

export async function checkDuplicates(
  context: UserContext,
  input: DuplicateCheckInput,
): Promise<DuplicateMatch[]> {
  assertModule(context, MODULE);
  assertPermission(context, "client.view");
  return findPossibleDuplicates(context, input);
}

/* -------------------------------------------------------------------------- */
/* Client writes                                                               */
/* -------------------------------------------------------------------------- */

export async function createClient(
  context: UserContext,
  input: CreateClientInput,
): Promise<ClientDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "client.create");

  if (!input.acceptDuplicate) {
    const matches = await findPossibleDuplicates(context, {
      name: input.name,
      legalName: input.legalName,
      email: input.email,
      phone: input.phone,
    });
    if (matches.length > 0) throw new DuplicateClientError(matches);
  }

  const created = await prisma
    .$transaction((tx) => createClientRecord(tx, context, input))
    .catch(translateWriteError);

  return getClient(context, created.id);
}

/**
 * Creating the canonical client, inside somebody else's transaction
 * (PRD #12 §50, PRD #17 §54, §259, §260).
 *
 * Sales converts a lead into a Client and an Opportunity together, and either
 * both land or neither does. Rather than a second client-creation path living
 * in Sales, the conversion calls this — the same insert, the same normalised
 * name, the same activity entry — with its own transaction handle.
 *
 * The permission is asserted here rather than only in the caller, so a future
 * caller cannot reach the insert without it.
 */
export async function createClientRecord(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: CreateClientInput,
): Promise<{ id: string; name: string }> {
  assertPermission(context, "client.create");

  const client = await tx.client.create({
    data: {
      companyId: context.companyId,
      ...clientData(input),
      normalizedName: normalizeName(input.name),
      createdBy: context.userId,
    },
    select: { id: true, name: true },
  });

  await recordActivity(tx, context, {
    module: MODULE,
    entityType: CLIENT_ENTITY,
    entityId: client.id,
    action: "CLIENT_CREATED",
    message: "created the client",
    metadata: { clientId: client.id } as Prisma.InputJsonValue,
  });

  // The optional primary contact is created in the same transaction, so a
  // client is never left half-made (PRD #12 §50).
  if (input.contactFirstName && input.contactLastName) {
    assertPermission(context, "contact.create");

    const contact = await tx.contact.create({
      data: {
        companyId: context.companyId,
        clientId: client.id,
        firstName: input.contactFirstName,
        lastName: input.contactLastName,
        jobTitle: input.contactJobTitle ?? null,
        email: input.contactEmail ?? null,
        phone: input.contactPhone ?? null,
        isPrimary: true,
        status: "ACTIVE",
        createdBy: context.userId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: CONTACT_ENTITY,
      entityId: contact.id,
      action: "CONTACT_CREATED",
      message: "added the primary contact",
      metadata: { clientId: client.id, contactId: contact.id } as Prisma.InputJsonValue,
    });
  }

  return client;
}

/** The duplicate check Sales runs before it offers to create a client (PRD #17 §158). */
export { findPossibleDuplicates, normalizeName };

export async function updateClient(
  context: UserContext,
  clientId: string,
  input: UpdateClientInput,
): Promise<ClientDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "client.update");

  const existing = assertFound(await repository.findClientInScope(context, clientId));

  // An archived client is read-only: it must be restored first (PRD #12 §68).
  if (isClientArchived(existing)) {
    throw new AccessError("CONFLICT", "Restore this client before editing it.");
  }

  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This client was updated by another user. Refresh and review the latest changes.",
    );
  }

  const nextStatus = input.status as ClientStatus;
  if (!canTransitionClientStatus(existing.status, nextStatus)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A client cannot move from ${existing.status} to ${nextStatus}.`,
    );
  }

  const identityChanged =
    input.name !== existing.name ||
    (input.legalName ?? null) !== existing.legalName ||
    (input.email ?? null) !== existing.email ||
    (input.phone ?? null) !== existing.phone;

  if (identityChanged && !input.acceptDuplicate) {
    const matches = await findPossibleDuplicates(context, {
      name: input.name,
      legalName: input.legalName,
      email: input.email,
      phone: input.phone,
      excludeClientId: clientId,
    });
    if (matches.length > 0) throw new DuplicateClientError(matches);
  }

  await prisma
    .$transaction(async (tx) => {
      await tx.client.update({
        where: { id: clientId },
        data: {
          ...clientData(input),
          normalizedName: normalizeName(input.name),
          updatedBy: context.userId,
        },
      });

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: CLIENT_ENTITY,
        entityId: clientId,
        action: "CLIENT_UPDATED",
        message: "updated the client",
        metadata: { clientId } as Prisma.InputJsonValue,
      });

      if (existing.status !== nextStatus) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: CLIENT_ENTITY,
          entityId: clientId,
          action: "CLIENT_STATUS_CHANGED",
          message: `changed the status from ${existing.status} to ${nextStatus}`,
          metadata: {
            clientId,
            ...(changeMetadata({ status: { from: existing.status, to: nextStatus } }) as object),
          } as Prisma.InputJsonValue,
        });
      }
    })
    .catch(translateWriteError);

  return getClient(context, clientId);
}

export async function archiveClient(context: UserContext, clientId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "client.archive");

  const existing = assertFound(await repository.findClientInScope(context, clientId));
  if (isClientArchived(existing)) {
    throw new AccessError("CONFLICT", "This client is already archived.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: {
        preArchiveStatus: existing.status,
        status: "ARCHIVED",
        archivedAt: new Date(),
        archivedBy: context.userId,
        updatedBy: context.userId,
      },
    });

    // Archiving a client alters nothing else: its projects, contacts and
    // documents stay exactly as they are (PRD #12 §72, §73).
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: CLIENT_ENTITY,
      entityId: clientId,
      action: "CLIENT_ARCHIVED",
      message: "archived the client",
      metadata: { clientId, preArchiveStatus: existing.status } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.CLIENT_ARCHIVED,
        entity: { type: CLIENT_ENTITY, id: clientId, label: existing.name },
        before: { status: existing.status, archivedAt: null },
        after: { status: "ARCHIVED" },
      },
      { tx },
    );
  });
}

export async function restoreClient(context: UserContext, clientId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "client.restore");

  const existing = assertFound(await repository.findClientInScope(context, clientId));
  if (!isClientArchived(existing)) {
    throw new AccessError("CONFLICT", "This client is not archived.");
  }

  const restored = existing.preArchiveStatus ?? "ACTIVE";

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: {
        status: restored,
        preArchiveStatus: null,
        archivedAt: null,
        archivedBy: null,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: CLIENT_ENTITY,
      entityId: clientId,
      action: "CLIENT_RESTORED",
      message: "restored the client",
      metadata: { clientId, status: restored } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.CLIENT_RESTORED,
        entity: { type: CLIENT_ENTITY, id: clientId, label: existing.name },
        before: { status: "ARCHIVED" },
        after: { status: restored, archivedAt: null },
      },
      { tx },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

export async function listContacts(
  context: UserContext,
  clientId: string,
  options: { archived?: boolean } = {},
): Promise<ContactDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "contact.view");
  await assertClientInScope(context, clientId);

  const rows = await repository.listContacts(context, clientId, options);
  return rows.map(toContactDTO);
}

export async function createContact(
  context: UserContext,
  clientId: string,
  input: CreateContactInput,
): Promise<ContactDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "contact.create");

  const client = assertFound(await repository.findClientInScope(context, clientId));
  if (isClientArchived(client)) {
    throw new AccessError("CONFLICT", "Restore this client before adding contacts.");
  }

  const contact = await prisma.$transaction(async (tx) => {
    if (input.isPrimary) await clearPrimary(tx, context, clientId, null);

    const created = await tx.contact.create({
      data: {
        companyId: context.companyId,
        clientId,
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        isPrimary: Boolean(input.isPrimary),
        status: input.status as ContactStatus,
        createdBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: CONTACT_ENTITY,
      entityId: created.id,
      action: "CONTACT_CREATED",
      message: `added ${created.firstName} ${created.lastName} as a contact`,
      metadata: { clientId, contactId: created.id } as Prisma.InputJsonValue,
    });

    return created;
  });

  return toContactDTO(contact);
}

export async function updateContact(
  context: UserContext,
  clientId: string,
  contactId: string,
  input: UpdateContactInput,
): Promise<ContactDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "contact.update");
  await assertClientWritable(context, clientId);

  const existing = assertFound(await repository.findContact(context, clientId, contactId));
  if (isContactArchived(existing)) {
    throw new AccessError("CONFLICT", "Restore this contact before editing it.");
  }

  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This contact was updated by another user. Refresh and review the latest changes.",
    );
  }

  const nextStatus = input.status as ContactStatus;
  if (!canTransitionContactStatus(existing.status, nextStatus)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A contact cannot move from ${existing.status} to ${nextStatus}.`,
    );
  }

  const becomingPrimary = Boolean(input.isPrimary) && !existing.isPrimary;

  const contact = await prisma.$transaction(async (tx) => {
    if (becomingPrimary) await clearPrimary(tx, context, clientId, contactId);

    const updated = await tx.contact.update({
      where: { id: contactId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        isPrimary: Boolean(input.isPrimary),
        status: nextStatus,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: CONTACT_ENTITY,
      entityId: contactId,
      action: "CONTACT_UPDATED",
      message: `updated ${updated.firstName} ${updated.lastName}`,
      metadata: { clientId, contactId } as Prisma.InputJsonValue,
    });

    if (becomingPrimary) {
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: CONTACT_ENTITY,
        entityId: contactId,
        action: "CONTACT_PRIMARY_CHANGED",
        message: `made ${updated.firstName} ${updated.lastName} the primary contact`,
        metadata: { clientId, contactId } as Prisma.InputJsonValue,
      });
    }

    return updated;
  });

  return toContactDTO(contact);
}

/** Switching the primary contact is one transaction (PRD #12 §84, §164). */
export async function makePrimaryContact(
  context: UserContext,
  clientId: string,
  contactId: string,
): Promise<ContactDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "contact.update");
  await assertClientWritable(context, clientId);

  const existing = assertFound(await repository.findContact(context, clientId, contactId));
  if (isContactArchived(existing)) {
    throw new AccessError("CONFLICT", "An archived contact cannot be the primary contact.");
  }
  if (existing.isPrimary) {
    throw new AccessError("CONFLICT", "This contact is already the primary contact.");
  }

  const contact = await prisma.$transaction(async (tx) => {
    await clearPrimary(tx, context, clientId, contactId);

    const updated = await tx.contact.update({
      where: { id: contactId },
      data: { isPrimary: true, updatedBy: context.userId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: CONTACT_ENTITY,
      entityId: contactId,
      action: "CONTACT_PRIMARY_CHANGED",
      message: `made ${updated.firstName} ${updated.lastName} the primary contact`,
      metadata: { clientId, contactId } as Prisma.InputJsonValue,
    });

    return updated;
  });

  return toContactDTO(contact);
}

export async function archiveContact(
  context: UserContext,
  clientId: string,
  contactId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "contact.archive");
  await assertClientWritable(context, clientId);

  const existing = assertFound(await repository.findContact(context, clientId, contactId));
  if (isContactArchived(existing)) {
    throw new AccessError("CONFLICT", "This contact is already archived.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: contactId },
      data: {
        preArchiveStatus: existing.status,
        status: "ARCHIVED",
        // A client may be left without a primary contact rather than having one
        // chosen for it (PRD #12 §87).
        isPrimary: false,
        archivedAt: new Date(),
        archivedBy: context.userId,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: CONTACT_ENTITY,
      entityId: contactId,
      action: "CONTACT_ARCHIVED",
      message: `archived ${existing.firstName} ${existing.lastName}`,
      metadata: { clientId, contactId } as Prisma.InputJsonValue,
    });
  });
}

export async function restoreContact(
  context: UserContext,
  clientId: string,
  contactId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "contact.restore");
  await assertClientWritable(context, clientId);

  const existing = assertFound(await repository.findContact(context, clientId, contactId));
  if (!isContactArchived(existing)) {
    throw new AccessError("CONFLICT", "This contact is not archived.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: contactId },
      data: {
        status: existing.preArchiveStatus ?? "ACTIVE",
        preArchiveStatus: null,
        archivedAt: null,
        archivedBy: null,
        // Restoring never re-takes the primary slot; the user chooses
        // explicitly (PRD #12 §88).
        isPrimary: false,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: CONTACT_ENTITY,
      entityId: contactId,
      action: "CONTACT_RESTORED",
      message: `restored ${existing.firstName} ${existing.lastName}`,
      metadata: { clientId, contactId } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Stands down whichever contact currently holds the primary slot.
 *
 * A client may have at most one, and the switch happens inside the caller's
 * transaction so two simultaneous promotions cannot both win (PRD #12 §83,
 * §84, §164).
 */
async function clearPrimary(
  tx: Prisma.TransactionClient,
  context: UserContext,
  clientId: string,
  exceptContactId: string | null,
): Promise<void> {
  await tx.contact.updateMany({
    where: {
      companyId: context.companyId,
      clientId,
      isPrimary: true,
      ...(exceptContactId ? { id: { not: exceptContactId } } : {}),
    },
    data: { isPrimary: false, updatedBy: context.userId },
  });
}

async function assertClientInScope(context: UserContext, clientId: string): Promise<void> {
  if (!(await repository.clientInScopeExists(context, clientId))) {
    throw new AccessError("NOT_FOUND");
  }
}

/**
 * The client, in scope and not archived, before any change to its contacts.
 *
 * An archived client is read-only, and its contacts are part of that record:
 * editing, promoting, archiving or restoring one would change a client that has
 * to be restored first — the same rule `createContact` already applies
 * (PRD #12 §60, PRD #47 §87).
 */
async function assertClientWritable(context: UserContext, clientId: string): Promise<void> {
  const client = assertFound(await repository.findClientInScope(context, clientId));
  if (isClientArchived(client)) {
    throw stateDenied("Restore this client before changing its contacts.");
  }
}

function clientData(input: CreateClientInput | UpdateClientInput) {
  return {
    code: input.code ?? null,
    name: input.name,
    legalName: input.legalName ?? null,
    type: input.type as ClientType,
    email: input.email ?? null,
    phone: input.phone ?? null,
    website: input.website ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
    status: input.status as ClientStatus,
  };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // The database is the final authority on client-code uniqueness; a
    // front-end check is a courtesy, not a guarantee (PRD #12 §163).
    if (error.code === "P2002") {
      throw new AccessError("CONFLICT", "That client code is already used in your company.");
    }
    if (error.code === "P2003") {
      throw new AccessError("VALIDATION_ERROR", "A related record could not be found.");
    }
  }
  throw error;
}

/* -------------------------------------------------------------------------- */
/* DTO mapping                                                                 */
/* -------------------------------------------------------------------------- */

function contactSummary(
  rows: { id: string; firstName: string; lastName: string; jobTitle: string | null; email: string | null; phone: string | null }[],
) {
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    fullName: `${row.firstName} ${row.lastName}`,
    jobTitle: row.jobTitle,
    email: row.email,
    phone: row.phone,
  };
}

export function toSummaryDTO(row: repository.ClientSummaryRow): ClientSummaryDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    legalName: row.legalName,
    type: row.type,
    status: row.status,
    primaryContact: contactSummary(row.contacts),
    activeProjectsCount: row.activeProjectsCount,
    country: row.country,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetailDTO(
  context: UserContext,
  row: repository.ClientDetailRow,
  counts: { visibleProjects: number; visibleDocuments: number; activeContacts: number },
): ClientDetailDTO {
  const archived = isClientArchived(row);
  const primary = row.contacts[0] ?? null;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    legalName: row.legalName,
    type: row.type,
    status: row.status,
    preArchiveStatus: row.preArchiveStatus,
    contact: { email: row.email, phone: row.phone, website: row.website },
    address: { address: row.address, city: row.city, country: row.country },
    primaryContact: primary
      ? {
          id: primary.id,
          fullName: `${primary.firstName} ${primary.lastName}`,
          jobTitle: primary.jobTitle,
          email: primary.email,
          phone: primary.phone,
          status: primary.status,
        }
      : null,
    counts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: {
      canEdit: !archived && can(context, "client.update"),
      canArchive: !archived && can(context, "client.archive"),
      canRestore: archived && can(context, "client.restore"),
      canViewContacts: can(context, "contact.view"),
      canManageContacts: !archived && can(context, "contact.create"),
      canViewProjects: can(context, "client.project.view") && can(context, "project.view"),
      canViewDocuments: can(context, "client.document.view") && can(context, "document.view"),
      canViewActivity: can(context, "client.activity.view"),
    /**
     * The client Finance tab needs client access *and* a finance permission
     * that has something to show about a client — which is invoices and what
     * is outstanding on them (PRD #15 §185, §186). Generic client access is
     * never enough.
     */
    canViewFinance:
      can(context, "finance.view") &&
      (can(context, "finance.invoice.view") || can(context, "finance.receivables.view")),
    /**
     * The client Sales tab needs client access *and* Sales access to the deals
     * behind it (PRD #17 §266, §414). Generic client access is never enough —
     * and what the tab then shows is still narrowed by the Sales scope, so the
     * counts on it are the reader's own.
     */
    canViewSales: can(context, "sales.view") && can(context, "sales.opportunity.view"),
    /**
     * The client Contracts tab needs client access *and* legal access to the
     * agreements behind it (PRD #18 §10, §251). Client access alone never
     * reaches a contract — that separation is the point: somebody who can open
     * a customer record has not thereby been told what the company agreed to
     * pay its subcontractor on that customer's job.
     *
     * A company with the module switched off has no tab at all (PRD #18 §518).
     */
    canViewContracts:
      isModuleEnabled(context, "contracts") &&
      can(context, "legal.view") &&
      can(context, "legal.contract.view"),
    },
  };
}

export function toContactDTO(row: repository.ContactRow): ContactDTO {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`,
    jobTitle: row.jobTitle,
    email: row.email,
    phone: row.phone,
    isPrimary: row.isPrimary,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
