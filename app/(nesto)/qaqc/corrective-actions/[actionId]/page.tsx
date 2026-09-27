import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
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
    const t = await getTranslations("qaqc");
    return { title: t("meta.correctiveAction") };
  }
}

/** One corrective action (PRD #21 §141, §146, §147). */
export default async function CorrectiveActionPage({ params }: Params) {
  const { actionId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

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
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.correctiveActions"), href: "/qaqc/corrective-actions" },
          { label: action.actionNumber },
        ]}
        title={action.title}
        subtitle={action.actionNumber}
        status={action.status}
        badges={action.overdue ? <Badge tone="danger">{t("common.overdue")}</Badge> : null}
        meta={[
          {
            label: t("detail.assignedTo"),
            value: action.assignedTo ? (
              <PersonLink memberId={action.assignedTo.memberId} name={action.assignedTo.fullName} />
            ) : (
              t("common.notAssigned")
            ),
          },
          { label: t("detail.due"), value: action.dueDate ? formatDate(action.dueDate) : t("common.noDate") },
          {
            label: t("detail.raisedAgainst"),
            value: action.parent ? action.parent.label : "—",
          },
        ]}
        actions={<CorrectiveActionActions action={action} />}
      />

      {action.status === "PENDING_VERIFICATION" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("actionPage.pendingNote")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("actionPage.whatNeedsDoing")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {action.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: t("detail.raisedAgainst"),
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
                  label: t("detail.project"),
                  value: action.project ? (
                    <Link href={`/projects/${action.project.id}`} className="hover:text-accent">
                      {action.project.code} — {action.project.name}
                    </Link>
                  ) : (
                    t("common.notTied")
                  ),
                },
              ]}
            />
          </section>

          {action.completionNote ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("detail.whatWasDone")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {action.completionNote}
              </p>
              <p className="mt-3 text-meta text-fg-subtle">
                {t("detail.recordedBy")}{" "}
                {action.completedBy ? (
                  <PersonLink memberId={action.completedBy.memberId} name={action.completedBy.fullName} />
                ) : (
                  t("common.somebody")
                )}
                {action.completedAt ? t("detail.onDate", { date: formatDate(action.completedAt) }) : ""}.
              </p>
            </section>
          ) : null}

          {action.verificationNote || action.verifiedAt ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("actionPage.verification")}</h2>
              {action.verificationNote ? (
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {action.verificationNote}
                </p>
              ) : null}
              <p className="mt-3 text-meta text-fg-subtle">
                {t("detail.verifiedBy")}{" "}
                {action.verifiedBy ? (
                  <PersonLink memberId={action.verifiedBy.memberId} name={action.verifiedBy.fullName} />
                ) : (
                  t("common.somebody")
                )}
                {action.verifiedAt ? t("detail.onDate", { date: formatDate(action.verifiedAt) }) : ""}.
              </p>
            </section>
          ) : null}

          {action.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.documents")}</h2>
              <QaqcRecordDocuments
                context={context}
                entityType="corrective_action"
                entityId={action.id}
                emptyDescription={t("documents.action")}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("detail.raisedBy")}
                value={
                  action.createdBy ? (
                    <PersonLink memberId={action.createdBy.memberId} name={action.createdBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("detail.raised")} value={formatDateTime(action.createdAt)} />
              {action.cancelledAt ? (
                <Meta label={t("detail.cancelled")} value={formatDateTime(action.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {action.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.activity")}</h2>
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
