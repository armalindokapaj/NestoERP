import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SeverityBadge } from "@/components/hse/hse-format";
import { ActionTable } from "@/components/hse/hse-tables";
import { ObservationActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as environment from "@/lib/modules/hse/environment/environment.service";
import { environmentalCategoryLabels } from "@/lib/modules/hse/hse.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ observationId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { observationId } = await params;
  try {
    const context = await requireModule("hse");
    const observation = await environment.getObservation(context, observationId);
    return { title: observation.observationNumber };
  } catch {
    return { title: "Environmental observation" };
  }
}

/** One environmental observation (PRD #22 §163, §324). */
export default async function ObservationPage({ params }: Params) {
  const { observationId } = await params;
  const context = await requireModule("hse");

  let observation;
  try {
    observation = await environment.getObservation(context, observationId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = observation.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: "Environment", href: "/hse/environment" },
          { label: observation.observationNumber },
        ]}
        title={observation.title}
        subtitle={`${observation.observationNumber} · ${environmentalCategoryLabels[observation.category]}`}
        status={observation.status}
        badges={
          <>
            <SeverityBadge severity={observation.severity} />
            {observation.overdue ? <Badge tone="danger">Overdue</Badge> : null}
          </>
        }
        meta={[
          { label: "Project", value: observation.project?.code ?? "Company-wide" },
          { label: "Observed", value: formatDate(observation.observedAt) },
          { label: "Assigned to", value: observation.assignedTo?.fullName ?? "Not assigned" },
        ]}
        actions={<ObservationActions observation={observation} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">What was seen</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {observation.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: "Project",
                  value: observation.project ? (
                    <Link
                      href={`/projects/${observation.project.id}`}
                      className="hover:text-accent"
                    >
                      {observation.project.code} — {observation.project.name}
                    </Link>
                  ) : (
                    "Company-wide"
                  ),
                },
                { label: "Where", value: orDash(observation.locationText) },
                { label: "Immediate action", value: orDash(observation.immediateAction) },
                {
                  label: "Due",
                  value: observation.dueDate ? formatDate(observation.dueDate) : "No date",
                },
              ]}
            />
          </section>

          {observation.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Actions</h2>
              <ActionTable
                actions={observation.actions}
                caption={`Actions on ${observation.observationNumber}`}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <HseRecordDocuments
                context={context}
                entityType="environmental_observation"
                entityId={observation.id}
                emptyDescription="Photographs, waste receipts and cleanup evidence appear here."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label="Reported by"
                value={orDash(observation.reportedBy?.fullName ?? null)}
              />
              <Meta label="Reported" value={formatDateTime(observation.createdAt)} />
              {observation.closedAt ? (
                <Meta
                  label="Closed"
                  value={`${formatDateTime(observation.closedAt)}${observation.closedBy ? ` by ${observation.closedBy.fullName}` : ""}`}
                />
              ) : null}
              {observation.closureNote ? (
                <Meta label="Closure note" value={observation.closureNote} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <HseActivityFeed
                context={context}
                entityType="EnvironmentalObservation"
                entityId={observation.id}
              />
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
