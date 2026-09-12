import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PermitClock, PermitStatusBadge } from "@/components/hse/hse-format";
import { ActionTable } from "@/components/hse/hse-tables";
import { PermitActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import { permitTypeLabels } from "@/lib/modules/hse/hse.status";
import { formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ permitId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { permitId } = await params;
  try {
    const context = await requireModule("hse");
    const permit = await permits.getPermit(context, permitId);
    return { title: permit.permitNumber };
  } catch {
    return { title: "Work permit" };
  }
}

/** One work permit (PRD #22 §140, §151, §321, §322). */
export default async function PermitPage({ params }: Params) {
  const { permitId } = await params;
  const context = await requireModule("hse");

  let permit;
  try {
    permit = await permits.getPermit(context, permitId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = permit.capabilities;
  const lapsed = permit.effectiveStatus === "EXPIRED" && permit.status !== "EXPIRED";

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: "Permits", href: "/hse/permits" },
          { label: permit.permitNumber },
        ]}
        title={permit.title}
        subtitle={`${permit.permitNumber} · ${permitTypeLabels[permit.permitType]}`}
        badges={
          <PermitStatusBadge
            status={permit.status}
            effectiveStatus={permit.effectiveStatus}
          />
        }
        meta={[
          { label: "Project", value: permit.project.code },
          { label: "Location", value: permit.locationText },
          { label: "Responsible", value: permit.responsible?.fullName ?? "—" },
          { label: "Window", value: <PermitClock hoursRemaining={permit.hoursRemaining} /> },
        ]}
        actions={<PermitActions permit={permit} />}
      />

      {/*
       * The clock and the column disagree: somebody may be working to a permit
       * that ran out under them (PRD #22 §151, §322, §360).
       */}
      {lapsed ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-3 text-table font-medium text-danger-strong"
        >
          This permit&rsquo;s validity window has closed. It authorises nothing, whatever the stored
          status says. Close it and raise a new one if the work is continuing.
        </p>
      ) : permit.status === "SUSPENDED" ? (
        <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-3 text-table text-warning-strong">
          Suspended{permit.suspensionReason ? `: ${permit.suspensionReason}` : "."} Work under it
          is stopped until somebody reactivates it.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">The work</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: "Project",
                  value: (
                    <Link href={`/projects/${permit.project.id}`} className="hover:text-accent">
                      {permit.project.code} — {permit.project.name}
                    </Link>
                  ),
                },
                { label: "Location", value: permit.locationText },
                { label: "Valid from", value: formatDateTime(permit.validFrom) },
                { label: "Valid until", value: formatDateTime(permit.validUntil) },
                { label: "Requested by", value: orDash(permit.requestedBy?.fullName ?? null) },
                { label: "Responsible", value: orDash(permit.responsible?.fullName ?? null) },
                {
                  label: "Risk assessment",
                  value: permit.riskAssessment ? (
                    permit.riskAssessment.href ? (
                      <Link href={permit.riskAssessment.href} className="hover:text-accent">
                        {permit.riskAssessment.label}
                      </Link>
                    ) : (
                      permit.riskAssessment.label
                    )
                  ) : (
                    "None cited"
                  ),
                },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Hazards and controls</h2>
            <dl className="mt-4 space-y-4">
              <Block label="Hazards" value={permit.hazardsSummary} />
              <Block label="Controls" value={permit.controlsSummary} />
              <Block label="PPE required" value={permit.ppeRequirements} />
              <Block label="Special conditions" value={permit.specialConditions} />
            </dl>
          </section>

          {permit.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Actions</h2>
              <ActionTable
                actions={permit.actions}
                caption={`Actions on ${permit.permitNumber}`}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <HseRecordDocuments
                context={context}
                entityType="work_permit"
                entityId={permit.id}
                emptyDescription="The signed permit form, method statement and authorisation sheet appear here."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">History</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Raised" value={formatDateTime(permit.createdAt)} />
              {permit.submittedAt ? (
                <Meta label="Submitted" value={formatDateTime(permit.submittedAt)} />
              ) : null}
              {permit.approvedAt ? (
                <Meta
                  label="Approved"
                  value={`${formatDateTime(permit.approvedAt)}${permit.approvedBy ? ` by ${permit.approvedBy.fullName}` : ""}`}
                />
              ) : null}
              {permit.activatedAt ? (
                <Meta label="Activated" value={formatDateTime(permit.activatedAt)} />
              ) : null}
              {permit.suspendedAt ? (
                <Meta label="Suspended" value={formatDateTime(permit.suspendedAt)} />
              ) : null}
              {permit.closedAt ? (
                <Meta label="Closed" value={formatDateTime(permit.closedAt)} />
              ) : null}
              {permit.cancelledAt ? (
                <Meta label="Cancelled" value={formatDateTime(permit.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <HseActivityFeed
                context={context}
                entityType="HseWorkPermit"
                entityId={permit.id}
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Block({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-table text-fg-muted">
        {value ?? <span className="text-fg-subtle">Not recorded</span>}
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
