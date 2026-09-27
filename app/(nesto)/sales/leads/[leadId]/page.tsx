import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";

import { RecordHeader } from "@/components/modules/record-header";
import { LeadActions } from "@/components/sales/lead-actions";
import { PersonLink } from "@/components/people/person-link";
import { SalesRecordDocuments } from "@/components/sales/record-documents";
import { SalesActivityFeed } from "@/components/sales/sales-activity";
import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { SkeletonTable } from "@/components/ui/loading-state";
import { leadSourceLabels } from "@/lib/modules/sales/leads/lead.status";
import { formatAmount } from "@/components/sales/sales-format";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
import { formatDate } from "@/lib/utils/format";
import { leadContext } from "./lead-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.lead") };
}

type Params = { params: Promise<{ leadId: string }> };

/** Lead detail (PRD #17 §286). */
export default async function LeadPage({ params }: Params) {
  const { leadId } = await params;
  const { context, lead } = await leadContext(leadId);
  const t = await getTranslations("sales");

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.leads"), href: "/sales/leads" },
          { label: lead.name },
        ]}
        title={lead.name}
        subtitle={lead.companyName ?? t("detail.individual")}
        status={lead.status}
        meta={[
          { label: t("detail.source"), value: salesLabel(t, "leadSource", lead.source, leadSourceLabels[lead.source]) },
          {
            label: t("detail.owner"),
            value: lead.owner ? (
              <>
                <PersonLink memberId={lead.owner.memberId} name={lead.owner.fullName} />
                {lead.owner.active ? "" : t("detail.inactive")}
              </>
            ) : (
              t("detail.unassigned")
            ),
          },
          {
            label: t("detail.estimatedValue"),
            value:
              lead.estimatedValue && lead.currency
                ? formatAmount(lead.estimatedValue, lead.currency)
                : "—",
          },
          { label: t("detail.created"), value: formatDate(lead.createdAt) },
        ]}
        actions={<LeadActions lead={lead} />}
      />

      {lead.status === "CONVERTED" ? (
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("detail.converted")}</h2>
          <p className="mt-1 text-table text-fg-muted">
            {t("detail.convertedOn", { date: lead.convertedAt ? formatDate(lead.convertedAt) : "—" })}
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-table">
            {lead.convertedOpportunity ? (
              <Link
                href={`/sales/opportunities/${lead.convertedOpportunity.id}`}
                className="font-medium text-accent-strong"
              >
                {lead.convertedOpportunity.name}
              </Link>
            ) : null}
            {lead.convertedClient ? (
              <Link
                href={`/clients/${lead.convertedClient.id}`}
                className="font-medium text-accent-strong"
              >
                {lead.convertedClient.name}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("detail.contact")}</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Detail label={t("detail.email")} value={lead.email} href={lead.email ? `mailto:${lead.email}` : null} />
            <Detail label={t("detail.phone")} value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : null} />
            <Detail label={t("detail.website")} value={lead.website} href={lead.website} external />
            <Detail label={t("detail.company")} value={lead.companyName} />
          </dl>

          {lead.notes ? (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="nesto-eyebrow text-fg-subtle">{t("detail.notes")}</h3>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{lead.notes}</p>
            </div>
          ) : null}

          {lead.disqualifyReason ? (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="nesto-eyebrow text-fg-subtle">{t("detail.whyDisqualified")}</h3>
              <p className="mt-2 text-table text-fg-muted">{lead.disqualifyReason}</p>
            </div>
          ) : null}
        </section>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("detail.documents")}</h2>
          <div className="mt-4">
            <Suspense fallback={<SkeletonTable rows={2} />}>
              <SalesRecordDocuments context={context} entityType="lead" entityId={lead.id} />
            </Suspense>
          </div>
        </section>
      </div>

      <Suspense fallback={<SkeletonTable rows={2} />}>
        <RecordTasks context={context} parentType="lead" parentId={lead.id} title={t("detail.followUpTasks")} />
      </Suspense>

      <CollaborationPanel parentType="lead" parentId={lead.id} />

      {lead.capabilities.canViewActivity ? (
        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">{t("detail.activity")}</h2>
          <Suspense fallback={<SkeletonTable rows={3} />}>
            <SalesActivityFeed context={context} entityType="Lead" entityId={lead.id} />
          </Suspense>
        </section>
      ) : null}
    </div>
  );
}

function Detail({
  label,
  value,
  href,
  external,
}: {
  label: string;
  value: string | null;
  href?: string | null;
  external?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table text-fg [overflow-wrap:anywhere]">
        {value === null ? (
          <span className="text-fg-subtle">—</span>
        ) : href ? (
          <a
            href={href}
            className="text-accent-strong"
            {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
