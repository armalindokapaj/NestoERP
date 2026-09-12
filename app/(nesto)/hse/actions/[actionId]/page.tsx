import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AssignControl } from "@/components/hse/assign-control";
import { HseActionActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import { actionTypeLabels, priorityLabels } from "@/lib/modules/hse/hse.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ actionId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { actionId } = await params;
  try {
    const context = await requireModule("hse");
    const action = await actionService.getAction(context, actionId);
    return { title: action.actionNumber };
  } catch {
    return { title: "HSE action" };
  }
}

/** One HSE action (PRD #22 §114, §122, §128, §319). */
export default async function HseActionPage({ params }: Params) {
  const { actionId } = await params;
  const context = await requireModule("hse");

  let action;
  try {
    action = await actionService.getAction(context, actionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = action.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: "Actions", href: "/hse/actions" },
          { label: action.actionNumber },
        ]}
        title={action.title}
        subtitle={`${action.actionNumber} · ${actionTypeLabels[action.actionType]}`}
        status={action.status}
        badges={
          <>
            <Badge
              tone={
                action.priority === "CRITICAL"
                  ? "danger"
                  : action.priority === "HIGH"
                    ? "warning"
                    : "neutral"
              }
            >
              {priorityLabels[action.priority]}
            </Badge>
            {action.overdue ? (
              <Badge tone="danger">
                {action.daysOverdue > 0 ? `${action.daysOverdue}d overdue` : "Overdue"}
              </Badge>
            ) : null}
          </>
        }
        meta={[
          { label: "Project", value: action.project?.code ?? "Company-wide" },
          { label: "Responsible", value: action.assignedTo?.fullName ?? "—" },
          { label: "Due", value: action.dueDate ? formatDate(action.dueDate) : "No date" },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {may.canAssign ? <AssignControl kind="action" recordId={action.id} /> : null}
            <HseActionActions action={action} />
          </div>
        }
      />

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
                  label: "Raised from",
                  value: action.source ? (
                    action.source.href ? (
                      <Link href={action.source.href} className="hover:text-accent">
                        {action.source.label}
                      </Link>
                    ) : (
                      action.source.label
                    )
                  ) : (
                    "Raised on its own"
                  ),
                },
                {
                  label: "Project",
                  value: action.project ? (
                    <Link href={`/projects/${action.project.id}`} className="hover:text-accent">
                      {action.project.code} — {action.project.name}
                    </Link>
                  ) : (
                    "Company-wide"
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
                Recorded by {action.completedBy?.fullName ?? "somebody"}
                {action.completedAt ? ` on ${formatDate(action.completedAt)}` : ""}.
              </p>
            </section>
          ) : null}

          {action.verificationNote || action.verifiedAt ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">
                {action.status === "REJECTED" ? "Sent back" : "Verification"}
              </h2>
              {action.verificationNote ? (
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {action.verificationNote}
                </p>
              ) : null}
              <p className="mt-3 text-meta text-fg-subtle">
                By {action.verifiedBy?.fullName ?? "somebody"}
                {action.verifiedAt ? ` on ${formatDate(action.verifiedAt)}` : ""}.
              </p>
            </section>
          ) : null}

          {/* The Task is the work item; the action is the obligation and its
              verification. They are not the same thing (PRD #22 §128). */}
          {action.tasks.length > 0 ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Tasks</h2>
              <p className="mt-1 text-meta text-fg-subtle">
                Work items raised to discharge this action. Completing one does not verify the
                action.
              </p>
              <ul className="mt-3 divide-y divide-line">
                {action.tasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/tasks/${task.id}`} className="text-table text-fg hover:text-accent">
                      {task.title}
                    </Link>
                    <StatusBadge status={task.status} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <HseRecordDocuments
                context={context}
                entityType="hse_action"
                entityId={action.id}
                emptyDescription="Evidence that the control went in appears here."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Raised by" value={orDash(action.createdBy?.fullName ?? null)} />
              <Meta label="Raised" value={formatDateTime(action.createdAt)} />
              {action.cancelledAt ? (
                <Meta label="Cancelled" value={formatDateTime(action.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <HseActivityFeed context={context} entityType="HseAction" entityId={action.id} />
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
