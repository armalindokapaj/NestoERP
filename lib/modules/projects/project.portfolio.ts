import { assignedOnly, assignedCompany, assignedCompanyId } from "@/lib/access/project-ownership";
import { Prisma, type ProjectStatus } from "@prisma/client";
import { cache } from "react";
import { z } from "zod";

import type { Permission } from "@/config/permissions";
import { can, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { recordAuthEvent } from "@/lib/auth/events";
import { incrementCounter, Metric, observeHistogram } from "@/lib/core/observability/metrics";
import { moveSessionToMembership } from "@/lib/auth/session-store";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { isThumbnailableMimeType } from "@/lib/modules/documents/storage/thumbnail.service";
import { resolveProductivitySettings } from "@/lib/modules/productivity/productivity.settings";
import type { PortfolioQuery } from "./project.schema";
import type { KeyProjectDTO, PortfolioListDTO, ProjectCardDTO } from "./project.types";

/**
 * A person's projects, across the companies the active workspace reads
 * (E-05A §1, §26-§28, §42; Workspace Context §30, §83).
 *
 * NESTO resolves one company per request: the session points at one membership
 * and every scope builder starts from that membership's company. The Projects
 * page is the one place that has to look past it — in the Group workspace it is
 * every project the person may open in every company of the group; in a company
 * workspace it is that company's, and nothing else.
 *
 * It does so without a second authorisation model. The workspace resolver
 * (`resolveWorkspaceContexts`) gives the same `UserContext` a signed-in request
 * in each company would get, and a project is authorised when *that* context's
 * own project scope contains it. The page's query is the union of those scopes,
 * applied in the database before search and pagination (§42; Projects Workspace
 * Grid §93-§95).
 * Nothing here decides access on its own; it only asks each company's rules in
 * turn — and never a company outside the person's group.
 *
 * The contexts carry the caller's session id, because every write made through
 * them is this person, in this session — the audit trail should say so. They are
 * never used to act on the session itself.
 */

export type PortfolioMembership = {
  companyId: string;
  company: { id: string; name: string; logoUrl: string | null };
  context: UserContext;
  /**
   * The company the session works in. In the Group workspace there is none: the
   * session's company is only where the person is anchored, so every project
   * goes through the enter-company step before it opens (Workspace Context §31).
   */
  isCurrent: boolean;
};

/**
 * Every membership in which this person can open projects in the active
 * workspace, current company first.
 *
 * Memoised per request against the session context, which the resolver itself
 * memoises — a page that lists, counts and builds filters resolves it once.
 */
export const resolveProjectPortfolio = cache(async (session: UserContext): Promise<PortfolioMembership[]> => {
  const contexts = await resolveWorkspaceContexts(session, { module: "projects", permission: "project.view" });
  const inCompany = session.workspace.scopeType === "COMPANY";

  return contexts
    .map((context) => ({
      companyId: context.companyId,
      company: { id: context.company.id, name: context.company.name, logoUrl: context.company.logoUrl },
      context,
      isCurrent: inCompany && context.membershipId === session.membershipId,
    }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.company.name.localeCompare(b.company.name));
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

  const project = assignedOnly(await prisma.project.findFirst({
    where: { AND: [portfolioProjectWhere(portfolio), { id: projectId }] },
    select: { id: true, companyId: true, name: true, archivedAt: true },
  }));
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
    metadata: {
      fromCompanyId: session.companyId,
      toCompanyId: membership.companyId,
      projectId,
      // The central event (Workspace Context §67): opening a project enters its company.
      event: "WORKSPACE_CHANGED",
      previousScopeType: session.workspace.scopeType,
      previousCompanyId: session.workspace.companyId,
      nextScopeType: "COMPANY",
      nextCompanyId: membership.companyId,
      parentGroupId: session.parentGroupId,
    },
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
  coverImageDocumentId: true,
  company: { select: { name: true } },
} satisfies Prisma.ProjectSelect;

type ListRow = Prisma.ProjectGetPayload<{ select: typeof LIST_SELECT }>;

/**
 * The page's one order (Projects Workspace Grid §34-§36): Active, then Pending,
 * then Finished, each by name and then id, so it is total and the same on every
 * load. The status enum sorts Pending first in the database, so the order is
 * read as three keyset runs, and the cursor says which run it is in.
 */
const STATUS_RUNS = ["ACTIVE", "PENDING", "FINISHED"] as const;
type StatusRun = (typeof STATUS_RUNS)[number];

const cursorSchema = z.object({ s: z.enum(STATUS_RUNS), v: z.tuple([z.string(), z.string()]) });

function encodeCursor(row: ListRow): string {
  return Buffer.from(JSON.stringify({ s: row.status, v: [row.name, row.id] })).toString("base64url");
}

function decodeCursor(cursor: string | undefined): { run: StatusRun; name: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return { run: parsed.s, name: parsed.v[0], id: parsed.v[1] };
  } catch {
    throw new AccessError("VALIDATION_ERROR", "That page of projects is no longer available. Reload the list.");
  }
}

/**
 * The search (§22, §25): name, code and place — and the company's name in the
 * Group workspace, where cards of several companies sit side by side. It is a
 * clause added to the authorised set, so it can only narrow it (§196).
 */
function searchClause(session: UserContext, q: string): Prisma.ProjectWhereInput {
  const contains = { contains: q, mode: "insensitive" as const };
  const fields: Prisma.ProjectWhereInput[] = [{ name: contains }, { code: contains }, { city: contains }, { country: contains }];
  if (session.workspace.scopeType === "GROUP") fields.push({ company: { name: contains } });
  return { OR: fields };
}

/**
 * Which of these projects the person has starred, and in which companies they
 * may star at all — one query for the page, whatever its size (§119). A star
 * orders nothing and opens nothing: a project reaches this only by being in the
 * authorised set already (§124, §126).
 */
async function favoriteState(portfolio: PortfolioMembership[], projectIds: string[]): Promise<{ ids: Set<string>; enabledCompanies: Set<string> }> {
  const settings = await Promise.all(
    portfolio.map(async (membership) => ({ membership, enabled: (await resolveProductivitySettings(membership.companyId)).favoritesEnabled })),
  );
  const enabled = settings.filter((entry) => entry.enabled).map((entry) => entry.membership);
  const enabledCompanies = new Set(enabled.map((membership) => membership.companyId));
  if (enabled.length === 0 || projectIds.length === 0) return { ids: new Set(), enabledCompanies };

  const rows = await prisma.userFavorite.findMany({
    where: {
      entityType: "project",
      entityId: { in: projectIds },
      OR: enabled.map((membership) => ({ companyId: membership.companyId, memberId: membership.context.membershipId })),
    },
    select: { entityId: true },
  });
  return { ids: new Set(rows.map((row) => row.entityId)), enabledCompanies };
}

/**
 * Which covers each reader may see (E-05A §73; Projects Workspace Grid §96-§99).
 *
 * A cover is a document, and a reader who cannot open the document sees the
 * placeholder rather than a thumbnail link that would refuse them. One query
 * per company with covers on the page, through the documents module's own
 * access clause (§120).
 */
async function readableCovers(portfolio: PortfolioMembership[], rows: ListRow[]): Promise<Map<string, number>> {
  const readable = new Map<string, number>();
  const byCompany = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.coverImageDocumentId) continue;
    const companyId = assignedCompanyId(row);
    byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), row.coverImageDocumentId]);
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
 * The Projects page list (Projects Workspace Grid §11-§13, §34, §91).
 *
 * Authorised projects in the active workspace → search → the fixed order →
 * a cursor page. Each status run is read at once; a page seldom crosses more
 * than one, and the three reads cost one round trip together.
 */
export async function listPortfolioProjects(session: UserContext, query: PortfolioQuery): Promise<PortfolioListDTO> {
  const started = performance.now();
  const scope = session.workspace.scopeType === "GROUP" ? "group" : "company";
  try {
    const result = await discoverProjects(session, query);
    observeHistogram("project_discovery_query_ms", { scope, outcome: "success" }, performance.now() - started);
    return result;
  } catch (error) {
    // Refusals and stale cursors are answers, not failures of the page (§172).
    if (!(error instanceof AccessError)) {
      observeHistogram("project_discovery_query_ms", { scope, outcome: "failure" }, performance.now() - started);
      incrementCounter(Metric.PROJECT_DISCOVERY_ERROR, { scope });
    }
    throw error;
  }
}

async function discoverProjects(session: UserContext, query: PortfolioQuery): Promise<PortfolioListDTO> {
  const portfolio = await requirePortfolio(session);
  const authorised: Prisma.ProjectWhereInput = { AND: [portfolioProjectWhere(portfolio), IN_DISCOVERY] };
  const matching: Prisma.ProjectWhereInput = query.q ? { AND: [authorised, searchClause(session, query.q)] } : authorised;
  const cursor = decodeCursor(query.cursor);
  const take = query.limit + 1;

  const runs = STATUS_RUNS.slice(cursor ? STATUS_RUNS.indexOf(cursor.run) : 0);
  const reads = runs.map((run, index) => {
    const after: Prisma.ProjectWhereInput[] =
      cursor && index === 0 ? [{ OR: [{ name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } }] }] : [];
    return prisma.project.findMany({
      where: { AND: [matching, { status: run }, ...after] },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      select: LIST_SELECT,
    });
  });
  // The page, the per-company counts and the matching count come from one
  // REPEATABLE READ snapshot, so a project created or archived between the
  // reads cannot make "N projects" disagree with the cards (AUD-08 §4, DT-06).
  // Without a search the matching count is the visible count, so it is not read twice.
  const results = await prisma.$transaction(
    [
      prisma.project.groupBy({ by: ["companyId"], where: authorised, _count: { _all: true }, orderBy: { companyId: "asc" } }),
      ...(query.q ? [prisma.project.count({ where: matching })] : []),
      ...reads,
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const companyCounts = results[0] as Array<{ companyId: string; _count: { _all: number } }>;
  const matchingCount = query.q ? (results[1] as number) : null;
  const pages = results.slice(query.q ? 2 : 1) as Array<Array<Prisma.ProjectGetPayload<{ select: typeof LIST_SELECT }>>>;
  const rows = pages.flat().slice(0, take);
  const hasNextPage = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);

  const [favorites, covers] = await Promise.all([
    favoriteState(portfolio, page.map((row) => row.id)),
    readableCovers(portfolio, page),
  ]);
  const visibleProjectCount = companyCounts.reduce((sum, group) => sum + group._count._all, 0);
  const only = companyCounts.length === 1 ? portfolio.find((membership) => membership.companyId === companyCounts[0]!.companyId) : undefined;

  return {
    items: page.map((row) => toCard(row, portfolio, { favorites: favorites.ids, enabledCompanies: favorites.enabledCompanies, covers })),
    pageInfo: { nextCursor: hasNextPage && last ? encodeCursor(last) : null, hasNextPage },
    meta: {
      visibleProjectCount,
      visibleCompanyCount: companyCounts.length,
      onlyCompany: only ? { id: only.companyId, name: only.company.name } : null,
      matchingCount: matchingCount ?? visibleProjectCount,
    },
  };
}

/**
 * The projects a group shows as its key projects (D-01 §31): marked so on the
 * project, among those this person can discover — the same authorisation, cover
 * rule and card as the Projects page. Active first, each by its published built
 * area and then its name. An empty list for somebody who can open projects
 * nowhere.
 */
export async function keyPortfolioProjects(session: UserContext, limit = 4): Promise<KeyProjectDTO[]> {
  const portfolio = await resolveProjectPortfolio(session);
  if (portfolio.length === 0) return [];
  const rows = await prisma.project.findMany({
    where: { AND: [portfolioProjectWhere(portfolio), IN_DISCOVERY, { isKeyProject: true }] },
    // The largest published first, so a group's flagship leads.
    orderBy: [{ builtArea: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
    select: { ...LIST_SELECT, projectType: { select: { id: true, name: true } } },
  });
  const ordered = [...rows.filter((row) => row.status === "ACTIVE"), ...rows.filter((row) => row.status !== "ACTIVE")].slice(0, limit);
  const [favorites, covers] = await Promise.all([favoriteState(portfolio, ordered.map((row) => row.id)), readableCovers(portfolio, ordered)]);
  return ordered.map((row) => ({
    ...toCard(row, portfolio, { favorites: favorites.ids, enabledCompanies: favorites.enabledCompanies, covers }),
    projectType: row.projectType,
  }));
}

/** How the projects this person can discover divide by status and by type (D-01 §32, §33). */
export async function portfolioBreakdown(session: UserContext): Promise<{ byStatus: Array<{ status: ProjectStatus; count: number }>; byType: Array<{ name: string; count: number }> }> {
  const portfolio = await resolveProjectPortfolio(session);
  if (portfolio.length === 0) return { byStatus: [], byType: [] };
  const authorised: Prisma.ProjectWhereInput = { AND: [portfolioProjectWhere(portfolio), IN_DISCOVERY] };
  const [statuses, types] = await Promise.all([
    prisma.project.groupBy({ by: ["status"], where: authorised, _count: { _all: true } }),
    prisma.project.findMany({ where: authorised, select: { projectType: { select: { name: true } } } }),
  ]);
  // Types are each company's own; the same name across companies is one category.
  const byType = new Map<string, number>();
  for (const row of types) {
    const name = row.projectType?.name ?? "Other";
    byType.set(name, (byType.get(name) ?? 0) + 1);
  }
  return {
    byStatus: statuses.map((row) => ({ status: row.status, count: row._count._all })),
    byType: [...byType].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** "Eyes of Tirana" → "EO": the first letter of the first two words (§47). */
export function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]!.toLocaleUpperCase())
    .join("");
}

function toCard(
  row: ListRow,
  portfolio: PortfolioMembership[],
  lookups: { favorites: Set<string>; enabledCompanies: Set<string>; covers: Map<string, number> },
): ProjectCardDTO {
  const membership = portfolio.find((candidate) => candidate.companyId === row.companyId)!;
  const company = assignedCompany(row);
  const coverVersion = row.coverImageDocumentId ? lookups.covers.get(row.coverImageDocumentId) : undefined;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    href: `/projects/${row.id}`,
    company: { id: assignedCompanyId(row), name: company.name, isCurrent: membership.isCurrent },
    location: row.city || row.country ? { city: row.city, country: row.country } : null,
    // The version is the document's, so the same cover keeps the same URL between loads (§98).
    cover: coverVersion !== undefined ? { thumbnailUrl: `/api/projects/${row.id}/cover?v=${coverVersion.toString(36)}` } : null,
    initials: projectInitials(row.name),
    isFavorite: lookups.favorites.has(row.id),
    canFavorite: lookups.enabledCompanies.has(assignedCompanyId(row)),
  };
}
