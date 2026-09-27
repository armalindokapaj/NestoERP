import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DefectActions } from "@/components/qaqc/record-actions";
import { CorrectiveActionTable, NcrTable } from "@/components/qaqc/qaqc-tables";
import { SeverityBadge } from "@/components/qaqc/qaqc-format";
import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { QaqcRecordDocuments } from "@/components/qaqc/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ defectId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { defectId } = await params;
  try {
    const context = await requireModule("qaqc");
    const defect = await defects.getDefect(context, defectId);
    return { title: defect.defectNumber };
  } catch {
    const t = await getTranslations("qaqc");
    return { title: t("meta.defect") };
  }
}

/** One defect (PRD #21 §112, §118, §119). */
export default async function DefectPage({ params }: Params) {
  const { defectId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let defect;
  try {
    defect = await defects.getDefect(context, defectId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.defects"), href: "/qaqc/defects" },
          { label: defect.defectNumber },
        ]}
        title={defect.title}
        subtitle={defect.defectNumber}
        status={defect.status}
        badges={
          <>
            <SeverityBadge severity={defect.severity} />
            {defect.overdue ? <Badge tone="danger">{t("common.overdue")}</Badge> : null}
          </>
        }
        meta={[
          { label: t("detail.project"), value: defect.project.code },
          {
            label: t("detail.assignedTo"),
            value: defect.assignedTo ? (
              <PersonLink memberId={defect.assignedTo.memberId} name={defect.assignedTo.fullName} />
            ) : (
              t("common.notAssigned")
            ),
          },
          { label: t("detail.due"), value: defect.dueDate ? formatDate(defect.dueDate) : t("common.noDate") },
        ]}
        actions={<DefectActions defect={defect} />}
      />

      {defect.status === "RESOLVED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("defectPage.resolvedNote")}
        </p>
      ) : defect.status === "REOPENED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("defectPage.reopenedNote")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("defectPage.whatWrong")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {defect.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: t("detail.project"),
                  value: (
                    <Link href={`/projects/${defect.project.id}`} className="hover:text-accent">
                      {defect.project.code} — {defect.project.name}
                    </Link>
                  ),
                },
                { label: t("detail.where"), value: orDash(defect.locationText) },
                {
                  label: t("detail.foundOn"),
                  value: defect.inspection ? (
                    <Link
                      href={`/qaqc/inspections/${defect.inspection.id}`}
                      className="hover:text-accent"
                    >
                      {defect.inspection.inspectionNumber}
                    </Link>
                  ) : (
                    t("common.raisedDirectly")
                  ),
                },
              ]}
            />
          </section>

          {defect.resolutionNote ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("detail.whatWasDone")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {defect.resolutionNote}
              </p>
              <p className="mt-3 text-meta text-fg-subtle">
                {t("detail.recordedBy")}{" "}
                {defect.resolvedBy ? (
                  <PersonLink memberId={defect.resolvedBy.memberId} name={defect.resolvedBy.fullName} />
                ) : (
                  t("common.somebody")
                )}
                {defect.resolvedAt ? t("detail.onDate", { date: formatDate(defect.resolvedAt) }) : ""}.
              </p>
            </section>
          ) : null}

          {defect.ncrs.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-card font-semibold text-fg">{t("defectPage.escalatedTo")}</h2>
                <p className="mt-1 text-meta text-fg-subtle">
                  {t("defectPage.escalatedBody")}
                </p>
              </div>
              <NcrTable ncrs={defect.ncrs} caption={t("defectPage.ncrsCaption", { number: defect.defectNumber })} />
            </section>
          ) : null}

          {defect.correctiveActions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.correctiveActions")}</h2>
              <CorrectiveActionTable
                actions={defect.correctiveActions}
                showParent={false}
                caption={t("defectPage.actionsCaption", { number: defect.defectNumber })}
              />
            </section>
          ) : null}

          {defect.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.documents")}</h2>
              <QaqcRecordDocuments
                context={context}
                entityType="quality_defect"
                entityId={defect.id}
                emptyDescription={t("documents.defect")}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("detail.raisedBy")}
                value={
                  defect.createdBy ? (
                    <PersonLink memberId={defect.createdBy.memberId} name={defect.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("detail.raised")} value={formatDateTime(defect.createdAt)} />
              {defect.closedAt ? (
                <Meta
                  label={t("detail.closed")}
                  value={
                    <>
                      {formatDateTime(defect.closedAt)}
                      {defect.closedBy ? (
                        <>
                          {" "}
                          {t("detail.by")} <PersonLink memberId={defect.closedBy.memberId} name={defect.closedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {defect.cancelledAt ? (
                <Meta label={t("detail.cancelled")} value={formatDateTime(defect.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {defect.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.activity")}</h2>
              <QaqcActivityFeed
                context={context}
                entityType="QualityDefect"
                entityId={defect.id}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="quality_defect" parentId={defectId} />
    </div>
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
