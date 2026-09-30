"use client";

import { usePathname } from "next/navigation";

import { ContextTabs, type ContextTab } from "@/components/navigation/context-tabs";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import type { ProjectTabKey } from "./project-context";

export type ProjectNavTab = ContextTab & { key: ProjectTabKey };

/** The six sections a project always shows (Sticky Navigation §9); every other permitted one is under More. */
const PRIMARY: ProjectTabKey[] = ["overview", "planning", "units", "sales", "tasks", "calendar"];

/**
 * The project's place in the breadcrumb bar and its sticky tabs. It lives in the
 * project layout, so moving between sections swaps only the page beneath it
 * (§10, §28). A page deeper inside (a unit) names its own longer trail, which
 * takes over the bar while it is open.
 */
export function ProjectNavBar({ projectId, crumbs, tabs, sectionsLabel }: { projectId: string; crumbs: Crumb[]; tabs: ProjectNavTab[]; sectionsLabel: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const segment = pathname === base ? null : pathname.slice(base.length + 1).split("/")[0];
  const section = segment ? tabs.find((tab) => tab.key !== "overview" && tab.href.slice(base.length + 1).split("/")[0] === segment) : undefined;
  const trail = section ? [...crumbs, { label: section.label, href: section.href }] : crumbs;
  return (
    <>
      <Breadcrumbs items={trail} level="layout" />
      <ContextTabs label={sectionsLabel} tabs={tabs} primary={PRIMARY} rootKey="overview" />
    </>
  );
}
