import { redirect } from "next/navigation";
import { getTranslations } from "@/lib/i18n/server";

import { ModuleMessages } from "@/components/i18n/module-messages";
import { SectionNav } from "@/components/engineering/section-nav";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { engineeringHeadline } from "@/lib/modules/engineering/engineering.overview";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, } from "../project-context";

type Props = { children: React.ReactNode; params: Promise<{ projectId: string }> };

/**
 * A project's engineering workspace (PRD #46 §10, §165): the project header and
 * tabs, a headline of what is open, the section column and the register or
 * record beside it.
 */
export default async function ProjectEngineeringLayout({ children, params }: Props) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);
  if (!actions.canViewEngineering) redirect("/access-denied");

  const headline = await engineeringHeadline(context, project.id);
  const base = `/projects/${project.id}/engineering`;
  const documents = can(context, "engineering_document.view");
  const submittals = can(context, "submittal.view");
  const items = [
    { href: base, label: t("engineering.overview"), exact: true },
    ...(documents ? [{ href: `${base}/drawings`, label: t("engineering.drawings") }, { href: `${base}/documents`, label: t("engineering.engineeringDocs") }] : []),
    ...(can(context, "rfi.view") ? [{ href: `${base}/rfis`, label: t("engineering.rfis"), count: headline.openRfis }] : []),
    ...(submittals ? [{ href: `${base}/submittals`, label: t("engineering.submittals") }, { href: `${base}/method-statements`, label: t("engineering.methodStatements") }, { href: `${base}/material-submittals`, label: t("engineering.materialSubmittals") }] : []),
    ...(can(context, "transmittal.view") ? [{ href: `${base}/transmittals`, label: t("engineering.transmittals") }] : []),
  ];

  return (
    <ModuleMessages namespaces={["engineering"]}>
      <div className="space-y-5">
        <RecordContextHeader title={project.name} subtitle={project.code} status={project.status} />
        <p className="text-table text-fg-muted" data-testid="engineering-headline">
          <span className="tabular-nums text-fg">{headline.openRfis}</span> {t("engineering.openRfis")} <span aria-hidden="true">•</span> <span className="tabular-nums text-fg">{headline.inReview}</span> {t("engineering.underReview")} <span aria-hidden="true">•</span> <span className={headline.revisionRequired ? "tabular-nums font-medium text-warning-strong" : "tabular-nums text-fg"}>{headline.revisionRequired}</span> {t("engineering.revisionRequiredInline")}
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-8">
          <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <SectionNav items={items} label={t("engineering.sections")} testId="engineering-nav" />
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </ModuleMessages>
  );
}
