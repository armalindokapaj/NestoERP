import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AssignControl } from "@/components/hse/assign-control";
import { BlockedList, RiskBadge } from "@/components/hse/hse-format";
import { ActionTable, StopWorkTable } from "@/components/hse/hse-tables";
import { HazardActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import { riskLevelLabels } from "@/lib/modules/hse/hse.risk";
import { hazardCategoryLabels, hazardClosureGapLabels } from "@/lib/modules/hse/hse.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ hazardId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { hazardId } = await params;
  try {
    const context = await requireModule("hse");
    const hazard = await hazards.getHazard(context, hazardId);
    return { title: hazard.hazardNumber };
  } catch {
    return { title: "Hazard" };
  }
}

/** One hazard (PRD #22 §57, §73, §314, §315). */
export default async function HazardPage({ params }: Params) {
  const { hazardId } = await params;
  const context = await requireModule("hse");

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
          { label: "HSE", href: "/hse" },
          { label: "Hazards", href: "/hse/hazards" },
          { label: hazard.hazardNumber },
        ]}
        title={hazard.title}
        subtitle={hazard.hazardNumber}
        status={hazard.status}
        badges={
          <>
            <RiskBadge risk={hazard.risk} />
            {hazard.overdue ? <Badge tone="danger">Overdue</Badge> : null}
          </>
        }
        meta={[
          { label: "Category", value: hazardCategoryLabels[hazard.hazardCategory] },
          { label: "Project", value: hazard.project?.code ?? "Company-wide" },
          { label: "Assigned to", value: hazard.assignedTo?.fullName ?? "Not assigned" },
          {
            label: "Due",
            value: hazard.dueDate ? formatDate(hazard.dueDate) : "No date",
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
          title="This hazard is not ready to close"
          reasons={hazard.closureGaps.map((gap) => hazardClosureGapLabels[gap])}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">What was seen</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {hazard.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: "Project",
                  value: hazard.project ? (
                    <Link href={`/projects/${hazard.project.id}`} className="hover:text-accent">
                      {hazard.project.code} — {hazard.project.name}
                    </Link>
                  ) : (
                    "Company-wide"
                  ),
                },
                { label: "Where", value: orDash(hazard.locationText) },
                { label: "Observed", value: formatDate(hazard.observedAt) },
                {
                  label: "Found on",
                  value: hazard.inspection ? (
                    hazard.inspection.href ? (
                      <Link href={hazard.inspection.href} className="hover:text-accent">
                        {hazard.inspection.label}
                      </Link>
                    ) : (
                      hazard.inspection.label
                    )
                  ) : (
                    "Reported directly"
                  ),
                },
              ]}
            />
          </section>

          {/* Initial and residual side by side: the point of controlling a
              hazard is the difference between them (PRD #22 §71, §315). */}
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Risk</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-line p-4">
                <p className="nesto-eyebrow text-fg-subtle">Before controls</p>
                <p className="mt-2 text-page font-semibold tabular-nums text-fg">
                  {hazard.risk.score}
                </p>
                <p className="mt-1 text-meta text-fg-muted">
                  {riskLevelLabels[hazard.risk.level]} · likelihood {hazard.risk.likelihood} ×
                  severity {hazard.risk.severity}
                </p>
              </div>

              <div className="rounded-md border border-line p-4">
                <p className="nesto-eyebrow text-fg-subtle">After controls</p>
                {hazard.residualRisk ? (
                  <>
                    <p className="mt-2 text-page font-semibold tabular-nums text-fg">
                      {hazard.residualRisk.score}
                    </p>
                    <p className="mt-1 text-meta text-fg-muted">
                      {riskLevelLabels[hazard.residualRisk.level]} · likelihood{" "}
                      {hazard.residualRisk.likelihood} × severity{" "}
                      {hazard.residualRisk.severity}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-table text-fg-subtle">Not assessed yet</p>
                )}
              </div>
            </div>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Controls</h2>
            <DetailGrid
              className="mt-4"
              columns={2}
              items={[
                { label: "Immediate", value: orDash(hazard.immediateControl) },
                { label: "Ongoing", value: orDash(hazard.controlMeasure) },
              ]}
            />
          </section>

          {hazard.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Actions</h2>
              <ActionTable
                actions={hazard.actions}
                caption={`Actions on ${hazard.hazardNumber}`}
              />
            </section>
          ) : null}

          {hazard.stopWorks.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Stop-work</h2>
              <StopWorkTable
                records={hazard.stopWorks}
                caption={`Stop-work from ${hazard.hazardNumber}`}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <HseRecordDocuments
                context={context}
                entityType="hazard"
                entityId={hazard.id}
                emptyDescription="Photographs of the hazard and of the control that went in appear here."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Reported by" value={orDash(hazard.reportedBy?.fullName ?? null)} />
              <Meta label="Reported" value={formatDateTime(hazard.createdAt)} />
              {hazard.closedAt ? (
                <Meta
                  label="Closed"
                  value={`${formatDateTime(hazard.closedAt)}${hazard.closedBy ? ` by ${hazard.closedBy.fullName}` : ""}`}
                />
              ) : null}
              {hazard.closureNote ? (
                <Meta label="Closure note" value={hazard.closureNote} />
              ) : null}
              {hazard.cancelledAt ? (
                <Meta label="Cancelled" value={formatDateTime(hazard.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <HseActivityFeed context={context} entityType="HseHazard" entityId={hazard.id} />
            </section>
          ) : null}
        </div>
      </div>
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
