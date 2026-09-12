import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AssignControl } from "@/components/hse/assign-control";
import { ChecklistExecutor } from "@/components/hse/checklist-executor";
import { ActionTable, HazardTable } from "@/components/hse/hse-tables";
import { InspectionActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import { inspectionResultLabels, inspectionTypeLabels } from "@/lib/modules/hse/hse.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ inspectionId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { inspectionId } = await params;
  try {
    const context = await requireModule("hse");
    const inspection = await inspections.getInspection(context, inspectionId);
    return { title: inspection.inspectionNumber };
  } catch {
    return { title: "Inspection" };
  }
}

/** One safety inspection (PRD #22 §33, §37, §38). */
export default async function InspectionPage({ params }: Params) {
  const { inspectionId } = await params;
  const context = await requireModule("hse");

  let inspection;
  try {
    inspection = await inspections.getInspection(context, inspectionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = inspection.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: "Inspections", href: "/hse/inspections" },
          { label: inspection.inspectionNumber },
        ]}
        title={inspectionTypeLabels[inspection.inspectionType]}
        subtitle={inspection.inspectionNumber}
        status={inspection.status}
        badges={
          /*
           * Both, side by side. An inspection can sit at "pending approval"
           * with a result of "fail" — the inspector has finished and found a
           * problem, and somebody still has to sign it off (PRD #22 §37, §38).
           */
          inspection.result === "NOT_SET" ? null : (
            <StatusBadge status={inspection.result} />
          )
        }
        meta={[
          { label: "Project", value: inspection.project?.code ?? "Company-wide" },
          { label: "Inspector", value: inspection.assignedInspector?.fullName ?? "—" },
          {
            label: "Scheduled",
            value: inspection.scheduledDate ? formatDate(inspection.scheduledDate) : "—",
          },
          {
            label: "Result",
            value: inspectionResultLabels[inspection.result],
          },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {may.canAssign ? (
              <AssignControl kind="inspection" recordId={inspection.id} />
            ) : null}
            <InspectionActions inspection={inspection} />
          </div>
        }
      />

      {inspection.status === "REJECTED" && inspection.decisionNote ? (
        <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-3 text-table text-warning-strong">
          Sent back: {inspection.decisionNote}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <div>
              <h2 className="text-card font-semibold text-fg">Checklist</h2>
              {inspection.template ? (
                <p className="mt-1 text-meta text-fg-subtle">
                  Copied from {inspection.template.code} — {inspection.template.name}, version{" "}
                  {inspection.template.version}. Editing that checklist since has not changed
                  this one.
                </p>
              ) : null}
            </div>
            <ChecklistExecutor
              inspectionId={inspection.id}
              items={inspection.checklistItems}
              readOnly
            />
          </section>

          {inspection.summary ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Summary</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {inspection.summary}
              </p>
            </section>
          ) : null}

          {inspection.hazards.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Hazards found</h2>
              <HazardTable
                hazards={inspection.hazards}
                caption={`Hazards from ${inspection.inspectionNumber}`}
              />
            </section>
          ) : null}

          {inspection.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Actions</h2>
              <ActionTable
                actions={inspection.actions}
                caption={`Actions from ${inspection.inspectionNumber}`}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <HseRecordDocuments
                context={context}
                entityType="hse_inspection"
                entityId={inspection.id}
                emptyDescription="Photographs and signed checklists appear here."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <DetailGrid
              className="mt-4"
              columns={2}
              items={[
                { label: "Where", value: orDash(inspection.locationText) },
                {
                  label: "Inspected",
                  value: inspection.inspectionDate
                    ? formatDate(inspection.inspectionDate)
                    : "—",
                },
                { label: "Carried out by", value: inspection.executedBy?.fullName ?? "—" },
                {
                  label: "Submitted",
                  value: inspection.submittedAt ? formatDateTime(inspection.submittedAt) : "—",
                },
                {
                  label: "Approved",
                  value: inspection.approvedAt
                    ? `${formatDate(inspection.approvedAt)}${inspection.approvedBy ? ` by ${inspection.approvedBy.fullName}` : ""}`
                    : "—",
                },
                {
                  label: "Closed",
                  value: inspection.closedAt ? formatDate(inspection.closedAt) : "—",
                },
              ]}
            />
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <HseActivityFeed
                context={context}
                entityType="HseInspection"
                entityId={inspection.id}
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
