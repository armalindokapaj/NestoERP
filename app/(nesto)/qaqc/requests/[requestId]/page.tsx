import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InspectionTable } from "@/components/qaqc/qaqc-tables";
import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { RequestActions } from "@/components/qaqc/request-actions";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import {
  inspectionTypeLabels,
  priorityLabels,
} from "@/lib/modules/qaqc/qaqc.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ requestId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { requestId } = await params;
  try {
    const context = await requireModule("qaqc");
    const request = await requests.getRequest(context, requestId);
    return { title: request.requestNumber };
  } catch {
    return { title: "Inspection request" };
  }
}

/** One inspection request (PRD #21 §35). */
export default async function RequestPage({ params }: Params) {
  const { requestId } = await params;
  const context = await requireModule("qaqc");

  let request;
  try {
    request = await requests.getRequest(context, requestId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Requests", href: "/qaqc/requests" },
          { label: request.requestNumber },
        ]}
        title={request.title}
        subtitle={request.requestNumber}
        status={request.status}
        badges={
          <>
            <Badge tone="neutral">{inspectionTypeLabels[request.inspectionType]}</Badge>
            {request.priority === "HIGH" || request.priority === "CRITICAL" ? (
              <Badge tone={request.priority === "CRITICAL" ? "danger" : "warning"}>
                {priorityLabels[request.priority]}
              </Badge>
            ) : null}
            {request.overdue ? <Badge tone="danger">Overdue</Badge> : null}
          </>
        }
        meta={[
          {
            label: "Inspector",
            value: request.assignedInspector?.fullName ?? "Not assigned",
          },
          {
            label: "Needed by",
            value: request.requiredByDate ? formatDate(request.requiredByDate) : "No date",
          },
          { label: "Inspections", value: String(request.inspectionCount) },
        ]}
        actions={<RequestActions request={request} />}
      />

      {request.status === "OPEN" && !request.assignedInspector ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          Nobody has picked this up yet. Assigning an inspector is what turns a request into work.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Details</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "Type", value: inspectionTypeLabels[request.inspectionType] },
                { label: "Priority", value: priorityLabels[request.priority] },
                {
                  label: "Project",
                  value: request.project ? (
                    <Link href={`/projects/${request.project.id}`} className="hover:text-accent">
                      {request.project.code} — {request.project.name}
                    </Link>
                  ) : (
                    "Not tied to a project"
                  ),
                },
                { label: "Where", value: orDash(request.locationText) },
                {
                  label: "Delivery",
                  value: request.source ? (
                    request.source.href ? (
                      <Link href={request.source.href} className="hover:text-accent">
                        {request.source.label}
                      </Link>
                    ) : (
                      request.source.label
                    )
                  ) : (
                    "—"
                  ),
                },
                { label: "Raised on", value: formatDate(request.requestedDate) },
              ]}
            />

            {request.description ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-table font-semibold text-fg">Detail</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {request.description}
                </p>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Inspections</h2>
            {request.inspections.length === 0 ? (
              <p className="nesto-card p-5 text-table text-fg-subtle">
                No inspection has been carried out against this request yet.
              </p>
            ) : (
              <InspectionTable
                inspections={request.inspections}
                caption={`Inspections against ${request.requestNumber}`}
              />
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Raised by" value={orDash(request.requestedBy?.fullName ?? null)} />
              <Meta label="Raised" value={formatDateTime(request.createdAt)} />
              <Meta label="Updated" value={formatDateTime(request.updatedAt)} />
              {request.cancelledAt ? (
                <Meta label="Cancelled" value={formatDateTime(request.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {request.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <QaqcActivityFeed
                context={context}
                entityType="InspectionRequest"
                entityId={request.id}
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
      <dd className="mt-0.5 text-table text-fg">{value}</dd>
    </div>
  );
}
