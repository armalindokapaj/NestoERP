import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { extensionsForGroups, type FileTypeGroup } from "./document.files";
import { buildDocumentAccessWhere, findReadableDocument } from "./document.parent-access";
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
  /// A group list names the company each row belongs to (Workspace Context §45).
  companyId: true,
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
 * The access part of a list `where`, for every context the list reads.
 *
 * One context is the company workspace and its clause is exactly the company's
 * own. Several are the Group workspace: the union of each company's own clause,
 * every branch starting with its `companyId` and built by the same function the
 * company page uses, so a group list can never admit a file that company's own
 * list would not (Workspace Context §35, §57, §62). `mine` is per branch — a
 * person is a different member in each company.
 */
async function documentScopeFilters(contexts: UserContext[], mine: boolean): Promise<Prisma.DocumentWhereInput[]> {
  // No company to read is a real answer — nothing — not an unfiltered query.
  if (contexts.length === 0) return [{ id: { in: [] } }];

  if (contexts.length === 1) {
    const [context] = contexts;
    return [await buildDocumentAccessWhere(context), ...(mine ? [{ uploadedByMemberId: context.membershipId }] : [])];
  }

  const branches = await Promise.all(
    contexts.map(async (context): Promise<Prisma.DocumentWhereInput> => {
      const access = await buildDocumentAccessWhere(context);
      return mine ? { AND: [access, { uploadedByMemberId: context.membershipId }] } : access;
    }),
  );
  return [{ OR: branches }];
}

/**
 * Builds the full `where` for a list request.
 *
 * Order: company + parent access → archive state → search → filters
 * (PRD #13 §133).
 */
export async function buildDocumentListWhere(
  context: UserContext,
  query: DocumentListQuery,
): Promise<Prisma.DocumentWhereInput> {
  return buildDocumentListWhereAcross([context], query);
}

/** The same list `where` over one or several companies' contexts (Workspace Context §35). */
export async function buildDocumentListWhereAcross(
  contexts: UserContext[],
  query: DocumentListQuery,
): Promise<Prisma.DocumentWhereInput> {
  const filters: Prisma.DocumentWhereInput[] = await documentScopeFilters(contexts, query.mine);

  filters.push(
    query.archived
      ? { OR: [{ archivedAt: { not: null } }, { status: "ARCHIVED" }] }
      : { archivedAt: null, status: { not: "ARCHIVED" } },
  );

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
      if (kind === "record") branches.push({ entityType: { notIn: ["project", "client"] }, entityId: { not: null } });
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
  const where = await buildDocumentListWhere(context, query);

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
 * The Group workspace's list: every company's own clause in one query, applied
 * in the database before search, filters, sort and pagination — never a page
 * per company merged afterwards (Workspace Context §35, §57). Ties on the sort
 * key fall back to the id so a page boundary cannot repeat or drop a row.
 */
export async function listDocumentsAcross(contexts: UserContext[], query: DocumentListQuery) {
  const where = await buildDocumentListWhereAcross(contexts, query);

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: [...SORT_ORDER[query.sort], { id: "asc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
    }),
    prisma.document.count({ where }),
  ]);

  return { rows, total };
}

/**
 * A single document, if its parent is reachable right now.
 *
 * Decided by the record registry for that one parent rather than by building
 * the whole list clause: an unregistered parent answers "not found", which is
 * the fail-closed behaviour the registry promises (PRD #13 §45, §149,
 * PRD #38 §66).
 */
/**
 * The files attached to one record, found by the record rather than by the
 * reader's company — for the one parent whose files everybody who can read it
 * may read: an announcement, including a Group announcement read from another
 * company of the group (Activity Center §47, §150). The caller has already
 * decided the reader may read the record; nothing here decides access.
 */
export async function listRecordAttachments(parent: { companyId: string; entityType: string; entityId: string }) {
  return prisma.document.findMany({
    where: { companyId: parent.companyId, entityType: parent.entityType, entityId: parent.entityId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: SUMMARY_SELECT,
  });
}

/** One file attached to that record, or null — the same condition as the list above. */
export async function findRecordAttachment(parent: { companyId: string; entityType: string; entityId: string }, documentId: string): Promise<DocumentDetailRow | null> {
  return prisma.document.findFirst({
    where: { id: documentId, companyId: parent.companyId, entityType: parent.entityType, entityId: parent.entityId, status: "ACTIVE" },
    select: DETAIL_SELECT,
  });
}

export async function findDocumentInScope(
  context: UserContext,
  documentId: string,
): Promise<DocumentDetailRow | null> {
  const readable = await findReadableDocument(context, documentId);
  if (!readable) return null;
  return prisma.document.findFirst({
    where: { id: readable.id, companyId: context.companyId },
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
        actorMemberId: true,
        actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.activity.count({ where }),
  ]);

  return { rows, total };
}

/** The overview counters, all counted in the database under access (PRD #13 §167). */
export async function documentOverviewStats(context: UserContext) {
  return documentOverviewStatsAcross([context]);
}

/** The same counters over one or several companies, each under its own access clause (Workspace Context §35). */
export async function documentOverviewStatsAcross(contexts: UserContext[]) {
  const access: Prisma.DocumentWhereInput = { AND: await documentScopeFilters(contexts, false) };
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
  return recentDocumentsAcross([context], take);
}

export async function recentDocumentsAcross(contexts: UserContext[], take = 6) {
  return prisma.document.findMany({
    where: {
      AND: [...(await documentScopeFilters(contexts, false)), { archivedAt: null, status: { not: "ARCHIVED" } }],
    },
    select: SUMMARY_SELECT,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take,
  });
}

export async function myRecentUploads(context: UserContext, take = 6) {
  return myRecentUploadsAcross([context], take);
}

/** Each company's own uploads by this person — a different member in every company. */
export async function myRecentUploadsAcross(contexts: UserContext[], take = 6) {
  return prisma.document.findMany({
    where: {
      AND: [...(await documentScopeFilters(contexts, true)), { archivedAt: null, status: { not: "ARCHIVED" } }],
    },
    select: SUMMARY_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take,
  });
}

/** Filter dropdown values, derived from documents the caller can already see. */
export async function documentFilterOptions(context: UserContext) {
  const access = await buildDocumentAccessWhere(context);

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

/**
 * The dropdown values of a group list: each company's own options — found under
 * that company's own access clause — merged, and named by company where more
 * than one contributes, because two companies can each have a "Tower A"
 * (Workspace Context §35, §45). The ids stay the companies' own record ids, so
 * choosing one narrows a list that already only holds what the reader may open.
 */
export async function documentFilterOptionsAcross(contexts: UserContext[]) {
  const perCompany = await Promise.all(
    contexts.map(async (context) => ({ company: context.company.name, options: await documentFilterOptions(context) })),
  );
  const named = perCompany.length > 1;
  const label = (name: string, company: string) => (named ? `${name} · ${company}` : name);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  return {
    projects: perCompany.flatMap(({ company, options }) => options.projects.map((row) => ({ id: row.id, name: label(row.name, company) }))).sort(byName),
    clients: perCompany.flatMap(({ company, options }) => options.clients.map((row) => ({ id: row.id, name: label(row.name, company) }))).sort(byName),
    uploaders: perCompany.flatMap(({ company, options }) => options.uploaders.map((row) => ({ id: row.id, name: label(row.name, company) }))).sort(byName),
  };
}
