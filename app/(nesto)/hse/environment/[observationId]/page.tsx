import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { SeverityBadge } from "@/components/hse/hse-format";
import { ActionTable } from "@/components/hse/hse-tables";
import { ObservationActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as environment from "@/lib/modules/hse/environment/environment.service";
import { environmentalCategoryLabels } from "@/lib/modules/hse/hse.status";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ observationId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { observationId } = await params;
  try {
    const context = await requireModule("hse");
    const observation = await environment.getObservation(context, observationId);
    return { title: observation.observationNumber };
  } catch {
    return { title: (await getTranslations("hse"))("record.observation") };
  }
}

/** One environmental observation (PRD #22 §163, §324). */
export default async function ObservationPage({ params }: Params) {
  const { observationId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

  let observation;
  try {
    observation = await environment.getObservation(context, observationId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = observation.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.environment.title"), href: "/hse/environment" },
          { label: observation.observationNumber },
        ]}
        title={observation.title}
        subtitle={`${observation.observationNumber} · ${hseLabel(t, "environmentalCategory", observation.category, environmentalCategoryLabels[observation.category])}`}
        status={observation.status}
        badges={
          <>
            <SeverityBadge severity={observation.severity} />
            {observation.overdue ? <Badge tone="danger">{t("record.overdue")}</Badge> : null}
          </>
        }
        meta={[
          { label: t("record.project"), value: observation.project?.code ?? t("record.companyWide") },
          { label: t("record.observed"), value: formatDate(observation.observedAt) },
          {
            label: t("record.assignedTo"),
            value: observation.assignedTo ? (
              <PersonLink memberId={observation.assignedTo.memberId} name={observation.assignedTo.fullName} />
            ) : (
              t("record.notAssigned")
            ),
          },
        ]}
        actions={<ObservationActions observation={observation} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("hazard.detail.whatWasSeen")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {observation.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: t("record.project"),
                  value: observation.project ? (
                    <Link
                      href={`/projects/${observation.project.id}`}
                      className="hover:text-accent"
                    >
                      {observation.project.code} — {observation.project.name}
                    </Link>
                  ) : (
                    t("record.companyWide")
                  ),
                },
                { label: t("record.where"), value: orDash(observation.locationText) },
                { label: t("incident.detail.immediateAction"), value: orDash(observation.immediateAction) },
                {
                  label: t("record.due"),
                  value: observation.dueDate ? formatDate(observation.dueDate) : t("record.noDate"),
                },
              ]}
            />
          </section>

          {observation.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.actions")}</h2>
              <ActionTable
                actions={observation.actions}
                caption={t("record.actionsOn", { number: observation.observationNumber })}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.documents")}</h2>
              <HseRecordDocuments
                context={context}
                entityType="environmental_observation"
                entityId={observation.id}
                emptyDescription={t("environment.detail.documentsEmpty")}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("record.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("record.reportedBy")}
                value={
                  observation.reportedBy ? (
                    <PersonLink memberId={observation.reportedBy.memberId} name={observation.reportedBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("record.reported")} value={formatDateTime(observation.createdAt)} />
              {observation.closedAt ? (
                <Meta
                  label={t("record.closed")}
                  value={
                    <>
                      {formatDateTime(observation.closedAt)}
                      {observation.closedBy ? (
                        <>
                          {" "}
                          {t("record.by")} <PersonLink memberId={observation.closedBy.memberId} name={observation.closedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {observation.closureNote ? (
                <Meta label={t("record.closureNote")} value={observation.closureNote} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.activity")}</h2>
              <HseActivityFeed
                context={context}
                entityType="EnvironmentalObservation"
                entityId={observation.id}
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
      <dd className="mt-0.5 whitespace-pre-wrap text-table text-fg">{value}</dd>
    </div>
  );
}
