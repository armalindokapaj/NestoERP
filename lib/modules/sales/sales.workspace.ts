import { modules, sectionRoute } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { inGroupWorkspace, isGroupRoute } from "@/config/workspace";
import { resolveModuleExperience, type ResolvedModuleExperience } from "@/lib/access/module-access";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import type { CompanyRef } from "./sales.types";

/**
 * Sales in the Group workspace (Workspace Context §25, §37, §41, §45, §58).
 *
 * The session is one company's context; in the Group workspace it is only where
 * the person is anchored. A group view asks each company the person may read
 * Sales in, with that company's own rules, and unions the answers — these
 * helpers are the one place that decides which companies, so no sales service
 * takes a company id from a browser (§14, §57).
 */

const MODULE = "sales" as const;

export function companyRefOf(context: UserContext): CompanyRef {
  return { id: context.companyId, name: context.company.name };
}

/** Company id to its label, for stamping the rows a group read returns. */
export function companyRefs(contexts: UserContext[]): Map<string, CompanyRef> {
  return new Map(contexts.map((context) => [context.companyId, companyRefOf(context)]));
}

/**
 * A `company` filter narrows what the workspace already reads (§86, §87): it is
 * matched against the companies the person may read and never trusted. A
 * company they may not read — or one that does not exist — narrows nothing, and
 * nothing says which of the two it was.
 */
export function narrowToCompany(contexts: UserContext[], companyId: string | undefined): UserContext[] {
  if (!companyId) return contexts;
  const match = contexts.filter((context) => context.companyId === companyId);
  return match.length > 0 ? match : contexts;
}

/**
 * The companies the Group workspace reads for an action, narrowed by the
 * optional `company` filter. Empty means the person holds the action nowhere:
 * a group result with nothing in it, not an error (§76).
 */
export async function groupReaders(
  session: UserContext,
  permission: Permission,
  companyId?: string,
): Promise<UserContext[]> {
  return narrowToCompany(await resolveWorkspaceContexts(session, { module: MODULE, permission }), companyId);
}

/** Every company the person may read for an action, never narrowed: the options of the company filter. */
export async function groupCompanies(session: UserContext, permission: Permission): Promise<CompanyRef[]> {
  const contexts = await resolveWorkspaceContexts(session, { module: MODULE, permission });
  return contexts.map(companyRefOf).sort((a, b) => a.name.localeCompare(b.name));
}

/** The companies a `company` filter leaves in play: the one it names among those readable, else all of them. */
export function includedCompanies(companies: CompanyRef[], companyId: string | undefined): CompanyRef[] {
  const match = companyId ? companies.filter((company) => company.id === companyId) : [];
  return match.length > 0 ? match : companies;
}

/**
 * The module's sections for the workspace (§25, §85).
 *
 * In a company: what the session's role reaches, unchanged. In the group: only
 * the sections that read across companies, and only those the person holds in at
 * least one authorised company — a tab that would answer "choose a company" is
 * not offered under a group header. The group is read-only, so nothing here
 * offers to create.
 */
export async function resolveSalesExperience(session: UserContext): Promise<ResolvedModuleExperience> {
  const experience = resolveModuleExperience(session, MODULE);
  if (!inGroupWorkspace(session)) return experience;

  const perCompany = (await resolveWorkspaceContexts(session, { module: MODULE })).map(
    (context) => resolveModuleExperience(context, MODULE).sections,
  );
  const sections = modules[MODULE].sections.flatMap((section) => {
    if (!isGroupRoute(MODULE, sectionRoute(MODULE, section.key))) return [];
    const held = perCompany.map((list) => list.find((candidate) => candidate.key === section.key)).find(Boolean);
    return held ? [held] : [];
  });
  const preferred = modules[MODULE].defaultSection;

  return {
    ...experience,
    sections,
    defaultSection: preferred && sections.some((section) => section.key === preferred) ? preferred : (sections[0]?.key ?? null),
    canCreate: false,
    canUpdate: false,
    readOnly: true,
  };
}
