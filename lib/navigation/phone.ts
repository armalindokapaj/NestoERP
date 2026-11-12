/**
 * The phone's five places (docs/ui/UI-04-navigation-layouts.md §Phone):
 * Home, Projects, New, Inbox and Menu, in the bar at the bottom below `lg`.
 *
 * A presentation adapter: it decides which place a path belongs to and where
 * Projects goes, never what a person may open — the navigation resolver and
 * every page decide that. Edge-safe, so it is unit-tested on its own.
 */

export type PhonePlace = "home" | "projects" | "inbox" | "menu";

export const PHONE_HOME = "/my-day";
export const PHONE_INBOX = "/inbox";
export const PHONE_MENU = "/menu";
export const PROJECTS_ROOT = "/projects";

/** Paths under /projects that are pages of the module, not a project. */
const NOT_A_PROJECT = new Set(["all", "archived", "milestones", "my-projects", "new", "types", "unit-types", "units"]);

/** The project a path is in; null outside a project. */
export function projectIdFrom(pathname: string): string | null {
  const id = /^\/projects\/([^/?#]+)/.exec(pathname)?.[1];
  return id && !NOT_A_PROJECT.has(id) ? id : null;
}

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

/**
 * The place a page belongs to, which the bar marks. Home is your day and the
 * Dashboard; Projects is every project page; Inbox is approvals and activity;
 * everything else was reached through Menu, so Menu is where you are.
 */
export function placeOf(pathname: string): PhonePlace {
  if (under(pathname, PHONE_HOME) || under(pathname, "/dashboard")) return "home";
  if (under(pathname, PROJECTS_ROOT)) return "projects";
  if (under(pathname, PHONE_INBOX) || under(pathname, "/approvals") || under(pathname, "/activity") || under(pathname, "/notifications")) return "inbox";
  return "menu";
}

/** A place's own first page: no Back in the top bar there, the bar is the way out. */
export function isPlaceRoot(pathname: string): boolean {
  if ([PHONE_HOME, PHONE_INBOX, PHONE_MENU, PROJECTS_ROOT, "/dashboard"].includes(pathname)) return true;
  const project = projectIdFrom(pathname);
  return project !== null && pathname === `${PROJECTS_ROOT}/${project}`;
}

/** Where Projects goes: the project you were last in, in this workspace, else every project. */
export function projectsHref(lastProjectId: string | null): string {
  return lastProjectId ? `${PROJECTS_ROOT}/${lastProjectId}` : PROJECTS_ROOT;
}

const LAST_PROJECT_KEY = "nesto-last-project";

/** The last project opened in this workspace, on this device; never a record's content, only its id. */
export function readLastProject(workspaceKey: string): string | null {
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_PROJECT_KEY) ?? "{}") as Record<string, unknown>;
    const id = stored[workspaceKey];
    return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function rememberLastProject(workspaceKey: string, projectId: string): void {
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_PROJECT_KEY) ?? "{}") as Record<string, string>;
    localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({ ...stored, [workspaceKey]: projectId }));
  } catch {
    // Not remembered: Projects opens the list instead.
  }
}
