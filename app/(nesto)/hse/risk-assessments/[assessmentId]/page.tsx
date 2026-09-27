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
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ assessmentId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { assessmentId } = await params;
  try {
    const context = await requireModule("hse");
    const assessment = await risk.getRiskAssessment(context, assessmentId);
    return { title: assessment.assessmentNumber };
  } catch {
    return { title: "Risk assessment" };
  }
}

/** One risk assessment (PRD #22 §100, §104, §318). */
export default async function RiskAssessmentPage({ params }: Params) {
  const { assessmentId } = await params;
  const context = await requireModule("hse");

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
          { label: "Risk assessments", href: "/hse/risk-assessments" },
          { label: assessment.assessmentNumber },
        ]}
        title={assessment.title}
        subtitle={`${assessment.assessmentNumber} · version ${assessment.version}`}
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
                Highest: {riskLevelLabels[assessment.highestRisk]}
              </Badge>
            ) : null}
            {assessment.reviewDue ? <Badge tone="warning">Review due</Badge> : null}
          </>
        }
        meta={[
          { label: "Project", value: assessment.project?.code ?? "Company-wide" },
          {
            label: "Owner",
            value: assessment.owner ? (
              <PersonLink memberId={assessment.owner.memberId} name={assessment.owner.fullName} />
            ) : (
              "—"
            ),
          },
          { label: "Assessed", value: formatDate(assessment.assessmentDate) },
          {
            label: "Review",
            value: assessment.reviewDate ? formatDate(assessment.reviewDate) : "No date",
          },
        ]}
        actions={<RiskAssessmentActions assessment={assessment} cycle={cycle} />}
      />

      {/* Flagged, never invalidated: a person decides (PRD #22 §359). */}
      {assessment.reviewDue ? (
        <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-3 text-table text-warning-strong">
          This assessment has passed its review date. It is still valid — nothing expires by
          itself — but somebody should look at it.
        </p>
      ) : null}

      {assessment.status === "APPROVED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          Approved and frozen. Site work is carried out against this document, so a material
          change creates version {assessment.version + 1} rather than rewriting it.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">About</h2>
            {assessment.description ? (
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {assessment.description}
              </p>
            ) : null}

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: "Project",
                  value: assessment.project ? (
                    <Link
                      href={`/projects/${assessment.project.id}`}
                      className="hover:text-accent"
                    >
                      {assessment.project.code} — {assessment.project.name}
                    </Link>
                  ) : (
                    "Company-wide"
                  ),
                },
                { label: "Activity", value: orDash(assessment.activityType) },
                { label: "Location", value: orDash(assessment.locationText) },
              ]}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Hazards</h2>
            <ol className="space-y-3">
              {assessment.items.map((item, index) => (
                <li key={item.id} className="nesto-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="nesto-eyebrow text-fg-subtle">Hazard {index + 1}</p>
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
                      { label: "Existing controls", value: orDash(item.existingControls) },
                      { label: "Further controls", value: orDash(item.additionalControls) },
                      {
                        label: "Responsible",
                        value: item.responsible ? (
                          <PersonLink memberId={item.responsible.memberId} name={item.responsible.fullName} />
                        ) : (
                          "—"
                        ),
                      },
                      {
                        label: "By when",
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
              <h2 className="text-card font-semibold text-fg">Actions</h2>
              <ActionTable
                actions={assessment.actions}
                caption={`Actions from ${assessment.assessmentNumber}`}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <HseRecordDocuments
                context={context}
                entityType="risk_assessment"
                entityId={assessment.id}
                emptyDescription="The signed assessment, method statement and marked-up plans appear here."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label="Created by"
                value={
                  assessment.createdBy ? (
                    <PersonLink memberId={assessment.createdBy.memberId} name={assessment.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label="Created" value={formatDateTime(assessment.createdAt)} />
              {assessment.submittedAt ? (
                <Meta label="Submitted" value={formatDateTime(assessment.submittedAt)} />
              ) : null}
              {assessment.approvedAt ? (
                <Meta
                  label="Approved"
                  value={
                    <>
                      {formatDateTime(assessment.approvedAt)}
                      {assessment.approvedBy ? (
                        <>
                          {" "}
                          by <PersonLink memberId={assessment.approvedBy.memberId} name={assessment.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {assessment.archivedAt ? (
                <Meta label="Archived" value={formatDateTime(assessment.archivedAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
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
