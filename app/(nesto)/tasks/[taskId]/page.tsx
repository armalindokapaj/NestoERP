import type { Metadata } from "next";
import Link from "next/link";

import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PriorityBadge } from "@/components/modules/status-badge";
import { TaskActions } from "@/components/tasks/task-actions";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/access/can";
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
                {can(context, "team.view") ? (
                  <Link
                    href={`/team/${task.assignee.memberId}`}
                    className="text-fg transition-colors hover:text-accent"
                  >
                    {task.assignee.fullName}
                  </Link>
                ) : (
                  task.assignee.fullName
                )}
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
        ]}
        actions={<TaskActions task={task} />}
      />

      {archived ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This task is archived and read-only. Restore it to make changes.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Description</h2>
          {task.description ? (
            <p className="mt-3 whitespace-pre-wrap text-body text-fg-muted">{task.description}</p>
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

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Details</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Created by" value={task.creator?.fullName ?? "—"} />
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
                      <p className="text-fg">
                        <span className="font-medium">{entry.actor ?? "Someone"}</span>{" "}
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
