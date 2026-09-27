import type { ModuleKey } from "@/config/modules";
import type { UserContext } from "@/lib/context/types";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { listFavoritesForWorkspace, type FavoriteItemDTO } from "./favorites.service";
import { personalContexts } from "./productivity.workspace";
import { listRecentWorkForWorkspace, type RecentWorkItemDTO } from "./recent-work.service";

/**
 * Search Home and My Work (Fast Re-entry PRD §90, §91, §114, §115, §195-§197).
 *
 * Both read the person's own favorite and recent references across every
 * company of their group, resolve them in each company's own context in one
 * query per record type (§112, §113), and leave out whatever the person cannot
 * open now — silently, with no count and no hint (§35-§37). Nothing here holds
 * a copy of a record: titles, companies, projects and links are read fresh.
 */

export const SEARCH_HOME_FAVORITES = 5;
export const SEARCH_HOME_RECENT = 8;
export const MY_WORK_PAGE = 30;

export type MyWorkTab = "recent" | "favorites";
export type MyWorkItemDTO = (FavoriteItemDTO | RecentWorkItemDTO) & { at: string };

export type SearchHomeDTO = {
  favorites: FavoriteItemDTO[];
  recent: RecentWorkItemDTO[];
  /** `type:id` of every record the person has starred — keys only, so a search result can show and toggle its star (§75). */
  favoriteKeys: string[];
  /** Where the session is, so a click opens in place when the record's company is the one already entered (§127). */
  workspace: { scopeType: "GROUP" | "COMPANY"; companyId: string | null };
};

function workspaceOf(session: UserContext): SearchHomeDTO["workspace"] {
  return session.workspace.scopeType === "GROUP" ? { scopeType: "GROUP", companyId: null } : { scopeType: "COMPANY", companyId: session.companyId };
}

export async function searchHome(session: UserContext): Promise<SearchHomeDTO> {
  const started = performance.now();
  const [favorites, recent, starred] = await Promise.all([
    listFavoritesForWorkspace(session, { limit: SEARCH_HOME_FAVORITES }),
    listRecentWorkForWorkspace(session, { limit: SEARCH_HOME_RECENT }),
    personalContexts(session).then((contexts) => prisma.userFavorite.findMany({ where: { OR: contexts.map((context) => ({ companyId: context.companyId, memberId: context.membershipId })) }, select: { entityType: true, entityId: true } })),
  ]);
  incrementCounter(Metric.SEARCH_HOME_LOAD_MS, {}, Math.max(0, performance.now() - started));
  return { favorites, recent, favoriteKeys: starred.map((row) => `${row.entityType}:${row.entityId}`), workspace: workspaceOf(session) };
}

export type MyWorkFilters = {
  tab: MyWorkTab;
  companyId?: string | null;
  module?: string | null;
  projectId?: string | null;
  q?: string | null;
  /** Recent tab: opened on or after this instant (§66). */
  since?: Date | null;
  until?: Date | null;
  cursor?: string | null;
  limit?: number;
};

export type MyWorkPageDTO = {
  items: MyWorkItemDTO[];
  nextCursor: string | null;
  /** Only values that visible rows carry — never a company, module or project the person cannot open (§63-§65, §105). */
  facets: { companies: Array<{ id: string; name: string }>; modules: ModuleKey[]; projects: Array<{ id: string; name: string }> };
  workspace: SearchHomeDTO["workspace"];
};

const keyOf = (item: MyWorkItemDTO) => `${item.at}|${item.entityType}:${item.entityId}`;

/**
 * One tab of My Work, filtered and paged by cursor (§135-§137, §167-§169).
 *
 * The references are bounded per person (200 recent, a soft 500 favorites per
 * company), so the whole visible set is resolved once and then narrowed; the
 * cursor is the sort key of the last row, so paging stays stable while new
 * opens land on top.
 */
export async function listMyWork(session: UserContext, filters: MyWorkFilters): Promise<MyWorkPageDTO> {
  const started = performance.now();
  const base: MyWorkItemDTO[] =
    filters.tab === "favorites"
      ? (await listFavoritesForWorkspace(session)).map((item) => ({ ...item, at: item.favoritedAt }))
      : (await listRecentWorkForWorkspace(session)).map((item) => ({ ...item, at: item.lastAccessedAt }));

  const companies = new Map<string, string>();
  const modules = new Set<ModuleKey>();
  const projects = new Map<string, string>();
  for (const item of base) {
    if (item.company) companies.set(item.company.id, item.company.name);
    modules.add(item.moduleKey);
    if (item.project) projects.set(item.project.id, item.project.name);
  }

  // A filter naming something the person cannot see matches nothing it could leak, and is simply not applied (§168).
  // AUD-08 note: dropping it shows only the person's own authorized rows, and the page echoes only kept filters,
  // so query and result still agree; narrowing to nothing instead needs the page to echo it (see the AUD-08 manifest).
  const companyId = filters.companyId && companies.has(filters.companyId) ? filters.companyId : null;
  const moduleKey = filters.module && modules.has(filters.module as ModuleKey) ? filters.module : null;
  const projectId = filters.projectId && projects.has(filters.projectId) ? filters.projectId : null;
  const text = filters.q?.trim().toLowerCase() ?? "";

  const narrowed = base.filter((item) => {
    if (companyId && item.company?.id !== companyId) return false;
    if (moduleKey && item.moduleKey !== moduleKey) return false;
    if (projectId && item.project?.id !== projectId) return false;
    if (filters.since && item.at < filters.since.toISOString()) return false;
    if (filters.until && item.at > filters.until.toISOString()) return false;
    if (text) {
      const haystack = [item.title, item.subtitle, item.company?.name, item.project?.name].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
  narrowed.sort((a, b) => keyOf(b).localeCompare(keyOf(a)));

  const limit = Math.min(Math.max(filters.limit ?? MY_WORK_PAGE, 1), 50);
  const start = filters.cursor ? narrowed.findIndex((item) => keyOf(item) < filters.cursor!) : 0;
  const page = start < 0 ? [] : narrowed.slice(start, start + limit);
  const more = start >= 0 && start + limit < narrowed.length;

  incrementCounter(Metric.MY_WORK_LOAD_MS, { tab: filters.tab }, Math.max(0, performance.now() - started));
  return {
    items: page,
    nextCursor: more && page.length > 0 ? keyOf(page[page.length - 1]) : null,
    facets: {
      companies: [...companies].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      modules: [...modules].sort(),
      projects: [...projects].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    },
    workspace: workspaceOf(session),
  };
}
