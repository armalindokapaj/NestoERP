import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { canNavigate } from "./navigable.registry";
import type { EntityRef } from "./productivity.schema";
import { resolveProductivitySettings } from "./productivity.settings";
import { inGroupWorkspace } from "@/config/workspace";

/**
 * What favorites and recent work share about the Group workspace
 * (Workspace Context §43, §44).
 *
 * Both are the person's own, kept per membership — one record in the company
 * the thing lives in — so the Group workspace never invents a company of its
 * own: it reads every membership of the person and writes to the one that owns
 * the record.
 */

/** The company a record lives in, named on a row in the Group workspace only (§44, §45). */
export type InCompany = { company?: { id: string; name: string } };

/** The contexts a filter narrows to; a company the person may not use is no filter at all (§57, §87). */
export function narrowedTo(contexts: UserContext[], companyId?: string | null): UserContext[] {
  const narrowed = companyId ? contexts.filter((context) => context.companyId === companyId) : [];
  return narrowed.length > 0 ? narrowed : contexts;
}

/**
 * The context in which this record is the person's to open: the one company it
 * belongs to. Records belong to exactly one company, so at most one of the
 * person's contexts resolves it — and none does when they cannot open it, which
 * is the answer for an unknown record too.
 */
export async function contextOpening(session: UserContext, ref: EntityRef): Promise<UserContext | null> {
  const contexts = await resolveWorkspaceContexts(session, {});
  const opened = await Promise.all(contexts.map(async (context) => ((await canNavigate(context, ref.entityType, ref.entityId)) ? context : null)));
  return opened.find((context): context is UserContext => context !== null) ?? null;
}

/**
 * Whether favorites and recent work are switched on for what the workspace
 * reads: the company's own switches in a company workspace, and in the Group
 * workspace on wherever any of the person's companies has them on (a company
 * that switched one off simply contributes none).
 */
export async function productivityAvailability(session: UserContext): Promise<{ favoritesEnabled: boolean; recentWorkEnabled: boolean }> {
  const contexts = inGroupWorkspace(session) ? await resolveWorkspaceContexts(session, {}) : [session];
  const settings = await Promise.all(contexts.map((context) => resolveProductivitySettings(context.companyId)));
  return { favoritesEnabled: settings.some((row) => row.favoritesEnabled), recentWorkEnabled: settings.some((row) => row.recentWorkEnabled) };
}
