/**
 * Gallery or list, remembered per browser (E-05A §23).
 *
 * NESTO has no user-preference store — the interface language is a cookie for
 * the same reason (`nesto.locale`) — so this follows it rather than inventing
 * one: a cookie the server reads, so the page renders in the remembered mode
 * with no flash of the other. Clear Filters never touches it (E-05A §19).
 */
export const PROJECTS_VIEW_COOKIE = "nesto.projects.view";

export type ProjectsView = "gallery" | "list";

export function parseProjectsView(value: string | undefined | null): ProjectsView {
  return value === "list" ? "list" : "gallery";
}

/** One year; the preference is a convenience, not a record. */
export function projectsViewCookie(view: ProjectsView): string {
  return `${PROJECTS_VIEW_COOKIE}=${view}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
