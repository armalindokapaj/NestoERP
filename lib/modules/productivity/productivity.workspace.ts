import type { UserContext } from "@/lib/context/types";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { canNavigate } from "./navigable.registry";
import type { EntityRef } from "./productivity.schema";
import { resolveProductivitySettings } from "./productivity.settings";

/**
 * What favorites and recent work share about workspaces (Fast Re-entry PRD §38,
 * §124; Workspace Context §43, §44).
 *
 * Both are the person's own and user-global: whichever workspace they are in,
 * they see every favorite and recent record they can still open in any company
 * of their group — never another group's (§191). Storage stays per membership,
 * one row in the company the record lives in, so the rows never copy a record
 * and a company that removes the person takes its rows' visibility with it.
 */

/** The company a record lives in — named on every row, since every row may be another company's (§53, §162). */
export type InCompany = { company?: { id: string; name: string } };

/**
 * Every company of the person's group they may use, as their own context
 * there, whatever the active workspace (§38). The session's own company comes
 * first, so a record it can open is resolved there without asking the others.
 */
export async function personalContexts(session: UserContext): Promise<UserContext[]> {
  const contexts = await resolveGroupContexts(session);
  const own = contexts.find((context) => context.companyId === session.companyId);
  if (!own) return contexts.length > 0 ? contexts : [session];
  return [own, ...contexts.filter((context) => context !== own)];
}

/** The contexts a filter narrows to; a company the person may not use is no filter at all (§63, §168). */
export function narrowedTo(contexts: UserContext[], companyId?: string | null): UserContext[] {
  const narrowed = companyId ? contexts.filter((context) => context.companyId === companyId) : [];
  return narrowed.length > 0 ? narrowed : contexts;
}

/**
 * The context in which this record is the person's to open: the one company it
 * belongs to. Records belong to exactly one company, so at most one of the
 * person's contexts resolves it — and none does when they cannot open it, which
 * is the answer for an unknown record too (§103, §190).
 */
export async function contextOpening(session: UserContext, ref: EntityRef): Promise<UserContext | null> {
  const [first, ...rest] = await personalContexts(session);
  if (first && (await canNavigate(first, ref.entityType, ref.entityId))) return first;
  const opened = await Promise.all(rest.map(async (context) => ((await canNavigate(context, ref.entityType, ref.entityId)) ? context : null)));
  return opened.find((context): context is UserContext => context !== null) ?? null;
}

/** Whether favorites and recent work are on anywhere the person reads (a company that switched one off contributes none). */
export async function productivityAvailability(session: UserContext): Promise<{ favoritesEnabled: boolean; recentWorkEnabled: boolean }> {
  const contexts = await personalContexts(session);
  const settings = await Promise.all(contexts.map((context) => resolveProductivitySettings(context.companyId)));
  return { favoritesEnabled: settings.some((row) => row.favoritesEnabled), recentWorkEnabled: settings.some((row) => row.recentWorkEnabled) };
}
