import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import {
  CorrectiveActionTable,
  DefectTable,
  InspectionTable,
  NcrTable,
} from "@/components/qaqc/qaqc-tables";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";
import { projectQuality } from "@/lib/modules/qaqc/reports/reports.service";
import { inspectionListQuerySchema } from "@/lib/modules/qaqc/qaqc.schema";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, } from "../project-context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("qaqcTab.title") };
}

/**
 * Quality on one project (PRD #21 §11, §32).
 *
 * The same canonical quality records filtered by `projectId` — not a second
 * table. Being given a project does not by itself hand somebody its quality
 * history: the tab needs a quality permission, and every quality scope narrows
 * the rows again on the way out (PRD #21 §26).
 *
 * Each section is a bounded preview of the full register (AUD-08 §4, DT-01):
 * the first rows and the true count of this project's records, with "View all"
 * opening the register filtered to this project — never a silent stop at 20.
 */
export default async function ProjectQaqcPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const projectActions = projects.projectActions(context);

  if (!projectActions.canViewQaqc) redirect("/access-denied");

  const empty = { data: [], total: 0 };
  const [summary, inspectionRows, defectRows, ncrRows, actionRows] = await Promise.all([
    projectQuality(context, projectId),
    can(context, "qaqc.inspection.view")
      ? inspections
          .listInspections(context, inspectionListQuerySchema.parse({ projectId, limit: 20 }))
          .then((result) => ({ data: result.data, total: result.pagination.total }))
      : Promise.resolve(empty),
    defects.listForProject(context, projectId, 20),
    ncrs.listForProject(context, projectId, 20),
    actions.listForProject(context, projectId, 20),
  ]);

  const nothing =
    inspectionRows.total === 0 &&
    defectRows.total === 0 &&
    ncrRows.total === 0 &&
    actionRows.total === 0;

  /** The full register narrowed to this project, in the preview's own order where the register has it. */
  const viewAll = (list: string, sort?: string) =>
    `/qaqc/${list}?projectId=${encodeURIComponent(project.id)}${sort ? `&sort=${sort}` : ""}`;

  const mayRequest = can(context, "qaqc.request.create");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          mayRequest ? (
            <Button asChild size="sm">
              <Link href={`/qaqc/requests/new?projectId=${project.id}`}>
                {t("qaqcTab.requestInspection")}
              </Link>
            </Button>
          ) : null
        }
      />


      {nothing ? (
        <EmptyState
          icon={<ShieldCheck />}
          title={t("qaqcTab.emptyTitle")}
          description={t("qaqcTab.emptyBody")}
          action={
            mayRequest
              ? {
                  label: t("qaqcTab.requestInspection"),
                  href: `/qaqc/requests/new?projectId=${project.id}`,
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label={t("qaqcTab.passRate")}
              value={summary.passRate ? `${summary.passRate.percent}%` : "—"}
              hint={
                summary.passRate
                  ? t("qaqcTab.decided", { passed: summary.passRate.passed, total: summary.passRate.total })
                  : t("qaqcTab.nothingDecided")
              }
            />
            <Stat label={t("qaqcTab.openDefects")} value={String(summary.openDefects)} />
            <Stat label={t("qaqcTab.openNcrs")} value={String(summary.openNcrs)} />
            <Stat label={t("qaqcTab.openActions")} value={String(summary.openActions)} />
          </section>

          {inspectionRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("qaqcTab.inspections")}</h2>
              <InspectionTable
                inspections={inspectionRows.data}
                caption={t("qaqcTab.inspectionsOn", { name: project.name })}
                listId="projects.qaqc-inspections"
              />
              <PreviewFooter
                shown={inspectionRows.data.length}
                total={inspectionRows.total}
                href={viewAll("inspections")}
                records="inspections"
              />
            </section>
          ) : null}

          {defectRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("qaqcTab.defects")}</h2>
              <DefectTable
                defects={defectRows.data}
                showProject={false}
                caption={t("qaqcTab.defectsOn", { name: project.name })}
                listId="projects.qaqc-defects"
              />
              <PreviewFooter
                shown={defectRows.data.length}
                total={defectRows.total}
                href={viewAll("defects", "severity-desc")}
                records="defects"
              />
            </section>
          ) : null}

          {ncrRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("qaqcTab.ncrs")}</h2>
              <NcrTable
                ncrs={ncrRows.data}
                showProject={false}
                caption={t("qaqcTab.ncrsOn", { name: project.name })}
                listId="projects.qaqc-ncrs"
              />
              <PreviewFooter
                shown={ncrRows.data.length}
                total={ncrRows.total}
                href={viewAll("ncrs", "severity-desc")}
                records="ncrs"
              />
            </section>
          ) : null}

          {actionRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("qaqcTab.corrective")}</h2>
              <CorrectiveActionTable
                actions={actionRows.data}
                caption={t("qaqcTab.correctiveOn", { name: project.name })}
                listId="projects.qaqc-corrective-actions"
              />
              <PreviewFooter
                shown={actionRows.data.length}
                total={actionRows.total}
                href={viewAll("corrective-actions")}
                records="correctiveActions"
              />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

type PreviewRecords = "inspections" | "defects" | "ncrs" | "correctiveActions";

/**
 * Under a preview: how many of the project's records it shows, and the way to
 * the rest (AUD-08 §4). A complete preview still states its count.
 */
async function PreviewFooter({ shown, total, href, records }: { shown: number; total: number; href: string; records: PreviewRecords }) {
  const t = await getTranslations("projects");
  // The noun as it reads after the count; "View all …" is a phrase of its own, because the noun changes form there.
  const noun = t(`tabPages.preview.${records}.counted`, { count: total });
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-2 text-meta text-fg-muted" data-testid="preview-count">
      <span>
        {shown < total ? (
          <>
            {t("tabPages.showing")} <span className="tabular-nums">{shown}</span> {t("tabPages.of")} <span className="tabular-nums">{total}</span> {noun}
          </>
        ) : (
          <>
            <span className="tabular-nums">{total}</span> {noun}
          </>
        )}
      </span>
      <Link href={href} className="text-accent hover:underline">
        {t(`tabPages.preview.${records}.viewAll`)}
      </Link>
    </p>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="nesto-card p-5">
      <p className="nesto-eyebrow text-fg-subtle">{label}</p>
      <p className="mt-1.5 text-page font-semibold tabular-nums text-fg">{value}</p>
      {hint ? <p className="mt-1 text-meta text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
