import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { AssignControl } from "@/components/hse/assign-control";
import { ChecklistExecutor } from "@/components/hse/checklist-executor";
import { ActionTable, HazardTable } from "@/components/hse/hse-tables";
import { InspectionActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pendingCycle } from "@/lib/modules/hse/approvals/approval.service";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import { inspectionResultLabels, inspectionTypeLabels } from "@/lib/modules/hse/hse.status";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ inspectionId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { inspectionId } = await params;
  try {
    const context = await requireModule("hse");
    const inspection = await inspections.getInspection(context, inspectionId);
    return { title: inspection.inspectionNumber };
  } catch {
    return { title: (await getTranslations("hse"))("record.inspection") };
  }
}

/** One safety inspection (PRD #22 §33, §37, §38). */
export default async function InspectionPage({ params }: Params) {
  const { inspectionId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

  let inspection;
  try {
    inspection = await inspections.getInspection(context, inspectionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = inspection.capabilities;
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "INSPECTION", inspection.id) : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.inspections.title"), href: "/hse/inspections" },
          { label: inspection.inspectionNumber },
        ]}
        title={hseLabel(t, "inspectionType", inspection.inspectionType, inspectionTypeLabels[inspection.inspectionType])}
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
          { label: t("record.project"), value: inspection.project?.code ?? t("record.companyWide") },
          {
            label: t("inspection.detail.inspector"),
            value: inspection.assignedInspector ? (
              <PersonLink memberId={inspection.assignedInspector.memberId} name={inspection.assignedInspector.fullName} />
            ) : (
              "—"
            ),
          },
          {
            label: t("inspection.detail.scheduled"),
            value: inspection.scheduledDate ? formatDate(inspection.scheduledDate) : "—",
          },
          {
            label: t("inspection.detail.result"),
            value: hseLabel(t, "inspectionResult", inspection.result, inspectionResultLabels[inspection.result]),
          },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {may.canAssign ? (
              <AssignControl kind="inspection" recordId={inspection.id} />
            ) : null}
            <InspectionActions inspection={inspection} cycle={cycle} />
          </div>
        }
      />

      {inspection.status === "REJECTED" && inspection.decisionNote ? (
        <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-3 text-table text-warning-strong">
          {t("inspection.detail.sentBack", { note: inspection.decisionNote })}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <div>
              <h2 className="text-card font-semibold text-fg">{t("inspection.detail.checklist")}</h2>
              {inspection.template ? (
                <p className="mt-1 text-meta text-fg-subtle">
                  {t("inspection.detail.copiedFrom", { code: inspection.template.code, name: inspection.template.name, version: inspection.template.version })}
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
              <h2 className="text-card font-semibold text-fg">{t("inspection.detail.summary")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {inspection.summary}
              </p>
            </section>
          ) : null}

          {inspection.hazards.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("inspection.detail.hazardsFound")}</h2>
              <HazardTable
                hazards={inspection.hazards}
                caption={t("inspection.detail.hazardsFrom", { number: inspection.inspectionNumber })}
              />
            </section>
          ) : null}

          {inspection.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.actions")}</h2>
              <ActionTable
                actions={inspection.actions}
                caption={t("inspection.detail.actionsFrom", { number: inspection.inspectionNumber })}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.documents")}</h2>
              <HseRecordDocuments
                context={context}
                entityType="hse_inspection"
                entityId={inspection.id}
                emptyDescription={t("inspection.detail.documentsEmpty")}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("record.record")}</h2>
            <DetailGrid
              className="mt-4"
              columns={2}
              items={[
                { label: t("record.where"), value: orDash(inspection.locationText) },
                {
                  label: t("inspection.detail.inspected"),
                  value: inspection.inspectionDate
                    ? formatDate(inspection.inspectionDate)
                    : "—",
                },
                {
                  label: t("inspection.detail.carriedOutBy"),
                  value: inspection.executedBy ? (
                    <PersonLink memberId={inspection.executedBy.memberId} name={inspection.executedBy.fullName} />
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t("inspection.detail.submitted"),
                  value: inspection.submittedAt ? formatDateTime(inspection.submittedAt) : "—",
                },
                {
                  label: t("inspection.detail.approved"),
                  value: inspection.approvedAt ? (
                    <>
                      {formatDate(inspection.approvedAt)}
                      {inspection.approvedBy ? (
                        <>
                          {" "}
                          {t("record.by")} <PersonLink memberId={inspection.approvedBy.memberId} name={inspection.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t("record.closed"),
                  value: inspection.closedAt ? formatDate(inspection.closedAt) : "—",
                },
              ]}
            />
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.activity")}</h2>
              <HseActivityFeed
                context={context}
                entityType="HseInspection"
                entityId={inspection.id}
                moreHref={`/hse/inspections/${inspection.id}/activity`}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="hse_inspection" parentId={inspectionId} />
    </div>
  );
}
