import { cache } from "react";
import { getTranslations } from "@/lib/i18n/server";
import { RecordFavorite } from "@/components/productivity/record-favorite";
import Link from "@/components/navigation/nav-link";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";
import { notFound, redirect } from "next/navigation";

import { RecordHeader } from "@/components/modules/record-header";
import { UnitActions } from "@/components/project-structure/unit-actions";
import { PublicationBadge, UnpublishedChangesBadge } from "@/components/project-structure/unit-page/publication-badge";
import { PublishingActions } from "@/components/project-structure/unit-page/publishing-actions";
import { CommercialStatusBadge } from "@/components/sales/unit-sales/commercial-status";
import { Badge } from "@/components/ui/badge";
import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { getProjectStructure, getUnitDetail, lastUnitChange } from "@/lib/modules/project-structure/structure.service";
import { PersonLink } from "@/components/people/person-link";
import { formatRelativeTime } from "@/lib/utils/format";
import { getUnitPublishing } from "@/lib/modules/project-structure/unit-publishing.service";
import * as projects from "@/lib/modules/projects/project.service";
import { legalCapabilities } from "@/lib/modules/contracts/units/sale-contract";
import { financeCapabilities } from "@/lib/modules/finance/units/unit-finance.core";
import { salesCapabilities } from "@/lib/modules/sales/units/unit-sales.core";
import { loadProject } from "../../project-context";

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

export const loadUnitPage = cache(async function loadUnitPage(projectId: string, unitId: string) {
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
});

type Page = Awaited<ReturnType<typeof loadUnitPage>>;

const SECTIONS: Array<{ key: UnitSection; suffix: string }> = [
  { key: "overview", suffix: "" },
  { key: "documents", suffix: "/documents" },
  { key: "media", suffix: "/media" },
  { key: "publishing", suffix: "/publishing" },
  { key: "sales", suffix: "/sales" },
  { key: "legal", suffix: "/legal" },
  { key: "finance", suffix: "/finance" },
  { key: "activity", suffix: "/activity" },
];

export async function UnitShell({ page, active, children }: { page: Page; active: UnitSection; children: React.ReactNode }) {
  const { project, actions, unit, publishing } = page;
  const t = await getTranslations("projects");
  const writes = unit.capabilities.canUpdateUnit || unit.capabilities.canMoveUnit;
  const [structure, lastChange] = await Promise.all([
    writes ? getProjectStructure(page.context, project.id) : null,
    lastUnitChange(page.context, unit.id),
  ]);
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
          { label: t("meta.projects"), href: "/projects" },
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
            {publishing.status !== "PUBLISHED" && publishing.currentPublication ? <Badge tone="default">{t("unitPage.lastPublished", { version: publishing.currentPublication.versionNumber })}</Badge> : null}
            {publishing.hasUnpublishedChanges ? <UnpublishedChangesBadge /> : null}
            {publishing.pendingRequest ? <Badge tone="info">{t("unitPage.waitingReview")}</Badge> : null}
            {unit.isActive ? null : <Badge>{t("unitPage.inactive")}</Badge>}
          </>
        }
        meta={[
          { label: t("unitPage.location"), value: <span data-testid="unit-location">{`${unit.building.name} · ${unit.floor.name}`}</span> },
          ...(unit.name ? [{ label: t("unitPage.name"), value: unit.name }] : []),
          ...(lastChange
            ? [{ label: t("unitPage.lastEditedBy"), value: <span data-testid="unit-last-edited"><PersonLink memberId={lastChange.actorMemberId} name={lastChange.actor} /> · {formatRelativeTime(lastChange.at)}</span> }]
            : []),
        ]}
        actions={
          <>
            <RecordFavorite context={page.context} entityType="project_unit" entityId={unit.id} />
            <PublishingActions unitId={unit.id} unitCode={unit.unitCode} version={unit.version} publishing={publishing} />
            {structure ? <UnitActions unit={unit} types={structure.unitTypes} buildings={structure.buildings} /> : null}
          </>
        }
      />
      <ContextTabsFrame label={t("unitPage.sectionsLabel", { code: unit.unitCode })}>
          {visible.map((section) => {
            const current = section.key === active;
            return (
              <Link
                  key={section.key}
                  href={`${base}${section.suffix}`}
                  aria-current={current ? "page" : undefined}
                  className={contextTabClass(current)}
                >
                  {t(`unitPage.sections.${section.key}`)}
                </Link>
            );
          })}
        </ContextTabsFrame>
      {children}
    </div>
  );
}
