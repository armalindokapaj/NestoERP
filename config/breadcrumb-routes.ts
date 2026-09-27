import { moduleList, type ModuleKey } from "./modules";

export type RouteBreadcrumbMetadata = {
  moduleKey: ModuleKey;
  moduleLabel: string;
  moduleHref: string;
  collectionLabel?: string;
  collectionHref?: string;
};

function cleanPath(pathname: string): string {
  const value = pathname.split("?")[0].replace(/\/{2,}/g, "/");
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

/**
 * Breadcrumb metadata comes from the canonical module registry. This is kept
 * deliberately label-only: dynamic entity labels still come from the
 * authorized record DTO already loaded by the page.
 */
export function breadcrumbRouteMetadata(pathnameInput: string): RouteBreadcrumbMetadata | null {
  const pathname = cleanPath(pathnameInput);
  const moduleDefinition = moduleList
    .slice()
    .sort((left, right) => right.route.length - left.route.length)
    .find((candidate) => pathname === candidate.route || pathname.startsWith(`${candidate.route}/`));
  if (!moduleDefinition) return null;

  const section = moduleDefinition.sections.find(({ key }) => {
    const href = `${moduleDefinition.route}/${key}`;
    return pathname === href || pathname.startsWith(`${href}/`);
  });

  return {
    moduleKey: moduleDefinition.key,
    moduleLabel: moduleDefinition.label,
    moduleHref: moduleDefinition.route,
    collectionLabel: section?.label,
    collectionHref: section ? `${moduleDefinition.route}/${section.key}` : undefined,
  };
}

/** The in-app history entry shape the record navigation keeps in this tab (components/navigation/record-navigation-provider.tsx). */
export type ReturnHistoryEntry = { route: string; workspaceKey: string };

/**
 * Where a list crumb should return to (AUD-05 §3, UX-04): the list exactly as
 * the person last left it in this workspace — its search, filters and page —
 * when this tab's own history has it; otherwise the plain list.
 *
 * Only an entry for the same path in the same workspace counts, and only its
 * query is borrowed, so a crumb can never be turned into another destination
 * or carry one company's filters into another.
 */
export function returnHref(href: string, history: readonly ReturnHistoryEntry[], workspaceKey: string | null): string {
  const target = cleanPath(href);
  if (!workspaceKey || href.includes("?")) return href;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || entry.workspaceKey !== workspaceKey || typeof entry.route !== "string") continue;
    const [path, query = ""] = entry.route.split("?");
    if (cleanPath(path) !== target) continue;
    return query ? `${target}?${query}` : href;
  }
  return href;
}

/**
 * The page a Back control falls back to when this tab has no history — a
 * deep link opened from an e-mail or another app (AUD-05 §3, UX-04): the
 * nearest parent the trail already offers as a link, which the page and the
 * module registry only ever offer to somebody who may open it.
 */
export function fallbackParent<T extends { href?: string; disabled?: boolean; label: string }>(trail: readonly T[]): T | null {
  for (let index = trail.length - 2; index >= 0; index -= 1) {
    const item = trail[index];
    if (item?.href && !item.disabled) return item;
  }
  return null;
}
