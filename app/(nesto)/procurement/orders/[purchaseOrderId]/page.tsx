import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { RecordFavorite } from "@/components/productivity/record-favorite";
import { notFound } from "next/navigation";

import { RecordDocuments } from "@/components/documents/record-documents";
import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { OrderActions } from "@/components/procurement/order-actions";
import { ProcurementApprovalHistory } from "@/components/procurement/approval-history";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pendingCycle } from "@/lib/modules/procurement/approvals/approval.service";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { dueLabel, formatAmount, receivedLabel } from "@/components/procurement/procurement-format";
import { RecordTasks } from "@/components/tasks/record-tasks";

type Params = { params: Promise<{ purchaseOrderId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { purchaseOrderId } = await params;
  try {
    const context = await requireModule("procurement");
    const order = await orders.getOrder(context, purchaseOrderId);
    return { title: `${order.poNumber} — ${order.supplier.name}` };
  } catch {
    return { title: (await getTranslations("procurement"))("meta.order") };
  }
}

/**
 * Purchase order detail (PRD #19 §272, §273, §279).
 *
 * Each line shows what was ordered and what has arrived against it, because
 * "70% received" on the header does not tell a site manager which item is
 * short (PRD #19 §140, §141).
 */
export default async function OrderDetailPage({ params }: Params) {
  const { purchaseOrderId } = await params;
  const context = await requireModule("procurement");

  let order;
  try {
    order = await orders.getOrder(context, purchaseOrderId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // The cycle (and chain step) the decision controls act on; they name it back (AUD-10 §4, CW-04, CW-05).
  const cycle =
    order.capabilities.canApprove || order.capabilities.canReject
      ? await pendingCycle(context, "PURCHASE_ORDER", order.id)
      : null;
  const money = (value: string) => formatAmount(value, order.currency);
  const t = await getTranslations("procurement");

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("crumbs.procurement"), href: "/procurement" },
          { label: t("crumbs.orders"), href: "/procurement/orders" },
          { label: order.poNumber },
        ]}
        title={`${order.poNumber} — ${order.supplier.name}`}
        subtitle={t("orders.orderedOn", { date: formatDate(order.orderDate) })}
        status={order.status}
        badges={
          <>
            {order.attention.overdue ? (
              <Badge tone="warning">{dueLabel(t, order.attention.daysToRequired)}</Badge>
            ) : null}
            {order.attention.awaitingReceipt ? (
              <Badge tone="info">{receivedLabel(t, order.receivedFraction)}</Badge>
            ) : null}
            {order.modifiedFromQuote ? (
              <Badge tone="warning">{t("orders.changedFromQuote")}</Badge>
            ) : null}
          </>
        }
        meta={[
          { label: t("common.supplier"), value: order.supplier.name },
          { label: t("orders.value"), value: money(order.totalAmount) },
          {
            label: t("orders.required"),
            value: order.requiredDate ? formatDate(order.requiredDate) : t("common.noDate"),
          },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="purchase_order" entityId={order.id} />
            <OrderActions order={order} cycle={cycle} />
          </>
        }
      />

      {order.archivedAt ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("orders.archivedNotice")}
        </p>
      ) : null}

      {order.rejectionReason ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-table text-warning-strong">
          <span className="font-medium">{t("common.rejectedPrefix")}</span> {order.rejectionReason}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-5">
              <h2 className="text-card font-semibold text-fg">{t("common.ordered")}</h2>
              <span className="text-meta text-fg-subtle">
                {receivedLabel(t, order.receivedFraction)}
              </span>
            </div>

            <ScrollRegion label={t("orders.linesLabel")} className="hidden md:block">
              <table className="w-full text-table">
                <caption className="sr-only">{t("orders.linesLabel")}</caption>
                <thead>
                  <tr className="border-y border-line text-left text-meta text-fg-subtle">
                    <th scope="col" className="px-5 py-2 font-medium">{t("common.description")}</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">{t("common.ordered")}</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">{t("common.received")}</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">{t("common.unitPrice")}</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">{t("common.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-3 text-fg">{item.description}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        <span
                          className={
                            Number(item.outstandingQuantity) > 0 ? "text-warning-strong" : "text-fg"
                          }
                        >
                          {item.receivedQuantity}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg-muted">
                        {money(item.unitPrice)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg">
                        {money(item.totalAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line">
                  <tr>
                    <td colSpan={4} className="px-5 py-2 text-right text-fg-muted">{t("common.subtotal")}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-fg">
                      {money(order.subtotal)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-5 py-2 text-right text-fg-muted">{t("common.tax")}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-fg">
                      {money(order.taxAmount)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-5 py-3 text-right font-medium text-fg">{t("common.total")}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-fg">
                      {money(order.totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </ScrollRegion>
            {/*
              Phones read each line as quantity × price = total, with the totals
              under the list, instead of scrolling a five-column table sideways to
              reach the money (AUD-04 §5, MW-05).
            */}
            <ul className="divide-y divide-line border-t border-line md:hidden" aria-label={t("orders.linesLabel")} data-testid="order-line-cards">
              {order.items.map((item) => (
                <li key={item.id} className="space-y-1 px-5 py-3 text-table">
                  <p className="break-words text-fg">{item.description}</p>
                  <p className="tabular-nums text-fg-muted">
                    {item.quantity} {item.unit} × {money(item.unitPrice)} = <span className="font-medium text-fg">{money(item.totalAmount)}</span>
                  </p>
                  <p className="text-meta text-fg-subtle">
                    {t("common.received")}{" "}
                    <span className={Number(item.outstandingQuantity) > 0 ? "tabular-nums text-warning-strong" : "tabular-nums text-fg"}>{item.receivedQuantity}</span>
                  </p>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-line px-5 py-3 text-table md:hidden">
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">{t("common.subtotal")}</dt>
                <dd className="tabular-nums text-fg">{money(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">{t("common.tax")}</dt>
                <dd className="tabular-nums text-fg">{money(order.taxAmount)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-medium text-fg">{t("common.total")}</dt>
                <dd className="font-semibold tabular-nums text-fg">{money(order.totalAmount)}</dd>
              </div>
            </dl>
          </section>

          {order.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("common.notes")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{order.notes}</p>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">{t("common.approvalHistory")}</h2>
            <ProcurementApprovalHistory approvals={order.approvals} />
          </section>
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("orders.whereFrom")}</h2>
            <DetailGrid
              className="mt-4"
              columns={2}
              items={[
                { label: t("common.request"), value: <LinkOrText link={order.requestLink} fallback={t("orders.directOrder")} /> },
                { label: t("common.enquiry"), value: <LinkOrText link={order.rfqLink} fallback={t("orders.noEnquiry")} /> },
                { label: t("common.project"), value: <LinkOrText link={order.projectLink} fallback={t("common.company")} /> },
                { label: t("common.contract"), value: <LinkOrText link={order.contractLink} fallback={t("common.none")} /> },
              ]}
            />
          </section>

          {/* Absent without `procurement.commitment.view` (PRD #19 §262). */}
          {order.commitment ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("orders.commitment")}</h2>
              <p className="mt-3 text-table text-fg">{money(order.commitment.amount)}</p>
              <p className="mt-1 text-meta text-fg-subtle">
                {t("orders.commitmentNote")}
              </p>
              {order.commitment.href ? (
                <Link
                  href={order.commitment.href}
                  className="mt-2 inline-block text-table font-medium text-accent-strong"
                >
                  {t("orders.openInFinance")}
                </Link>
              ) : null}
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-card font-semibold text-fg">{t("orders.deliveries")}</h2>
              {order.capabilities.canViewReceipts ? (
                <Link
                  href={`/procurement/orders/${order.id}/receipts`}
                  className="text-table font-medium text-accent-strong"
                >
                  {t("common.viewAll")}
                </Link>
              ) : null}
            </div>
            <p className="mt-3 text-table text-fg">
              {t("orders.recordedCount", { count: order.receiptCount })}
            </p>
            <p className="mt-1 text-meta text-fg-subtle">{receivedLabel(t, order.receivedFraction)}</p>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("suppliers.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("common.created")} value={formatDateTime(order.createdAt)} />
              {order.dates.approvedAt ? (
                <Meta
                  label={t("common.approved")}
                  value={
                    <>
                      {formatDateTime(order.dates.approvedAt)}
                      {order.approvedBy ? (
                        <>
                          {" · "}
                          <PersonLink memberId={order.approvedBy.memberId} name={order.approvedBy.fullName} />
                        </>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {order.dates.issuedAt ? (
                <Meta label={t("common.issued")} value={formatDateTime(order.dates.issuedAt)} />
              ) : null}
              {order.dates.closedAt ? (
                <Meta label={t("common.closed")} value={formatDateTime(order.dates.closedAt)} />
              ) : null}
              <Meta
                label={t("common.raisedBy")}
                value={order.createdBy ? <PersonLink memberId={order.createdBy.memberId} name={order.createdBy.fullName} /> : "—"}
              />
            </dl>
          </section>
        </div>
      </div>
      <RecordDocuments context={context} entityType="purchase_order" entityId={purchaseOrderId} title={t("common.documents")} emptyDescription={t("orders.documentsEmpty")} />
      {/* Follow-up work raised from this record, in the reader's task scope (PRD #38 §45). */}
      <RecordTasks context={context} parentType="purchase_order" parentId={purchaseOrderId} />
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="purchase_order" parentId={purchaseOrderId} />
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

/** A cross-module link, or its name as plain text when it cannot be opened. */
function LinkOrText({
  link,
  fallback,
}: {
  link: { id: string; label: string; href: string | null } | null;
  fallback: string;
}) {
  if (!link) return <span className="text-fg-subtle">{fallback}</span>;
  if (!link.href) return <span>{link.label}</span>;
  return (
    <Link href={link.href} className="text-accent-strong transition-colors hover:text-accent">
      {link.label}
    </Link>
  );
}
