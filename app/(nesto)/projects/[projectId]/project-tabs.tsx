import Link from "@/components/navigation/nav-link";

import { requireUserContext } from "@/lib/context/current-user";
import { hasActiveProject3DViewer } from "@/lib/modules/project-3d/project-3d.viewer";
import { cn } from "@/lib/utils/cn";
import { getTranslations } from "@/lib/i18n/server";
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
  const t = await getTranslations("projects");
  const threeD = show.threeD ?? await hasActiveProject3DViewer(await requireUserContext(), projectId);
  const tabs: { key: ProjectTabKey; label: string; href: string; visible: boolean }[] = [
    { key: "overview", label: t("tabs.overview"), href: `/projects/${projectId}`, visible: true },
    { key: "3d", label: t("tabs.3d"), href: `/projects/${projectId}/3d`, visible: threeD },
    { key: "planning", label: t("tabs.planning"), href: `/projects/${projectId}/planning`, visible: Boolean(show.planning) },
    // Buildings, floors and units (E-05B §34: "Units", with the hierarchy inside).
    { key: "units", label: t("tabs.units"), href: `/projects/${projectId}/units`, visible: Boolean(show.units) },
    // The same units, as Sales sees them (E-05E §13).
    { key: "sales", label: t("tabs.sales"), href: `/projects/${projectId}/sales`, visible: Boolean(show.sales) },
    { key: "tasks", label: t("tabs.tasks"), href: `/projects/${projectId}/tasks`, visible: show.tasks },
    { key: "calendar", label: t("tabs.calendar"), href: `/projects/${projectId}/calendar`, visible: Boolean(show.calendar) },
    { key: "meetings", label: t("tabs.meetings"), href: `/projects/${projectId}/meetings`, visible: Boolean(show.meetings) },
    { key: "dailyLogs", label: t("tabs.dailyLogs"), href: `/projects/${projectId}/daily-logs`, visible: Boolean(show.dailyLogs) },
    { key: "workforce", label: t("tabs.workforce"), href: `/projects/${projectId}/workforce`, visible: Boolean(show.workforce) },
    // Who builds it and the technical record of it (PRD #46 §7, §9, §10).
    { key: "contractors", label: t("tabs.contractors"), href: `/projects/${projectId}/contractors`, visible: Boolean(show.contractors) },
    { key: "engineering", label: t("tabs.engineering"), href: `/projects/${projectId}/engineering`, visible: Boolean(show.engineering) },
    { key: "team", label: t("tabs.team"), href: `/projects/${projectId}/team`, visible: show.team },
    {
      key: "finance",
      label: t("tabs.finance"),
      href: show.finance ? `/projects/${projectId}/finance` : `/projects/${projectId}/finance/units`,
      visible: Boolean(show.finance || show.unitFinance),
    },
    {
      key: "contracts",
      label: t("tabs.contracts"),
      href: `/projects/${projectId}/contracts`,
      visible: Boolean(show.contracts),
    },
    {
      key: "inventory",
      label: t("tabs.inventory"),
      href: `/projects/${projectId}/inventory`,
      visible: Boolean(show.inventory),
    },
    {
      key: "qaqc",
      label: t("tabs.qaqc"),
      href: `/projects/${projectId}/qaqc`,
      visible: Boolean(show.qaqc),
    },
    {
      key: "hse",
      label: t("tabs.hse"),
      href: `/projects/${projectId}/hse`,
      visible: Boolean(show.hse),
    },
    {
      key: "documents",
      label: t("tabs.documents"),
      href: `/projects/${projectId}/documents`,
      visible: show.documents,
    },
    {
      key: "activity",
      label: t("tabs.activity"),
      href: `/projects/${projectId}/activity`,
      visible: show.activity,
    },
  ];

  const visible = tabs.filter((tab) => tab.visible);
  if (visible.length <= 1) return null;

  return (
    <div className="-mx-1 overflow-x-auto">
      <nav aria-label={t("tabs.sectionsLabel")} className="flex min-w-max items-center gap-1 border-b border-line px-1">
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
