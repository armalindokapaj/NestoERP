import Link from "next/link";

import { cn } from "@/lib/utils/cn";
import type { ProjectTabKey } from "./project-context";

/**
 * Record tabs (PRD #10 §45, §34).
 *
 * Routes, not client state, so each tab is a real URL. A tab whose permission
 * the user lacks is absent rather than empty (PRD #10 §135).
 */
export function ProjectTabs({
  projectId,
  active,
  show,
}: {
  projectId: string;
  active: ProjectTabKey;
  show: {
    tasks: boolean;
    team: boolean;
    finance?: boolean;
    documents: boolean;
    activity: boolean;
  };
}) {
  const tabs: { key: ProjectTabKey; label: string; href: string; visible: boolean }[] = [
    { key: "overview", label: "Overview", href: `/projects/${projectId}`, visible: true },
    { key: "tasks", label: "Tasks", href: `/projects/${projectId}/tasks`, visible: show.tasks },
    { key: "team", label: "Team", href: `/projects/${projectId}/team`, visible: show.team },
    {
      key: "finance",
      label: "Finance",
      href: `/projects/${projectId}/finance`,
      visible: Boolean(show.finance),
    },
    {
      key: "documents",
      label: "Documents",
      href: `/projects/${projectId}/documents`,
      visible: show.documents,
    },
    {
      key: "activity",
      label: "Activity",
      href: `/projects/${projectId}/activity`,
      visible: show.activity,
    },
  ];

  const visible = tabs.filter((tab) => tab.visible);
  if (visible.length <= 1) return null;

  return (
    <div className="-mx-1 overflow-x-auto">
      <nav aria-label="Project sections" className="flex min-w-max items-center gap-1 border-b border-line px-1">
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-table font-medium transition-colors",
                isActive ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
