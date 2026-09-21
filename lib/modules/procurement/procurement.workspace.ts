import { Prisma } from "@prisma/client";

import { modules, sectionRoute } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { inGroupWorkspace, isGroupRoute } from "@/config/workspace";
import { AccessError } from "@/lib/access/guards";
import { resolveModuleExperience, type ResolvedModuleExperience } from "@/lib/access/module-access";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { toAmountString } from "./procurement.dto";
import type { CompanyRef, CurrencyTotal } from "./procurement.types";

/**
 * Procurement in the Group workspace (Workspace Context §38, §41, §45, §72).
 *
 * The Group workspace reads the buying book of every company the person may
 * read it in, and nothing else: each company is asked with the person's own
 * context there, so a group list is the union of exactly what the company
 * pages show and never a query with the company boundary taken off. What this
 * file holds is the small vocabulary the services share to do that — which
 * contexts, how to union their scopes, how a `company` filter narrows them and
 * how money from several companies is added up without mixing currencies.
 */

export function companyRef(context: UserContext): CompanyRef {
  return { id: context.company.id, name: context.company.name };
}

/**
 * The companies whose Procurement this Group request may read for one action,
 * as the person's real context in each (§57, §58). A company where they lack
 * the module or the permission is not in the list, so it is never asked.
 *
 * None at all is a refusal — the same answer the company workspace gives a
 * person without the permission (§60, §62) — and the page decides what to say
 * before it gets here (§76).
 */
export async function groupProcurementContexts(
  session: UserContext,
  permission: Permission,
): Promise<UserContext[]> {
  const contexts = await resolveWorkspaceContexts(session, { module: "procurement", permission });
  if (contexts.length === 0) throw new AccessError("FORBIDDEN");
  return contexts;
}

/**
 * Whether the workspace lets the person read this in at least one company: the
 * page's own access check. A company workspace asks the session; the Group
 * workspace asks each company, because the anchor company is only where the
 * person is signed in and says nothing about the others (§60, §62).
 */
export async function canReadProcurement(session: UserContext, permission: Permission): Promise<boolean> {
  return (await resolveWorkspaceContexts(session, { module: "procurement", permission })).length > 0;
}

/**
 * The module's section bar for the active workspace.
 *
 * A company workspace is the person's own experience, unchanged. In the Group
 * workspace a section appears when at least one authorised company lets them
 * open it *and* the section has a group answer at all: enquiries and approvals
 * are worked inside one company and are not offered under a group header
 * (§25, §29). The group is read-only, so nothing here advertises creating.
 */
export async function resolveProcurementExperience(session: UserContext): Promise<ResolvedModuleExperience> {
  const own = resolveModuleExperience(session, "procurement");
  if (!inGroupWorkspace(session)) return own;

  const contexts = await resolveWorkspaceContexts(session, { module: "procurement" });
  const available = new Map<string, ResolvedModuleExperience["sections"][number]>();
  for (const context of contexts) {
    for (const section of resolveModuleExperience(context, "procurement").sections) {
      if (!available.has(section.key)) available.set(section.key, section);
    }
  }

  const sections = modules.procurement.sections
    .filter((section) => isGroupRoute("procurement", sectionRoute("procurement", section.key)))
    .flatMap((section) => available.get(section.key) ?? []);

  const landing = modules.procurement.defaultSection;

  return {
    ...own,
    sections,
    defaultSection: landing && sections.some((section) => section.key === landing) ? landing : (sections[0]?.key ?? null),
    canCreate: false,
    canUpdate: false,
    readOnly: true,
  };
}

/**
 * One company's own rule, or the union of each authorised company's.
 *
 * Every builder starts from its own `companyId`, so a union can only match a
 * row in the company whose rule matched it. A single context is answered by its
 * builder unchanged, which is what keeps the company workspace's queries exactly
 * what they were.
 */
export function unionWhere<W extends { OR?: W[] }>(
  contexts: UserContext[],
  build: (context: UserContext) => W,
): W {
  if (contexts.length === 1) return build(contexts[0]!);
  return { OR: contexts.map(build) } as W;
}

/**
 * The `company` filter (§86, §87): one of the companies the workspace already
 * reads. It is checked against those, never trusted — an id the person may not
 * read is ignored rather than answered, so the response cannot tell them whether
 * such a company exists or what it holds.
 */
export function narrowToCompany(contexts: UserContext[], companyId: string | undefined): UserContext[] {
  if (!companyId) return contexts;
  const chosen = contexts.filter((context) => context.companyId === companyId);
  return chosen.length > 0 ? chosen : contexts;
}

/** The choices the Group `company` filter offers: the companies it may narrow to. */
export function companyFilterOptions(contexts: UserContext[]): { value: string; label: string }[] {
  return contexts
    .map((context) => ({ value: context.companyId, label: context.company.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Money from several companies, added up per currency (§72).
 *
 * Euro of one company and euro of another are the same unit and add; a lek
 * total beside them is a line of its own. V0.1 has no exchange rates, so two
 * currencies are never turned into one number (PRD #19 §190).
 */
export function mergeCurrencyTotals(...lists: (CurrencyTotal[] | null)[]): CurrencyTotal[] {
  const totals = new Map<string, { count: number; value: Prisma.Decimal }>();

  for (const list of lists) {
    for (const total of list ?? []) {
      const current = totals.get(total.currency);
      const value = new Prisma.Decimal(total.value);
      if (current) {
        current.count += total.count;
        current.value = current.value.plus(value);
      } else {
        totals.set(total.currency, { count: total.count, value });
      }
    }
  }

  return [...totals.entries()]
    .map(([currency, entry]) => ({ currency, count: entry.count, value: toAmountString(entry.value) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
