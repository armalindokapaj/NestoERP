import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { BlockedList } from "@/components/hse/hse-format";
import { ActionTable } from "@/components/hse/hse-tables";
import { StopWorkActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as stopWork from "@/lib/modules/hse/stop-work/stop-work.service";
import { stopWorkReleaseGapLabels } from "@/lib/modules/hse/hse.status";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ stopWorkId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { stopWorkId } = await params;
  try {
    const context = await requireModule("hse");
    const record = await stopWork.getStopWork(context, stopWorkId);
    return { title: record.stopWorkNumber };
  } catch {
    return { title: (await getTranslations("hse"))("pages.stopWork.title") };
  }
}

/** One stop-work record (PRD #22 §170, §174, §323). */
export default async function StopWorkPage({ params }: Params) {
  const { stopWorkId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

  let record;
  try {
    record = await stopWork.getStopWork(context, stopWorkId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = record.capabilities;
  const blocking = record.releaseGaps.filter((gap) => gap !== "RELEASE_REASON");

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.stopWork.title"), href: "/hse/stop-work" },
          { label: record.stopWorkNumber },
        ]}
        title={record.title}
        subtitle={record.stopWorkNumber}
        badges={
          record.status === "ACTIVE" ? (
            <Badge tone="danger">{t("overview.workIsStopped")}</Badge>
          ) : (
            <Badge tone="neutral">{record.status === "RELEASED" ? hseLabel(t, "stopWorkStatus", "RELEASED", t("stopWork.detail.releasedHeading")) : hseLabel(t, "stopWorkStatus", "CANCELLED", t("record.cancelled"))}</Badge>
          )
        }
        meta={[
          { label: t("record.project"), value: record.project.code },
          { label: t("stopWork.detail.issued"), value: formatDateTime(record.issuedAt) },
          {
            label: t("stopWork.detail.issuedBy"),
            value: record.issuedBy ? (
              <PersonLink memberId={record.issuedBy.memberId} name={record.issuedBy.fullName} />
            ) : (
              "—"
            ),
          },
        ]}
        actions={<StopWorkActions record={record} />}
      />

      {record.status === "ACTIVE" ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-3 text-table font-medium text-danger-strong"
        >
          {t("stopWork.detail.halted")}
        </p>
      ) : null}

      {/* Releasing while the cause is outstanding is how the same accident
          happens twice in one week (PRD #22 §174). */}
      {record.status === "ACTIVE" && blocking.length > 0 ? (
        <BlockedList
          title={t("stopWork.detail.cannotRelease")}
          reasons={blocking.map((gap) => hseLabel(t, "stopWorkReleaseGap", gap, stopWorkReleaseGapLabels[gap]))}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("stopWork.detail.whyStopped")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{record.reason}</p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: t("record.project"),
                  value: (
                    <Link href={`/projects/${record.project.id}`} className="hover:text-accent">
                      {record.project.code} — {record.project.name}
                    </Link>
                  ),
                },
                { label: t("record.where"), value: orDash(record.locationText) },
                {
                  label: t("record.hazard"),
                  value: record.hazard ? (
                    record.hazard.href ? (
                      <Link href={record.hazard.href} className="hover:text-accent">
                        {record.hazard.label}
                      </Link>
                    ) : (
                      record.hazard.label
                    )
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t("record.incident"),
                  value: record.incident ? (
                    record.incident.href ? (
                      <Link href={record.incident.href} className="hover:text-accent">
                        {record.incident.label}
                      </Link>
                    ) : (
                      record.incident.label
                    )
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
          </section>

          {record.releaseReason ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("stopWork.detail.releasedHeading")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {record.releaseReason}
              </p>
              <p className="mt-3 text-meta text-fg-subtle">
                {t("action.detail.byPrefix")}{" "}
                {record.releasedBy ? (
                  <PersonLink memberId={record.releasedBy.memberId} name={record.releasedBy.fullName} />
                ) : (
                  t("action.detail.somebody")
                )}
                {record.releasedAt ? t("action.detail.onDate", { date: formatDateTime(record.releasedAt) }) : ""}.
              </p>
            </section>
          ) : null}

          {record.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.actions")}</h2>
              <ActionTable
                actions={record.actions}
                caption={t("record.actionsOn", { number: record.stopWorkNumber })}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("record.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("stopWork.detail.issuedBy")}
                value={
                  record.issuedBy ? (
                    <PersonLink memberId={record.issuedBy.memberId} name={record.issuedBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("stopWork.detail.issued")} value={formatDateTime(record.issuedAt)} />
              {record.cancelledAt ? (
                <Meta label={t("record.cancelled")} value={formatDateTime(record.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.activity")}</h2>
              <HseActivityFeed
                context={context}
                entityType="StopWorkRecord"
                entityId={record.id}
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
