import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { OpenProjectInCompany } from "@/components/projects/open-project-in-company";
import { requireUserContext } from "@/lib/context/current-user";
import { findPortfolioProject } from "@/lib/modules/projects/project.portfolio";

export const metadata: Metadata = { title: "Opening project" };

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
};

/**
 * Opening a project that lives in another of the person's companies
 * (E-05A §26, §34).
 *
 * Rendering this page changes nothing — a prefetch or a crawler may load it.
 * The move happens when the page, in the person's browser, asks for it with a
 * POST, and only for a project the server has just found through their own
 * membership. Anything else is a 404 that names nothing.
 */
export default async function OpenProjectPage({ params, searchParams }: Props) {
  const [{ projectId }, { next }] = await Promise.all([params, searchParams]);
  const session = await requireUserContext();

  const match = await findPortfolioProject(session, projectId);
  if (!match) notFound();

  const destination = safeDestination(typeof next === "string" ? next : undefined, projectId);
  if (match.membership.isCurrent) redirect(destination);

  return (
    <OpenProjectInCompany
      projectId={projectId}
      projectName={match.project.name}
      companyName={match.membership.company.name}
      destination={destination}
    />
  );
}

/**
 * Only somewhere inside this project — never an arbitrary URL, so the page
 * cannot be used as a redirect to anywhere else.
 */
function safeDestination(next: string | undefined, projectId: string): string {
  const base = `/projects/${projectId}`;
  if (!next) return base;
  let url: URL;
  try {
    url = new URL(next, "http://nesto.local");
  } catch {
    return base;
  }
  if (url.origin !== "http://nesto.local") return base;
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return base;
  if (url.pathname.startsWith(`${base}/open`)) return base;
  return `${url.pathname}${url.search}`;
}
