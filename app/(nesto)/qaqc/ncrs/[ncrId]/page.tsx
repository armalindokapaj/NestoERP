import { RecordFavorite } from "@/components/productivity/record-favorite";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ClosureGaps, NcrActions } from "@/components/qaqc/record-actions";
import { CorrectiveActionTable } from "@/components/qaqc/qaqc-tables";
import { SeverityBadge } from "@/components/qaqc/qaqc-format";
import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { QaqcRecordDocuments } from "@/components/qaqc/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pendingCycle } from "@/lib/modules/qaqc/approvals/approval.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";
import { qaqcLabel } from "@/components/qaqc/qaqc-labels";
import { formatDate, formatDateTime } from "@/lib/utils/format";

type Params = { params: Promise<{ ncrId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ncrId } = await params;
  try {
    const context = await requireModule("qaqc");
    const ncr = await ncrs.getNcr(context, ncrId);
    return { title: ncr.ncrNumber };
  } catch {
    const t = await getTranslations("qaqc");
    return { title: t("meta.ncr") };
  }
}

/**
 * One NCR (PRD #21 §123, §136).
 *
 * The closure requirements are shown on the page, not hidden behind a refused
 * button: a reader who cannot close this should be able to see exactly what is
 * still missing.
 */
export default async function NcrPage({ params }: Params) {
  const { ncrId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let ncr;
  try {
    ncr = await ncrs.getNcr(context, ncrId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const live = ncr.status !== "CLOSED" && ncr.status !== "CANCELLED";
  // The closure approval the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = ncr.capabilities.canApprove || ncr.capabilities.canReject ? await pendingCycle(context, "NCR", ncr.id) : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.ncrs"), href: "/qaqc/ncrs" },
          { label: ncr.ncrNumber },
        ]}
        title={ncr.title}
        subtitle={ncr.ncrNumber}
        status={ncr.status}
        badges={
          <>
            <SeverityBadge severity={ncr.severity} />
            <Badge tone="neutral">{qaqcLabel(t, "ncrCategory", ncr.category)}</Badge>
            {ncr.overdue ? <Badge tone="danger">{t("common.overdue")}</Badge> : null}
          </>
        }
        meta={[
          { label: t("detail.project"), value: ncr.project ? ncr.project.code : t("common.companyWide") },
          {
            label: t("detail.assignedTo"),
            value: ncr.assignedTo ? (
              <PersonLink memberId={ncr.assignedTo.memberId} name={ncr.assignedTo.fullName} />
            ) : (
              t("common.notAssigned")
            ),
          },
          { label: t("detail.due"), value: ncr.dueDate ? formatDate(ncr.dueDate) : t("common.noDate") },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="non_conformance_report" entityId={ncr.id} />
            <NcrActions ncr={ncr} cycle={cycle} />
          </>
        }
      />

      {live ? <ClosureGaps gaps={ncr.closureGaps} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("ncrPage.whatFailed")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{ncr.description}</p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                { label: t("detail.category"), value: qaqcLabel(t, "ncrCategory", ncr.category) },
                {
                  label: t("detail.project"),
                  value: ncr.project ? (
                    <Link href={`/projects/${ncr.project.id}`} className="hover:text-accent">
                      {ncr.project.code} — {ncr.project.name}
                    </Link>
                  ) : (
                    t("common.notTied")
                  ),
                },
                {
                  label: t("detail.foundOn"),
                  value: ncr.inspection ? (
                    <Link
                      href={`/qaqc/inspections/${ncr.inspection.id}`}
                      className="hover:text-accent"
                    >
                      {ncr.inspection.inspectionNumber}
                    </Link>
                  ) : (
                    t("common.raisedDirectly")
                  ),
                },
                {
                  label: t("ncrPage.fromDefect"),
                  value: ncr.sourceDefect ? (
                    <Link
                      href={`/qaqc/defects/${ncr.sourceDefect.id}`}
                      className="hover:text-accent"
                    >
                      {ncr.sourceDefect.defectNumber}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t("detail.delivery"),
                  value: ncr.source ? (
                    ncr.source.href ? (
                      <Link href={ncr.source.href} className="hover:text-accent">
                        {ncr.source.label}
                      </Link>
                    ) : (
                      ncr.source.label
                    )
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t("detail.qualityOwner"),
                  value: ncr.owner ? <PersonLink memberId={ncr.owner.memberId} name={ncr.owner.fullName} /> : "—",
                },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("ncrPage.investigation")}</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              {t("ncrPage.investigationBody")}
            </p>

            <dl className="mt-4 space-y-4">
              <Block label={t("ncrPage.immediateAction")} value={ncr.immediateAction} />
              <Block label={t("ncrPage.rootCause")} value={ncr.rootCause} />
              <Block label={t("ncrPage.summary")} value={ncr.correctiveActionSummary} />
              {ncr.closureNote ? <Block label={t("ncrPage.closureNote")} value={ncr.closureNote} /> : null}
            </dl>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.correctiveActions")}</h2>
              <p className="text-meta text-fg-subtle">
                {t("ncrPage.actionsNote")}
              </p>
            </div>
            {ncr.correctiveActions.length === 0 ? (
              <p className="nesto-card p-5 text-table text-fg-subtle">
                {t("ncrPage.noActions")}
              </p>
            ) : (
              <CorrectiveActionTable
                actions={ncr.correctiveActions}
                showParent={false}
                caption={t("ncrPage.actionsCaption", { number: ncr.ncrNumber })}
              />
            )}
          </section>

          {ncr.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.documents")}</h2>
              <QaqcRecordDocuments
                context={context}
                entityType="non_conformance_report"
                entityId={ncr.id}
                emptyDescription={t("documents.ncr")}
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
                  ncr.createdBy ? (
                    <PersonLink memberId={ncr.createdBy.memberId} name={ncr.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("detail.raised")} value={formatDateTime(ncr.createdAt)} />
              {ncr.submittedAt ? (
                <Meta label={t("detail.submitted")} value={formatDateTime(ncr.submittedAt)} />
              ) : null}
              {ncr.approvedAt ? (
                <Meta
                  label={t("ncrPage.closureApproved")}
                  value={
                    <>
                      {formatDateTime(ncr.approvedAt)}
                      {ncr.approvedBy ? (
                        <>
                          {" "}
                          {t("detail.by")} <PersonLink memberId={ncr.approvedBy.memberId} name={ncr.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {ncr.rejectedAt ? (
                <Meta
                  label={t("ncrPage.closureRejected")}
                  value={
                    <>
                      {formatDateTime(ncr.rejectedAt)}
                      {ncr.rejectedBy ? (
                        <>
                          {" "}
                          {t("detail.by")} <PersonLink memberId={ncr.rejectedBy.memberId} name={ncr.rejectedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {ncr.closedAt ? (
                <Meta label={t("detail.closed")} value={formatDateTime(ncr.closedAt)} />
              ) : null}
            </dl>
          </section>

          {ncr.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.activity")}</h2>
              <QaqcActivityFeed
                context={context}
                entityType="NonConformanceReport"
                entityId={ncr.id}
                moreHref={`/qaqc/ncrs/${ncr.id}/activity`}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Follow-up work raised from this record, in the reader's task scope (PRD #38 §45). */}
      <RecordTasks context={context} parentType="non_conformance_report" parentId={ncrId} />
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="non_conformance_report" parentId={ncrId} />
    </div>
  );
}

async function Block({ label, value }: { label: string; value: string | null }) {
  const t = await getTranslations("qaqc");
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-table text-fg-muted">
        {value ?? <span className="text-fg-subtle">{t("ncrPage.notRecorded")}</span>}
      </dd>
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
