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
import { getTranslations } from "@/lib/i18n/server";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { loadTask, taskBreadcrumbs } from "./task-context";

type Params = { params: Promise<{ taskId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { taskId } = await params;
  try {
    const { task } = await loadTask(taskId);
    return { title: task.title };
  } catch {
    return { title: (await getTranslations("tasks"))("meta.task") };
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
  const t = await getTranslations("tasks");

  const archived = task.archivedAt !== null || task.status === "ARCHIVED";
  const showDocuments = canAccessModule(context, "documents") && can(context, "document.view");
  const activity = can(context, "task.activity.view")
    ? await tasks.listActivity(context, taskId, { page: 1, limit: 5 })
    : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={await taskBreadcrumbs(task)}
        title={task.title}
        subtitle={task.project ? task.project.name : t("common.personalTask")}
        status={task.status}
        badges={
          <>
            <PriorityBadge priority={task.priority} />
            {task.schedule.isOverdue ? <Badge tone="danger">{t("common.overdue")}</Badge> : null}
          </>
        }
        meta={[
          {
            label: t("fields.assignee"),
            value: task.assignee ? (
              <span className="flex items-center gap-2">
                <PersonLink memberId={task.assignee.memberId} name={task.assignee.fullName} />
                {task.assignee.membershipActive ? null : <Badge tone="warning">{t("common.inactive")}</Badge>}
              </span>
            ) : (
              t("common.unassigned")
            ),
          },
          {
            label: t("fields.project"),
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
            label: t("fields.due"),
            value: task.schedule.dueDate ? formatDate(task.schedule.dueDate) : t("common.noDueDate"),
          },
          // The record this work came from, when the reader can open it
          // (PRD #38 §45, §47).
          ...(task.parent
            ? [
                {
                  label: t("detail.raisedFrom", { noun: task.parent.noun.toLowerCase() }),
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
            ? t("detail.archivedRestore")
            : t("detail.archivedReadOnly")}
        </p>
      ) : null}

      {/* Status and assignment are the task's high-confusion points (AUD-05 §7, UX-13, UX-15). */}
      <WhatIsThis id="tasks.detail.status" title={t("detail.helpTitle")}>
        <p>{t("detail.helpStatus")}</p>
        <p>{t("detail.helpAssignee")}</p>
      </WhatIsThis>

      {task.blocked ? (
        <div role="note" className="rounded-md border border-warning bg-warning-soft px-4 py-3" data-testid="task-blocked-reason">
          <p className="text-table font-semibold text-warning-strong">{t("detail.blocked")}</p>
          <p className="mt-1 whitespace-pre-wrap text-table text-fg [overflow-wrap:anywhere]">{task.blocked.reason ?? t("detail.noReason")}</p>
          {task.blocked.since ? (
            <p className="mt-1 text-meta text-fg-subtle">{t("detail.since", { date: formatDateTime(task.blocked.since) })}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("fields.description")}</h2>
          {/* A pasted URL or code wraps inside the card instead of widening the page on a phone (AUD-04 §3, MW-01). */}
          {task.description ? (
            <p className="mt-3 whitespace-pre-wrap text-body text-fg-muted [overflow-wrap:anywhere]">{task.description}</p>
          ) : (
            <p className="mt-3 text-table text-fg-subtle">{t("detail.noDescription")}</p>
          )}

          <div className="mt-6 border-t border-line pt-5">
            <DetailGrid
              items={[
                { label: t("fields.status"), value: t(`status.${task.status}`) },
                { label: t("fields.priority"), value: <PriorityBadge priority={task.priority} /> },
                {
                  label: t("fields.startDate"),
                  value: task.schedule.startDate ? formatDate(task.schedule.startDate) : "—",
                },
                {
                  label: t("fields.completed"),
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
                  {t("detail.attachments")}
                </h2>
                <Link href={`/tasks/${task.id}/documents`} className="text-table font-medium text-accent-strong">
                  {t("common.viewAll")}
                </Link>
              </div>
              <RecordDocuments
                context={context}
                entityType="task"
                entityId={task.id}
                canAttach={!archived}
                captureEvidence
                emptyTitle={t("common.noEvidence")}
                emptyDescription={t("common.evidenceDescription")}
              />
            </section>
          ) : null}

          <CollaborationPanel parentType="task" parentId={task.id} />
        </div>

        <div className="space-y-4 lg:col-start-3 lg:row-start-1">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("detail.createdBy")} value={task.creator ? <PersonLink memberId={task.creator.memberId} name={task.creator.fullName} /> : "—"} />
              <Meta label={t("detail.created")} value={formatDateTime(task.createdAt)} />
              <Meta label={t("detail.updated")} value={formatDateTime(task.updatedAt)} />
              {task.archivedAt ? (
                <Meta label={t("detail.archived")} value={formatDateTime(task.archivedAt)} />
              ) : null}
            </dl>
          </section>

          {activity ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">{t("common.activity")}</h2>
                <Link
                  href={`/tasks/${task.id}/activity`}
                  className="text-table font-medium text-accent-strong"
                >
                  {t("common.viewAll")}
                </Link>
              </div>
              {activity.data.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">{t("common.noActivity")}</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {activity.data.map((entry) => (
                    <li key={entry.id} className="text-table">
                      <p className="text-fg [overflow-wrap:anywhere]">
                        {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("common.someone")}</span>}{" "}
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
