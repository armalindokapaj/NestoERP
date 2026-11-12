"use client";

import type * as React from "react";
import { usePathname } from "next/navigation";

import { ContextTabs, type ContextTab } from "@/components/navigation/context-tabs";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { ProjectStatusBadge } from "@/components/projects/portfolio/project-status-badge";
import { switchProjectHref } from "@/lib/modules/projects/project.switch";
import type { ProjectCardDTO } from "@/lib/modules/projects/project.types";
import { PageMenuSlot } from "@/components/navigation/page-menu";
import { cn } from "@/lib/utils/cn";
import type { ProjectTabKey } from "./project-context";

export type ProjectNavTab = ContextTab & { key: ProjectTabKey };

export type ProjectIdentity = { name: string; code: string; companyName: string; status: ProjectCardDTO["status"] };

/** The six sections a project always shows (Sticky Navigation §9); every other permitted one is under More. */
const PRIMARY: ProjectTabKey[] = ["overview", "planning", "units", "sales", "tasks", "calendar"];

/**
 * The project's place in the breadcrumb bar and its sticky tabs. It lives in the
 * project layout, so moving between sections swaps only the page beneath it
 * (§10, §28). A page deeper inside (a unit) names its own longer trail, which
 * takes over the bar while it is open.
 */
export function ProjectNavBar({ projectId, crumbs, tabs, sectionsLabel, identity, overviewTrailing }: { projectId: string; crumbs: Crumb[]; tabs: ProjectNavTab[]; sectionsLabel: string; identity: ProjectIdentity; overviewTrailing?: React.ReactNode }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const segment = pathname === base ? null : pathname.slice(base.length + 1).split("/")[0];
  const section = segment ? tabs.find((tab) => tab.key !== "overview" && tab.href.slice(base.length + 1).split("/")[0] === segment) : undefined;
  // Switching project keeps the section when the other project has it (MOB-05 §58).
  const segments = tabs.filter((tab) => !tab.newTab).map((tab) => tab.href.slice(base.length + 1).split("/")[0]!).filter(Boolean);
  const carried = crumbs.map((crumb) =>
    crumb.switcher
      ? { ...crumb, switcher: { ...crumb.switcher, items: crumb.switcher.items.map((item) => ({ ...item, href: item.current ? item.href : switchProjectHref(pathname, projectId, item.href.split("/").pop()!, segments) })) } }
      : crumb,
  );
  const trail = section ? [...carried, { label: section.label, href: section.href }] : carried;
  /*
   * Below lg: who and what, once — name, code, company and status in one
   * compact header, in the tab row's place (MOB-05 §18, §19, §70). The page's
   * ⋯ follows the status on the same line: the Overview's project menu, or on
   * a section the ⋯ for its tips, Help and secondary actions when it has any.
   * A section's own page header then draws only its actions
   * (RecordContextHeader `nameInLayout`) and the Overview's hero no name, so
   * the name is not shown twice. From lg the row is the tabs alone: the
   * Overview's menu is on its hero, after the status (page.tsx), and a
   * section's ⋯ in its own page header, after its title or status.
   */
  const header = <ProjectCompactHeader identity={identity} className="lg:hidden" />;
  const overviewMenu = segment === null ? overviewTrailing : undefined;
  return (
    <>
      <Breadcrumbs items={trail} level="layout" />
      {/*
        * A project with no section but its Overview draws no tab row; its header
        * stands alone, and on the Overview the project's menu still ends it, as it
        * ends the tab row's place in a project with sections.
        */}
      {tabs.length <= 1 ? (
        overviewMenu ? (
          <div className="flex items-stretch gap-2 lg:hidden" data-project-header-alone>
            {header}
            <div className="flex h-(--nesto-shell-tab-row-h) shrink-0 items-center gap-1" data-project-menu>
              {overviewMenu}
            </div>
          </div>
        ) : (
          header
        )
      ) : null}
      {/* The Overview's menu ends the compact row below lg, on the Overview only; from lg the row is the tabs alone. */}
      <ContextTabs label={sectionsLabel} tabs={tabs} primary={PRIMARY} rootKey="overview" trailing={overviewMenu} lead={header} />
    </>
  );
}

/**
 * The project's compact header below lg: its code and company in one mono
 * line on the left — the top bar above already names the project, in the
 * display face (components/layout/phone-title.tsx) — and its status, then the
 * page's ⋯, on the right. The ⋯ here is the one for a section's tips, Help and
 * secondary actions (`PageMenuSlot`, below lg only: from lg a section's own
 * header has it); on the Overview the project's own menu, which follows this
 * header in the row, holds them.
 */
function ProjectCompactHeader({ identity, className }: { identity: ProjectIdentity; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2 py-1", className)} data-testid="project-phone-identity">
      <div className="min-w-0 flex-1">
        <p className="sr-only">{identity.name}</p>
        <p className="truncate font-mono text-meta font-medium uppercase tracking-[0.1em] text-fg-subtle">
          <span data-testid="project-phone-code" className="text-fg">{identity.code}</span>
          <span aria-hidden="true"> · </span>
          <span data-testid="project-phone-company">{identity.companyName}</span>
        </p>
      </div>
      <ProjectStatusBadge status={identity.status} className="shrink-0" />
      <PageMenuSlot at="belowLg" />
    </div>
  );
}
