import { parsePortfolioQuery } from "@/lib/modules/projects/project.query";

/**
 * A Projects page URL for a link written before E-05A (`/projects/all`,
 * `/projects/my-projects`). Only the search carries over: the page has no
 * status, role or other filter to carry it into (Projects Workspace Grid §183,
 * §184). Priority, client and manager filters had no successor even before.
 */
export function legacyProjectsHref(params: Record<string, string | string[] | undefined>): string {
  const { q } = parsePortfolioQuery(params);
  return q ? `/projects?${new URLSearchParams({ q }).toString()}` : "/projects";
}
