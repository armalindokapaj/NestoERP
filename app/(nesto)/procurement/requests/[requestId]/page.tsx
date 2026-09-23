import { RecordFavorite } from "@/components/productivity/record-favorite";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordDocuments } from "@/components/documents/record-documents";
import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RequestActions } from "@/components/procurement/request-actions";
import { ProcurementApprovalHistory } from "@/components/procurement/approval-history";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as requests from "@/lib/modules/procurement/requests/request.service";
import {
  categoryLabels,
  priorityLabels,
} from "@/lib/modules/procurement/procurement.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { dueLabel, formatAmount } from "@/components/procurement/procurement-format";
import { RecordTasks } from "@/components/tasks/record-tasks";

type Params = { params: Promise<{ requestId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { requestId } = await params;
  try {
    const context = await requireModule("procurement");
    const request = await requests.getRequest(context, requestId);
    return { title: `${request.requestNumber} — ${request.title}` };
  } catch {
    return { title: "Purchase request" };
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

  const currency = request.currency;
  const money = (value: string) => (currency ? formatAmount(value, currency) : value);

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Requests", href: "/procurement/requests" },
          { label: request.requestNumber },
        ]}
        title={request.title}
        subtitle={request.requestNumber}
        status={request.status}
        badges={
          <>
            <Badge tone="neutral">{priorityLabels[request.priority]}</Badge>
            {request.attention.overdue ? (
              <Badge tone="warning">{dueLabel(request.attention.daysToRequired)}</Badge>
            ) : null}
            {request.attention.unsourced ? <Badge tone="info">Not yet sourced</Badge> : null}
          </>
        }
        meta={[
          { label: "Raised by", value: <PersonLink memberId={request.requestedBy.memberId} name={request.requestedBy.fullName} /> },
          {
            label: "Estimated",
            value: currency ? money(request.estimatedTotal) : "Not priced",
          },
          {
            label: "Needed",
            value: request.requiredDate ? formatDate(request.requiredDate) : "No date",
          },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="purchase_request" entityId={request.id} />
            <RequestActions request={request} />
          </>
        }
      />

      {request.archivedAt ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This request is archived and read-only. Restore it to make changes.
        </p>
      ) : null}

      {request.rejectionReason ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-table text-warning-strong">
          <span className="font-medium">Rejected:</span> {request.rejectionReason}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-5">
              <h2 className="text-card font-semibold text-fg">What is being asked for</h2>
              <span className="text-meta text-fg-subtle">
                {request.items.length} line{request.items.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-table">
                <caption className="sr-only">Request lines</caption>
                <thead>
                  <tr className="border-y border-line text-left text-meta text-fg-subtle">
                    <th scope="col" className="px-5 py-2 font-medium">Description</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Quantity</th>
                    <th scope="col" className="px-5 py-2 font-medium">Unit</th>
                    <th scope="col" className="px-5 py-2 font-medium">Category</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Estimate</th>
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
                        {item.category ? categoryLabels[item.category] : "—"}
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
                      Estimated total
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-fg">
                      {currency ? money(request.estimatedTotal) : "Not priced"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {request.description ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {request.description}
              </p>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Approval history</h2>
            <ProcurementApprovalHistory approvals={request.approvals} />
          </section>
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Where it belongs</h2>
            <DetailGrid
              className="mt-4"
              columns={2}
              items={[
                {
                  label: "Project",
                  value: request.projectLink ? (
                    request.projectLink.href ? (
                      <Link href={request.projectLink.href} className="text-accent-strong">
                        {request.projectLink.label}
                      </Link>
                    ) : (
                      request.projectLink.label
                    )
                  ) : (
                    <span className="text-fg-subtle">Company-general</span>
                  ),
                },
                { label: "Department", value: orDash(request.department?.name ?? null) },
                { label: "Buyer", value: request.owner ? <PersonLink memberId={request.owner.memberId} name={request.owner.fullName} /> : "—" },
                { label: "Priority", value: priorityLabels[request.priority] },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Sourcing</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Enquiries" value={String(request.sourcing.rfqs)} />
              <Meta label="Orders raised" value={String(request.sourcing.orders)} />
              {request.sourcing.orderedValue && currency ? (
                <Meta label="Ordered value" value={money(request.sourcing.orderedValue)} />
              ) : null}
            </dl>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Created" value={formatDateTime(request.createdAt)} />
              <Meta label="Updated" value={formatDateTime(request.updatedAt)} />
              {request.dates.submittedAt ? (
                <Meta label="Submitted" value={formatDateTime(request.dates.submittedAt)} />
              ) : null}
              {request.dates.approvedAt ? (
                <Meta
                  label="Approved"
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
      <RecordDocuments context={context} entityType="purchase_request" entityId={requestId} title="Documents" emptyDescription="Specifications, quotations and justifications attached to this request appear here." />
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
