import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule, requireUserContext } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { REQUEST_PATH_HEADER } from "@/lib/core/security/request-path";
import { findPortfolioProject } from "@/lib/modules/projects/project.portfolio";
import * as projects from "@/lib/modules/projects/project.service";
import type { ProjectDetailDTO } from "@/lib/modules/projects/project.types";

/**
 * Loads the project every tab needs (PRD #10 §139; E-05A §26, §34).
 *
 * A project in the session's company opens as it always has. A project in
 * another of the person's companies — a link from the Projects page, a shared
 * URL, a bookmark — goes through the open step, which moves the session there
 * and comes back to exactly the page asked for. Anything else is a 404, the
 * same answer the API gives, so a URL cannot be used to discover that a record
 * exists or which company holds it (PRD #10 §113, E-05A §49).
 */
export async function loadProject(
  projectId: string,
): Promise<{ context: UserContext; project: ProjectDetailDTO }> {
  const session = await requireUserContext();
  const opensHere = isModuleEnabled(session, "projects") && canAccessModule(session, "projects");

  if (opensHere) {
    try {
      return { context: session, project: await projects.getProject(session, projectId) };
    } catch (error) {
      if (!(error instanceof AccessError && error.code === "NOT_FOUND")) throw error;
    }
  }

  const match = await findPortfolioProject(session, projectId);
  if (match && !match.membership.isCurrent) {
    const requested = (await headers()).get(REQUEST_PATH_HEADER) ?? `/projects/${projectId}`;
    redirect(`/projects/${projectId}/open?next=${encodeURIComponent(requested)}`);
  }

  if (!opensHere) await requireModule("projects");
  notFound();
}

export type ProjectTabKey =
  | "overview"
  | "planning"
  | "units"
  | "sales"
  | "tasks"
  | "calendar"
  | "meetings"
  | "dailyLogs"
  | "workforce"
  | "contractors"
  | "engineering"
  | "team"
  | "finance"
  | "contracts"
  | "inventory"
  | "qaqc"
  | "hse"
  | "documents"
  | "activity";

/** Projects / Company / Project — the company is always named (E-05A §9, §26). */
export function projectBreadcrumbs(project: ProjectDetailDTO, tab?: string) {
  const crumbs = [
    { label: "Projects", href: "/projects" },
    { label: project.company.name, href: `/projects?company=${encodeURIComponent(project.company.id)}` },
    { label: project.name, ...(tab ? { href: `/projects/${project.id}` } : {}) },
  ];
  if (tab) crumbs.push({ label: tab });
  return crumbs;
}
