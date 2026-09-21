import { modules, sectionRoute } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { inGroupWorkspace, isGroupRoute } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { resolveModuleExperience, type ResolvedModuleExperience } from "@/lib/access/module-access";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { toAmountString, ZERO, type Money } from "./finance.money";
import type { CompanyRef, CurrencyTotal } from "./finance.types";

/**
 * Finance in the Group workspace (Workspace Context §36, §41, §60, §72, §92).
 *
 * A group view is never a query with the company boundary taken off: it asks
 * each company the reader may open Finance in, as the reader is in that
 * company, and puts the answers together. Which companies is decided here and
 * only here — `resolveWorkspaceContexts` — so a company where Finance is off,
 * or where the reader lacks the permission, is left out of every list, total and
 * report the same way (§92). Nothing in this file is ever given a company id by
 * a browser (§57).
 */

export const companyOf = (context: UserContext): CompanyRef => ({ id: context.companyId, name: context.company.name });

/**
 * The contexts a Finance read is answered from: the reader's own in each
 * company that has Finance on and where they hold every permission named,
 * ordered by company name so a group answer reads the same on every request.
 *
 * In a company workspace this is the session itself, or nothing.
 */
export async function financeContexts(session: UserContext, ...permissions: Permission[]): Promise<UserContext[]> {
  const [first, ...rest] = permissions;
  const contexts = (await resolveWorkspaceContexts(session, { module: "finance", permission: first })).filter((context) =>
    rest.every((permission) => can(context, permission)),
  );
  return contexts.sort((a, b) => a.company.name.localeCompare(b.company.name) || a.companyId.localeCompare(b.companyId));
}

/** Whether the reader may open a Finance section anywhere the workspace reaches. */
export async function canReadFinance(session: UserContext, ...permissions: Permission[]): Promise<boolean> {
  return (await financeContexts(session, ...permissions)).length > 0;
}

/**
 * The `company` filter (§86, §87): a refinement of the workspace, never a way
 * out of it. It can only keep a company the workspace already reaches, so a
 * company the reader may not read — or one that does not exist — narrows the
 * list to nothing and says nothing about it.
 */
export function narrowToCompany(contexts: UserContext[], company: string | null | undefined): UserContext[] {
  return company ? contexts.filter((context) => context.companyId === company) : contexts;
}

/** The choices for the Group `company` filter: only companies the reader reads here. */
export function companyFilterOptions(contexts: UserContext[]): Array<{ value: string; label: string }> {
  return contexts.map((context) => ({ value: context.companyId, label: context.company.name }));
}

/**
 * Amounts added together, one bucket per currency. A currency is only ever
 * added to itself: V0.1 has no FX engine, so EUR and USD stay side by side and
 * a single figure across both would mean nothing (PRD #15 §36, §150; §72).
 */
export function mergeCurrencyTotals(lists: ReadonlyArray<readonly CurrencyTotal[]>): CurrencyTotal[] {
  const sums = new Map<string, Money>();
  for (const list of lists) {
    for (const { currency, amount } of list) sums.set(currency, (sums.get(currency) ?? ZERO).plus(amount));
  }
  return [...sums.entries()]
    .filter(([, value]) => !value.isZero())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => ({ currency, amount: toAmountString(value) }));
}

/**
 * The module's tab bar for the workspace (§25, §29). In a company workspace it
 * is the company's own. In the Group workspace it is the sections that read
 * across companies, each shown when at least one company offers it to the
 * reader — a tab that would only send them to "choose a company" is not there —
 * and the module is read-only, since creating something needs a company.
 */
export async function financeExperience(session: UserContext): Promise<ResolvedModuleExperience> {
  if (!inGroupWorkspace(session)) return resolveModuleExperience(session, "finance");

  const experiences = (await resolveWorkspaceContexts(session, { module: "finance" })).map((context) => resolveModuleExperience(context, "finance"));
  const base = experiences[0] ?? resolveModuleExperience(session, "finance");
  const sections = modules.finance.sections
    .map((section) => experiences.flatMap((experience) => experience.sections).find((offered) => offered.key === section.key))
    .filter((section): section is NonNullable<typeof section> => Boolean(section))
    .filter((section) => isGroupRoute("finance", sectionRoute("finance", section.key)));

  return {
    ...base,
    sections,
    defaultSection: sections.some((section) => section.key === modules.finance.defaultSection) ? (modules.finance.defaultSection ?? null) : (sections[0]?.key ?? null),
    canCreate: false,
    canUpdate: false,
    readOnly: true,
  };
}
