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
