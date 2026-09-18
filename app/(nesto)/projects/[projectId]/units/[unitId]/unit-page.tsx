import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { RecordHeader } from "@/components/modules/record-header";
import { UnitActions } from "@/components/project-structure/unit-actions";
import { PublicationBadge, UnpublishedChangesBadge } from "@/components/project-structure/unit-page/publication-badge";
import { PublishingActions } from "@/components/project-structure/unit-page/publishing-actions";
import { CommercialStatusBadge } from "@/components/sales/unit-sales/commercial-status";
import { Badge } from "@/components/ui/badge";
import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { getProjectStructure, getUnitDetail } from "@/lib/modules/project-structure/structure.service";
import { getUnitPublishing } from "@/lib/modules/project-structure/unit-publishing.service";
import * as projects from "@/lib/modules/projects/project.service";
import { legalCapabilities } from "@/lib/modules/contracts/units/sale-contract";
import { financeCapabilities } from "@/lib/modules/finance/units/unit-finance.core";
import { salesCapabilities } from "@/lib/modules/sales/units/unit-sales.core";
import { cn } from "@/lib/utils/cn";
import { loadProject } from "../../project-context";
import { ProjectTabs } from "../../project-tabs";

/**
 * The one page of a unit (E-05B §29; E-05D §5-§9, §90-§93, §104).
 *
 * Sales, Finance, Documents and the 3D explorer all open this page for this
 * unit; none of them gets a page of its own. Its sections are routes under the
 * unit — Overview, Documents, Media, Publishing, Activity — so each is a real
 * URL, and a section the reader may not open is absent (§104). Sales is one of
 * them (E-05E §15), for readers who may see the unit's sales; Legal and Finance
 * are two more (E-05F §49, §50), for readers of the unit's contract and of its
 * collection. Everyone who can open the unit sees its commercial status beside its
 * publication status. A unit is found
 * only through the project in the URL: a unit of another project, even one the
 * reader can open, is not found here (§86).
 */

export type UnitSection = "overview" | "documents" | "media" | "publishing" | "sales" | "legal" | "finance" | "activity";

export async function loadUnitPage(projectId: string, unitId: string) {
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);
  if (!actions.canViewUnits) redirect("/access-denied");
  const unit = await getUnitDetail(context, unitId, project.id).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
    throw error;
  });
  const publishing = await getUnitPublishing(context, unit.id);
  return { context, project, actions, unit, publishing };
}

type Page = Awaited<ReturnType<typeof loadUnitPage>>;

const SECTIONS: Array<{ key: UnitSection; label: string; suffix: string }> = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "media", label: "Media", suffix: "/media" },
  { key: "publishing", label: "Publishing", suffix: "/publishing" },
  { key: "sales", label: "Sales", suffix: "/sales" },
  { key: "legal", label: "Legal", suffix: "/legal" },
  { key: "finance", label: "Finance", suffix: "/finance" },
  { key: "activity", label: "Activity", suffix: "/activity" },
];

export async function UnitShell({ page, active, children }: { page: Page; active: UnitSection; children: React.ReactNode }) {
  const { project, actions, unit, publishing } = page;
  const writes = unit.capabilities.canUpdateUnit || unit.capabilities.canMoveUnit;
  const structure = writes ? await getProjectStructure(page.context, project.id) : null;
  const units = `/projects/${project.id}/units`;
  const base = `${units}/${unit.id}`;
  // Files are listed only through the Documents module's own gate (§88); history with the project's (§48).
  const filesOpen = canAccessModule(page.context, "documents") && can(page.context, "document.view");
  const salesOpen = salesCapabilities(page.context).canView;
  // The contract and its collection, each for readers of that side of the unit (E-05F §104).
  const legalOpen = legalCapabilities(page.context).canView;
  const financeOpen = financeCapabilities(page.context).canView;
  const opens: Partial<Record<UnitSection, boolean>> = { documents: filesOpen, media: filesOpen, activity: actions.canViewActivity, sales: salesOpen, legal: legalOpen, finance: financeOpen };
  const visible = SECTIONS.filter((section) => opens[section.key] ?? true);

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          // Projects / company / project / building / floor / unit, each level a link (§8; E-05A §9).
          { label: "Projects", href: "/projects" },
          { label: project.company.name, href: `/projects?company=${encodeURIComponent(project.company.id)}` },
          { label: project.name, href: `/projects/${project.id}` },
          { label: unit.building.name, href: `${units}?building=${unit.building.id}` },
          { label: unit.floor.name, href: `${units}?floor=${unit.floor.id}` },
          active === "overview" ? { label: unit.unitCode } : { label: unit.unitCode, href: base },
        ]}
        title={unit.unitCode}
        subtitle={unit.unitType.name}
        badges={
          <>
            <PublicationBadge status={publishing.status} versionNumber={publishing.currentPublication?.versionNumber} />
            <CommercialStatusBadge status={unit.commercialStatus} />
            {publishing.status !== "PUBLISHED" && publishing.currentPublication ? <Badge tone="default">Last published v{publishing.currentPublication.versionNumber}</Badge> : null}
            {publishing.hasUnpublishedChanges ? <UnpublishedChangesBadge /> : null}
            {publishing.pendingRequest ? <Badge tone="info">Waiting for review</Badge> : null}
            {unit.isActive ? null : <Badge>Inactive</Badge>}
          </>
        }
        meta={[
          { label: "Location", value: <span data-testid="unit-location">{`${unit.building.name} · ${unit.floor.name}`}</span> },
          ...(unit.name ? [{ label: "Name", value: unit.name }] : []),
        ]}
        actions={
          <>
            <PublishingActions unitId={unit.id} unitCode={unit.unitCode} version={unit.version} publishing={publishing} />
            {structure ? <UnitActions unit={unit} types={structure.unitTypes} buildings={structure.buildings} /> : null}
          </>
        }
      />
      <ProjectTabs
        projectId={project.id}
        active="units"
        show={{
          planning: actions.canViewPlanning,
          units: actions.canViewUnits,
          sales: actions.canViewUnitSales,
          contractors: actions.canViewContractors,
          engineering: actions.canViewEngineering,
          tasks: actions.canViewTasks,
          calendar: actions.canViewCalendar,
          meetings: actions.canViewMeetings,
          dailyLogs: actions.canViewDailyLogs,
          workforce: actions.canViewWorkforce,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          unitFinance: actions.canViewUnitFinance,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />
      <nav aria-label={`${unit.unitCode} sections`} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 px-1">
          {visible.map((section) => {
            const current = section.key === active;
            return (
              <li key={section.key}>
                <Link
                  href={`${base}${section.suffix}`}
                  aria-current={current ? "page" : undefined}
                  className={cn("inline-flex h-9 items-center rounded-md px-3 text-table font-medium transition-colors", current ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </div>
  );
}
