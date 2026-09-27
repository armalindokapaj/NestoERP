import { RecordFavorite } from "@/components/productivity/record-favorite";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { RecordDocuments } from "@/components/documents/record-documents";
import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { InviteSupplierControl } from "@/components/procurement/invite-supplier-control";
import { RfqActions } from "@/components/procurement/rfq-actions";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as rfqs from "@/lib/modules/procurement/rfqs/rfq.service";
import { selectableSuppliers } from "@/lib/modules/procurement/suppliers/supplier.service";
import { rfqSupplierStatusLabels } from "@/lib/modules/procurement/procurement.status";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";

type Params = { params: Promise<{ rfqId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { rfqId } = await params;
  try {
    const context = await requireModule("procurement");
    const rfq = await rfqs.getRfq(context, rfqId);
    return { title: `${rfq.rfqNumber} — ${rfq.title}` };
  } catch {
    return { title: (await getTranslations("procurement"))("meta.rfq") };
  }
}

/** Enquiry detail (PRD #19 §267, §268). */
export default async function RfqDetailPage({ params }: Params) {
  const { rfqId } = await params;
  const context = await requireModule("procurement");

  let rfq;
  try {
    rfq = await rfqs.getRfq(context, rfqId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // Only fetched for somebody who may actually invite: a list of every
  // supplier is procurement data in its own right.
  const suppliers = rfq.capabilities.canManageSuppliers
    ? await selectableSuppliers(context)
    : [];
  const t = await getTranslations("procurement");

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("crumbs.procurement"), href: "/procurement" },
          { label: t("crumbs.enquiries"), href: "/procurement/rfqs" },
          { label: rfq.rfqNumber },
        ]}
        title={rfq.title}
        subtitle={rfq.rfqNumber}
        status={rfq.status}
        badges={rfq.overdue ? <Badge tone="warning">{t("rfqs.responsesOverdue")}</Badge> : null}
        meta={[
          { label: t("rfqs.invited"), value: t("rfqs.suppliersCount", { count: rfq.invitedCount }) },
          { label: t("rfqs.answered"), value: `${rfq.respondedCount}` },
          {
            label: t("rfqs.responsesBy"),
            value: rfq.responseDueDate ? formatDate(rfq.responseDueDate) : t("common.noDate"),
          },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="rfq" entityId={rfq.id} />
            <RfqActions rfq={rfq} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card overflow-hidden">
            <div className="p-5">
              <h2 className="text-card font-semibold text-fg">{t("rfqs.asked")}</h2>
              <p className="mt-1 text-meta text-fg-subtle">
                {t("rfqs.askedNote")}
              </p>
            </div>
            <ScrollRegion label={t("rfqs.linesLabel")}>
              <table className="w-full text-table">
                <caption className="sr-only">{t("rfqs.linesLabel")}</caption>
                <thead>
                  <tr className="border-y border-line text-left text-meta text-fg-subtle">
                    <th scope="col" className="px-5 py-2 font-medium">{t("common.description")}</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">{t("common.quantity")}</th>
                    <th scope="col" className="px-5 py-2 font-medium">{t("common.unit")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rfq.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-3 text-fg">
                        {item.description}
                        {item.specification ? (
                          <span className="block text-meta text-fg-subtle">{item.specification}</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg">{item.quantity}</td>
                      <td className="px-5 py-3 text-fg-muted">{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>

          <section className="nesto-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-card font-semibold text-fg">{t("rfqs.suppliersAsked")}</h2>
              <div className="flex items-center gap-3">
                {rfq.capabilities.canViewQuotes ? (
                  <Link
                    href={`/procurement/rfqs/${rfq.id}/comparison`}
                    className="text-table font-medium text-accent-strong"
                  >
                    {t("rfqs.compare")}
                  </Link>
                ) : null}
                {rfq.capabilities.canManageSuppliers ? (
                  <InviteSupplierControl
                    rfqId={rfq.id}
                    suppliers={suppliers}
                    invitedSupplierIds={rfq.suppliers.map((entry) => entry.supplier.id)}
                  />
                ) : null}
              </div>
            </div>

            <ul className="mt-4 divide-y divide-line border-t border-line">
              {rfq.suppliers.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link
                    href={`/procurement/suppliers/${entry.supplier.id}`}
                    className="text-table font-medium text-accent-strong"
                  >
                    {entry.supplier.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    {entry.respondedAt ? (
                      <span className="text-meta text-fg-subtle">
                        {t("rfqs.answeredOn", { date: formatDate(entry.respondedAt) })}
                      </span>
                    ) : null}
                    <Badge
                      tone={
                        entry.status === "RESPONDED"
                          ? "success"
                          : entry.status === "DISQUALIFIED" || entry.status === "DECLINED"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {procurementLabel(t, "rfqSupplierStatus", entry.status, rfqSupplierStatusLabels[entry.status])}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("common.whereItBelongs")}</h2>
            <DetailGrid
              className="mt-4"
              columns={2}
              items={[
                {
                  label: t("common.request"),
                  value: rfq.requestLink ? (
                    rfq.requestLink.href ? (
                      <Link href={rfq.requestLink.href} className="text-accent-strong">
                        {rfq.requestLink.label}
                      </Link>
                    ) : (
                      rfq.requestLink.label
                    )
                  ) : (
                    <span className="text-fg-subtle">{t("common.none")}</span>
                  ),
                },
                {
                  label: t("common.project"),
                  value: rfq.projectLink ? (
                    rfq.projectLink.href ? (
                      <Link href={rfq.projectLink.href} className="text-accent-strong">
                        {rfq.projectLink.label}
                      </Link>
                    ) : (
                      rfq.projectLink.label
                    )
                  ) : (
                    <span className="text-fg-subtle">{t("common.company")}</span>
                  ),
                },
                { label: t("common.currency"), value: rfq.currency },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("suppliers.record")}</h2>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="nesto-eyebrow text-fg-subtle">{t("common.created")}</dt>
                <dd className="mt-0.5 text-table text-fg">{formatDateTime(rfq.createdAt)}</dd>
              </div>
              {rfq.dates.issuedAt ? (
                <div>
                  <dt className="nesto-eyebrow text-fg-subtle">{t("common.issued")}</dt>
                  <dd className="mt-0.5 text-table text-fg">
                    {formatDateTime(rfq.dates.issuedAt)}
                  </dd>
                </div>
              ) : null}
              {rfq.dates.closedAt ? (
                <div>
                  <dt className="nesto-eyebrow text-fg-subtle">{t("common.closed")}</dt>
                  <dd className="mt-0.5 text-table text-fg">
                    {formatDateTime(rfq.dates.closedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        </div>
      </div>
      <RecordDocuments context={context} entityType="rfq" entityId={rfqId} title={t("common.documents")} emptyDescription={t("rfqs.documentsEmpty")} />
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="rfq" parentId={rfqId} />
    </div>
  );
}
