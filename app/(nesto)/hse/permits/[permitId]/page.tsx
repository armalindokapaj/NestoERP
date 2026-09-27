import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { PermitClock, PermitStatusBadge } from "@/components/hse/hse-format";
import { ActionTable } from "@/components/hse/hse-tables";
import { PermitActions } from "@/components/hse/record-actions";
import { HseActivityFeed } from "@/components/hse/record-activity";
import { HseRecordDocuments } from "@/components/hse/record-documents";
import { PermitWorkers } from "@/components/hse/workforce-panels";
import { hseEmploymentOptions, listPermitWorkers } from "@/lib/modules/hse/hse.workforce";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pendingCycle } from "@/lib/modules/hse/approvals/approval.service";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import { permitTypeLabels } from "@/lib/modules/hse/hse.status";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { formatDateTime } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";
import { HseText } from "@/components/hse/hse-text";

type Params = { params: Promise<{ permitId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { permitId } = await params;
  try {
    const context = await requireModule("hse");
    const permit = await permits.getPermit(context, permitId);
    return { title: permit.permitNumber };
  } catch {
    return { title: (await getTranslations("hse"))("record.workPermit") };
  }
}

/** One work permit (PRD #22 §140, §151, §321, §322). */
export default async function PermitPage({ params }: Params) {
  const { permitId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

  let permit;
  try {
    permit = await permits.getPermit(context, permitId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = permit.capabilities;
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "WORK_PERMIT", permit.id) : null;
  // Who it covers — people with or without a login, or whole crews (E-04 §74).
  const [workers, options] = await Promise.all([listPermitWorkers(context, permit.id), may.canEdit ? hseEmploymentOptions(context) : Promise.resolve({ employees: [], crews: [] })]);
  const lapsed = permit.effectiveStatus === "EXPIRED" && permit.status !== "EXPIRED";

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.permits.title"), href: "/hse/permits" },
          { label: permit.permitNumber },
        ]}
        title={permit.title}
        subtitle={`${permit.permitNumber} · ${hseLabel(t, "permitType", permit.permitType, permitTypeLabels[permit.permitType])}`}
        badges={
          <PermitStatusBadge
            status={permit.status}
            effectiveStatus={permit.effectiveStatus}
          />
        }
        meta={[
          { label: t("record.project"), value: permit.project.code },
          { label: t("record.location"), value: permit.locationText },
          {
            label: t("permit.detail.responsible"),
            value: permit.responsible ? (
              <PersonLink memberId={permit.responsible.memberId} name={permit.responsible.fullName} />
            ) : (
              "—"
            ),
          },
          { label: t("permit.detail.window"), value: <PermitClock hoursRemaining={permit.hoursRemaining} /> },
        ]}
        actions={<PermitActions permit={permit} cycle={cycle} />}
      />

      {/*
       * The clock and the column disagree: somebody may be working to a permit
       * that ran out under them (PRD #22 §151, §322, §360).
       */}
      {lapsed ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-3 text-table font-medium text-danger-strong"
        >
          {t("permit.detail.lapsed")}
        </p>
      ) : permit.status === "SUSPENDED" ? (
        <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-3 text-table text-warning-strong">
          {t("permit.detail.suspendedBanner", { reason: permit.suspensionReason ? `: ${permit.suspensionReason}` : "." })}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("permit.detail.theWork")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: t("record.project"),
                  value: (
                    <Link href={`/projects/${permit.project.id}`} className="hover:text-accent">
                      {permit.project.code} — {permit.project.name}
                    </Link>
                  ),
                },
                { label: t("record.location"), value: permit.locationText },
                { label: t("permit.detail.validFrom"), value: formatDateTime(permit.validFrom) },
                { label: t("permit.detail.validUntil"), value: formatDateTime(permit.validUntil) },
                {
                  label: t("permit.detail.requestedBy"),
                  value: permit.requestedBy ? (
                    <PersonLink memberId={permit.requestedBy.memberId} name={permit.requestedBy.fullName} />
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t("permit.detail.responsible"),
                  value: permit.responsible ? (
                    <PersonLink memberId={permit.responsible.memberId} name={permit.responsible.fullName} />
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t("permit.detail.riskAssessment"),
                  value: permit.riskAssessment ? (
                    permit.riskAssessment.href ? (
                      <Link href={permit.riskAssessment.href} className="hover:text-accent">
                        {permit.riskAssessment.label}
                      </Link>
                    ) : (
                      permit.riskAssessment.label
                    )
                  ) : (
                    t("permit.detail.noneCited")
                  ),
                },
              ]}
            />
          </section>

          <PermitWorkers permitId={permit.id} workers={workers} canEdit={may.canEdit} employees={options.employees} crews={options.crews} />

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("permit.detail.hazardsAndControls")}</h2>
            <dl className="mt-4 space-y-4">
              <Block label={t("permit.detail.hazards")} value={permit.hazardsSummary} />
              <Block label={t("hazard.detail.controls")} value={permit.controlsSummary} />
              <Block label={t("permit.detail.ppeRequired")} value={permit.ppeRequirements} />
              <Block label={t("permit.detail.specialConditions")} value={permit.specialConditions} />
            </dl>
          </section>

          {permit.actions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.actions")}</h2>
              <ActionTable
                actions={permit.actions}
                caption={t("record.actionsOn", { number: permit.permitNumber })}
              />
            </section>
          ) : null}

          {may.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.documents")}</h2>
              <HseRecordDocuments
                context={context}
                entityType="work_permit"
                entityId={permit.id}
                emptyDescription={t("permit.detail.documentsEmpty")}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("permit.detail.history")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("incident.detail.raised")} value={formatDateTime(permit.createdAt)} />
              {permit.submittedAt ? (
                <Meta label={t("inspection.detail.submitted")} value={formatDateTime(permit.submittedAt)} />
              ) : null}
              {permit.approvedAt ? (
                <Meta
                  label={t("inspection.detail.approved")}
                  value={
                    <>
                      {formatDateTime(permit.approvedAt)}
                      {permit.approvedBy ? (
                        <>
                          {" "}
                          {t("record.by")} <PersonLink memberId={permit.approvedBy.memberId} name={permit.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {permit.activatedAt ? (
                <Meta label={t("permit.detail.activated")} value={formatDateTime(permit.activatedAt)} />
              ) : null}
              {permit.suspendedAt ? (
                <Meta label={t("permit.detail.suspended")} value={formatDateTime(permit.suspendedAt)} />
              ) : null}
              {permit.closedAt ? (
                <Meta label={t("record.closed")} value={formatDateTime(permit.closedAt)} />
              ) : null}
              {permit.cancelledAt ? (
                <Meta label={t("record.cancelled")} value={formatDateTime(permit.cancelledAt)} />
              ) : null}
            </dl>
          </section>

          {may.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("record.activity")}</h2>
              <HseActivityFeed
                context={context}
                entityType="HseWorkPermit"
                entityId={permit.id}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="work_permit" parentId={permitId} />
    </div>
  );
}

function Block({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-table text-fg-muted">
        {value ?? <span className="text-fg-subtle"><HseText k="permit.detail.notRecorded" /></span>}
      </dd>
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
