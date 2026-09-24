import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { CorrectiveActionActions } from "@/components/qaqc/record-actions";
import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { QaqcRecordDocuments } from "@/components/qaqc/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";

type Params = { params: Promise<{ actionId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { actionId } = await params;
  try {
    const context = await requireModule("qaqc");
    const action = await actions.getAction(context, actionId);
    return { title: action.actionNumber };
  } catch {
    return { title: "Corrective action" };
  }
}

/** One corrective action (PRD #21 §141, §146, §147). */
export default async function CorrectiveActionPage({ params }: Params) {
  const { actionId } = await params;
  const context = await requireModule("qaqc");

  let action;
  try {
    action = await actions.getAction(context, actionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const parentHref = action.parent
    ? action.parent.kind === "NCR"
      ? `/qaqc/ncrs/${action.parent.id}`
      : action.parent.kind === "DEFECT"
        ? `/qaqc/defects/${action.parent.id}`
        : `/qaqc/inspections/${action.parent.id}`
    : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Corrective actions", href: "/qaqc/corrective-actions" },
          { label: action.actionNumber },
        ]}
        title={action.title}
        subtitle={action.actionNumber}
        status={action.status}
        badges={action.overdue ? <Badge tone="danger">Overdue</Badge> : null}
        meta={[
          {
            label: "Assigned to",
            value: action.assignedTo ? (
              <PersonLink memberId={action.assignedTo.memberId} name={action.assignedTo.fullName} />
            ) : (
              "Not assigned"
            ),
          },
          { label: "Due", value: action.dueDate ? formatDate(action.dueDate) : "No date" },
          {
            label: "Raised against",
            value: action.parent ? action.parent.label : "—",
          },
        ]}
        actions={<CorrectiveActionActions action={action} />}
      />

      {action.status === "PENDING_VERIFICATION" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          The work is recorded as done and is waiting to be verified. Whoever did it cannot verify
          it — that is what makes the verification worth anything.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">What needs doing</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {action.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: "Raised against",
                  value:
                    action.parent && parentHref ? (
                      <Link href={parentHref} className="hover:text-accent">
                        {action.parent.label}
                      </Link>
                    ) : (
                      "—"
                    ),
                },
                {
                  label: "Project",
                  value: action.project ? (
                    <Link href={`/projects/${action.project.id}`} className="hover:text-accent">
                      {action.project.code} — {action.project.name}
                    </Link>
                  ) : (
                    "Not tied to a project"
                  ),
                },
              ]}
            />
          </section>

          {action.completionNote ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">What was done</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {action.completionNote}
              </p>
              <p className="mt-3 text-meta text-fg-subtle">
                Recorded by{" "}
                {action.completedBy ? (
                  <PersonLink memberId={action.completedBy.memberId} name={action.completedBy.fullName} />
                ) : (
                  "somebody"
                )}
                {action.completedAt ? ` on ${formatDate(action.completedAt)}` : ""}.
              </p>
            </section>
          ) : null}

          {action.verificationNote || action.verifiedAt ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Verification</h2>
              {action.verificationNote ? (
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {action.verificationNote}
                </p>
              ) : null}
              <p className="mt-3 text-meta text-fg-subtle">
                Verified by{" "}
                {action.verifiedBy ? (
                  <PersonLink memberId={action.verifiedBy.memberId} name={action.verifiedBy.fullName} />
                ) : (
                  "somebody"
                )}
                {action.verifiedAt ? ` on ${formatDate(action.verifiedAt)}` : ""}.
              </p>
            </section>
          ) : null}

          {action.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <QaqcRecordDocuments
                context={context}
                entityType="corrective_action"
                entityId={action.id}
                emptyDescription="Evidence that the action was carried out appears here."
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
                  action.createdBy ? (
                    <PersonLink memberId={action.createdBy.memberId} name={action.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label="Raised" value={formatDateTime(action.createdAt)} />
              {action.cancelledAt ? (
                <Meta label="Cancelled" value={formatDateTime(action.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {action.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <QaqcActivityFeed
                context={context}
                entityType="CorrectiveAction"
                entityId={action.id}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Follow-up work raised from this record, in the reader's task scope (PRD #38 §45). */}
      <RecordTasks context={context} parentType="corrective_action" parentId={actionId} />
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="corrective_action" parentId={actionId} />
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
