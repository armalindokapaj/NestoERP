import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AssignControl } from "@/components/hse/assign-control";
import { BlockedList, InjuryFlags, SeverityBadge } from "@/components/hse/hse-format";
import { ActionTable, StopWorkTable } from "@/components/hse/hse-tables";
import { IncidentActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import { incidentClosureGapLabels, incidentTypeLabels } from "@/lib/modules/hse/hse.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ incidentId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { incidentId } = await params;
  try {
    const context = await requireModule("hse");
    const incident = await incidents.getIncident(context, incidentId);
    return { title: incident.incidentNumber };
  } catch {
    return { title: "Incident" };
  }
}

/** One incident (PRD #22 §76, §95, §316, §317). */
export default async function IncidentPage({ params }: Params) {
  const { incidentId } = await params;
  const context = await requireModule("hse");

  let incident;
  try {
    incident = await incidents.getIncident(context, incidentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = incident.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: "Incidents", href: "/hse/incidents" },
          { label: incident.incidentNumber },
        ]}
        title={incident.title}
        subtitle={`${incident.incidentNumber} · ${incidentTypeLabels[incident.incidentType]}`}
        status={incident.status}
        badges={
          <>
            <SeverityBadge severity={incident.severity} />
            {incident.overdue ? <Badge tone="danger">Overdue</Badge> : null}
          </>
        }
        meta={[
          { label: "Project", value: incident.project?.code ?? "Company-wide" },
          { label: "Occurred", value: formatDateTime(incident.occurredAt) },
          { label: "Reported by", value: incident.reportedBy?.fullName ?? "—" },
          {
            label: "Investigator",
            value: incident.investigator?.fullName ?? "Not assigned",
          },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {may.canAssign ? <AssignControl kind="incident" recordId={incident.id} /> : null}
            <IncidentActions incident={incident} />
          </div>
        }
      />

      {may.canSubmitClose && incident.closureGaps.length > 0 ? (
        <BlockedList
          title="This incident is not ready to close"
          reasons={incident.closureGaps.map((gap) => incidentClosureGapLabels[gap])}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">What happened</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {incident.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: "Project",
                  value: incident.project ? (
                    <Link href={`/projects/${incident.project.id}`} className="hover:text-accent">
                      {incident.project.code} — {incident.project.name}
                    </Link>
                  ) : (
                    "Company-wide"
                  ),
                },
                { label: "Where", value: orDash(incident.locationText) },
                { label: "Occurred", value: formatDateTime(incident.occurredAt) },
                { label: "Reported", value: formatDateTime(incident.reportedAt) },
              ]}
            />
          </section>

          {/*
           * Flags, never descriptions. There is no diagnosis field to render
           * because there is none stored (PRD #22 §22, §87).
           */}
          {incident.injury ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">What resulted</h2>
              <div className="mt-3">
                <InjuryFlags flags={incident.injury} />
              </div>
              <p className="mt-3 text-meta text-fg-subtle">
                NESTO records whether these happened, and nothing about anybody&rsquo;s medical
                condition.
              </p>
            </section>
          ) : null}

          {incident.immediateAction ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Immediate action</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {incident.immediateAction}
              </p>
            </section>
          ) : null}

          {incident.investigationSummary || incident.rootCause || incident.lessonsLearned ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Investigation</h2>
              <dl className="mt-4 space-y-4">
                {incident.investigationSummary ? (
                  <Block label="What was found" value={incident.investigationSummary} />
                ) : null}
                {incident.rootCause ? (
                  <Block label="Root cause" value={incident.rootCause} />
                ) : null}
                {incident.lessonsLearned ? (
                  <Block label="Lessons learned" value={incident.lessonsLearned} />
                ) : null}
              </dl>
            </section>
          ) : null}

          {incident.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Actions</h2>
              <ActionTable
                actions={incident.actions}
                caption={`Actions on ${incident.incidentNumber}`}
              />
            </section>
          ) : null}

          {incident.stopWorks.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Stop-work</h2>
              <StopWorkTable
                records={incident.stopWorks}
                caption={`Stop-work from ${incident.incidentNumber}`}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <HseRecordDocuments
                context={context}
                entityType="incident"
                entityId={incident.id}
                emptyDescription="Photographs and investigation reports appear here. Medical records do not belong in NESTO."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Reported by" value={orDash(incident.reportedBy?.fullName ?? null)} />
              <Meta label="Raised" value={formatDateTime(incident.createdAt)} />
              {incident.dueDate ? (
                <Meta label="Due" value={formatDate(incident.dueDate)} />
              ) : null}
              {incident.submittedForCloseAt ? (
                <Meta
                  label="Put up for closure"
                  value={formatDateTime(incident.submittedForCloseAt)}
                />
              ) : null}
              {incident.closedAt ? (
                <Meta
                  label="Closed"
                  value={`${formatDateTime(incident.closedAt)}${incident.closedBy ? ` by ${incident.closedBy.fullName}` : ""}`}
                />
              ) : null}
              {incident.closureNote ? (
                <Meta label="Closure note" value={incident.closureNote} />
              ) : null}
              {incident.cancelledAt ? (
                <Meta label="Cancelled" value={formatDateTime(incident.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <HseActivityFeed
                context={context}
                entityType="HseIncident"
                entityId={incident.id}
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-table text-fg-muted">{value}</dd>
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
