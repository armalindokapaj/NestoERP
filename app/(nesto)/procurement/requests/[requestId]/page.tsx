import { RecordFavorite } from "@/components/productivity/record-favorite";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { RecordDocuments } from "@/components/documents/record-documents";
import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RequestActions } from "@/components/procurement/request-actions";
import { ProcurementApprovalHistory } from "@/components/procurement/approval-history";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pendingCycle } from "@/lib/modules/procurement/approvals/approval.service";
import * as requests from "@/lib/modules/procurement/requests/request.service";
import {
  categoryLabels,
  priorityLabels,
} from "@/lib/modules/procurement/procurement.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { dueLabel, formatAmount } from "@/components/procurement/procurement-format";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";

type Params = { params: Promise<{ requestId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { requestId } = await params;
  try {
    const context = await requireModule("procurement");
    const request = await requests.getRequest(context, requestId);
    return { title: `${request.requestNumber} — ${request.title}` };
  } catch {
    return { title: (await getTranslations("procurement"))("meta.request") };
  }
}

/**
 * Purchase request detail (PRD #19 §265, §266).
 *
 * The lines are the ask. Their estimated total is computed from them and
 * labelled as an estimate, because a request is a need rather than a
 * commitment — nothing is owed until an order is issued (PRD #19 §3, §48).
 */
export default async function RequestDetailPage({ params }: Params) {
  const { requestId } = await params;
  const context = await requireModule("procurement");

  let request;
  try {
    request = await requests.getRequest(context, requestId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // The cycle (and chain step) the decision controls act on; they name it back (AUD-10 §4, CW-04, CW-05).
  const cycle =
    request.capabilities.canApprove || request.capabilities.canReject
      ? await pendingCycle(context, "PURCHASE_REQUEST", request.id)
      : null;
  const t = await getTranslations("procurement");
  const priority = procurementLabel(t, "priority", request.priority, priorityLabels[request.priority]);
  const category = (value: keyof typeof categoryLabels) => procurementLabel(t, "category", value, categoryLabels[value]);
  const currency = request.currency;
  const money = (value: string) => (currency ? formatAmount(value, currency) : value);

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("crumbs.procurement"), href: "/procurement" },
          { label: t("crumbs.requests"), href: "/procurement/requests" },
          { label: request.requestNumber },
        ]}
        title={request.title}
        subtitle={request.requestNumber}
        status={request.status}
        badges={
          <>
            <Badge tone="neutral">{priority}</Badge>
            {request.attention.overdue ? (
              <Badge tone="warning">{dueLabel(t, request.attention.daysToRequired)}</Badge>
            ) : null}
            {request.attention.unsourced ? <Badge tone="info">{t("requests.notSourced")}</Badge> : null}
          </>
        }
        meta={[
          { label: t("common.raisedBy"), value: <PersonLink memberId={request.requestedBy.memberId} name={request.requestedBy.fullName} /> },
          {
            label: t("requests.estimated"),
            value: currency ? money(request.estimatedTotal) : t("requests.notPriced"),
          },
          {
            label: t("requests.needed"),
            value: request.requiredDate ? formatDate(request.requiredDate) : t("common.noDate"),
          },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="purchase_request" entityId={request.id} />
            <RequestActions request={request} cycle={cycle} />
          </>
        }
      />

      {request.archivedAt ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("requests.archivedNotice")}
        </p>
      ) : null}

      {request.rejectionReason ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-table text-warning-strong">
          <span className="font-medium">{t("common.rejectedPrefix")}</span> {request.rejectionReason}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-5">
              <h2 className="text-card font-semibold text-fg">{t("requests.asked")}</h2>
              <span className="text-meta text-fg-subtle">
                {t("common.lineCount", { count: request.items.length })}
              </span>
            </div>

            <ScrollRegion label={t("requests.linesLabel")} className="hidden md:block">
              <table className="w-full text-table">
                <caption className="sr-only">{t("requests.linesLabel")}</caption>
                <thead>
                  <tr className="border-y border-line text-left text-meta text-fg-subtle">
                    <th scope="col" className="px-5 py-2 font-medium">{t("common.description")}</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">{t("common.quantity")}</th>
                    <th scope="col" className="px-5 py-2 font-medium">{t("common.unit")}</th>
                    <th scope="col" className="px-5 py-2 font-medium">{t("common.category")}</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">{t("requests.estimate")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {request.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-3 text-fg">
                        {item.description}
                        {item.specification ? (
                          <span className="block text-meta text-fg-subtle">
                            {item.specification}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg">{item.quantity}</td>
                      <td className="px-5 py-3 text-fg-muted">{item.unit}</td>
                      <td className="px-5 py-3 text-fg-muted">
                        {item.category ? category(item.category) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg">
                        {item.estimatedUnitPrice === null ? "—" : money(item.estimatedAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <td colSpan={4} className="px-5 py-3 text-right font-medium text-fg">
                      {t("requests.estimatedTotal")}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-fg">
                      {currency ? money(request.estimatedTotal) : t("requests.notPriced")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </ScrollRegion>
            {/* Phones read each line as a card and the estimate under the list, not a sideways-scrolling table (AUD-04 §5, MW-05). */}
            <ul className="divide-y divide-line border-t border-line md:hidden" aria-label={t("requests.linesLabel")} data-testid="request-line-cards">
              {request.items.map((item) => (
                <li key={item.id} className="space-y-1 px-5 py-3 text-table">
                  <p className="break-words text-fg">{item.description}</p>
                  {item.specification ? <p className="break-words text-meta text-fg-subtle">{item.specification}</p> : null}
                  <p className="tabular-nums text-fg-muted">
                    {item.quantity} {item.unit}
                    {item.category ? ` · ${category(item.category)}` : ""}
                    {item.estimatedUnitPrice === null ? null : (
                      <>
                        {" "}
                        · <span className="text-fg">{money(item.estimatedAmount)}</span>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex justify-between gap-3 border-t border-line px-5 py-3 text-table md:hidden">
              <span className="font-medium text-fg">{t("requests.estimatedTotal")}</span>
              <span className="font-semibold tabular-nums text-fg">{currency ? money(request.estimatedTotal) : t("requests.notPriced")}</span>
            </div>
          </section>

          {request.description ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("common.notes")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {request.description}
              </p>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">{t("common.approvalHistory")}</h2>
            <ProcurementApprovalHistory approvals={request.approvals} />
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
                  label: t("common.project"),
                  value: request.projectLink ? (
                    request.projectLink.href ? (
                      <Link href={request.projectLink.href} className="text-accent-strong">
                        {request.projectLink.label}
                      </Link>
                    ) : (
                      request.projectLink.label
                    )
                  ) : (
                    <span className="text-fg-subtle">{t("requests.companyGeneral")}</span>
                  ),
                },
                { label: t("common.department"), value: orDash(request.department?.name ?? null) },
                { label: t("requests.buyer"), value: request.owner ? <PersonLink memberId={request.owner.memberId} name={request.owner.fullName} /> : "—" },
                { label: t("common.priority"), value: priority },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("requests.sourcing")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("requests.enquiries")} value={String(request.sourcing.rfqs)} />
              <Meta label={t("requests.ordersRaised")} value={String(request.sourcing.orders)} />
              {request.sourcing.orderedValue && currency ? (
                <Meta label={t("requests.orderedValue")} value={money(request.sourcing.orderedValue)} />
              ) : null}
            </dl>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("suppliers.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("common.created")} value={formatDateTime(request.createdAt)} />
              <Meta label={t("common.updated")} value={formatDateTime(request.updatedAt)} />
              {request.dates.submittedAt ? (
                <Meta label={t("common.submitted")} value={formatDateTime(request.dates.submittedAt)} />
              ) : null}
              {request.dates.approvedAt ? (
                <Meta
                  label={t("common.approved")}
                  value={
                    <>
                      {formatDateTime(request.dates.approvedAt)}
                      {request.approvedBy ? (
                        <>
                          {" · "}
                          <PersonLink memberId={request.approvedBy.memberId} name={request.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
            </dl>
          </section>
        </div>
      </div>
      <RecordDocuments context={context} entityType="purchase_request" entityId={requestId} title={t("common.documents")} emptyDescription={t("requests.documentsEmpty")} />
      {/* Follow-up work raised from this record, in the reader's task scope (PRD #38 §45). */}
      <RecordTasks context={context} parentType="purchase_request" parentId={requestId} />
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="purchase_request" parentId={requestId} />
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
