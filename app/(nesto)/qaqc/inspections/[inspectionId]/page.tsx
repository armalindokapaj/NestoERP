import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { MaterialPanel } from "@/components/qaqc/material-panel";
import {
  CorrectiveActionTable,
  DefectTable,
  InspectionTable,
  NcrTable,
} from "@/components/qaqc/qaqc-tables";
import { DetailGrid } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { PersonLink } from "@/components/people/person-link";
import { requireModule } from "@/lib/context/current-user";
import * as inspectionService from "@/lib/modules/qaqc/inspections/inspection.service";
import * as materials from "@/lib/modules/qaqc/materials/material.service";
import { qaqcLabel } from "@/components/qaqc/qaqc-labels";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { InspectionPageShell, loadInspectionPage } from "./inspection-shell";

type Params = { params: Promise<{ inspectionId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { inspectionId } = await params;
  try {
    const context = await requireModule("qaqc");
    const inspection = await inspectionService.getInspection(context, inspectionId);
    return { title: inspection.inspectionNumber };
  } catch {
    const t = await getTranslations("qaqc");
    return { title: t("meta.inspection") };
  }
}

/** One inspection (PRD #21 §60, §63–§65). */
export default async function InspectionPage({ params }: Params) {
  const { inspectionId } = await params;
  const { context, inspection } = await loadInspectionPage(inspectionId, "overview");
  const t = await getTranslations("qaqc");

  const lines =
    inspection.inspectionType === "MATERIAL" && inspection.source
      ? await materials.inspectableLines(context, inspection.source.id)
      : [];

  const showMaterial =
    inspection.inspectionType === "MATERIAL" &&
    (inspection.materialDecisions.length > 0 ||
      inspection.release !== null ||
      inspection.capabilities.canRecordMaterialDecision ||
      inspection.capabilities.canRelease);

  return (
    <InspectionPageShell context={context} inspection={inspection} tab="overview">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("detail.type"), value: qaqcLabel(t, "inspectionType", inspection.inspectionType) },
                {
                  label: t("detail.template"),
                  value: inspection.templateName
                    ? `${inspection.templateName}${inspection.templateVersion ? ` v${inspection.templateVersion}` : ""}`
                    : t("common.noChecklist"),
                },
                {
                  label: t("detail.project"),
                  value: inspection.project ? (
                    <Link
                      href={`/projects/${inspection.project.id}`}
                      className="hover:text-accent"
                    >
                      {inspection.project.code} — {inspection.project.name}
                    </Link>
                  ) : (
                    t("common.notTied")
                  ),
                },
                { label: t("detail.where"), value: orDash(inspection.locationText) },
                {
                  label: t("detail.fromRequest"),
                  value: inspection.requestId ? (
                    <Link
                      href={`/qaqc/requests/${inspection.requestId}`}
                      className="hover:text-accent"
                    >
                      {inspection.requestNumber}
                    </Link>
                  ) : (
                    t("common.raisedDirectly")
                  ),
                },
                {
                  label: t("detail.delivery"),
                  value: inspection.source ? (
                    inspection.source.href ? (
                      <Link href={inspection.source.href} className="hover:text-accent">
                        {inspection.source.label}
                      </Link>
                    ) : (
                      inspection.source.label
                    )
                  ) : (
                    "—"
                  ),
                },
                { label: t("detail.workReference"), value: orDash(inspection.workReference) },
                { label: t("detail.drawing"), value: orDash(inspection.drawingReference) },
                { label: t("detail.specification"), value: orDash(inspection.specificationReference) },
              ]}
            />

            {inspection.summary ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-table font-semibold text-fg">{t("inspectionPage.whatFound")}</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {inspection.summary}
                </p>
              </div>
            ) : null}
          </section>

          {showMaterial ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-card font-semibold text-fg">{t("inspectionPage.material")}</h2>
                <p className="mt-1 text-meta text-fg-subtle">
                  {t("inspectionPage.materialBody")}
                </p>
              </div>
              <MaterialPanel
                inspectionId={inspection.id}
                lines={lines}
                decisions={inspection.materialDecisions}
                release={inspection.release}
                canDecide={inspection.capabilities.canRecordMaterialDecision}
                canRelease={inspection.capabilities.canRelease}
              />
            </section>
          ) : null}

          {inspection.defects.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("inspectionPage.defectsRaised")}</h2>
              <DefectTable
                defects={inspection.defects}
                caption={t("inspectionPage.defectsCaption", { number: inspection.inspectionNumber })}
              />
            </section>
          ) : null}

          {inspection.ncrs.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("inspectionPage.nonConformances")}</h2>
              <NcrTable ncrs={inspection.ncrs} caption={t("inspectionPage.ncrsCaption", { number: inspection.inspectionNumber })} />
            </section>
          ) : null}

          {inspection.correctiveActions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.correctiveActions")}</h2>
              <CorrectiveActionTable
                actions={inspection.correctiveActions}
                showParent={false}
                caption={t("inspectionPage.actionsCaption", { number: inspection.inspectionNumber })}
              />
            </section>
          ) : null}

          {inspection.reinspections.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-card font-semibold text-fg">{t("inspectionPage.reinspections")}</h2>
                <p className="mt-1 text-meta text-fg-subtle">
                  {t("inspectionPage.reinspectionsBody")}
                </p>
              </div>
              <InspectionTable
                inspections={inspection.reinspections}
                caption={t("inspectionPage.reinspectionsCaption", { number: inspection.inspectionNumber })}
              />
            </section>
          ) : null}

          {inspection.parentInspectionId ? (
            <p className="text-meta text-fg-subtle">
              {t("inspectionPage.reinspectionOf")}{" "}
              <Link
                href={`/qaqc/inspections/${inspection.parentInspectionId}`}
                className="text-accent-strong hover:underline"
              >
                {t("inspectionPage.earlier")}
              </Link>
              {t("inspectionPage.keepsVerdict")}
            </p>
          ) : null}

          {inspection.capabilities.canExecute && inspection.checklist.length > 0 ? (
            <Button asChild>
              <Link href={`/qaqc/inspections/${inspection.id}/execute`}>
                {inspection.status === "DRAFT" ? t("inspectionPage.startChecklist") : t("inspectionPage.continueChecklist")}
              </Link>
            </Button>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("detail.createdBy")}
                value={
                  inspection.createdBy ? (
                    <PersonLink memberId={inspection.createdBy.memberId} name={inspection.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("detail.created")} value={formatDateTime(inspection.createdAt)} />
              <Meta
                label={t("inspectionPage.carriedOutBy")}
                value={
                  inspection.executedBy ? (
                    <PersonLink memberId={inspection.executedBy.memberId} name={inspection.executedBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              {inspection.submittedAt ? (
                <Meta label={t("detail.submitted")} value={formatDateTime(inspection.submittedAt)} />
              ) : null}
              {inspection.approvedAt ? (
                <Meta
                  label={t("inspectionPage.approved")}
                  value={
                    <>
                      {formatDateTime(inspection.approvedAt)}
                      {inspection.approvedBy ? (
                        <>
                          {" "}
                          {t("detail.by")} <PersonLink memberId={inspection.approvedBy.memberId} name={inspection.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {inspection.rejectedAt ? (
                <Meta
                  label={t("inspectionPage.rejected")}
                  value={
                    <>
                      {formatDateTime(inspection.rejectedAt)}
                      {inspection.rejectedBy ? (
                        <>
                          {" "}
                          {t("detail.by")} <PersonLink memberId={inspection.rejectedBy.memberId} name={inspection.rejectedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {inspection.closedAt ? (
                <Meta label={t("detail.closed")} value={formatDateTime(inspection.closedAt)} />
              ) : null}
            </dl>
          </section>
        </div>
      </div>

      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="quality_inspection" parentId={inspectionId} className="mt-4" />
    </InspectionPageShell>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table text-fg">{value}</dd>
    </div>
  );
}
