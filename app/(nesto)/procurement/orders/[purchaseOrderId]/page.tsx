import type { Metadata } from "next";
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
    return { title: "Purchase order" };
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

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Orders", href: "/procurement/orders" },
          { label: order.poNumber },
        ]}
        title={`${order.poNumber} — ${order.supplier.name}`}
        subtitle={`Ordered ${formatDate(order.orderDate)}`}
        status={order.status}
        badges={
          <>
            {order.attention.overdue ? (
              <Badge tone="warning">{dueLabel(order.attention.daysToRequired)}</Badge>
            ) : null}
            {order.attention.awaitingReceipt ? (
              <Badge tone="info">{receivedLabel(order.receivedFraction)}</Badge>
            ) : null}
            {order.modifiedFromQuote ? (
              <Badge tone="warning">Changed from the quote</Badge>
            ) : null}
          </>
        }
        meta={[
          { label: "Supplier", value: order.supplier.name },
          { label: "Value", value: money(order.totalAmount) },
          {
            label: "Required",
            value: order.requiredDate ? formatDate(order.requiredDate) : "No date",
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
          This order is archived and read-only. Restore it to make changes.
        </p>
      ) : null}

      {order.rejectionReason ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-table text-warning-strong">
          <span className="font-medium">Rejected:</span> {order.rejectionReason}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-5">
              <h2 className="text-card font-semibold text-fg">Ordered</h2>
              <span className="text-meta text-fg-subtle">
                {receivedLabel(order.receivedFraction)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-table">
                <caption className="sr-only">Order lines and what has arrived</caption>
                <thead>
                  <tr className="border-y border-line text-left text-meta text-fg-subtle">
                    <th scope="col" className="px-5 py-2 font-medium">Description</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Ordered</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Received</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Unit price</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Line total</th>
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
                    <td colSpan={4} className="px-5 py-2 text-right text-fg-muted">Subtotal</td>
                    <td className="px-5 py-2 text-right tabular-nums text-fg">
                      {money(order.subtotal)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-5 py-2 text-right text-fg-muted">Tax</td>
                    <td className="px-5 py-2 text-right tabular-nums text-fg">
                      {money(order.taxAmount)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-5 py-3 text-right font-medium text-fg">Total</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-fg">
                      {money(order.totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {order.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{order.notes}</p>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Approval history</h2>
            <ProcurementApprovalHistory approvals={order.approvals} />
          </section>
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Where it came from</h2>
            <DetailGrid
              className="mt-4"
              columns={2}
              items={[
                { label: "Request", value: <LinkOrText link={order.requestLink} fallback="Direct order" /> },
                { label: "Enquiry", value: <LinkOrText link={order.rfqLink} fallback="No enquiry" /> },
                { label: "Project", value: <LinkOrText link={order.projectLink} fallback="Company" /> },
                { label: "Contract", value: <LinkOrText link={order.contractLink} fallback="None" /> },
              ]}
            />
          </section>

          {/* Absent without `procurement.commitment.view` (PRD #19 §262). */}
          {order.commitment ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Finance commitment</h2>
              <p className="mt-3 text-table text-fg">{money(order.commitment.amount)}</p>
              <p className="mt-1 text-meta text-fg-subtle">
                Committed when this order was approved.
              </p>
              {order.commitment.href ? (
                <Link
                  href={order.commitment.href}
                  className="mt-2 inline-block text-table font-medium text-accent-strong"
                >
                  Open in Finance
                </Link>
              ) : null}
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-card font-semibold text-fg">Deliveries</h2>
              {order.capabilities.canViewReceipts ? (
                <Link
                  href={`/procurement/orders/${order.id}/receipts`}
                  className="text-table font-medium text-accent-strong"
                >
                  View all
                </Link>
              ) : null}
            </div>
            <p className="mt-3 text-table text-fg">
              {order.receiptCount} recorded
            </p>
            <p className="mt-1 text-meta text-fg-subtle">{receivedLabel(order.receivedFraction)}</p>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Created" value={formatDateTime(order.createdAt)} />
              {order.dates.approvedAt ? (
                <Meta
                  label="Approved"
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
                <Meta label="Issued" value={formatDateTime(order.dates.issuedAt)} />
              ) : null}
              {order.dates.closedAt ? (
                <Meta label="Closed" value={formatDateTime(order.dates.closedAt)} />
              ) : null}
              <Meta
                label="Raised by"
                value={order.createdBy ? <PersonLink memberId={order.createdBy.memberId} name={order.createdBy.fullName} /> : "—"}
              />
            </dl>
          </section>
        </div>
      </div>
      <RecordDocuments context={context} entityType="purchase_order" entityId={purchaseOrderId} title="Documents" emptyDescription="The issued order, supplier confirmations and delivery notes appear here." />
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
