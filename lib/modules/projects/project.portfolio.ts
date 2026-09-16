import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { z } from "zod";

import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { recordAuthEvent } from "@/lib/auth/events";
import { moveSessionToMembership } from "@/lib/auth/session-store";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { isThumbnailableMimeType } from "@/lib/modules/documents/storage/thumbnail.service";
import { resolveProductivitySettings } from "@/lib/modules/productivity/productivity.settings";
import { statusActionFor, WORKING_STATUSES, type WorkingStatus } from "./project.machine";
import { ASSIGNED_ROLE_VALUE } from "./project.portfolio-url";
import type { PortfolioQuery, PortfolioSortKey } from "./project.schema";
import type {
  PortfolioFilterOptionsDTO,
  PortfolioListDTO,
  PortfolioProjectDTO,
} from "./project.types";

/**
 * A person's projects, across every company they belong to (E-05A §1, §26-§28,
 * §42).
 *
 * NESTO resolves one company per request: the session points at one membership
 * and every scope builder starts from that membership's company. The Projects
 * page is the one place that has to look past it — an architect assigned in two
 * companies must find both projects without switching first.
 *
 * It does so without a second authorisation model. Each of the person's active
 * memberships is resolved into the same `UserContext` a signed-in request in
 * that company would get (`buildMemberContexts`, which the session resolver
 * shares), and a project is authorised when *that* context's own project scope
 * contains it. The page's query is the union of those scopes, applied in the
 * database before search, filters, sort and pagination (§42). Nothing here
 * decides access on its own; it only asks each company's rules in turn.
 *
 * The memberships' contexts carry the caller's session id, because every write
 * made through them is this person, in this session — the audit trail should
 * say so. They are never used to act on the session itself.
 */

export type PortfolioMembership = {
  companyId: string;
  company: { id: string; name: string; logoUrl: string | null };
  context: UserContext;
  isCurrent: boolean;
};

const opensProjects = (context: UserContext) =>
  isModuleEnabled(context, "projects") && canAccessModule(context, "projects") && can(context, "project.view");

/**
 * Every membership in which this person can open projects, current company first.
 *
 * Memoised per request against the session context, which the resolver itself
 * memoises — a page that lists, counts and builds filters resolves it once.
 */
export const resolveProjectPortfolio = cache(async (session: UserContext): Promise<PortfolioMembership[]> => {
  const others = await prisma.companyMember.findMany({
    where: {
      userId: session.userId,
      id: { not: session.membershipId },
      status: "ACTIVE",
      company: { status: "ACTIVE" },
      user: { status: "ACTIVE" },
    },
    select: { id: true, companyId: true },
  });

  const contexts = await Promise.all(
    others.map(async (membership) => {
      const context = (await buildMemberContexts(membership.companyId, [membership.id])).get(membership.id);
      return context ? { ...context, sessionId: session.sessionId } : null;
    }),
  );

  const portfolio = [session, ...contexts.filter((context): context is UserContext => context !== null)]
    .filter(opensProjects)
    .map((context) => ({
      companyId: context.companyId,
      company: { id: context.company.id, name: context.company.name, logoUrl: context.company.logoUrl },
      context,
      isCurrent: context.membershipId === session.membershipId,
    }));

  return portfolio.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.company.name.localeCompare(b.company.name));
});

/**
 * The union of each membership's own project scope. Every branch carries its
 * company, so a project is only ever matched by the membership in its company.
 */
export function portfolioProjectWhere(portfolio: PortfolioMembership[]): Prisma.ProjectWhereInput {
  if (portfolio.length === 0) return { id: { in: [] } };
  return { OR: portfolio.map((membership) => buildProjectScopeWhere(membership.context)) };
}

/** Archived projects leave daily discovery (E-05A §10, §55). */
const IN_DISCOVERY: Prisma.ProjectWhereInput = { archivedAt: null, status: { not: "ARCHIVED" } };

/**
 * Refuses a person who can open projects nowhere, with the same answer the
 * single-company guards give for their current company.
 */
async function requirePortfolio(session: UserContext): Promise<PortfolioMembership[]> {
  const portfolio = await resolveProjectPortfolio(session);
  if (portfolio.length > 0) return portfolio;
  assertModule(session, "projects");
  assertPermission(session, "project.view");
  throw new AccessError("FORBIDDEN");
}

/* -------------------------------------------------------------------------- */
/* One project, wherever it lives                                              */
/* -------------------------------------------------------------------------- */

export type PortfolioProjectMatch = {
  membership: PortfolioMembership;
  project: { id: string; companyId: string; name: string; archivedAt: Date | null };
};

/**
 * The project, and the membership through which this person may open it — or
 * null, with nothing to tell an unauthorised id from a missing one (E-05A §49).
 * Archived projects are included: they can still be opened, only not discovered.
 */
export async function findPortfolioProject(session: UserContext, projectId: string): Promise<PortfolioProjectMatch | null> {
  const portfolio = await resolveProjectPortfolio(session);
  if (portfolio.length === 0) return null;

  const project = await prisma.project.findFirst({
    where: { AND: [portfolioProjectWhere(portfolio), { id: projectId }] },
    select: { id: true, companyId: true, name: true, archivedAt: true },
  });
  if (!project) return null;

  const membership = portfolio.find((candidate) => candidate.companyId === project.companyId);
  return membership ? { membership, project } : null;
}

/**
 * The context to act on a project with: the membership in the project's own
 * company. Not found answers 404, like every other project lookup (PRD #10 §113).
 */
export async function contextForProject(session: UserContext, projectId: string): Promise<UserContext> {
  const match = await findPortfolioProject(session, projectId);
  if (!match) throw new AccessError("NOT_FOUND");
  return match.membership.context;
}

/**
 * The context to create in a company with, when this person holds the
 * permission there (E-05A §30, §39). A company they do not belong to and one
 * where they lack the permission get the same refusal — a request body naming a
 * company is a request, not a grant.
 */
export async function contextForCompany(session: UserContext, companyId: string, permission: Permission): Promise<UserContext> {
  const portfolio = await resolveProjectPortfolio(session);
  const membership = portfolio.find((candidate) => candidate.companyId === companyId);
  if (!membership || !can(membership.context, permission)) {
    throw new AccessError("FORBIDDEN", "You cannot create projects in that company.");
  }
  return membership.context;
}

/** Companies where this person may create a project (E-05A §5, §30). */
export async function creatableCompanies(session: UserContext): Promise<Array<{ id: string; name: string; isCurrent: boolean }>> {
  const portfolio = await resolveProjectPortfolio(session);
  return portfolio
    .filter((membership) => can(membership.context, "project.create"))
    .map((membership) => ({ id: membership.companyId, name: membership.company.name, isCurrent: membership.isCurrent }));
}

/* -------------------------------------------------------------------------- */
/* Opening a project in its own company                                        */
/* -------------------------------------------------------------------------- */

export type OpenProjectResult = {
  projectId: string;
  company: { id: string; name: string };
  switched: boolean;
};

/**
 * Makes the project's company the session's company (E-05A §26, §34).
 *
 * Only ever through a project: the person asks to open a project, the project
 * is authorised through the membership in its company, and that membership —
 * and no other — becomes the session's. A project in the company the session is
 * already in changes nothing.
 */
export async function openPortfolioProject(
  session: UserContext,
  projectId: string,
  request: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<OpenProjectResult> {
  const match = await findPortfolioProject(session, projectId);
  if (!match) throw new AccessError("NOT_FOUND");

  const { membership } = match;
  const company = { id: membership.companyId, name: membership.company.name };
  if (membership.isCurrent) return { projectId, company, switched: false };

  const { moved } = await moveSessionToMembership({
    sessionId: session.sessionId,
    userId: session.userId,
    membershipId: membership.context.membershipId,
  });
  // The membership was active a moment ago; if the move found nothing, the
  // session or the membership ended in between. Nothing moved, so nothing opens.
  if (!moved) throw new AccessError("NOT_FOUND");

  await recordAuthEvent({
    type: "COMPANY_CONTEXT_SWITCHED",
    userId: session.userId,
    companyId: membership.companyId,
    sessionId: session.sessionId,
    ipAddress: request.ipAddress ?? null,
    userAgent: request.userAgent ?? null,
    metadata: { fromCompanyId: session.companyId, toCompanyId: membership.companyId, projectId },
  });

  return { projectId, company, switched: true };
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

const LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  city: true,
  country: true,
  companyId: true,
  projectType: { select: { id: true, name: true } },
  coverImageDocumentId: true,
  projectManagerMemberId: true,
  lastActivityAt: true,
  createdAt: true,
  company: { select: { name: true } },
} satisfies Prisma.ProjectSelect;

type ListRow = Prisma.ProjectGetPayload<{ select: typeof LIST_SELECT }>;

type SortField = { key: "lastActivityAt" | "name" | "createdAt" | "company" | "id"; direction: "asc" | "desc" };

/**
 * Every sort ends on a unique column, so the order is total and a cursor
 * always names exactly one position (E-05A §14, §43).
 */
const SORT_FIELDS: Record<PortfolioSortKey, SortField[]> = {
  recommended: [{ key: "lastActivityAt", direction: "desc" }, { key: "name", direction: "asc" }, { key: "id", direction: "asc" }],
  activity: [{ key: "lastActivityAt", direction: "desc" }, { key: "name", direction: "asc" }, { key: "id", direction: "asc" }],
  "name-asc": [{ key: "name", direction: "asc" }, { key: "id", direction: "asc" }],
  "name-desc": [{ key: "name", direction: "desc" }, { key: "id", direction: "desc" }],
  "company-asc": [{ key: "company", direction: "asc" }, { key: "name", direction: "asc" }, { key: "id", direction: "asc" }],
  newest: [{ key: "createdAt", direction: "desc" }, { key: "id", direction: "desc" }],
  oldest: [{ key: "createdAt", direction: "asc" }, { key: "id", direction: "asc" }],
};

/** `fav` and `rest` are the two halves of the recommended order; `all` is every other sort. */
type Phase = "fav" | "rest" | "all";

const cursorSchema = z.object({ p: z.enum(["fav", "rest", "all"]), v: z.array(z.string()).min(1).max(3) });

function sortValue(row: ListRow, field: SortField): string {
  switch (field.key) {
    case "lastActivityAt":
      return row.lastActivityAt.toISOString();
    case "createdAt":
      return row.createdAt.toISOString();
    case "company":
      return row.company.name;
    case "name":
      return row.name;
    case "id":
      return row.id;
  }
}

function encodeCursor(phase: Phase, fields: SortField[], row: ListRow): string {
  return Buffer.from(JSON.stringify({ p: phase, v: fields.map((field) => sortValue(row, field)) })).toString("base64url");
}

function decodeCursor(cursor: string | undefined, fields: SortField[]): { phase: Phase; values: Array<string | Date> } | null {
  if (!cursor) return null;
  const stale = () => new AccessError("VALIDATION_ERROR", "That page of projects is no longer available. Reload the list.");
  let parsed: z.infer<typeof cursorSchema>;
  try {
    parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw stale();
  }
  if (parsed.v.length !== fields.length) throw stale();
  const values = fields.map((field, index) => {
    const raw = parsed.v[index]!;
    if (field.key !== "lastActivityAt" && field.key !== "createdAt") return raw;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw stale();
    return date;
  });
  return { phase: parsed.p, values };
}

function orderByFor(fields: SortField[]): Prisma.ProjectOrderByWithRelationInput[] {
  return fields.map((field) =>
    field.key === "company" ? { company: { name: field.direction } } : { [field.key]: field.direction },
  );
}

function equalsClause(field: SortField, value: string | Date): Prisma.ProjectWhereInput {
  return field.key === "company" ? { company: { name: value as string } } : { [field.key]: value };
}

function beyondClause(field: SortField, value: string | Date): Prisma.ProjectWhereInput {
  const operator = field.direction === "asc" ? "gt" : "lt";
  return field.key === "company"
    ? { company: { name: { [operator]: value as string } } }
    : { [field.key]: { [operator]: value } };
}

/** Rows strictly after the cursor in the sort's own order — keyset pagination. */
function afterCursor(fields: SortField[], values: Array<string | Date>): Prisma.ProjectWhereInput {
  return {
    OR: fields.map((field, index) => ({
      AND: [...fields.slice(0, index).map((previous, i) => equalsClause(previous, values[i]!)), beyondClause(field, values[index]!)],
    })),
  };
}

function fetchPage(where: Prisma.ProjectWhereInput, fields: SortField[], cursorValues: Array<string | Date> | null, take: number) {
  return prisma.project.findMany({
    where: cursorValues ? { AND: [where, afterCursor(fields, cursorValues)] } : where,
    orderBy: orderByFor(fields),
    take,
    select: LIST_SELECT,
  });
}

/** The person's starred projects, in companies that have favorites switched on. */
async function favoriteProjectIds(portfolio: PortfolioMembership[]): Promise<{ ids: Set<string>; enabledCompanies: Set<string> }> {
  const settings = await Promise.all(
    portfolio.map(async (membership) => ({ membership, enabled: (await resolveProductivitySettings(membership.companyId)).favoritesEnabled })),
  );
  const enabled = settings.filter((entry) => entry.enabled).map((entry) => entry.membership);
  const enabledCompanies = new Set(enabled.map((membership) => membership.companyId));
  if (enabled.length === 0) return { ids: new Set(), enabledCompanies };

  const rows = await prisma.userFavorite.findMany({
    where: {
      entityType: "project",
      OR: enabled.map((membership) => ({ companyId: membership.companyId, memberId: membership.context.membershipId })),
    },
    select: { entityId: true },
  });
  return { ids: new Set(rows.map((row) => row.entityId)), enabledCompanies };
}

export { ASSIGNED_ROLE_VALUE as ASSIGNED_ROLE } from "./project.portfolio-url";

function filterClauses(query: PortfolioQuery, portfolio: PortfolioMembership[], favorites: Set<string>): Prisma.ProjectWhereInput[] {
  const clauses: Prisma.ProjectWhereInput[] = [];
  const memberIds = portfolio.map((membership) => membership.context.membershipId);

  if (query.q) {
    const contains = { contains: query.q, mode: "insensitive" as const };
    clauses.push({
      OR: [
        { name: contains },
        { code: contains },
        { company: { name: contains } },
        { city: contains },
        { country: contains },
        { projectType: { name: contains } },
      ],
    });
  }

  if (query.status) clauses.push({ status: query.status });
  if (query.favorites) clauses.push({ id: { in: [...favorites] } });
  if (query.companyId) clauses.push({ companyId: query.companyId });
  // By name: each company keeps its own list, and "Hospital" means the same
  // thing on a card from either company (E-05A §30).
  if (query.projectType) clauses.push({ projectType: { name: { equals: query.projectType, mode: "insensitive" } } });

  if (query.location) {
    const separator = query.location.indexOf(":");
    const kind = query.location.slice(0, separator);
    const value = query.location.slice(separator + 1);
    const equals = { equals: value, mode: "insensitive" as const };
    clauses.push(kind === "city" ? { city: equals } : { country: equals });
  }

  if (query.role) {
    const managed: Prisma.ProjectWhereInput = { projectManagerMemberId: { in: memberIds } };
    if (query.role === ASSIGNED_ROLE_VALUE) {
      clauses.push({ OR: [managed, { members: { some: { companyMemberId: { in: memberIds }, status: "ACTIVE" } } }] });
    } else {
      const byLabel: Prisma.ProjectWhereInput = {
        members: { some: { companyMemberId: { in: memberIds }, status: "ACTIVE", projectRole: { equals: query.role, mode: "insensitive" } } },
      };
      clauses.push(query.role.toLowerCase() === "project manager" ? { OR: [byLabel, managed] } : byLabel);
    }
  }

  return clauses;
}

/**
 * Which covers each reader may see (E-05A §73).
 *
 * A cover is a document, and a reader who cannot open the document sees the
 * placeholder rather than a thumbnail link that would refuse them. One query
 * per company with covers on the page, through the documents module's own
 * access clause.
 */
async function readableCovers(portfolio: PortfolioMembership[], rows: ListRow[]): Promise<Map<string, number>> {
  const readable = new Map<string, number>();
  const byCompany = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.coverImageDocumentId) continue;
    byCompany.set(row.companyId, [...(byCompany.get(row.companyId) ?? []), row.coverImageDocumentId]);
  }

  await Promise.all(
    [...byCompany].map(async ([companyId, ids]) => {
      const context = portfolio.find((membership) => membership.companyId === companyId)?.context;
      if (!context) return;
      if (!isModuleEnabled(context, "documents") || !can(context, "document.view") || !can(context, "document.download")) return;
      const access = await buildDocumentAccessWhere(context);
      const documents = await prisma.document.findMany({
        where: { AND: [access, { id: { in: ids }, companyId, status: "ACTIVE", storageStatus: "AVAILABLE" }] },
        select: { id: true, updatedAt: true, mimeType: true, detectedMimeType: true },
      });
      for (const document of documents) {
        if (isThumbnailableMimeType(document.detectedMimeType ?? document.mimeType)) readable.set(document.id, document.updatedAt.getTime());
      }
    }),
  );
  return readable;
}

/**
 * The Projects page list (E-05A §4, §14, §36, §37, §42, §43).
 *
 * Authorised projects → search → filters → sort → cursor page. The recommended
 * order puts the person's favorites first; it is paged as two keyset runs —
 * favorites, then everything else — so a cursor never has to express
 * "is starred" as a column.
 */
export async function listPortfolioProjects(session: UserContext, query: PortfolioQuery): Promise<PortfolioListDTO> {
  const portfolio = await requirePortfolio(session);
  const { ids: favorites, enabledCompanies } = await favoriteProjectIds(portfolio);

  const authorised: Prisma.ProjectWhereInput = { AND: [portfolioProjectWhere(portfolio), IN_DISCOVERY] };
  const filtered: Prisma.ProjectWhereInput = { AND: [authorised, ...filterClauses(query, portfolio, favorites)] };
  const fields = SORT_FIELDS[query.sort];
  const cursor = decodeCursor(query.cursor, fields);
  const take = query.limit + 1;

  const rows: Array<{ row: ListRow; phase: Phase }> = [];
  const phased = query.sort === "recommended" && !query.favorites;

  if (phased) {
    if (cursor && cursor.phase === "all") throw new AccessError("VALIDATION_ERROR", "That page of projects is no longer available. Reload the list.");
    const favoriteIds = [...favorites];
    if ((!cursor || cursor.phase === "fav") && favoriteIds.length > 0) {
      const page = await fetchPage({ AND: [filtered, { id: { in: favoriteIds } }] }, fields, cursor?.values ?? null, take);
      rows.push(...page.map((row) => ({ row, phase: "fav" as const })));
    }
    if (rows.length < take) {
      const rest: Prisma.ProjectWhereInput = favoriteIds.length > 0 ? { AND: [filtered, { id: { notIn: favoriteIds } }] } : filtered;
      const page = await fetchPage(rest, fields, cursor?.phase === "rest" ? cursor.values : null, take - rows.length);
      rows.push(...page.map((row) => ({ row, phase: "rest" as const })));
    }
  } else {
    if (cursor && cursor.phase !== "all") throw new AccessError("VALIDATION_ERROR", "That page of projects is no longer available. Reload the list.");
    const page = await fetchPage(filtered, fields, cursor?.values ?? null, take);
    rows.push(...page.map((row) => ({ row, phase: "all" as const })));
  }

  const hasNextPage = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);

  const [companyCounts, matchingCount, covers, roles] = await Promise.all([
    prisma.project.groupBy({ by: ["companyId"], where: authorised, _count: { _all: true } }),
    prisma.project.count({ where: filtered }),
    readableCovers(portfolio, page.map((entry) => entry.row)),
    effectiveRoles(portfolio, page.map((entry) => entry.row)),
  ]);

  return {
    items: page.map(({ row }) => toPortfolioDTO(row, portfolio, { favorites, enabledCompanies, covers, roles })),
    pageInfo: { nextCursor: hasNextPage && last ? encodeCursor(last.phase, fields, last.row) : null, hasNextPage },
    meta: {
      visibleProjectCount: companyCounts.reduce((sum, group) => sum + group._count._all, 0),
      visibleCompanyCount: companyCounts.length,
      matchingCount,
    },
  };
}

/**
 * The roles this person holds on each project (E-05A §55, §56): their role on
 * the project's team first, then Project Manager where they manage it and the
 * team role says something else. Never the job title and never the company
 * role — an Owner who is on no project's team has no project role to show.
 * The same words in another case are one role, not two.
 */
async function effectiveRoles(portfolio: PortfolioMembership[], rows: ListRow[]): Promise<Map<string, string[]>> {
  const roles = new Map<string, string[]>();
  if (rows.length === 0) return roles;
  const memberIds = new Set(portfolio.map((membership) => membership.context.membershipId));

  const add = (projectId: string, label: string | null | undefined) => {
    const trimmed = label?.trim();
    if (!trimmed) return;
    const held = roles.get(projectId) ?? [];
    if (!held.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) roles.set(projectId, [...held, trimmed]);
  };

  const assignments = await prisma.projectMember.findMany({
    where: { projectId: { in: rows.map((row) => row.id) }, companyMemberId: { in: [...memberIds] }, status: "ACTIVE" },
    select: { projectId: true, projectRole: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  for (const assignment of assignments) add(assignment.projectId, assignment.projectRole);
  for (const row of rows) {
    if (row.projectManagerMemberId && memberIds.has(row.projectManagerMemberId)) add(row.id, "Project Manager");
  }
  return roles;
}

function toPortfolioDTO(
  row: ListRow,
  portfolio: PortfolioMembership[],
  lookups: { favorites: Set<string>; enabledCompanies: Set<string>; covers: Map<string, number>; roles: Map<string, string[]> },
): PortfolioProjectDTO {
  const membership = portfolio.find((candidate) => candidate.companyId === row.companyId)!;
  const context = membership.context;
  const coverVersion = row.coverImageDocumentId ? lookups.covers.get(row.coverImageDocumentId) : undefined;
  const [role, ...otherRoles] = lookups.roles.get(row.id) ?? [];
  const manageStatus = can(context, "project.status.manage");

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    href: `/projects/${row.id}`,
    company: { id: row.companyId, name: row.company.name, logoUrl: membership.company.logoUrl, isCurrent: membership.isCurrent },
    cover:
      row.coverImageDocumentId && coverVersion !== undefined
        ? { documentId: row.coverImageDocumentId, thumbnailUrl: `/api/projects/${row.id}/cover?v=${coverVersion.toString(36)}` }
        : null,
    location: { city: row.city, country: row.country },
    projectType: row.projectType ? { id: row.projectType.id, name: row.projectType.name } : null,
    myProjectRole: role ? { name: role, others: otherRoles.length } : null,
    isFavorite: lookups.favorites.has(row.id),
    lastActivityAt: row.lastActivityAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    permissions: {
      open: true,
      edit: can(context, "project.update"),
      manageStatus,
      archive: can(context, "project.archive"),
      favorite: lookups.enabledCompanies.has(row.companyId),
    },
    statusMoves: manageStatus ? nextStatuses(row.status) : [],
  };
}

/** The working states a project can be moved to from where it is (E-05A §12). */
function nextStatuses(from: ListRow["status"]): WorkingStatus[] {
  return WORKING_STATUSES.filter((to) => to !== from && statusActionFor(from, to) !== null);
}

/* -------------------------------------------------------------------------- */
/* Filter options and header                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Filter values drawn only from projects this person can see (E-05A §18, §41).
 * A company, a role, a type or a place appears only because an authorised
 * project carries it — never because it exists.
 */
export async function portfolioFilterOptions(session: UserContext): Promise<PortfolioFilterOptionsDTO> {
  const portfolio = await requirePortfolio(session);
  const authorised: Prisma.ProjectWhereInput = { AND: [portfolioProjectWhere(portfolio), IN_DISCOVERY] };
  const memberIds = portfolio.map((membership) => membership.context.membershipId);

  const [companies, types, places, assignments, managed] = await Promise.all([
    prisma.project.groupBy({ by: ["companyId"], where: authorised, _count: { _all: true } }),
    prisma.project.groupBy({ by: ["projectTypeId"], where: { AND: [authorised, { projectTypeId: { not: null } }] } }),
    prisma.project.groupBy({ by: ["city", "country"], where: { AND: [authorised, { OR: [{ city: { not: null } }, { country: { not: null } }] }] } }),
    prisma.projectMember.findMany({
      where: { companyMemberId: { in: memberIds }, status: "ACTIVE", projectRole: { not: null }, project: authorised },
      select: { projectRole: true },
      distinct: ["projectRole"],
    }),
    prisma.project.count({ where: { AND: [authorised, { projectManagerMemberId: { in: memberIds } }] } }),
  ]);

  const represented = new Set(companies.map((group) => group.companyId));

  // Types are rows per company; the filter offers each name once.
  const typeRows = await prisma.projectType.findMany({
    where: { id: { in: types.map((group) => group.projectTypeId).filter((id): id is string => Boolean(id)) } },
    select: { name: true },
  });
  const typeNames = new Map<string, string>();
  for (const { name } of typeRows) {
    if (!typeNames.has(name.toLowerCase())) typeNames.set(name.toLowerCase(), name);
  }

  const roleLabels = new Map<string, string>();
  for (const { projectRole } of assignments) {
    const label = projectRole?.trim();
    if (label) roleLabels.set(label.toLowerCase(), roleLabels.get(label.toLowerCase()) ?? label);
  }
  if (managed > 0 && !roleLabels.has("project manager")) roleLabels.set("project manager", "Project Manager");

  const cities = new Map<string, { value: string; label: string }>();
  const countries = new Map<string, { value: string; label: string }>();
  for (const place of places) {
    const city = place.city?.trim();
    const country = place.country?.trim();
    if (city && !cities.has(city.toLowerCase())) cities.set(city.toLowerCase(), { value: `city:${city}`, label: country ? `${city}, ${country}` : city });
    if (country && !countries.has(country.toLowerCase())) countries.set(country.toLowerCase(), { value: `country:${country}`, label: country });
  }

  return {
    companies: portfolio.filter((membership) => represented.has(membership.companyId)).map((membership) => ({ id: membership.companyId, name: membership.company.name })),
    roles: [...roleLabels.values()].sort((a, b) => a.localeCompare(b)).map((label) => ({ value: label, label })),
    projectTypes: [...typeNames.values()].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name })),
    locations: {
      countries: [...countries.values()].sort((a, b) => a.label.localeCompare(b.label)),
      cities: [...cities.values()].sort((a, b) => a.label.localeCompare(b.label)),
    },
    creatableCompanies: portfolio.filter((membership) => can(membership.context, "project.create")).map((membership) => ({ id: membership.companyId, name: membership.company.name })),
  };
}
