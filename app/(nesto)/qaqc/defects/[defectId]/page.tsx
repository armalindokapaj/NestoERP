import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DefectActions } from "@/components/qaqc/record-actions";
import { CorrectiveActionTable, NcrTable } from "@/components/qaqc/qaqc-tables";
import { SeverityBadge } from "@/components/qaqc/qaqc-format";
import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { QaqcRecordDocuments } from "@/components/qaqc/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ defectId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { defectId } = await params;
  try {
    const context = await requireModule("qaqc");
    const defect = await defects.getDefect(context, defectId);
    return { title: defect.defectNumber };
  } catch {
    return { title: "Defect" };
  }
}

/** One defect (PRD #21 §112, §118, §119). */
export default async function DefectPage({ params }: Params) {
  const { defectId } = await params;
  const context = await requireModule("qaqc");

  let defect;
  try {
    defect = await defects.getDefect(context, defectId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Defects", href: "/qaqc/defects" },
          { label: defect.defectNumber },
        ]}
        title={defect.title}
        subtitle={defect.defectNumber}
        status={defect.status}
        badges={
          <>
            <SeverityBadge severity={defect.severity} />
            {defect.overdue ? <Badge tone="danger">Overdue</Badge> : null}
          </>
        }
        meta={[
          { label: "Project", value: defect.project.code },
          {
            label: "Assigned to",
            value: defect.assignedTo ? (
              <PersonLink memberId={defect.assignedTo.memberId} name={defect.assignedTo.fullName} />
            ) : (
              "Not assigned"
            ),
          },
          { label: "Due", value: defect.dueDate ? formatDate(defect.dueDate) : "No date" },
        ]}
        actions={<DefectActions defect={defect} />}
      />

      {defect.status === "RESOLVED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          The fix is recorded and waiting to be confirmed. Whoever recorded it cannot close it —
          somebody else has to agree it is genuinely done.
        </p>
      ) : defect.status === "REOPENED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This was resolved once and came back. The earlier fix is still on the record below.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">What is wrong</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {defect.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: "Project",
                  value: (
                    <Link href={`/projects/${defect.project.id}`} className="hover:text-accent">
                      {defect.project.code} — {defect.project.name}
                    </Link>
                  ),
                },
                { label: "Where", value: orDash(defect.locationText) },
                {
                  label: "Found on",
                  value: defect.inspection ? (
                    <Link
                      href={`/qaqc/inspections/${defect.inspection.id}`}
                      className="hover:text-accent"
                    >
                      {defect.inspection.inspectionNumber}
                    </Link>
                  ) : (
                    "Raised directly"
                  ),
                },
              ]}
            />
          </section>

          {defect.resolutionNote ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">What was done</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {defect.resolutionNote}
              </p>
              <p className="mt-3 text-meta text-fg-subtle">
                Recorded by{" "}
                {defect.resolvedBy ? (
                  <PersonLink memberId={defect.resolvedBy.memberId} name={defect.resolvedBy.fullName} />
                ) : (
                  "somebody"
                )}
                {defect.resolvedAt ? ` on ${formatDate(defect.resolvedAt)}` : ""}.
              </p>
            </section>
          ) : null}

          {defect.ncrs.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-card font-semibold text-fg">Escalated to</h2>
                <p className="mt-1 text-meta text-fg-subtle">
                  The defect still has to be fixed. The NCR asks why it happened.
                </p>
              </div>
              <NcrTable ncrs={defect.ncrs} caption={`NCRs from ${defect.defectNumber}`} />
            </section>
          ) : null}

          {defect.correctiveActions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Corrective actions</h2>
              <CorrectiveActionTable
                actions={defect.correctiveActions}
                showParent={false}
                caption={`Actions on ${defect.defectNumber}`}
              />
            </section>
          ) : null}

          {defect.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <QaqcRecordDocuments
                context={context}
                entityType="quality_defect"
                entityId={defect.id}
                emptyDescription="Photographs of the defect and of the finished repair appear here."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label="Raised by"
                value={
                  defect.createdBy ? (
                    <PersonLink memberId={defect.createdBy.memberId} name={defect.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label="Raised" value={formatDateTime(defect.createdAt)} />
              {defect.closedAt ? (
                <Meta
                  label="Closed"
                  value={
                    <>
                      {formatDateTime(defect.closedAt)}
                      {defect.closedBy ? (
                        <>
                          {" "}
                          by <PersonLink memberId={defect.closedBy.memberId} name={defect.closedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {defect.cancelledAt ? (
                <Meta label="Cancelled" value={formatDateTime(defect.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {defect.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <QaqcActivityFeed
                context={context}
                entityType="QualityDefect"
                entityId={defect.id}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="quality_defect" parentId={defectId} />
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
