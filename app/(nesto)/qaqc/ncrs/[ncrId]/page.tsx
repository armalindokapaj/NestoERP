import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ClosureGaps, NcrActions } from "@/components/qaqc/record-actions";
import { CorrectiveActionTable } from "@/components/qaqc/qaqc-tables";
import { SeverityBadge } from "@/components/qaqc/qaqc-format";
import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { QaqcRecordDocuments } from "@/components/qaqc/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";
import { ncrCategoryLabels } from "@/lib/modules/qaqc/qaqc.status";
import { formatDate, formatDateTime } from "@/lib/utils/format";

type Params = { params: Promise<{ ncrId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ncrId } = await params;
  try {
    const context = await requireModule("qaqc");
    const ncr = await ncrs.getNcr(context, ncrId);
    return { title: ncr.ncrNumber };
  } catch {
    return { title: "Non-conformance report" };
  }
}

/**
 * One NCR (PRD #21 §123, §136).
 *
 * The closure requirements are shown on the page, not hidden behind a refused
 * button: a reader who cannot close this should be able to see exactly what is
 * still missing.
 */
export default async function NcrPage({ params }: Params) {
  const { ncrId } = await params;
  const context = await requireModule("qaqc");

  let ncr;
  try {
    ncr = await ncrs.getNcr(context, ncrId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const live = ncr.status !== "CLOSED" && ncr.status !== "CANCELLED";

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "NCRs", href: "/qaqc/ncrs" },
          { label: ncr.ncrNumber },
        ]}
        title={ncr.title}
        subtitle={ncr.ncrNumber}
        status={ncr.status}
        badges={
          <>
            <SeverityBadge severity={ncr.severity} />
            <Badge tone="neutral">{ncrCategoryLabels[ncr.category]}</Badge>
            {ncr.overdue ? <Badge tone="danger">Overdue</Badge> : null}
          </>
        }
        meta={[
          { label: "Project", value: ncr.project ? ncr.project.code : "Company-wide" },
          {
            label: "Assigned to",
            value: ncr.assignedTo ? (
              <PersonLink memberId={ncr.assignedTo.memberId} name={ncr.assignedTo.fullName} />
            ) : (
              "Not assigned"
            ),
          },
          { label: "Due", value: ncr.dueDate ? formatDate(ncr.dueDate) : "No date" },
        ]}
        actions={<NcrActions ncr={ncr} />}
      />

      {live ? <ClosureGaps gaps={ncr.closureGaps} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">What did not meet requirement</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{ncr.description}</p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                { label: "Category", value: ncrCategoryLabels[ncr.category] },
                {
                  label: "Project",
                  value: ncr.project ? (
                    <Link href={`/projects/${ncr.project.id}`} className="hover:text-accent">
                      {ncr.project.code} — {ncr.project.name}
                    </Link>
                  ) : (
                    "Not tied to a project"
                  ),
                },
                {
                  label: "Found on",
                  value: ncr.inspection ? (
                    <Link
                      href={`/qaqc/inspections/${ncr.inspection.id}`}
                      className="hover:text-accent"
                    >
                      {ncr.inspection.inspectionNumber}
                    </Link>
                  ) : (
                    "Raised directly"
                  ),
                },
                {
                  label: "From defect",
                  value: ncr.sourceDefect ? (
                    <Link
                      href={`/qaqc/defects/${ncr.sourceDefect.id}`}
                      className="hover:text-accent"
                    >
                      {ncr.sourceDefect.defectNumber}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Delivery",
                  value: ncr.source ? (
                    ncr.source.href ? (
                      <Link href={ncr.source.href} className="hover:text-accent">
                        {ncr.source.label}
                      </Link>
                    ) : (
                      ncr.source.label
                    )
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Quality owner",
                  value: ncr.owner ? <PersonLink memberId={ncr.owner.memberId} name={ncr.owner.fullName} /> : "—",
                },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Investigation</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              This is what separates an NCR from a defect. Without a root cause, closing it records
              that a problem stopped being discussed rather than that it was solved.
            </p>

            <dl className="mt-4 space-y-4">
              <Block label="Immediate action" value={ncr.immediateAction} />
              <Block label="Root cause" value={ncr.rootCause} />
              <Block label="Corrective action summary" value={ncr.correctiveActionSummary} />
              {ncr.closureNote ? <Block label="Closure note" value={ncr.closureNote} /> : null}
            </dl>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-card font-semibold text-fg">Corrective actions</h2>
              <p className="text-meta text-fg-subtle">
                Every one has to be verified before this NCR can close.
              </p>
            </div>
            {ncr.correctiveActions.length === 0 ? (
              <p className="nesto-card p-5 text-table text-fg-subtle">
                None raised yet. An NCR cannot close without at least one.
              </p>
            ) : (
              <CorrectiveActionTable
                actions={ncr.correctiveActions}
                showParent={false}
                caption={`Actions on ${ncr.ncrNumber}`}
              />
            )}
          </section>

          {ncr.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <QaqcRecordDocuments
                context={context}
                entityType="non_conformance_report"
                entityId={ncr.id}
                emptyDescription="Evidence, supplier correspondence and closure records appear here."
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
                  ncr.createdBy ? (
                    <PersonLink memberId={ncr.createdBy.memberId} name={ncr.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label="Raised" value={formatDateTime(ncr.createdAt)} />
              {ncr.submittedAt ? (
                <Meta label="Submitted" value={formatDateTime(ncr.submittedAt)} />
              ) : null}
              {ncr.approvedAt ? (
                <Meta
                  label="Closure approved"
                  value={
                    <>
                      {formatDateTime(ncr.approvedAt)}
                      {ncr.approvedBy ? (
                        <>
                          {" "}
                          by <PersonLink memberId={ncr.approvedBy.memberId} name={ncr.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {ncr.rejectedAt ? (
                <Meta
                  label="Closure rejected"
                  value={
                    <>
                      {formatDateTime(ncr.rejectedAt)}
                      {ncr.rejectedBy ? (
                        <>
                          {" "}
                          by <PersonLink memberId={ncr.rejectedBy.memberId} name={ncr.rejectedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {ncr.closedAt ? (
                <Meta label="Closed" value={formatDateTime(ncr.closedAt)} />
              ) : null}
            </dl>
          </section>

          {ncr.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <QaqcActivityFeed
                context={context}
                entityType="NonConformanceReport"
                entityId={ncr.id}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Follow-up work raised from this record, in the reader's task scope (PRD #38 §45). */}
      <RecordTasks context={context} parentType="non_conformance_report" parentId={ncrId} />
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="non_conformance_report" parentId={ncrId} />
    </div>
  );
}

function Block({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-table text-fg-muted">
        {value ?? <span className="text-fg-subtle">Not recorded yet.</span>}
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
