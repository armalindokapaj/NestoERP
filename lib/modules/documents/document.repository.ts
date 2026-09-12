import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { extensionsForGroups, type FileTypeGroup } from "./document.files";
import { buildDocumentAccessWhere } from "./document.parent-access";
import type { DocumentListQuery, DocumentSortKey } from "./document.schema";

/**
 * Database access for Documents (PRD #13 §130, §133).
 *
 * Every query starts from `buildDocumentAccessWhere`, which is where parent
 * access is enforced. A repository function that took the caller's word for
 * scope would be one refactor away from leaking a file (PRD #13 §134).
 */

const SORT_ORDER: Record<DocumentSortKey, Prisma.DocumentOrderByWithRelationInput[]> = {
  "updated-desc": [{ updatedAt: "desc" }],
  "created-desc": [{ createdAt: "desc" }],
  "name-asc": [{ name: "asc" }],
  "name-desc": [{ name: "desc" }],
  "size-desc": [{ sizeBytes: { sort: "desc", nulls: "last" } }],
  "size-asc": [{ sizeBytes: { sort: "asc", nulls: "last" } }],
  "type-asc": [{ extension: "asc" }, { name: "asc" }],
};

const SUMMARY_SELECT = {
  id: true,
  name: true,
  originalFileName: true,
  extension: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  /// The storage lifecycle is separate from the business status, and the list
  /// needs both: a document can be ACTIVE and still not downloadable
  /// (PRD #29 §2, §162).
  storageStatus: true,
  scanStatus: true,
  previewStatus: true,
  module: true,
  entityType: true,
  entityId: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  client: { select: { id: true, name: true } },
  uploadedBy: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.DocumentSelect;

export type DocumentSummaryRow = Prisma.DocumentGetPayload<{ select: typeof SUMMARY_SELECT }>;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  description: true,
  preArchiveStatus: true,
  storageKey: true,
  storageProvider: true,
  storageBucket: true,
  detectedMimeType: true,
  checksum: true,
  fileName: true,
  scanProvider: true,
  scanCompletedAt: true,
  previewMimeType: true,
  previewStorageKey: true,
  thumbnailStorageKey: true,
  uploadedAt: true,
  verifiedAt: true,
  availableAt: true,
  rejectedAt: true,
  rejectionReason: true,
  uploadedByMemberId: true,
  projectId: true,
  clientId: true,
  archivedAt: true,
} satisfies Prisma.DocumentSelect;

export type DocumentDetailRow = Prisma.DocumentGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * Builds the full `where` for a list request.
 *
 * Order: company + parent access → archive state → search → filters
 * (PRD #13 §133).
 */
export function buildDocumentListWhere(
  context: UserContext,
  query: DocumentListQuery,
): Prisma.DocumentWhereInput {
  const filters: Prisma.DocumentWhereInput[] = [buildDocumentAccessWhere(context)];

  filters.push(
    query.archived
      ? { OR: [{ archivedAt: { not: null } }, { status: "ARCHIVED" }] }
      : { archivedAt: null, status: { not: "ARCHIVED" } },
  );

  if (query.mine) filters.push({ uploadedByMemberId: context.membershipId });

  const search = searchClause(query.search, ["name", "originalFileName", "description"]);
  if (search) {
    const term = query.search!.trim();
    // Project and client names are searchable, but only through the graph the
    // access clause already allows — so a name the reader cannot reach never
    // surfaces one of its files (PRD #13 §76).
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.DocumentWhereInput),
        { project: { name: { contains: term, mode: "insensitive" } } },
        { client: { name: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  if (query.fileType?.length) {
    filters.push({ extension: { in: extensionsForGroups(query.fileType as FileTypeGroup[]) } });
  }

  if (query.context?.length) {
    const branches: Prisma.DocumentWhereInput[] = [];
    for (const kind of query.context) {
      if (kind === "project") branches.push({ projectId: { not: null } });
      if (kind === "client") branches.push({ projectId: null, clientId: { not: null } });
      if (kind === "task") branches.push({ entityType: "task" });
      if (kind === "company") {
        branches.push({ projectId: null, clientId: null, entityType: null });
      }
    }
    if (branches.length > 0) filters.push({ OR: branches });
  }

  if (query.moduleKey) filters.push({ module: query.moduleKey });
  if (query.entityType) filters.push({ entityType: query.entityType });
  if (query.entityId) filters.push({ entityId: query.entityId });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.clientId) filters.push({ clientId: query.clientId });
  if (query.uploadedByMemberId) filters.push({ uploadedByMemberId: query.uploadedByMemberId });

  const range: Prisma.DateTimeFilter = {};
  if (query.dateFrom) range.gte = query.dateFrom;
  if (query.dateTo) range.lte = query.dateTo;
  if (Object.keys(range).length > 0) filters.push({ createdAt: range });

  return { AND: filters };
}

export async function listDocuments(context: UserContext, query: DocumentListQuery) {
  const where = buildDocumentListWhere(context, query);

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: SORT_ORDER[query.sort],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
    }),
    prisma.document.count({ where }),
  ]);

  return { rows, total };
}

/**
 * A single document, already narrowed by the same access clause the list uses.
 *
 * The clause covers project, client, task and company shapes; anything with an
 * unregistered parent falls outside it and answers "not found", which is the
 * fail-closed behaviour the registry promises (PRD #13 §45, §149).
 */
export async function findDocumentInScope(
  context: UserContext,
  documentId: string,
): Promise<DocumentDetailRow | null> {
  return prisma.document.findFirst({
    where: { AND: [buildDocumentAccessWhere(context), { id: documentId }] },
    select: DETAIL_SELECT,
  });
}

export async function listDocumentActivity(
  context: UserContext,
  documentId: string,
  options: { page: number; limit: number },
) {
  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    entityType: "Document",
    entityId: documentId,
  };

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: skipFor(options.page, options.limit),
      take: options.limit,
      select: {
        id: true,
        action: true,
        message: true,
        createdAt: true,
        actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.activity.count({ where }),
  ]);

  return { rows, total };
}

/** The overview counters, all counted in the database under access (PRD #13 §167). */
export async function documentOverviewStats(context: UserContext) {
  const access = buildDocumentAccessWhere(context);
  const live: Prisma.DocumentWhereInput = {
    AND: [access, { archivedAt: null, status: { not: "ARCHIVED" } }],
  };

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [visible, addedThisMonth, projectDocuments, archived] = await Promise.all([
    prisma.document.count({ where: live }),
    prisma.document.count({ where: { AND: [live, { createdAt: { gte: monthStart } }] } }),
    prisma.document.count({ where: { AND: [live, { projectId: { not: null } }] } }),
    prisma.document.count({
      where: { AND: [access, { OR: [{ archivedAt: { not: null } }, { status: "ARCHIVED" }] }] },
    }),
  ]);

  return { visible, addedThisMonth, projectDocuments, archived };
}

export async function recentDocuments(context: UserContext, take = 6) {
  return prisma.document.findMany({
    where: {
      AND: [buildDocumentAccessWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }],
    },
    select: SUMMARY_SELECT,
    orderBy: { updatedAt: "desc" },
    take,
  });
}

export async function myRecentUploads(context: UserContext, take = 6) {
  return prisma.document.findMany({
    where: {
      AND: [
        buildDocumentAccessWhere(context),
        { archivedAt: null, status: { not: "ARCHIVED" } },
        { uploadedByMemberId: context.membershipId },
      ],
    },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** Filter dropdown values, derived from documents the caller can already see. */
export async function documentFilterOptions(context: UserContext) {
  const access = buildDocumentAccessWhere(context);

  const [projects, clients, uploaders] = await Promise.all([
    prisma.project.findMany({
      where: { companyId: context.companyId, documents: { some: access } },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 100,
    }),
    prisma.client.findMany({
      where: { companyId: context.companyId, documents: { some: access } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 100,
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, uploadedDocuments: { some: access } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { firstName: "asc" } },
      take: 100,
    }),
  ]);

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: `${project.name} (${project.code})`,
    })),
    clients: clients.map((client) => ({ id: client.id, name: client.name })),
    uploaders: uploaders.map((member) => ({
      id: member.id,
      name: `${member.user.firstName} ${member.user.lastName}`,
    })),
  };
}
