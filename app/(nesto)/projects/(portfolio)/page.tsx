import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { projectCountLabel } from "@/components/projects/portfolio/gallery";
import { ProjectsPortfolio, ProjectsPortfolioSkeleton } from "@/components/projects/portfolio/projects-portfolio";
import { canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import type { UserContext } from "@/lib/context/types";
import { creatableCompanies, listPortfolioProjects } from "@/lib/modules/projects/project.portfolio";
import { canonicalPortfolioHref, parsePortfolioQuery } from "@/lib/modules/projects/project.query";
import { PORTFOLIO_PAGE_SIZE } from "@/lib/modules/projects/project.schema";
import type { PortfolioListDTO } from "@/lib/modules/projects/project.types";
import { requireProjectPortfolio } from "../portfolio-access";

export const metadata: Metadata = { title: { absolute: "Projects · NESTO" } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Projects (E-05A; Projects Workspace Grid §1-§9, §213).
 *
 * The projects this person may open in the active workspace — every company's
 * they can open in the Group workspace, the one company's in a company
 * workspace — as one grid, in one order. The workspace is the organisational
 * filter; the page does not ask for a company, role, type, place, sort or view
 * again. It only offers a search, and the way into a project.
 */
export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const { session } = await requireProjectPortfolio();
  const params = await searchParams;

  // A bookmark from before the simplification: the same page, without the
  // filters it no longer applies (§184).
  const canonical = canonicalPortfolioHref(params);
  if (canonical) redirect(canonical);

  return (
    // No key: a new search keeps the page on screen, dimmed, while the next
    // first page arrives, so the search box keeps focus mid-typing.
    <Suspense
      fallback={
        <ProjectsFrame session={session} description={<span aria-hidden="true" className="inline-block h-4 w-44 animate-pulse rounded bg-surface-muted align-middle motion-reduce:animate-none" />}>
          <ProjectsPortfolioSkeleton />
        </ProjectsFrame>
      }
    >
      <ProjectsBody session={session} q={parsePortfolioQuery(params).q ?? ""} />
    </Suspense>
  );
}

async function ProjectsBody({ session, q }: { session: UserContext; q: string }) {
  const [result, creatable] = await Promise.all([
    // The page always renders the first page; "Load more" asks the API for the rest.
    listPortfolioProjects(session, { q: q || undefined, limit: PORTFOLIO_PAGE_SIZE }),
    creatableCompanies(session),
  ]);

  return (
    <ProjectsFrame session={session} description={headerCount(result.meta)}>
      <ProjectsPortfolio initial={result} q={q} canCreate={creatable.length > 0} />
    </ProjectsFrame>
  );
}

/**
 * "11 projects across 6 companies" in the Group workspace, "4 projects in
 * ARLIS - NDERTIM" where they are one company's (§16, §17, §68, §69). Counted
 * from the projects this person can see, so nothing hidden is hinted at (§15,
 * §18, §19), and unmoved by a search. No line at all when there are none: the
 * empty state says so.
 */
function headerCount(meta: PortfolioListDTO["meta"]): string | null {
  if (meta.visibleProjectCount === 0) return null;
  const projects = projectCountLabel(meta.visibleProjectCount);
  return meta.onlyCompany ? `${projects} in ${meta.onlyCompany.name}` : `${projects} across ${meta.visibleCompanyCount} companies`;
}

/**
 * The module frame. Its section tabs — Milestones, Archived and the company's
 * lists — belong to the session's company, so the Group workspace, which has
 * no company whose sections these would be, shows the page without them
 * (Workspace Context §25). No "New project" beside the title: the top bar's
 * + Create is where projects are started (§74, §75).
 */
function ProjectsFrame({ session, description, children }: { session: UserContext; description: React.ReactNode; children: React.ReactNode }) {
  if (session.workspace.scopeType === "COMPANY" && isModuleEnabled(session, "projects") && canAccessModule(session, "projects")) {
    return (
      <ModulePage experience={resolveModuleExperience(session, "projects")} activeSection="portfolio" description={description}>
        {children}
      </ModulePage>
    );
  }
  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-page font-semibold text-fg">Projects</h1>
        {description === null ? null : <p className="mt-1.5 text-body text-fg-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
