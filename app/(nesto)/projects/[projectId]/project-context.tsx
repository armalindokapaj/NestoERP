import { notFound } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as projects from "@/lib/modules/projects/project.service";
import type { ProjectDetailDTO } from "@/lib/modules/projects/project.types";

/**
 * Loads the project every tab needs (PRD #10 §139).
 *
 * A project outside the caller's scope is a 404 — the same answer the API
 * gives, so a URL cannot be used to discover that a record exists
 * (PRD #10 §113).
 */
export async function loadProject(
  projectId: string,
): Promise<{ context: UserContext; project: ProjectDetailDTO }> {
  const context = await requireModule("projects");

  try {
    const project = await projects.getProject(context, projectId);
    return { context, project };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export type ProjectTabKey =
  | "overview"
  | "tasks"
  | "team"
  | "finance"
  | "contracts"
  | "documents"
  | "activity";

export function projectBreadcrumbs(project: ProjectDetailDTO, tab?: string) {
  const crumbs = [
    { label: "Projects", href: "/projects" },
    { label: project.name, ...(tab ? { href: `/projects/${project.id}` } : {}) },
  ];
  if (tab) crumbs.push({ label: tab });
  return crumbs;
}
