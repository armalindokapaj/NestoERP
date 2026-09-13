import type { Metadata } from "next";
import Link from "next/link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { Money } from "@/components/finance/money";
import { ApprovalHistory } from "@/components/finance/approval-history";
import { InvoiceActions } from "@/components/finance/invoice-actions";
import { PaymentTable } from "@/components/finance/payment-table";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { settlementLabels } from "@/lib/modules/finance/invoices/invoice.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { invoiceBreadcrumbs, loadInvoice } from "./invoice-context";
import { FinanceRecordTabs } from "./record-tabs";

type Params = { params: Promise<{ invoiceId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { invoiceId } = await params;
  try {
    const { invoice } = await loadInvoice(invoiceId);
    return { title: invoice.invoiceNumber };
  } catch {
    return { title: "Invoice" };
  }
}

/**
 * Invoice detail (PRD #15 §177).
 *
 * Workflow status and settlement status are shown as two separate facts,
 * because they answer different questions: where the invoice is in its
 * approval, and whether the money has arrived (PRD #15 §42).
 */
const SETTLEMENT_TONES = {
  PAID: "success",
  PARTIALLY_PAID: "info",
  OVERDUE: "danger",
  UNPAID: "neutral",
} as const;

export default async function InvoiceDetailPage({ params }: Params) {
  const { invoiceId } = await params;
  const { invoice } = await loadInvoice(invoiceId);

  const may = invoice.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={invoiceBreadcrumbs(invoice)}
        title={invoice.invoiceNumber}
        subtitle={invoice.client.name}
        status={invoice.status}
        badges={
          <Badge tone={SETTLEMENT_TONES[invoice.settlementStatus]}>
            {settlementLabels[invoice.settlementStatus]}
          </Badge>
        }
        meta={[
          {
            label: "Total",
            value: <Money amount={invoice.totalAmount} currency={invoice.currency} emphasis />,
          },
          {
            label: "Outstanding",
            value: (
              <Money amount={invoice.outstandingAmount} currency={invoice.currency} />
            ),
          },
          { label: "Due", value: formatDate(invoice.dueDate) },
        ]}
        actions={
          <InvoiceActions
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoiceNumber}
            capabilities={may}
          />
        }
      />

      <FinanceRecordTabs
        basePath={`/finance/invoices/${invoice.id}`}
        active="overview"
        show={{ documents: may.canViewDocuments, activity: may.canViewActivity }}
      />

      {invoice.status === "ARCHIVED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This invoice is archived and read-only. Restore it to make changes.
        </p>
      ) : null}

      {invoice.status === "APPROVED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          Approved and ready to go out. Mark it sent once the client has it — NESTO does not
          deliver invoices itself.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Line items</h2>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-table">
              <caption className="sr-only">Invoice line items</caption>
              <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th scope="col" className="py-2 text-left font-medium">
                    Description
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Qty
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Unit price
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Tax
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoice.lineItems.map((line) => (
                  <tr key={line.id}>
                    <td className="py-2.5 pr-3 text-fg">{line.description}</td>
                    <td className="py-2.5 text-right tabular-nums text-fg-muted">
                      {line.quantity}
                    </td>
                    <td className="py-2.5 text-right">
                      <Money
                        amount={line.unitPrice}
                        currency={invoice.currency}
                        className="text-fg-muted"
                      />
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-fg-muted">
                      {line.taxRate}%
                    </td>
                    <td className="py-2.5 text-right">
                      <Money amount={line.totalAmount} currency={invoice.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-table">
            <SummaryRow label="Subtotal">
              <Money amount={invoice.subtotal} currency={invoice.currency} />
            </SummaryRow>
            <SummaryRow label="Tax">
              <Money amount={invoice.taxAmount} currency={invoice.currency} />
            </SummaryRow>
            <SummaryRow label="Total">
              <Money amount={invoice.totalAmount} currency={invoice.currency} emphasis />
            </SummaryRow>
            <SummaryRow label="Paid">
              <Money amount={invoice.paidAmount} currency={invoice.currency} />
            </SummaryRow>
            <SummaryRow label="Outstanding">
              <Money amount={invoice.outstandingAmount} currency={invoice.currency} emphasis />
            </SummaryRow>
          </dl>

          {invoice.notes ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-table font-medium text-fg">Notes</h3>
              <p className="mt-1 whitespace-pre-wrap text-table text-fg-muted">{invoice.notes}</p>
            </div>
          ) : null}
        </section>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Details</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: "Client",
                  value: (
                    <Link href={`/clients/${invoice.client.id}`} className="hover:text-accent">
                      {invoice.client.name}
                    </Link>
                  ),
                },
                {
                  label: "Project",
                  value: invoice.project ? (
                    <Link href={`/projects/${invoice.project.id}`} className="hover:text-accent">
                      {invoice.project.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: "Issued", value: formatDate(invoice.issueDate) },
                { label: "Due", value: formatDate(invoice.dueDate) },
                { label: "Currency", value: invoice.currency },
                {
                  label: "Sent",
                  value: invoice.sentAt ? formatDateTime(invoice.sentAt) : "Not yet",
                },
                { label: "Raised by", value: orDash(invoice.createdBy?.fullName) },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Approvals</h2>
            <ApprovalHistory approvals={invoice.approvals} />
          </section>
        </div>
      </div>

      <section className="nesto-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-card font-semibold text-fg">Payments</h2>
          {may.canRecordPayment ? (
            <Button asChild size="sm">
              <Link href={`/finance/payments/new?invoiceId=${invoice.id}`}>Record payment</Link>
            </Button>
          ) : null}
        </div>

        {invoice.payments.length === 0 ? (
          <p className="mt-4 text-table text-fg-subtle">
            {invoice.status === "SENT"
              ? "Nothing received against this invoice yet."
              : "Payments can be recorded once the invoice has been sent."}
          </p>
        ) : (
          <div className="mt-4">
            <PaymentTable payments={invoice.payments} />
          </div>
        )}
      </section>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="invoice" parentId={invoiceId} />
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
