import { requireUserContext } from "@/lib/context/current-user";
import { hasActiveProject3DViewer } from "@/lib/modules/project-3d/project-3d.viewer";
import * as projects from "@/lib/modules/projects/project.service";
import { getTranslations } from "@/lib/i18n/server";
import { projectListQuerySchema } from "@/lib/modules/projects/project.schema";
import { ProjectNavBar, type ProjectNavTab } from "./project-nav-bar";
import type { ProjectTabKey } from "./project-context";

/**
 * The project's breadcrumbs and record tabs (PRD #10 §45, §34), drawn once by the
 * project layout so they stay mounted — and pinned — while a person moves between
 * sections. Routes, not client state, so each tab is a real URL. A tab whose
 * permission the user lacks is absent rather than empty (PRD #10 §135).
 *
 * A project this session cannot read here (another company's, on its way through
 * the open step) draws nothing; the page itself gives the answer.
 */
export async function ProjectNav({ projectId }: { projectId: string }) {
  const context = await requireUserContext();
  const project = await projects.getProject(context, projectId).catch(() => null);
  if (!project) return null;
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);
  // The switcher lists only projects this person may open here (§8, §27): the same scoped list as the Projects page.
  const [threeD, siblings] = await Promise.all([
    hasActiveProject3DViewer(context, projectId).catch(() => false),
    projects.listProjects(context, projectListQuerySchema.parse({ limit: 100 })).then((result) => result.data, () => []),
  ]);
  const base = `/projects/${projectId}`;
  const all: (ProjectNavTab & { visible: boolean })[] = [
    { key: "overview", label: t("tabs.overview"), href: base, visible: true },
    // The 3D viewer is its own full-screen app; it opens beside the ERP.
    { key: "3d", label: t("tabs.3d"), href: `${base}/3d`, visible: threeD, newTab: true },
    { key: "planning", label: t("tabs.planning"), href: `${base}/planning`, visible: actions.canViewPlanning },
    // Buildings, floors and units (E-05B §34: "Units", with the hierarchy inside).
    { key: "units", label: t("tabs.units"), href: `${base}/units`, visible: actions.canViewUnits },
    // The same units, as Sales sees them (E-05E §13).
    { key: "sales", label: t("tabs.sales"), href: `${base}/sales`, visible: actions.canViewUnitSales },
    { key: "tasks", label: t("tabs.tasks"), href: `${base}/tasks`, visible: actions.canViewTasks },
    { key: "calendar", label: t("tabs.calendar"), href: `${base}/calendar`, visible: actions.canViewCalendar },
    { key: "meetings", label: t("tabs.meetings"), href: `${base}/meetings`, visible: actions.canViewMeetings },
    { key: "dailyLogs", label: t("tabs.dailyLogs"), href: `${base}/daily-logs`, visible: actions.canViewDailyLogs },
    { key: "workforce", label: t("tabs.workforce"), href: `${base}/workforce`, visible: actions.canViewWorkforce },
    // Who builds it and the technical record of it (PRD #46 §7, §9, §10).
    { key: "contractors", label: t("tabs.contractors"), href: `${base}/contractors`, visible: actions.canViewContractors },
    { key: "engineering", label: t("tabs.engineering"), href: `${base}/engineering`, visible: actions.canViewEngineering },
    { key: "team", label: t("tabs.team"), href: `${base}/team`, visible: actions.canViewMembers },
    // The units' collection (E-05F §45): the Finance tab opens on its Units view for readers without the rest of Finance.
    { key: "finance", label: t("tabs.finance"), href: actions.canViewFinance ? `${base}/finance` : `${base}/finance/units`, visible: actions.canViewFinance || actions.canViewUnitFinance },
    { key: "contracts", label: t("tabs.contracts"), href: `${base}/contracts`, visible: actions.canViewContracts },
    { key: "inventory", label: t("tabs.inventory"), href: `${base}/inventory`, visible: actions.canViewInventory },
    { key: "qaqc", label: t("tabs.qaqc"), href: `${base}/qaqc`, visible: actions.canViewQaqc },
    { key: "hse", label: t("tabs.hse"), href: `${base}/hse`, visible: actions.canViewHse },
    { key: "documents", label: t("tabs.documents"), href: `${base}/documents`, visible: actions.canViewDocuments },
    { key: "activity", label: t("tabs.activity"), href: `${base}/activity`, visible: actions.canViewActivity },
  ];
  const tabs: ProjectNavTab[] = all.filter((tab) => tab.visible).map((tab) => ({ key: tab.key, label: tab.label, href: tab.href, newTab: tab.newTab }));

  /* Projects / Group / Company / Project — the company is always named (E-05A §9, §26). */
  const crumbs = [
    { label: t("meta.projects"), href: "/projects" },
    { label: project.company.parentGroup.name },
    { label: project.company.name, href: `/projects?company=${encodeURIComponent(project.company.id)}` },
    { label: project.name, href: base, switcher: { label: t("meta.projects"), items: siblings.map((sibling) => ({ label: sibling.name, href: `/projects/${sibling.id}`, current: sibling.id === projectId })) } },
  ];
  return <ProjectNavBar projectId={projectId} crumbs={crumbs} tabs={tabs} sectionsLabel={t("tabs.sectionsLabel")} />;
}

export type { ProjectTabKey };
