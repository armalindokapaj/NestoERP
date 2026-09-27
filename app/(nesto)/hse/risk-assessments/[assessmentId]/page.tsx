import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RiskBadge } from "@/components/hse/hse-format";
import { ActionTable } from "@/components/hse/hse-tables";
import { RiskAssessmentActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pendingCycle } from "@/lib/modules/hse/approvals/approval.service";
import * as risk from "@/lib/modules/hse/risk-assessments/risk.service";
import { riskLevelLabels } from "@/lib/modules/hse/hse.risk";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ assessmentId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { assessmentId } = await params;
  try {
    const context = await requireModule("hse");
    const assessment = await risk.getRiskAssessment(context, assessmentId);
    return { title: assessment.assessmentNumber };
  } catch {
    return { title: (await getTranslations("hse"))("record.riskAssessment") };
  }
}

/** One risk assessment (PRD #22 §100, §104, §318). */
export default async function RiskAssessmentPage({ params }: Params) {
  const { assessmentId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

  let assessment;
  try {
    assessment = await risk.getRiskAssessment(context, assessmentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = assessment.capabilities;
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "RISK_ASSESSMENT", assessment.id) : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.riskAssessments.title"), href: "/hse/risk-assessments" },
          { label: assessment.assessmentNumber },
        ]}
        title={assessment.title}
        subtitle={t("risk.detail.version", { number: assessment.assessmentNumber, version: assessment.version })}
        status={assessment.status}
        badges={
          <>
            {assessment.highestRisk ? (
              <Badge
                tone={
                  assessment.highestRisk === "CRITICAL"
                    ? "danger"
                    : assessment.highestRisk === "HIGH"
                      ? "warning"
                      : "neutral"
                }
              >
                {t("risk.detail.highest", { level: hseLabel(t, "riskLevel", assessment.highestRisk, riskLevelLabels[assessment.highestRisk]) })}
              </Badge>
            ) : null}
            {assessment.reviewDue ? <Badge tone="warning">{t("risk.detail.reviewDue")}</Badge> : null}
          </>
        }
        meta={[
          { label: t("record.project"), value: assessment.project?.code ?? t("record.companyWide") },
          {
            label: t("risk.detail.owner"),
            value: assessment.owner ? (
              <PersonLink memberId={assessment.owner.memberId} name={assessment.owner.fullName} />
            ) : (
              "—"
            ),
          },
          { label: t("risk.detail.assessed"), value: formatDate(assessment.assessmentDate) },
          {
            label: t("risk.detail.review"),
            value: assessment.reviewDate ? formatDate(assessment.reviewDate) : t("record.noDate"),
          },
        ]}
        actions={<RiskAssessmentActions assessment={assessment} cycle={cycle} />}
      />

      {/* Flagged, never invalidated: a person decides (PRD #22 §359). */}
      {assessment.reviewDue ? (
        <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-3 text-table text-warning-strong">
          {t("risk.detail.reviewPassed")}
        </p>
      ) : null}

      {assessment.status === "APPROVED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("risk.detail.frozen", { version: assessment.version + 1 })}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("risk.detail.about")}</h2>
            {assessment.description ? (
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {assessment.description}
              </p>
            ) : null}

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: t("record.project"),
                  value: assessment.project ? (
                    <Link
                      href={`/projects/${assessment.project.id}`}
                      className="hover:text-accent"
                    >
                      {assessment.project.code} — {assessment.project.name}
                    </Link>
                  ) : (
                    t("record.companyWide")
                  ),
                },
                { label: t("risk.detail.activity"), value: orDash(assessment.activityType) },
                { label: t("record.location"), value: orDash(assessment.locationText) },
              ]}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">{t("permit.detail.hazards")}</h2>
            <ol className="space-y-3">
              {assessment.items.map((item, index) => (
                <li key={item.id} className="nesto-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="nesto-eyebrow text-fg-subtle">{t("risk.detail.hazardN", { n: index + 1 })}</p>
                    <span className="flex items-center gap-2">
                      <RiskBadge risk={item.risk} />
                      {item.residualRisk ? (
                        <>
                          <span aria-hidden="true" className="text-fg-subtle">
                            →
                          </span>
                          <RiskBadge risk={item.residualRisk} />
                        </>
                      ) : null}
                    </span>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-table text-fg">
                    {item.hazardDescription}
                  </p>

                  <DetailGrid
                    className="mt-4"
                    items={[
                      { label: t("risk.detail.existingControls"), value: orDash(item.existingControls) },
                      { label: t("risk.detail.furtherControls"), value: orDash(item.additionalControls) },
                      {
                        label: t("permit.detail.responsible"),
                        value: item.responsible ? (
                          <PersonLink memberId={item.responsible.memberId} name={item.responsible.fullName} />
                        ) : (
                          "—"
                        ),
                      },
                      {
                        label: t("risk.detail.byWhen"),
                        value: item.dueDate ? formatDate(item.dueDate) : "—",
                      },
                    ]}
                  />
                </li>
              ))}
            </ol>
          </section>

          {assessment.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.actions")}</h2>
              <ActionTable
                actions={assessment.actions}
                caption={t("inspection.detail.actionsFrom", { number: assessment.assessmentNumber })}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.documents")}</h2>
              <HseRecordDocuments
                context={context}
                entityType="risk_assessment"
                entityId={assessment.id}
                emptyDescription={t("risk.detail.documentsEmpty")}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("record.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("record.createdBy")}
                value={
                  assessment.createdBy ? (
                    <PersonLink memberId={assessment.createdBy.memberId} name={assessment.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("record.created")} value={formatDateTime(assessment.createdAt)} />
              {assessment.submittedAt ? (
                <Meta label={t("inspection.detail.submitted")} value={formatDateTime(assessment.submittedAt)} />
              ) : null}
              {assessment.approvedAt ? (
                <Meta
                  label={t("inspection.detail.approved")}
                  value={
                    <>
                      {formatDateTime(assessment.approvedAt)}
                      {assessment.approvedBy ? (
                        <>
                          {" "}
                          {t("record.by")} <PersonLink memberId={assessment.approvedBy.memberId} name={assessment.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {assessment.archivedAt ? (
                <Meta label={t("risk.detail.archived")} value={formatDateTime(assessment.archivedAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.activity")}</h2>
              <HseActivityFeed
                context={context}
                entityType="HseRiskAssessment"
                entityId={assessment.id}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="risk_assessment" parentId={assessmentId} />
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
