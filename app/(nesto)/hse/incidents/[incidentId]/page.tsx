import { RecordFavorite } from "@/components/productivity/record-favorite";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { AssignControl } from "@/components/hse/assign-control";
import { BlockedList, InjuryFlags, SeverityBadge } from "@/components/hse/hse-format";
import { ActionTable, StopWorkTable } from "@/components/hse/hse-tables";
import { IncidentActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { IncidentPeople } from "@/components/hse/workforce-panels";
import { hseEmploymentOptions, listIncidentPeople } from "@/lib/modules/hse/hse.workforce";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pendingCycle } from "@/lib/modules/hse/approvals/approval.service";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import { incidentClosureGapLabels, incidentTypeLabels } from "@/lib/modules/hse/hse.status";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ incidentId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { incidentId } = await params;
  try {
    const context = await requireModule("hse");
    const incident = await incidents.getIncident(context, incidentId);
    return { title: incident.incidentNumber };
  } catch {
    return { title: (await getTranslations("hse"))("record.incident") };
  }
}

/** One incident (PRD #22 §76, §95, §316, §317). */
export default async function IncidentPage({ params }: Params) {
  const { incidentId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

  let incident;
  try {
    incident = await incidents.getIncident(context, incidentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = incident.capabilities;
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canClose && incident.status === "PENDING_CLOSE" ? await pendingCycle(context, "INCIDENT_CLOSE", incident.id) : null;
  // Who it involved — employees with or without a login, or a name (E-04 §73).
  const [people, options] = await Promise.all([listIncidentPeople(context, incident.id), may.canEdit ? hseEmploymentOptions(context) : Promise.resolve({ employees: [], crews: [] })]);

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.incidents.title"), href: "/hse/incidents" },
          { label: incident.incidentNumber },
        ]}
        title={incident.title}
        subtitle={`${incident.incidentNumber} · ${hseLabel(t, "incidentType", incident.incidentType, incidentTypeLabels[incident.incidentType])}`}
        status={incident.status}
        badges={
          <>
            <SeverityBadge severity={incident.severity} />
            {incident.overdue ? <Badge tone="danger">{t("record.overdue")}</Badge> : null}
          </>
        }
        meta={[
          { label: t("record.project"), value: incident.project?.code ?? t("record.companyWide") },
          { label: t("incident.detail.occurred"), value: formatDateTime(incident.occurredAt) },
          {
            label: t("record.reportedBy"),
            value: incident.reportedBy ? (
              <PersonLink memberId={incident.reportedBy.memberId} name={incident.reportedBy.fullName} />
            ) : (
              "—"
            ),
          },
          {
            label: t("incident.detail.investigator"),
            value: incident.investigator ? (
              <PersonLink memberId={incident.investigator.memberId} name={incident.investigator.fullName} />
            ) : (
              t("record.notAssigned")
            ),
          },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RecordFavorite context={context} entityType="incident" entityId={incident.id} />
            {may.canAssign ? <AssignControl kind="incident" recordId={incident.id} /> : null}
            <IncidentActions incident={incident} cycle={cycle} />
          </div>
        }
      />

      {may.canSubmitClose && incident.closureGaps.length > 0 ? (
        <BlockedList
          title={t("incident.detail.notReady")}
          reasons={incident.closureGaps.map((gap) => hseLabel(t, "incidentClosureGap", gap, incidentClosureGapLabels[gap]))}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("incident.detail.whatHappened")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
              {incident.description}
            </p>

            <DetailGrid
              className="mt-6 border-t border-line pt-5"
              items={[
                {
                  label: t("record.project"),
                  value: incident.project ? (
                    <Link href={`/projects/${incident.project.id}`} className="hover:text-accent">
                      {incident.project.code} — {incident.project.name}
                    </Link>
                  ) : (
                    t("record.companyWide")
                  ),
                },
                { label: t("record.where"), value: orDash(incident.locationText) },
                { label: t("incident.detail.occurred"), value: formatDateTime(incident.occurredAt) },
                { label: t("record.reported"), value: formatDateTime(incident.reportedAt) },
              ]}
            />
          </section>

          {/*
           * Flags, never descriptions. There is no diagnosis field to render
           * because there is none stored (PRD #22 §22, §87).
           */}
          {incident.injury ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("incident.detail.whatResulted")}</h2>
              <div className="mt-3">
                <InjuryFlags flags={incident.injury} />
              </div>
              <p className="mt-3 text-meta text-fg-subtle">
                {t("incident.detail.noMedical")}
              </p>
            </section>
          ) : null}

          <IncidentPeople incidentId={incident.id} people={people} canEdit={may.canEdit} employees={options.employees} />

          {incident.immediateAction ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("incident.detail.immediateAction")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {incident.immediateAction}
              </p>
            </section>
          ) : null}

          {incident.investigationSummary || incident.rootCause || incident.lessonsLearned ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("incident.detail.investigation")}</h2>
              <dl className="mt-4 space-y-4">
                {incident.investigationSummary ? (
                  <Block label={t("incident.detail.whatWasFound")} value={incident.investigationSummary} />
                ) : null}
                {incident.rootCause ? (
                  <Block label={t("incident.detail.rootCause")} value={incident.rootCause} />
                ) : null}
                {incident.lessonsLearned ? (
                  <Block label={t("incident.detail.lessonsLearned")} value={incident.lessonsLearned} />
                ) : null}
              </dl>
            </section>
          ) : null}

          {incident.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.actions")}</h2>
              <ActionTable
                actions={incident.actions}
                caption={t("record.actionsOn", { number: incident.incidentNumber })}
              />
            </section>
          ) : null}

          {incident.stopWorks.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.stopWork")}</h2>
              <StopWorkTable
                records={incident.stopWorks}
                caption={t("hazard.detail.stopWorkFrom", { number: incident.incidentNumber })}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.documents")}</h2>
              <HseRecordDocuments
                context={context}
                entityType="incident"
                entityId={incident.id}
                emptyDescription={t("incident.detail.documentsEmpty")}
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
                  incident.reportedBy ? (
                    <PersonLink memberId={incident.reportedBy.memberId} name={incident.reportedBy.fullName} />
                  ) : (
                    "—"
                  )
                }
              />
              <Meta label={t("incident.detail.raised")} value={formatDateTime(incident.createdAt)} />
              {incident.dueDate ? (
                <Meta label={t("record.due")} value={formatDate(incident.dueDate)} />
              ) : null}
              {incident.submittedForCloseAt ? (
                <Meta
                  label={t("incident.detail.putUpForClosure")}
                  value={formatDateTime(incident.submittedForCloseAt)}
                />
              ) : null}
              {incident.closedAt ? (
                <Meta
                  label={t("record.closed")}
                  value={
                    <>
                      {formatDateTime(incident.closedAt)}
                      {incident.closedBy ? (
                        <>
                          {" "}
                          {t("record.by")} <PersonLink memberId={incident.closedBy.memberId} name={incident.closedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {incident.closureNote ? (
                <Meta label={t("record.closureNote")} value={incident.closureNote} />
              ) : null}
              {incident.cancelledAt ? (
                <Meta label={t("record.cancelled")} value={formatDateTime(incident.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.activity")}</h2>
              <HseActivityFeed
                context={context}
                entityType="HseIncident"
                entityId={incident.id}
                moreHref={`/hse/incidents/${incident.id}/activity`}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Follow-up work raised from this record, in the reader's task scope (PRD #38 §45). */}
      <RecordTasks context={context} parentType="incident" parentId={incidentId} />
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="incident" parentId={incidentId} />
    </div>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-table text-fg-muted">{value}</dd>
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
