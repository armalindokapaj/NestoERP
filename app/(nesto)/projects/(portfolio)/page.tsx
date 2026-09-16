import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { ProjectsPortfolio, ProjectsPortfolioSkeleton } from "@/components/projects/portfolio/projects-portfolio";
import { Button } from "@/components/ui/button";
import { canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import type { UserContext } from "@/lib/context/types";
import { listPortfolioProjects, portfolioFilterOptions } from "@/lib/modules/projects/project.portfolio";
import { activePortfolioFilterCount, parsePortfolioQuery } from "@/lib/modules/projects/project.query";
import { parseProjectsView, PROJECTS_VIEW_COOKIE } from "@/lib/modules/projects/project.view-preference";
import { requireProjectPortfolio } from "../portfolio-access";

export const metadata: Metadata = { title: { absolute: "Projects · NESTO" } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Projects (E-05A §1, §4, §5).
 *
 * One continuous collection of every project this person may open, in every
 * company they belong to — favorites first, then whatever was worked on most
 * recently. No separate sections for recent, finished or starred work: those
 * are filters on the one collection.
 */
export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const { session } = await requireProjectPortfolio();
  const params = await searchParams;

  return (
    // No key: a new search or filter keeps the page on screen, dimmed, while
    // the next first page arrives, so the search box keeps focus mid-typing.
    <Suspense fallback={<ProjectsFrame session={session} description="Loading projects…"><ProjectsPortfolioSkeleton /></ProjectsFrame>}>
      <ProjectsBody session={session} params={params} />
    </Suspense>
  );
}

async function ProjectsBody({ session, params }: { session: UserContext; params: Awaited<SearchParams> }) {
  const query = parsePortfolioQuery(params);
  const [result, options, cookieStore] = await Promise.all([
    // The page always renders the first page; "Load more" asks the API for the rest.
    listPortfolioProjects(session, { ...query, cursor: undefined }),
    portfolioFilterOptions(session),
    cookies(),
  ]);

  const { visibleProjectCount: projects, visibleCompanyCount: companies } = result.meta;
  const description =
    projects === 0
      ? "Projects you can open, in every company you work for."
      : `${projects} ${projects === 1 ? "project" : "projects"}${companies > 1 ? ` across ${companies} companies` : ""}`;

  return (
    <ProjectsFrame
      session={session}
      description={description}
      actions={
        options.creatableCompanies.length > 0 ? (
          <Button asChild size="sm">
            <Link href="/projects/new" aria-label="New project">
              <Plus aria-hidden="true" />
              {/* A phone keeps the header to "Projects +" (E-05A §38). */}
              <span className="hidden sm:inline">New project</span>
            </Link>
          </Button>
        ) : null
      }
    >
      <ProjectsPortfolio
        initial={result}
        options={options}
        query={query}
        filterCount={activePortfolioFilterCount(query)}
        initialView={parseProjectsView(cookieStore.get(PROJECTS_VIEW_COOKIE)?.value)}
      />
    </ProjectsFrame>
  );
}

/**
 * The module frame. Its section tabs — Milestones, Archived — belong to the
 * session's company, so somebody whose session is in a company without project
 * access sees the page without them.
 */
function ProjectsFrame({ session, description, actions, children }: { session: UserContext; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  if (isModuleEnabled(session, "projects") && canAccessModule(session, "projects")) {
    return (
      <ModulePage experience={resolveModuleExperience(session, "projects")} activeSection="portfolio" description={description} actions={actions}>
        {children}
      </ModulePage>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-fg">Projects</h1>
          <p className="mt-1.5 text-body text-fg-muted">{description}</p>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
