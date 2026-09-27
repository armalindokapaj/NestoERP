import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { AssignControl } from "@/components/hse/assign-control";
import { BlockedList, RiskBadge } from "@/components/hse/hse-format";
import { ActionTable, StopWorkTable } from "@/components/hse/hse-tables";
import { HazardActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import { riskLevelLabels } from "@/lib/modules/hse/hse.risk";
import { hazardCategoryLabels, hazardClosureGapLabels } from "@/lib/modules/hse/hse.status";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ hazardId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { hazardId } = await params;
  try {
    const context = await requireModule("hse");
    const hazard = await hazards.getHazard(context, hazardId);
    return { title: hazard.hazardNumber };
  } catch {
    return { title: (await getTranslations("hse"))("record.hazard") };
  }
}

/** One hazard (PRD #22 §57, §73, §314, §315). */
export default async function HazardPage({ params }: Params) {
  const { hazardId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

  let hazard;
  try {
    hazard = await hazards.getHazard(context, hazardId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = hazard.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("record.hse"), href: "/hse" },
          { label: t("pages.hazards.title"), href: "/hse/hazards" },
          { label: hazard.hazardNumber },
        ]}
        title={hazard.title}
        subtitle={hazard.hazardNumber}
        status={hazard.status}
        badges={
          <>
            <RiskBadge risk={hazard.risk} />
            {hazard.overdue ? <Badge tone="danger">{t("record.overdue")}</Badge> : null}
          </>
        }
        meta={[
          { label: t("record.category"), value: hseLabel(t, "hazardCategory", hazard.hazardCategory, hazardCategoryLabels[hazard.hazardCategory]) },
          { label: t("record.project"), value: hazard.project?.code ?? t("record.companyWide") },
          {
            label: t("record.assignedTo"),
            value: hazard.assignedTo ? (
              <PersonLink memberId={hazard.assignedTo.memberId} name={hazard.assignedTo.fullName} />
            ) : (
              t("record.notAssigned")
            ),
          },
          {
            label: t("record.due"),
            value: hazard.dueDate ? formatDate(hazard.dueDate) : t("record.noDate"),
          },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {may.canAssign ? <AssignControl kind="hazard" recordId={hazard.id} /> : null}
            <HazardActions hazard={hazard} />
          </div>
        }
      />

      {/* Named, not hidden behind a disabled button (PRD #22 §73, §341). */}
      {may.canClose && hazard.closureGaps.length > 0 ? (
        <BlockedList
          title={t("hazard.detail.notReady")}
          reasons={hazard.closureGaps.map((gap) => hseLabel(t, "hazardClosureGap", gap, hazardClosureGapLabels[gap]))}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("hazard.detail.whatWasSeen")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {hazard.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: t("record.project"),
                  value: hazard.project ? (
                    <Link href={`/projects/${hazard.project.id}`} className="hover:text-accent">
                      {hazard.project.code} — {hazard.project.name}
                    </Link>
                  ) : (
                    t("record.companyWide")
                  ),
                },
                { label: t("record.where"), value: orDash(hazard.locationText) },
                { label: t("record.observed"), value: formatDate(hazard.observedAt) },
                {
                  label: t("hazard.detail.foundOn"),
                  value: hazard.inspection ? (
                    hazard.inspection.href ? (
                      <Link href={hazard.inspection.href} className="hover:text-accent">
                        {hazard.inspection.label}
                      </Link>
                    ) : (
                      hazard.inspection.label
                    )
                  ) : (
                    t("hazard.detail.reportedDirectly")
                  ),
                },
              ]}
            />
          </section>

          {/* Initial and residual side by side: the point of controlling a
              hazard is the difference between them (PRD #22 §71, §315). */}
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("hazard.detail.risk")}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-line p-4">
                <p className="nesto-eyebrow text-fg-subtle">{t("hazard.detail.beforeControls")}</p>
                <p className="mt-2 text-page font-semibold tabular-nums text-fg">
                  {hazard.risk.score}
                </p>
                <p className="mt-1 text-meta text-fg-muted">
                  {t("record.likelihoodTimes", { level: hseLabel(t, "riskLevel", hazard.risk.level, riskLevelLabels[hazard.risk.level]), likelihood: hazard.risk.likelihood, severity: hazard.risk.severity })}
                </p>
              </div>

              <div className="rounded-md border border-line p-4">
                <p className="nesto-eyebrow text-fg-subtle">{t("hazard.detail.afterControls")}</p>
                {hazard.residualRisk ? (
                  <>
                    <p className="mt-2 text-page font-semibold tabular-nums text-fg">
                      {hazard.residualRisk.score}
                    </p>
                    <p className="mt-1 text-meta text-fg-muted">
                      {t("record.likelihoodTimes", { level: hseLabel(t, "riskLevel", hazard.residualRisk.level, riskLevelLabels[hazard.residualRisk.level]), likelihood: hazard.residualRisk.likelihood, severity: hazard.residualRisk.severity })}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-table text-fg-subtle">{t("hazard.detail.notAssessedYet")}</p>
                )}
              </div>
            </div>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("hazard.detail.controls")}</h2>
            <DetailGrid
              className="mt-4"
              columns={2}
              items={[
                { label: t("hazard.detail.immediate"), value: orDash(hazard.immediateControl) },
                { label: t("hazard.detail.ongoing"), value: orDash(hazard.controlMeasure) },
              ]}
            />
          </section>

          {hazard.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.actions")}</h2>
              <ActionTable
                actions={hazard.actions}
                caption={t("record.actionsOn", { number: hazard.hazardNumber })}
              />
            </section>
          ) : null}

          {hazard.stopWorks.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.stopWork")}</h2>
              <StopWorkTable
                records={hazard.stopWorks}
                caption={t("hazard.detail.stopWorkFrom", { number: hazard.hazardNumber })}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.documents")}</h2>
              <HseRecordDocuments
                context={context}
                entityType="hazard"
                entityId={hazard.id}
                emptyDescription={t("hazard.detail.documentsEmpty")}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("record.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("record.reportedBy")}
                value={
                  hazard.reportedBy ? (
                    <PersonLink memberId={hazard.reportedBy.memberId} name={hazard.reportedBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("record.reported")} value={formatDateTime(hazard.createdAt)} />
              {hazard.closedAt ? (
                <Meta
                  label={t("record.closed")}
                  value={
                    <>
                      {formatDateTime(hazard.closedAt)}
                      {hazard.closedBy ? (
                        <>
                          {" "}
                          {t("record.by")} <PersonLink memberId={hazard.closedBy.memberId} name={hazard.closedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {hazard.closureNote ? (
                <Meta label={t("record.closureNote")} value={hazard.closureNote} />
              ) : null}
              {hazard.cancelledAt ? (
                <Meta label={t("record.cancelled")} value={formatDateTime(hazard.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.activity")}</h2>
              <HseActivityFeed
                context={context}
                entityType="HseHazard"
                entityId={hazard.id}
                moreHref={`/hse/hazards/${hazard.id}/activity`}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Follow-up work raised from this record, in the reader's task scope (PRD #38 §45). */}
      <RecordTasks context={context} parentType="hazard" parentId={hazardId} />
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="hazard" parentId={hazardId} />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-table text-fg">{value}</dd>
    </div>
  );
}
