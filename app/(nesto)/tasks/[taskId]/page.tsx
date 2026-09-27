import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { RecordFavorite } from "@/components/productivity/record-favorite";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RecordDocuments } from "@/components/documents/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PriorityBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { TaskActions } from "@/components/tasks/task-actions";
import { WhatIsThis } from "@/components/help/what-is-this";
import { Badge } from "@/components/ui/badge";
import { can, canAccessModule } from "@/lib/access/can";
import * as tasks from "@/lib/modules/tasks/task.service";
import { taskStatusLabels } from "@/lib/modules/tasks/task.status";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { loadTask, taskBreadcrumbs } from "./task-context";

type Params = { params: Promise<{ taskId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { taskId } = await params;
  try {
    const { task } = await loadTask(taskId);
    return { title: task.title };
  } catch {
    return { title: "Task" };
  }
}

/**
 * Task detail (PRD #11 §54, §59).
 *
 * Header, status, assignment, schedule, description, metadata, activity — in
 * that order. Each section checks the permission behind it, so a role without
 * activity access sees no feed rather than an empty locked card.
 */
export default async function TaskDetailPage({ params }: Params) {
  const { taskId } = await params;
  const { context, task } = await loadTask(taskId);

  const archived = task.archivedAt !== null || task.status === "ARCHIVED";
  const showDocuments = canAccessModule(context, "documents") && can(context, "document.view");
  const activity = can(context, "task.activity.view")
    ? await tasks.listActivity(context, taskId, { page: 1, limit: 5 })
    : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={taskBreadcrumbs(task)}
        title={task.title}
        subtitle={task.project ? task.project.name : "Personal task"}
        status={task.status}
        badges={
          <>
            <PriorityBadge priority={task.priority} />
            {task.schedule.isOverdue ? <Badge tone="danger">Overdue</Badge> : null}
          </>
        }
        meta={[
          {
            label: "Assignee",
            value: task.assignee ? (
              <span className="flex items-center gap-2">
                <PersonLink memberId={task.assignee.memberId} name={task.assignee.fullName} />
                {task.assignee.membershipActive ? null : <Badge tone="warning">Inactive</Badge>}
              </span>
            ) : (
              "Unassigned"
            ),
          },
          {
            label: "Project",
            value: task.project ? (
              can(context, "project.view") ? (
                <Link
                  href={`/projects/${task.project.id}`}
                  className="text-fg transition-colors hover:text-accent"
                >
                  {task.project.name}
                </Link>
              ) : (
                // No link to a record this person cannot open (PRD #11 §57).
                task.project.name
              )
            ) : (
              "—"
            ),
          },
          {
            label: "Due",
            value: task.schedule.dueDate ? formatDate(task.schedule.dueDate) : "No due date",
          },
          // The record this work came from, when the reader can open it
          // (PRD #38 §45, §47).
          ...(task.parent
            ? [
                {
                  label: `Raised from ${task.parent.noun.toLowerCase()}`,
                  value: (
                    <Link href={task.parent.href} className="text-fg transition-colors hover:text-accent" data-testid="task-parent-link">
                      {task.parent.label}
                    </Link>
                  ),
                },
              ]
            : []),
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="task" entityId={task.id} />
            <TaskActions task={task} />
          </>
        }
      />

      {archived ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {/* "Restore" only to someone who may: never an instruction the reader cannot follow (AUD-05 §4, UX-08). */}
          {task.capabilities.canRestore
            ? "This task is archived and read-only. Restore it to make changes."
            : "This task is archived and read-only."}
        </p>
      ) : null}

      {/* Status and assignment are the task's high-confusion points (AUD-05 §7, UX-13, UX-15). */}
      <WhatIsThis id="tasks.detail.status" title="Task status and assignment">
        <p>
          A task moves from To Do to In Progress to Completed. Blocked means it cannot move until the recorded reason is resolved; an archived
          task is read-only. The buttons at the top show only the next steps you may take.
        </p>
        <p>
          The assignee is the one person responsible. A task on a project shows under that project&apos;s Tasks tab; a task with no project is a
          personal task.
        </p>
      </WhatIsThis>

      {task.blocked ? (
        <div role="note" className="rounded-md border border-warning bg-warning-soft px-4 py-3" data-testid="task-blocked-reason">
          <p className="text-table font-semibold text-warning-strong">Blocked</p>
          <p className="mt-1 whitespace-pre-wrap text-table text-fg [overflow-wrap:anywhere]">{task.blocked.reason ?? "No reason was recorded."}</p>
          {task.blocked.since ? (
            <p className="mt-1 text-meta text-fg-subtle">Since {formatDateTime(task.blocked.since)}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Description</h2>
          {/* A pasted URL or code wraps inside the card instead of widening the page on a phone (AUD-04 §3, MW-01). */}
          {task.description ? (
            <p className="mt-3 whitespace-pre-wrap text-body text-fg-muted [overflow-wrap:anywhere]">{task.description}</p>
          ) : (
            <p className="mt-3 text-table text-fg-subtle">No description was added.</p>
          )}

          <div className="mt-6 border-t border-line pt-5">
            <DetailGrid
              items={[
                { label: "Status", value: taskStatusLabels[task.status] },
                { label: "Priority", value: <PriorityBadge priority={task.priority} /> },
                {
                  label: "Start date",
                  value: task.schedule.startDate ? formatDate(task.schedule.startDate) : "—",
                },
                {
                  label: "Completed",
                  value: task.schedule.completedAt
                    ? formatDateTime(task.schedule.completedAt)
                    : "—",
                },
              ]}
            />
          </div>
        </section>

        <div className="space-y-4 lg:col-span-2 lg:row-start-2">
          {showDocuments ? (
            <section className="nesto-card p-5" aria-labelledby="task-documents-heading">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id="task-documents-heading" className="text-card font-semibold text-fg">
                  Attachments
                </h2>
                <Link href={`/tasks/${task.id}/documents`} className="text-table font-medium text-accent-strong">
                  View all
                </Link>
              </div>
              <RecordDocuments
                context={context}
                entityType="task"
                entityId={task.id}
                canAttach={!archived}
                emptyTitle="No evidence attached."
                emptyDescription="Photographs, drawings and files attached to this task appear here."
              />
            </section>
          ) : null}

          <CollaborationPanel parentType="task" parentId={task.id} />
        </div>

        <div className="space-y-4 lg:col-start-3 lg:row-start-1">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Details</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Created by" value={task.creator ? <PersonLink memberId={task.creator.memberId} name={task.creator.fullName} /> : "—"} />
              <Meta label="Created" value={formatDateTime(task.createdAt)} />
              <Meta label="Updated" value={formatDateTime(task.updatedAt)} />
              {task.archivedAt ? (
                <Meta label="Archived" value={formatDateTime(task.archivedAt)} />
              ) : null}
            </dl>
          </section>

          {activity ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Activity</h2>
                <Link
                  href={`/tasks/${task.id}/activity`}
                  className="text-table font-medium text-accent-strong"
                >
                  View all
                </Link>
              </div>
              {activity.data.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">No activity recorded yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {activity.data.map((entry) => (
                    <li key={entry.id} className="text-table">
                      <p className="text-fg [overflow-wrap:anywhere]">
                        {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">Someone</span>}{" "}
                        {entry.message ?? entry.action}
                      </p>
                      <p className="text-meta text-fg-subtle">{formatDateTime(entry.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
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
