import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { InspectionTable } from "@/components/qaqc/qaqc-tables";
import { QaqcActivityFeed } from "@/components/qaqc/record-activity";
import { RequestActions } from "@/components/qaqc/request-actions";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import { qaqcLabel } from "@/components/qaqc/qaqc-labels";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ requestId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { requestId } = await params;
  try {
    const context = await requireModule("qaqc");
    const request = await requests.getRequest(context, requestId);
    return { title: request.requestNumber };
  } catch {
    const t = await getTranslations("qaqc");
    return { title: t("meta.request") };
  }
}

/** One inspection request (PRD #21 §35). */
export default async function RequestPage({ params }: Params) {
  const { requestId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let request;
  try {
    request = await requests.getRequest(context, requestId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.requests"), href: "/qaqc/requests" },
          { label: request.requestNumber },
        ]}
        title={request.title}
        subtitle={request.requestNumber}
        status={request.status}
        badges={
          <>
            <Badge tone="neutral">{qaqcLabel(t, "inspectionType", request.inspectionType)}</Badge>
            {request.priority === "HIGH" || request.priority === "CRITICAL" ? (
              <Badge tone={request.priority === "CRITICAL" ? "danger" : "warning"}>
                {qaqcLabel(t, "priority", request.priority)}
              </Badge>
            ) : null}
            {request.overdue ? <Badge tone="danger">{t("common.overdue")}</Badge> : null}
          </>
        }
        meta={[
          {
            label: t("detail.inspector"),
            value: request.assignedInspector ? (
              <PersonLink memberId={request.assignedInspector.memberId} name={request.assignedInspector.fullName} />
            ) : (
              t("common.notAssigned")
            ),
          },
          {
            label: t("detail.neededBy"),
            value: request.requiredByDate ? formatDate(request.requiredByDate) : t("common.noDate"),
          },
          { label: t("detail.inspections"), value: String(request.inspectionCount) },
        ]}
        actions={<RequestActions request={request} />}
      />

      {request.status === "OPEN" && !request.assignedInspector ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("requestPage.unassignedNote")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("detail.type"), value: qaqcLabel(t, "inspectionType", request.inspectionType) },
                { label: t("detail.priority"), value: qaqcLabel(t, "priority", request.priority) },
                {
                  label: t("detail.project"),
                  value: request.project ? (
                    <Link href={`/projects/${request.project.id}`} className="hover:text-accent">
                      {request.project.code} — {request.project.name}
                    </Link>
                  ) : (
                    t("common.notTied")
                  ),
                },
                { label: t("detail.where"), value: orDash(request.locationText) },
                {
                  label: t("detail.delivery"),
                  value: request.source ? (
                    request.source.href ? (
                      <Link href={request.source.href} className="hover:text-accent">
                        {request.source.label}
                      </Link>
                    ) : (
                      request.source.label
                    )
                  ) : (
                    "—"
                  ),
                },
                { label: t("detail.raisedOn"), value: formatDate(request.requestedDate) },
              ]}
            />

            {request.description ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-table font-semibold text-fg">{t("detail.detail")}</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {request.description}
                </p>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">{t("detail.inspections")}</h2>
            {request.inspections.length === 0 ? (
              <p className="nesto-card p-5 text-table text-fg-subtle">
                {t("requestPage.noInspections")}
              </p>
            ) : (
              <InspectionTable
                inspections={request.inspections}
                caption={t("requestPage.inspectionsCaption", { number: request.requestNumber })}
              />
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("detail.raisedBy")}
                value={
                  request.requestedBy ? (
                    <PersonLink memberId={request.requestedBy.memberId} name={request.requestedBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("detail.raised")} value={formatDateTime(request.createdAt)} />
              <Meta label={t("detail.updated")} value={formatDateTime(request.updatedAt)} />
              {request.cancelledAt ? (
                <Meta label={t("detail.cancelled")} value={formatDateTime(request.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {request.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.activity")}</h2>
              <QaqcActivityFeed
                context={context}
                entityType="InspectionRequest"
                entityId={request.id}
              />
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
