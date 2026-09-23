import { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { canNavigate, resolveNavigable, type NavigableEntityDTO } from "./navigable.registry";
import { resolveProductivitySettings } from "./productivity.settings";
import type { EntityRef } from "./productivity.schema";
import { contextOpening, narrowedTo, personalContexts, type InCompany } from "./productivity.workspace";

/**
 * Favorites (PRD #45 §69-§93, §161, §250, §253, §256).
 *
 * A personal shortcut for one company membership: added only to a record the
 * member can open now, shown only while they still can, never a door of its
 * own. Adding twice is one favorite; removing needs no confirmation; nobody
 * else — no manager, no audit — sees them.
 */

/** An operational soft limit, not a product cap (Fast Re-entry §71). */
export const FAVORITES_LIMIT = 500;

export type FavoriteItemDTO = NavigableEntityDTO & InCompany & { favoritedAt: string };

function fail(code: string, message: string, status: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" = "VALIDATION_ERROR") {
  return new AccessError(status, message, { code });
}

async function assertEnabled(companyId: string) {
  if (!(await resolveProductivitySettings(companyId)).favoritesEnabled) throw fail("FAVORITES_DISABLED", "Favorites are switched off for this company.", "FORBIDDEN");
}

export async function listFavorites(context: UserContext, options: { limit?: number } = {}): Promise<FavoriteItemDTO[]> {
  if (!(await resolveProductivitySettings(context.companyId)).favoritesEnabled) return [];
  const rows = await prisma.userFavorite.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId },
    orderBy: { createdAt: "desc" },
    take: FAVORITES_LIMIT,
    select: { entityType: true, entityId: true, createdAt: true },
  });
  const favoritedAt = new Map(rows.map((row) => [`${row.entityType}:${row.entityId}`, row.createdAt.toISOString()]));
  const items = await resolveNavigable(context, rows);
  return items.slice(0, options.limit ?? FAVORITES_LIMIT).map((item) => ({ ...item, favoritedAt: favoritedAt.get(`${item.entityType}:${item.entityId}`)! }));
}

/** Which of these records the member has starred — for stars on search results and headers. */
export async function favoriteKeys(context: UserContext, refs?: EntityRef[]): Promise<Set<string>> {
  const rows = await prisma.userFavorite.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId, ...(refs ? { OR: refs.map((ref) => ({ entityType: ref.entityType, entityId: ref.entityId })) } : {}) },
    select: { entityType: true, entityId: true },
  });
  return new Set(rows.map((row) => `${row.entityType}:${row.entityId}`));
}

export async function isFavorite(context: UserContext, entityType: string, entityId: string): Promise<boolean> {
  return (await prisma.userFavorite.count({ where: { companyId: context.companyId, memberId: context.membershipId, entityType, entityId } })) > 0;
}

export async function addFavorite(context: UserContext, ref: EntityRef): Promise<FavoriteItemDTO> {
  await assertEnabled(context.companyId);
  // The record must be one this member can open right now (§78, §161).
  const item = await canNavigate(context, ref.entityType, ref.entityId);
  if (!item) throw fail("FAVORITE_NOT_FOUND", "That record could not be found.", "NOT_FOUND");
  const existing = await prisma.userFavorite.findUnique({ where: { memberId_entityType_entityId: { memberId: context.membershipId, entityType: ref.entityType, entityId: ref.entityId } }, select: { createdAt: true } });
  if (existing) return { ...item, favoritedAt: existing.createdAt.toISOString() };
  const count = await prisma.userFavorite.count({ where: { companyId: context.companyId, memberId: context.membershipId } });
  if (count >= FAVORITES_LIMIT) throw fail("FAVORITES_LIMIT", `You can keep up to ${FAVORITES_LIMIT} favorites. Remove one first.`, "CONFLICT");
  try {
    const row = await prisma.userFavorite.create({ data: { companyId: context.companyId, memberId: context.membershipId, entityType: ref.entityType, entityId: ref.entityId }, select: { createdAt: true } });
    return { ...item, favoritedAt: row.createdAt.toISOString() };
  } catch (error) {
    // A second click that raced the first is the same favorite (§85, §296).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ...item, favoritedAt: new Date().toISOString() };
    throw error;
  }
}

/**
 * Un-stars a record, and says whether anything was actually un-starred.
 *
 * Only this member's own favourites in their own company are ever touched, so
 * a request naming somebody else's record removes nothing — and answers `false`
 * rather than claiming a removal that never happened. Repeating the call is
 * still safe and still 200: a second click is not an error (PRD #47 §75).
 */
export async function removeFavorite(context: UserContext, ref: EntityRef): Promise<boolean> {
  const { count } = await prisma.userFavorite.deleteMany({ where: { companyId: context.companyId, memberId: context.membershipId, entityType: ref.entityType, entityId: ref.entityId } });
  return count > 0;
}

/* -------------------------------------------------------------------------- */
/* The active workspace (Workspace Context §44)                                */
/* -------------------------------------------------------------------------- */

/**
 * The person's favorites in the active workspace (§44).
 *
 * A favorite stays one record tied to the user's membership in the record's own
 * company — starring never copies it. A company workspace shows that company's
 * favorites, which is the company-relevant set. The Group workspace shows all of
 * them: each company's own list, resolved in that company's own context so a
 * favorite is shown only where the person can still open it, then merged newest
 * first, every row naming its company. `companyId` is a filter, ignored when it
 * is not one of the companies the person may use (§57, §87).
 */
export async function listFavoritesForWorkspace(session: UserContext, options: { limit?: number; companyId?: string | null } = {}): Promise<FavoriteItemDTO[]> {
  const contexts = narrowedTo(await personalContexts(session), options.companyId);
  const lists = await Promise.all(
    contexts.map(async (context) => {
      const company = { id: context.companyId, name: context.company.name };
      return (await listFavorites(context, { limit: options.limit })).map((item) => ({ ...item, company }));
    }),
  );
  return lists
    .flat()
    .sort((a, b) => b.favoritedAt.localeCompare(a.favoritedAt) || `${a.entityType}:${a.entityId}`.localeCompare(`${b.entityType}:${b.entityId}`))
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
}

/**
 * Stars a record. In the Group workspace the record decides the company: the
 * favorite is written for the person's membership in the company it lives in,
 * never for whichever company the session happens to be anchored in.
 */
export async function addFavoriteForWorkspace(session: UserContext, ref: EntityRef): Promise<FavoriteItemDTO> {
  const owner = await contextOpening(session, ref);
  if (!owner) throw fail("FAVORITE_NOT_FOUND", "That record could not be found.", "NOT_FOUND");
  return { ...(await addFavorite(owner, ref)), company: { id: owner.companyId, name: owner.company.name } };
}

/** Un-stars a record, in whichever of the person's memberships it was starred; only their own are ever touched (PRD #47 §75). */
export async function removeFavoriteForWorkspace(session: UserContext, ref: EntityRef): Promise<boolean> {
  const own = (await personalContexts(session)).map((context) => ({ companyId: context.companyId, memberId: context.membershipId }));
  const { count } = await prisma.userFavorite.deleteMany({ where: { OR: own, entityType: ref.entityType, entityId: ref.entityId } });
  return count > 0;
}
