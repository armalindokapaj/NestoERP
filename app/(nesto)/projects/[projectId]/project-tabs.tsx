import Link from "@/components/navigation/nav-link";

import { requireUserContext } from "@/lib/context/current-user";
import { hasActiveProject3DViewer } from "@/lib/modules/project-3d/project-3d.viewer";
import { cn } from "@/lib/utils/cn";
import type { ProjectTabKey } from "./project-context";

/**
 * Record tabs (PRD #10 §45, §34).
 *
 * Routes, not client state, so each tab is a real URL. A tab whose permission
 * the user lacks is absent rather than empty (PRD #10 §135).
 */
export async function ProjectTabs({
  projectId,
  active,
  show,
}: {
  projectId: string;
  active: ProjectTabKey;
  show: {
    threeD?: boolean;
    planning?: boolean;
    units?: boolean;
    sales?: boolean;
    contractors?: boolean;
    engineering?: boolean;
    tasks: boolean;
    calendar?: boolean;
    meetings?: boolean;
    dailyLogs?: boolean;
    /** Who works on it, its sites and its crews (E-04 §38, §181). */
    workforce?: boolean;
    team: boolean;
    finance?: boolean;
    /** The units' collection (E-05F §45): opens the Finance tab on its Units view for readers without the rest of Finance. */
    unitFinance?: boolean;
    contracts?: boolean;
    inventory?: boolean;
    qaqc?: boolean;
    hse?: boolean;
    documents: boolean;
    activity: boolean;
  };
}) {
  const threeD = show.threeD ?? await hasActiveProject3DViewer(await requireUserContext(), projectId);
  const tabs: { key: ProjectTabKey; label: string; href: string; visible: boolean }[] = [
    { key: "overview", label: "Overview", href: `/projects/${projectId}`, visible: true },
    { key: "3d", label: "3D", href: `/projects/${projectId}/3d`, visible: threeD },
    { key: "planning", label: "Planning", href: `/projects/${projectId}/planning`, visible: Boolean(show.planning) },
    // Buildings, floors and units (E-05B §34: "Units", with the hierarchy inside).
    { key: "units", label: "Units", href: `/projects/${projectId}/units`, visible: Boolean(show.units) },
    // The same units, as Sales sees them (E-05E §13).
    { key: "sales", label: "Sales", href: `/projects/${projectId}/sales`, visible: Boolean(show.sales) },
    { key: "tasks", label: "Tasks", href: `/projects/${projectId}/tasks`, visible: show.tasks },
    { key: "calendar", label: "Calendar", href: `/projects/${projectId}/calendar`, visible: Boolean(show.calendar) },
    { key: "meetings", label: "Meetings", href: `/projects/${projectId}/meetings`, visible: Boolean(show.meetings) },
    { key: "dailyLogs", label: "Daily Logs", href: `/projects/${projectId}/daily-logs`, visible: Boolean(show.dailyLogs) },
    { key: "workforce", label: "Workforce", href: `/projects/${projectId}/workforce`, visible: Boolean(show.workforce) },
    // Who builds it and the technical record of it (PRD #46 §7, §9, §10).
    { key: "contractors", label: "Contractors", href: `/projects/${projectId}/contractors`, visible: Boolean(show.contractors) },
    { key: "engineering", label: "Engineering", href: `/projects/${projectId}/engineering`, visible: Boolean(show.engineering) },
    { key: "team", label: "Team", href: `/projects/${projectId}/team`, visible: show.team },
    {
      key: "finance",
      label: "Finance",
      href: show.finance ? `/projects/${projectId}/finance` : `/projects/${projectId}/finance/units`,
      visible: Boolean(show.finance || show.unitFinance),
    },
    {
      key: "contracts",
      label: "Contracts",
      href: `/projects/${projectId}/contracts`,
      visible: Boolean(show.contracts),
    },
    {
      key: "inventory",
      label: "Inventory",
      href: `/projects/${projectId}/inventory`,
      visible: Boolean(show.inventory),
    },
    {
      key: "qaqc",
      label: "QA/QC",
      href: `/projects/${projectId}/qaqc`,
      visible: Boolean(show.qaqc),
    },
    {
      key: "hse",
      label: "HSE",
      href: `/projects/${projectId}/hse`,
      visible: Boolean(show.hse),
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
            <Link navSource="tab"
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-table font-medium transition-colors touch:inline-flex touch:min-h-11 touch:items-center",
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
