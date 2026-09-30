"use client";

import { usePathname } from "next/navigation";

import { ContextTabs, type ContextTab } from "@/components/navigation/context-tabs";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { ProjectStatusBadge } from "@/components/projects/portfolio/project-status-badge";
import { switchProjectHref } from "@/lib/modules/projects/project.switch";
import type { ProjectCardDTO } from "@/lib/modules/projects/project.types";
import type { ProjectTabKey } from "./project-context";

export type ProjectNavTab = ContextTab & { key: ProjectTabKey };

export type ProjectIdentity = { name: string; companyName: string; status: ProjectCardDTO["status"] };

/** The six sections a project always shows (Sticky Navigation §9); every other permitted one is under More. */
const PRIMARY: ProjectTabKey[] = ["overview", "planning", "units", "sales", "tasks", "calendar"];

/**
 * The project's place in the breadcrumb bar and its sticky tabs. It lives in the
 * project layout, so moving between sections swaps only the page beneath it
 * (§10, §28). A page deeper inside (a unit) names its own longer trail, which
 * takes over the bar while it is open.
 */
export function ProjectNavBar({ projectId, crumbs, tabs, sectionsLabel, identity }: { projectId: string; crumbs: Crumb[]; tabs: ProjectNavTab[]; sectionsLabel: string; identity: ProjectIdentity }) {
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
  return (
    <>
      <Breadcrumbs items={trail} level="layout" />
      {/* Phones: who and what, once, above the pinned tabs; it scrolls away and the tabs stay (MOB-05 §18, §19, §70). */}
      <div className="flex min-w-0 items-center justify-between gap-3 pt-3 sm:hidden" data-testid="project-phone-identity">
        <div className="min-w-0">
          <p className="truncate text-card font-semibold text-fg">{identity.name}</p>
          <p className="truncate text-table text-fg-muted" data-testid="project-phone-company">{identity.companyName}</p>
        </div>
        <ProjectStatusBadge status={identity.status} />
      </div>
      <ContextTabs label={sectionsLabel} tabs={tabs} primary={PRIMARY} rootKey="overview" />
    </>
  );
}
