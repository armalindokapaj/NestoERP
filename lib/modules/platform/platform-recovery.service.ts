import type { CompanyStatus, ParentGroupStatus, Prisma } from "@prisma/client";

import type { PlatformPermission } from "@/config/platform";
import { AccessError, assertFound } from "@/lib/access/guards";
import { revokeSessions } from "@/lib/auth/session-store";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordGlobalPlatformAction, recordPlatformAction } from "@/lib/core/audit/audit.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";

/**
 * Platform Recovery: deleting a company or a group, bringing it back, removing
 * it for good, and restoring documents.
 *
 * Deleting is a status, not a removal. A deleted tenant keeps every row and its
 * pre-delete status, so signing in stops at once (the usable-status checks
 * already refuse anything but ACTIVE) and a restore returns it exactly as it
 * was. `purgeAfter` says when it becomes eligible for permanent removal; the
 * purge itself is its own action behind a typed-name confirmation and never
 * runs by itself.
 */
import { RECOVERY_RETENTION_DAYS } from "./recovery-constants";

export { RECOVERY_RETENTION_DAYS };
const DAY_MS = 24 * 60 * 60 * 1000;

function assertPlatform(context: PlatformContext, permission: PlatformPermission): void {
  if (!canPlatform(context, permission)) throw new AccessError("FORBIDDEN");
}

function assertUpdated(result: { count: number }): void {
  if (result.count !== 1) throw new AccessError("CONFLICT", "The record changed while you were working. Refresh and try again.");
}

function assertConfirmed(name: string, typed: string): void {
  if (typed.trim() !== name.trim()) throw new AccessError("VALIDATION_ERROR", "Type the name exactly to confirm.", { confirmationName: ["Type the name exactly as shown."] });
}

const REAL_GROUP = { isTestFixture: false } as const;

/* -------------------------------------------------------------------------- */
/* Delete                                                                      */
/* -------------------------------------------------------------------------- */

export async function deleteCompany(context: PlatformContext, companyId: string, input: { reason: string; confirmationName: string }): Promise<void> {
  assertPlatform(context, "platform.company.delete");
  const company = assertFound(await prisma.company.findFirst({ where: { id: companyId, parentGroup: REAL_GROUP }, select: { id: true, name: true, status: true, parentGroupId: true, parentGroup: { select: { status: true } } } }));
  if (company.status === "DELETED") throw new AccessError("CONFLICT", "This company is already deleted.");
  if (company.parentGroup.status === "DELETED") throw new AccessError("CONFLICT", "Its group is deleted. Restore the group first.");
  assertConfirmed(company.name, input.confirmationName);

  const now = new Date();
  const purgeAfter = new Date(now.getTime() + RECOVERY_RETENTION_DAYS * DAY_MS);
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.company.updateMany({
      where: { id: company.id, status: company.status },
      data: { status: "DELETED", statusBeforeDelete: company.status, deletedAt: now, deletedByUserId: context.userId, deleteReason: input.reason, deletedWithGroup: false, purgeAfter, configVersion: { increment: 1 } },
    }));
    await revokeSessions(tx, { companyId: company.id, relocate: true });
    await recordPlatformAction(context, company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_COMPANY_DELETED,
      entity: { type: "Company", id: company.id, label: company.name },
      before: { status: company.status },
      after: { status: "DELETED", deletedAt: now.toISOString(), purgeAfter: purgeAfter.toISOString() },
      reason: input.reason,
    }, { tx, companyId: company.id });
  });
}

export async function deleteGroup(context: PlatformContext, groupId: string, input: { reason: string; confirmationName: string }): Promise<void> {
  assertPlatform(context, "platform.group.delete");
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: groupId, kind: "GROUP", ...REAL_GROUP }, select: { id: true, name: true, status: true, companies: { where: { status: { not: "DELETED" } }, select: { id: true, status: true } } } }));
  if (group.status === "DELETED") throw new AccessError("CONFLICT", "This group is already deleted.");
  assertConfirmed(group.name, input.confirmationName);

  const now = new Date();
  const purgeAfter = new Date(now.getTime() + RECOVERY_RETENTION_DAYS * DAY_MS);
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.parentGroup.updateMany({
      where: { id: group.id, status: group.status },
      data: { status: "DELETED", statusBeforeDelete: group.status, deletedAt: now, deletedByUserId: context.userId, deleteReason: input.reason, purgeAfter },
    }));
    // Each company remembers its own status; the flag lets a group restore bring back exactly these.
    for (const company of group.companies) {
      assertUpdated(await tx.company.updateMany({
        where: { id: company.id, status: company.status },
        data: { status: "DELETED", statusBeforeDelete: company.status, deletedAt: now, deletedByUserId: context.userId, deleteReason: input.reason, deletedWithGroup: true, purgeAfter, configVersion: { increment: 1 } },
      }));
    }
    await revokeSessions(tx, { parentGroupId: group.id });
    await recordPlatformAction(context, group.id, {
      actionKey: AuditAction.PLATFORM_GROUP_DELETED,
      entity: { type: "ParentGroup", id: group.id, label: group.name },
      before: { status: group.status },
      after: { status: "DELETED", deletedAt: now.toISOString(), purgeAfter: purgeAfter.toISOString(), companies: group.companies.length },
      reason: input.reason,
    }, { tx });
  });
}

/* -------------------------------------------------------------------------- */
/* Restore                                                                     */
/* -------------------------------------------------------------------------- */

export async function restoreCompany(context: PlatformContext, companyId: string, reason: string): Promise<void> {
  assertPlatform(context, "platform.recovery.restore");
  const company = assertFound(await prisma.company.findFirst({ where: { id: companyId, parentGroup: REAL_GROUP }, select: { id: true, name: true, status: true, statusBeforeDelete: true, parentGroupId: true, parentGroup: { select: { status: true } } } }));
  if (company.status !== "DELETED") throw new AccessError("CONFLICT", "This company is not deleted.");
  if (company.parentGroup.status === "DELETED") throw new AccessError("CONFLICT", "Its group is deleted. Restore the group and its companies come back with it.", { code: "GROUP_DELETED" });
  const status: CompanyStatus = company.statusBeforeDelete && company.statusBeforeDelete !== "DELETED" ? company.statusBeforeDelete : "ACTIVE";
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.company.updateMany({ where: { id: company.id, status: "DELETED" }, data: clearCompanyDeletion(status) }));
    await recordPlatformAction(context, company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_COMPANY_RESTORED,
      entity: { type: "Company", id: company.id, label: company.name },
      before: { status: "DELETED" },
      after: { status },
      reason,
    }, { tx, companyId: company.id });
  });
}

export async function restoreGroup(context: PlatformContext, groupId: string, reason: string): Promise<void> {
  assertPlatform(context, "platform.recovery.restore");
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: groupId, kind: "GROUP", ...REAL_GROUP }, select: { id: true, name: true, status: true, statusBeforeDelete: true, companies: { where: { status: "DELETED", deletedWithGroup: true }, select: { id: true, statusBeforeDelete: true } } } }));
  if (group.status !== "DELETED") throw new AccessError("CONFLICT", "This group is not deleted.");
  const status: ParentGroupStatus = group.statusBeforeDelete && group.statusBeforeDelete !== "DELETED" ? group.statusBeforeDelete : "ACTIVE";
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.parentGroup.updateMany({
      where: { id: group.id, status: "DELETED" },
      data: { status, statusBeforeDelete: null, deletedAt: null, deletedByUserId: null, deleteReason: null, purgeAfter: null },
    }));
    for (const company of group.companies) {
      assertUpdated(await tx.company.updateMany({ where: { id: company.id, status: "DELETED" }, data: clearCompanyDeletion(company.statusBeforeDelete && company.statusBeforeDelete !== "DELETED" ? company.statusBeforeDelete : "ACTIVE") }));
    }
    await recordPlatformAction(context, group.id, {
      actionKey: AuditAction.PLATFORM_GROUP_RESTORED,
      entity: { type: "ParentGroup", id: group.id, label: group.name },
      before: { status: "DELETED" },
      after: { status, companies: group.companies.length },
      reason,
    }, { tx });
  });
}

function clearCompanyDeletion(status: CompanyStatus): Prisma.CompanyUpdateManyMutationInput {
  return { status, statusBeforeDelete: null, deletedAt: null, deletedByUserId: null, deleteReason: null, deletedWithGroup: false, purgeAfter: null, configVersion: { increment: 1 } };
}

/* -------------------------------------------------------------------------- */
/* Permanent removal                                                           */
/* -------------------------------------------------------------------------- */

/** A company is purged alone, so its rows go and its group stays; a standalone company's private root goes with it. */
export async function purgeCompany(context: PlatformContext, companyId: string, input: { reason: string; confirmationName: string }): Promise<void> {
  assertPlatform(context, "platform.recovery.purge");
  const company = assertFound(await prisma.company.findFirst({ where: { id: companyId, parentGroup: REAL_GROUP }, select: { id: true, name: true, status: true, deletedWithGroup: true, parentGroupId: true, parentGroup: { select: { kind: true, status: true, _count: { select: { companies: true } } } } } }));
  if (company.status !== "DELETED") throw new AccessError("CONFLICT", "Only a deleted company can be removed permanently. Delete it first.");
  if (company.deletedWithGroup || company.parentGroup.status === "DELETED") throw new AccessError("CONFLICT", "This company was deleted with its group. Remove the group to remove it.", { code: "GROUP_DELETED" });
  assertConfirmed(company.name, input.confirmationName);
  const groupIds = company.parentGroup.kind === "STANDALONE" && company.parentGroup._count.companies === 1 ? [company.parentGroupId] : [];
  await purge(context, { kind: "Company", id: company.id, name: company.name, reason: input.reason, companyIds: [company.id], groupIds });
}

export async function purgeGroup(context: PlatformContext, groupId: string, input: { reason: string; confirmationName: string }): Promise<void> {
  assertPlatform(context, "platform.recovery.purge");
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: groupId, kind: "GROUP", ...REAL_GROUP }, select: { id: true, name: true, status: true, companies: { select: { id: true, status: true } } } }));
  if (group.status !== "DELETED") throw new AccessError("CONFLICT", "Only a deleted group can be removed permanently. Delete it first.");
  assertConfirmed(group.name, input.confirmationName);
  const live = group.companies.filter((company) => company.status !== "DELETED");
  if (live.length) throw new AccessError("CONFLICT", "The group still has companies that are not deleted.");
  await purge(context, { kind: "Group", id: group.id, name: group.name, reason: input.reason, companyIds: group.companies.map((company) => company.id), groupIds: [group.id] });
}

async function purge(context: PlatformContext, target: { kind: "Company" | "Group"; id: string; name: string; reason: string; companyIds: string[]; groupIds: string[] }): Promise<void> {
  const keys = await storedObjectKeys(target.companyIds);
  await prisma.$transaction(async (tx) => {
    try {
      await tx.$queryRaw`SELECT platform_purge_tenants(${target.companyIds}::text[], ${target.groupIds}::text[])`;
    } catch (error) {
      logger.error("platform.recovery.purge_failed", { target: target.id, ...serialiseError(error) });
      throw new AccessError("CONFLICT", "The permanent removal could not be completed, so nothing was removed. The database role may not be allowed to disable foreign-key checks.", { code: "PURGE_FAILED" });
    }
    // The tenant's own audit trail goes with it, so the removal is written where it survives.
    await recordGlobalPlatformAction(context, {
      actionKey: target.kind === "Company" ? AuditAction.PLATFORM_COMPANY_PURGED : AuditAction.PLATFORM_GROUP_PURGED,
      entity: { type: target.kind === "Company" ? "Company" : "ParentGroup", id: target.id, label: target.name },
      before: { status: "DELETED" },
      after: { status: "PURGED", companies: target.companyIds.length },
      reason: target.reason,
    }, { tx });
  }, { timeout: 120_000, maxWait: 10_000 });
  await removeStoredObjects(keys);
}

async function storedObjectKeys(companyIds: string[]): Promise<string[]> {
  if (!companyIds.length) return [];
  const [documents, versions, models] = await Promise.all([
    prisma.document.findMany({ where: { companyId: { in: companyIds } }, select: { storageKey: true, previewStorageKey: true, thumbnailStorageKey: true } }),
    prisma.documentVersion.findMany({ where: { companyId: { in: companyIds } }, select: { storageKey: true } }),
    prisma.project3DModelVersion.findMany({ where: { companyId: { in: companyIds } }, select: { sourceStorageKey: true, runtimeStorageKey: true } }),
  ]);
  const keys = new Set<string>();
  for (const row of documents) for (const key of [row.storageKey, row.previewStorageKey, row.thumbnailStorageKey]) if (key) keys.add(key);
  for (const row of versions) if (row.storageKey) keys.add(row.storageKey);
  for (const row of models) for (const key of [row.sourceStorageKey, row.runtimeStorageKey]) if (key) keys.add(key);
  return [...keys];
}

/** After the rows are gone: a failure leaves an unreferenced object for the storage sweep, never a half-removed tenant. */
async function removeStoredObjects(keys: string[]): Promise<void> {
  const provider = storageProvider();
  for (const key of keys) {
    try {
      await provider.deleteObject(key);
    } catch (error) {
      logger.warn("platform.recovery.object_not_removed", { key, ...serialiseError(error) });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Deleted tenants                                                             */
/* -------------------------------------------------------------------------- */

export type DeletedTenantDTO = {
  kind: "Group" | "Company";
  id: string;
  name: string;
  /** The group a company belonged to, or the group's company count. */
  detail: string;
  deletedAt: string;
  deletedBy: string | null;
  reason: string | null;
  purgeAfter: string | null;
  /** The standing it returns to. */
  returnsAs: string;
  /** A company deleted with its group comes back with the group. */
  viaGroup: boolean;
};

export async function listDeletedTenants(context: PlatformContext): Promise<DeletedTenantDTO[]> {
  assertPlatform(context, "platform.recovery.view");
  const [groups, companies] = await Promise.all([
    prisma.parentGroup.findMany({ where: { status: "DELETED", kind: "GROUP", ...REAL_GROUP }, select: { id: true, name: true, deletedAt: true, deletedByUserId: true, deleteReason: true, purgeAfter: true, statusBeforeDelete: true, _count: { select: { companies: true } } } }),
    prisma.company.findMany({ where: { status: "DELETED", parentGroup: REAL_GROUP }, select: { id: true, name: true, deletedAt: true, deletedByUserId: true, deleteReason: true, purgeAfter: true, statusBeforeDelete: true, deletedWithGroup: true, parentGroup: { select: { name: true, kind: true } } } }),
  ]);
  const userIds = [...new Set([...groups, ...companies].map((row) => row.deletedByUserId).filter((id): id is string => Boolean(id)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const who = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));
  const rows: DeletedTenantDTO[] = [
    ...groups.map((row) => ({ kind: "Group" as const, id: row.id, name: row.name, detail: `${row._count.companies} ${row._count.companies === 1 ? "company" : "companies"}`, deletedAt: (row.deletedAt ?? new Date(0)).toISOString(), deletedBy: row.deletedByUserId ? who.get(row.deletedByUserId) ?? null : null, reason: row.deleteReason, purgeAfter: row.purgeAfter?.toISOString() ?? null, returnsAs: row.statusBeforeDelete ?? "ACTIVE", viaGroup: false })),
    ...companies.map((row) => ({ kind: "Company" as const, id: row.id, name: row.name, detail: row.parentGroup.kind === "STANDALONE" ? "Standalone" : row.parentGroup.name, deletedAt: (row.deletedAt ?? new Date(0)).toISOString(), deletedBy: row.deletedByUserId ? who.get(row.deletedByUserId) ?? null : null, reason: row.deleteReason, purgeAfter: row.purgeAfter?.toISOString() ?? null, returnsAs: row.statusBeforeDelete ?? "ACTIVE", viaGroup: row.deletedWithGroup })),
  ];
  return rows.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export type ArchivedDocumentDTO = {
  id: string;
  name: string;
  company: { id: string; name: string };
  sizeBytes: number | null;
  archivedAt: string | null;
  archivedBy: string | null;
};

export const ARCHIVED_DOCUMENT_PAGE_SIZE = 50;

/** Archived documents of every live company, newest archive first. A deleted company's files come back with it. */
export async function listArchivedDocuments(context: PlatformContext, query: { q?: string; companyId?: string; page?: number }): Promise<{ rows: ArchivedDocumentDTO[]; total: number; page: number; pages: number }> {
  assertPlatform(context, "platform.recovery.view");
  const q = query.q?.trim();
  const where: Prisma.DocumentWhereInput = {
    OR: [{ status: "ARCHIVED" }, { archivedAt: { not: null } }],
    company: { status: { not: "DELETED" }, parentGroup: REAL_GROUP },
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(q ? { AND: [{ OR: [{ name: { contains: q, mode: "insensitive" } }, { originalFileName: { contains: q, mode: "insensitive" } }] }] } : {}),
  };
  const total = await prisma.document.count({ where });
  const pages = Math.max(1, Math.ceil(total / ARCHIVED_DOCUMENT_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const rows = await prisma.document.findMany({
    where,
    orderBy: [{ archivedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    skip: (page - 1) * ARCHIVED_DOCUMENT_PAGE_SIZE,
    take: ARCHIVED_DOCUMENT_PAGE_SIZE,
    select: { id: true, name: true, sizeBytes: true, archivedAt: true, archivedBy: true, company: { select: { id: true, name: true } } },
  });
  const userIds = [...new Set(rows.map((row) => row.archivedBy).filter((id): id is string => Boolean(id)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const who = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));
  return {
    total, page, pages,
    rows: rows.map((row) => ({ id: row.id, name: row.name, company: row.company, sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes), archivedAt: row.archivedAt?.toISOString() ?? null, archivedBy: row.archivedBy ? who.get(row.archivedBy) ?? null : null })),
  };
}

/**
 * Brings an archived document back for its company. The object was never
 * removed by archiving, so the file is exactly what it was; the document
 * returns to the status it held before the archive.
 */
export async function restoreArchivedDocument(context: PlatformContext, documentId: string, reason: string): Promise<void> {
  assertPlatform(context, "platform.recovery.restore");
  const document = assertFound(await prisma.document.findFirst({ where: { id: documentId, company: { parentGroup: REAL_GROUP } }, select: { id: true, name: true, status: true, archivedAt: true, preArchiveStatus: true, storageStatus: true, companyId: true, company: { select: { status: true, parentGroupId: true } } } }));
  if (document.status !== "ARCHIVED" && !document.archivedAt) throw new AccessError("CONFLICT", "This document is not archived.");
  if (document.company.status === "DELETED") throw new AccessError("CONFLICT", "Its company is deleted. Restore the company and its documents come back with it.", { code: "COMPANY_DELETED" });
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.document.updateMany({
      where: { id: document.id, status: document.status, storageStatus: document.storageStatus },
      data: { status: document.preArchiveStatus ?? "ACTIVE", storageStatus: "AVAILABLE", preArchiveStatus: null, archivedAt: null, archivedBy: null, updatedBy: context.userId },
    }));
    await recordPlatformAction(context, document.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_DOCUMENT_RESTORED,
      entity: { type: "Document", id: document.id, label: document.name },
      before: { documentId: document.id, companyId: document.companyId, status: document.status, storageStatus: document.storageStatus, archivedAt: document.archivedAt?.toISOString() ?? null },
      after: { documentId: document.id, companyId: document.companyId, status: document.preArchiveStatus ?? "ACTIVE", storageStatus: "AVAILABLE", archivedAt: null },
      reason,
    }, { tx, companyId: document.companyId });
  });
}

/* -------------------------------------------------------------------------- */
/* Project media                                                               */
/* -------------------------------------------------------------------------- */

export type RemovedMediaDTO = {
  /** The audit event that recorded the removal: what a restore is made from. */
  eventId: string;
  title: string;
  type: string;
  project: { id: string; name: string };
  company: { id: string; name: string };
  removedAt: string;
  removedBy: string | null;
};

type RemovedMediaEvidence = { documentId?: unknown; type?: unknown; title?: unknown; isCover?: unknown };

/**
 * Media taken off a project keeps its document, and the removal event keeps the
 * rest, so the link can be made again. An event is offered while the document
 * is still ACTIVE and not already linked to that project.
 */
export async function listRemovedProjectMedia(context: PlatformContext): Promise<RemovedMediaDTO[]> {
  assertPlatform(context, "platform.recovery.view");
  const events = await prisma.auditEvent.findMany({
    where: { actionKey: AuditAction.PROJECT_MEDIA_CHANGED, projectId: { not: null }, companyId: { not: null }, beforeJson: { path: ["change"], equals: "removed" }, company: { status: { not: "DELETED" }, parentGroup: REAL_GROUP } },
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    take: 200,
    select: { id: true, occurredAt: true, actorDisplayNameSnapshot: true, companyId: true, projectId: true, beforeJson: true, company: { select: { id: true, name: true } } },
  });
  const evidence = events.flatMap((event) => {
    const before = event.beforeJson as RemovedMediaEvidence | null;
    return before && typeof before.documentId === "string" && event.projectId && event.company ? [{ event, documentId: before.documentId, before }] : [];
  });
  if (!evidence.length) return [];
  const [documents, linked, projects] = await Promise.all([
    prisma.document.findMany({ where: { id: { in: evidence.map((row) => row.documentId) }, status: "ACTIVE" }, select: { id: true } }),
    prisma.projectMedia.findMany({ where: { documentId: { in: evidence.map((row) => row.documentId) } }, select: { projectId: true, documentId: true } }),
    prisma.project.findMany({ where: { id: { in: [...new Set(evidence.map((row) => row.event.projectId!))] }, archivedAt: null }, select: { id: true, name: true } }),
  ]);
  const live = new Set(documents.map((row) => row.id));
  const taken = new Set(linked.map((row) => `${row.projectId}:${row.documentId}`));
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const seen = new Set<string>();
  const rows: RemovedMediaDTO[] = [];
  for (const { event, documentId, before } of evidence) {
    const key = `${event.projectId}:${documentId}`;
    // Newest first: only the latest removal of the same file is offered.
    if (seen.has(key)) continue;
    seen.add(key);
    if (!live.has(documentId) || taken.has(key) || !names.has(event.projectId!)) continue;
    rows.push({ eventId: event.id, title: typeof before.title === "string" ? before.title : "Untitled media", type: typeof before.type === "string" ? before.type : "RENDER", project: { id: event.projectId!, name: names.get(event.projectId!)! }, company: event.company!, removedAt: event.occurredAt.toISOString(), removedBy: event.actorDisplayNameSnapshot });
  }
  return rows;
}

const MEDIA_TYPES = ["RENDER", "ANIMATION"] as const;

export async function restoreRemovedProjectMedia(context: PlatformContext, eventId: string, reason: string): Promise<void> {
  assertPlatform(context, "platform.recovery.restore");
  const event = assertFound(await prisma.auditEvent.findFirst({ where: { id: eventId, actionKey: AuditAction.PROJECT_MEDIA_CHANGED, beforeJson: { path: ["change"], equals: "removed" }, company: { parentGroup: REAL_GROUP } }, select: { id: true, companyId: true, projectId: true, actorMemberId: true, beforeJson: true, company: { select: { status: true, parentGroupId: true } } } }));
  const before = (event.beforeJson ?? {}) as RemovedMediaEvidence;
  if (!event.companyId || !event.projectId || !event.company || typeof before.documentId !== "string") throw new AccessError("NOT_FOUND");
  if (event.company.status === "DELETED") throw new AccessError("CONFLICT", "Its company is deleted. Restore the company first.", { code: "COMPANY_DELETED" });
  const { companyId, projectId, documentId } = { companyId: event.companyId, projectId: event.projectId, documentId: before.documentId };
  const [project, document, existing] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, companyId, archivedAt: null }, select: { id: true, name: true } }),
    prisma.document.findFirst({ where: { id: documentId, companyId, status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.projectMedia.findFirst({ where: { projectId, documentId }, select: { id: true } }),
  ]);
  if (!project) throw new AccessError("CONFLICT", "The project is archived or gone, so its media cannot be restored.");
  if (!document) throw new AccessError("CONFLICT", "The file is archived or gone. Restore the document first.");
  if (existing) throw new AccessError("CONFLICT", "This file is already part of the project's media.");
  const type = MEDIA_TYPES.find((value) => value === before.type) ?? "RENDER";
  const last = await prisma.projectMedia.aggregate({ where: { companyId, projectId }, _max: { sortOrder: true } });
  await prisma.$transaction(async (tx) => {
    const media = await tx.projectMedia.create({
      // Not the cover: another image may have taken that place since the removal.
      data: { companyId, projectId, documentId, type, title: typeof before.title === "string" ? before.title : document.name, sortOrder: (last._max.sortOrder ?? -1) + 1, createdByMemberId: event.actorMemberId ?? "platform" },
      select: { id: true },
    });
    await recordPlatformAction(context, event.company!.parentGroupId, {
      actionKey: AuditAction.PROJECT_MEDIA_CHANGED,
      entity: { type: "Project", id: project.id, label: project.name },
      projectId: project.id,
      after: { change: "restored", mediaId: media.id, documentId, type, title: typeof before.title === "string" ? before.title : document.name },
      reason,
    }, { tx, companyId });
  });
}

/* -------------------------------------------------------------------------- */
/* 3D experiences                                                              */
/* -------------------------------------------------------------------------- */

export type DeletedExperienceDTO = {
  projectId: string;
  name: string;
  company: { id: string; name: string };
  deletedAt: string;
  purgeAfter: string | null;
  controlVersion: number;
  /** Past its window or already claimed by the purge: the files are going or gone. */
  restorable: boolean;
};

/** Deleted 3D experiences; restoring one is the existing 3D lifecycle action, which owns its rules. */
export async function listDeletedExperiences(context: PlatformContext): Promise<DeletedExperienceDTO[]> {
  assertPlatform(context, "platform.recovery.view");
  const rows = await prisma.project3DConfig.findMany({
    where: { deletedAt: { not: null }, OR: [{ purgeStatus: null }, { purgeStatus: { in: ["SCHEDULED", "FAILED"] } }], company: { status: { not: "DELETED" }, parentGroup: REAL_GROUP } },
    orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
    take: 200,
    select: { projectId: true, experienceName: true, deletedAt: true, purgeAfter: true, controlVersion: true, company: { select: { id: true, name: true } }, project: { select: { name: true } } },
  });
  const now = new Date();
  return rows.map((row) => ({
    projectId: row.projectId,
    name: row.experienceName || `${row.project.name} 3D Experience`,
    company: row.company,
    deletedAt: (row.deletedAt ?? now).toISOString(),
    purgeAfter: row.purgeAfter?.toISOString() ?? null,
    controlVersion: row.controlVersion,
    restorable: !row.purgeAfter || row.purgeAfter > now,
  }));
}
