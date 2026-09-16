import { parsePortfolioQuery } from "@/lib/modules/projects/project.query";

/**
 * A Projects page URL for a link written before E-05A (`/projects/all`,
 * `/projects/my-projects`). Only what the new page understands is carried:
 * the search and the first status, which the query parser already reads in the
 * renamed vocabulary. Priority, client and manager filters had no successor.
 */
export function legacyProjectsHref(
  params: Record<string, string | string[] | undefined>,
  extra: Record<string, string> = {},
): string {
  const status = typeof params.status === "string" ? params.status.split(",")[0] : undefined;
  const query = parsePortfolioQuery({ search: params.search, status });
  const next = new URLSearchParams();
  if (query.q) next.set("q", query.q);
  if (query.status) next.set("status", query.status);
  for (const [key, value] of Object.entries(extra)) next.set(key, value);
  const text = next.toString();
  return text ? `/projects?${text}` : "/projects";
}
