import type { Metadata } from "next";
import Link from "next/link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { MaterialPanel } from "@/components/qaqc/material-panel";
import {
  CorrectiveActionTable,
  DefectTable,
  InspectionTable,
  NcrTable,
} from "@/components/qaqc/qaqc-tables";
import { DetailGrid } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { PersonLink } from "@/components/people/person-link";
import { requireModule } from "@/lib/context/current-user";
import * as inspectionService from "@/lib/modules/qaqc/inspections/inspection.service";
import * as materials from "@/lib/modules/qaqc/materials/material.service";
import { inspectionTypeLabels } from "@/lib/modules/qaqc/qaqc.status";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { InspectionPageShell, loadInspectionPage } from "./inspection-shell";

type Params = { params: Promise<{ inspectionId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { inspectionId } = await params;
  try {
    const context = await requireModule("qaqc");
    const inspection = await inspectionService.getInspection(context, inspectionId);
    return { title: inspection.inspectionNumber };
  } catch {
    return { title: "Inspection" };
  }
}

/** One inspection (PRD #21 §60, §63–§65). */
export default async function InspectionPage({ params }: Params) {
  const { inspectionId } = await params;
  const { context, inspection } = await loadInspectionPage(inspectionId, "overview");

  const lines =
    inspection.inspectionType === "MATERIAL" && inspection.source
      ? await materials.inspectableLines(context, inspection.source.id)
      : [];

  const showMaterial =
    inspection.inspectionType === "MATERIAL" &&
    (inspection.materialDecisions.length > 0 ||
      inspection.release !== null ||
      inspection.capabilities.canRecordMaterialDecision ||
      inspection.capabilities.canRelease);

  return (
    <InspectionPageShell context={context} inspection={inspection} tab="overview">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Details</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "Type", value: inspectionTypeLabels[inspection.inspectionType] },
                {
                  label: "Template",
                  value: inspection.templateName
                    ? `${inspection.templateName}${inspection.templateVersion ? ` v${inspection.templateVersion}` : ""}`
                    : "No checklist",
                },
                {
                  label: "Project",
                  value: inspection.project ? (
                    <Link
                      href={`/projects/${inspection.project.id}`}
                      className="hover:text-accent"
                    >
                      {inspection.project.code} — {inspection.project.name}
                    </Link>
                  ) : (
                    "Not tied to a project"
                  ),
                },
                { label: "Where", value: orDash(inspection.locationText) },
                {
                  label: "From request",
                  value: inspection.requestId ? (
                    <Link
                      href={`/qaqc/requests/${inspection.requestId}`}
                      className="hover:text-accent"
                    >
                      {inspection.requestNumber}
                    </Link>
                  ) : (
                    "Raised directly"
                  ),
                },
                {
                  label: "Delivery",
                  value: inspection.source ? (
                    inspection.source.href ? (
                      <Link href={inspection.source.href} className="hover:text-accent">
                        {inspection.source.label}
                      </Link>
                    ) : (
                      inspection.source.label
                    )
                  ) : (
                    "—"
                  ),
                },
                { label: "Work reference", value: orDash(inspection.workReference) },
                { label: "Drawing", value: orDash(inspection.drawingReference) },
                { label: "Specification", value: orDash(inspection.specificationReference) },
              ]}
            />

            {inspection.summary ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-table font-semibold text-fg">What was found</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {inspection.summary}
                </p>
              </div>
            ) : null}
          </section>

          {showMaterial ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-card font-semibold text-fg">Material</h2>
                <p className="mt-1 text-meta text-fg-subtle">
                  Quality decides what may be used; Inventory records where it went. Accepted,
                  rejected and conditional have to add back to the quantity inspected.
                </p>
              </div>
              <MaterialPanel
                inspectionId={inspection.id}
                lines={lines}
                decisions={inspection.materialDecisions}
                release={inspection.release}
                canDecide={inspection.capabilities.canRecordMaterialDecision}
                canRelease={inspection.capabilities.canRelease}
              />
            </section>
          ) : null}

          {inspection.defects.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Defects raised</h2>
              <DefectTable
                defects={inspection.defects}
                caption={`Defects from ${inspection.inspectionNumber}`}
              />
            </section>
          ) : null}

          {inspection.ncrs.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Non-conformances</h2>
              <NcrTable ncrs={inspection.ncrs} caption={`NCRs from ${inspection.inspectionNumber}`} />
            </section>
          ) : null}

          {inspection.correctiveActions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Corrective actions</h2>
              <CorrectiveActionTable
                actions={inspection.correctiveActions}
                showParent={false}
                caption={`Actions from ${inspection.inspectionNumber}`}
              />
            </section>
          ) : null}

          {inspection.reinspections.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-card font-semibold text-fg">Reinspections</h2>
                <p className="mt-1 text-meta text-fg-subtle">
                  A fresh look with its own verdict. This inspection is unchanged by them.
                </p>
              </div>
              <InspectionTable
                inspections={inspection.reinspections}
                caption={`Reinspections of ${inspection.inspectionNumber}`}
              />
            </section>
          ) : null}

          {inspection.parentInspectionId ? (
            <p className="text-meta text-fg-subtle">
              This is a reinspection of{" "}
              <Link
                href={`/qaqc/inspections/${inspection.parentInspectionId}`}
                className="text-accent-strong hover:underline"
              >
                the earlier inspection
              </Link>
              , which keeps its own verdict.
            </p>
          ) : null}

          {inspection.capabilities.canExecute && inspection.checklist.length > 0 ? (
            <Button asChild>
              <Link href={`/qaqc/inspections/${inspection.id}/execute`}>
                {inspection.status === "DRAFT" ? "Start the checklist" : "Continue the checklist"}
              </Link>
            </Button>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label="Created by"
                value={
                  inspection.createdBy ? (
                    <PersonLink memberId={inspection.createdBy.memberId} name={inspection.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label="Created" value={formatDateTime(inspection.createdAt)} />
              <Meta
                label="Carried out by"
                value={
                  inspection.executedBy ? (
                    <PersonLink memberId={inspection.executedBy.memberId} name={inspection.executedBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              {inspection.submittedAt ? (
                <Meta label="Submitted" value={formatDateTime(inspection.submittedAt)} />
              ) : null}
              {inspection.approvedAt ? (
                <Meta
                  label="Approved"
                  value={
                    <>
                      {formatDateTime(inspection.approvedAt)}
                      {inspection.approvedBy ? (
                        <>
                          {" "}
                          by <PersonLink memberId={inspection.approvedBy.memberId} name={inspection.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {inspection.rejectedAt ? (
                <Meta
                  label="Rejected"
                  value={
                    <>
                      {formatDateTime(inspection.rejectedAt)}
                      {inspection.rejectedBy ? (
                        <>
                          {" "}
                          by <PersonLink memberId={inspection.rejectedBy.memberId} name={inspection.rejectedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {inspection.closedAt ? (
                <Meta label="Closed" value={formatDateTime(inspection.closedAt)} />
              ) : null}
            </dl>
          </section>
        </div>
      </div>

      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="quality_inspection" parentId={inspectionId} className="mt-4" />
    </InspectionPageShell>
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
