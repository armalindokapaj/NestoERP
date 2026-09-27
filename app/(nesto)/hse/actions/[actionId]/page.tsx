import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { AssignControl } from "@/components/hse/assign-control";
import { HseActionActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import { actionTypeLabels, priorityLabels } from "@/lib/modules/hse/hse.status";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ actionId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { actionId } = await params;
  try {
    const context = await requireModule("hse");
    const action = await actionService.getAction(context, actionId);
    return { title: action.actionNumber };
  } catch {
    return { title: (await getTranslations("hse"))("record.hseAction") };
  }
}

/** One HSE action (PRD #22 §114, §122, §128, §319). */
export default async function HseActionPage({ params }: Params) {
  const { actionId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

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
          { label: t("pages.actions.title"), href: "/hse/actions" },
          { label: action.actionNumber },
        ]}
        title={action.title}
        subtitle={`${action.actionNumber} · ${hseLabel(t, "actionType", action.actionType, actionTypeLabels[action.actionType])}`}
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
              {hseLabel(t, "priority", action.priority, priorityLabels[action.priority])}
            </Badge>
            {action.overdue ? (
              <Badge tone="danger">
                {action.daysOverdue > 0 ? t("action.detail.daysOverdue", { days: action.daysOverdue }) : t("record.overdue")}
              </Badge>
            ) : null}
          </>
        }
        meta={[
          { label: t("record.project"), value: action.project?.code ?? t("record.companyWide") },
          {
            label: t("permit.detail.responsible"),
            value: action.assignedTo ? (
              <PersonLink memberId={action.assignedTo.memberId} name={action.assignedTo.fullName} />
            ) : (
              "—"
            ),
          },
          { label: t("record.due"), value: action.dueDate ? formatDate(action.dueDate) : t("record.noDate") },
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
            <h2 className="text-card font-semibold text-fg">{t("action.detail.whatNeedsDoing")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {action.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: t("action.detail.raisedFrom"),
                  value: action.source ? (
                    action.source.href ? (
                      <Link href={action.source.href} className="hover:text-accent">
                        {action.source.label}
                      </Link>
                    ) : (
                      action.source.label
                    )
                  ) : (
                    t("action.detail.raisedOnItsOwn")
                  ),
                },
                {
                  label: t("record.project"),
                  value: action.project ? (
                    <Link href={`/projects/${action.project.id}`} className="hover:text-accent">
                      {action.project.code} — {action.project.name}
                    </Link>
                  ) : (
                    t("record.companyWide")
                  ),
                },
              ]}
            />
          </section>

          {action.completionNote ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("action.detail.whatWasDone")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {action.completionNote}
              </p>
              <p className="mt-3 text-meta text-fg-subtle">
                {t("action.detail.recordedBy")}{" "}
                {action.completedBy ? (
                  <PersonLink memberId={action.completedBy.memberId} name={action.completedBy.fullName} />
                ) : (
                  t("action.detail.somebody")
                )}
                {action.completedAt ? t("action.detail.onDate", { date: formatDate(action.completedAt) }) : ""}.
              </p>
            </section>
          ) : null}

          {action.verificationNote || action.verifiedAt ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">
                {action.status === "REJECTED" ? t("action.detail.sentBack") : t("action.detail.verification")}
              </h2>
              {action.verificationNote ? (
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {action.verificationNote}
                </p>
              ) : null}
              <p className="mt-3 text-meta text-fg-subtle">
                {t("action.detail.byPrefix")}{" "}
                {action.verifiedBy ? (
                  <PersonLink memberId={action.verifiedBy.memberId} name={action.verifiedBy.fullName} />
                ) : (
                  t("action.detail.somebody")
                )}
                {action.verifiedAt ? t("action.detail.onDate", { date: formatDate(action.verifiedAt) }) : ""}.
              </p>
            </section>
          ) : null}

          {/* The Task is the work item; the action is the obligation and its
              verification. They are not the same thing (PRD #22 §128). */}
          {action.tasks.length > 0 ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("action.detail.tasks")}</h2>
              <p className="mt-1 text-meta text-fg-subtle">
                {t("action.detail.tasksHint")}
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
              <h2 className="text-card font-semibold text-fg">{t("record.documents")}</h2>
              <HseRecordDocuments
                context={context}
                entityType="hse_action"
                entityId={action.id}
                emptyDescription={t("action.detail.documentsEmpty")}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("record.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("action.detail.raisedBy")}
                value={
                  action.createdBy ? (
                    <PersonLink memberId={action.createdBy.memberId} name={action.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("incident.detail.raised")} value={formatDateTime(action.createdAt)} />
              {action.cancelledAt ? (
                <Meta label={t("record.cancelled")} value={formatDateTime(action.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.activity")}</h2>
              <HseActivityFeed context={context} entityType="HseAction" entityId={action.id} />
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="hse_action" parentId={actionId} />
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
