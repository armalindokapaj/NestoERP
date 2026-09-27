import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { RecordFavorite } from "@/components/productivity/record-favorite";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { Money } from "@/components/finance/money";
import { ApprovalHistory } from "@/components/finance/approval-history";
import { InvoiceActions } from "@/components/finance/invoice-actions";
import { PaymentTable } from "@/components/finance/payment-table";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTranslations } from "@/lib/i18n/server";
import { pendingCycle } from "@/lib/modules/finance/approvals/approval.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { invoiceBreadcrumbs, loadInvoice } from "./invoice-context";
import { FinanceRecordTabs } from "./record-tabs";

type Params = { params: Promise<{ invoiceId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { invoiceId } = await params;
  try {
    const { invoice } = await loadInvoice(invoiceId);
    return { title: invoice.invoiceNumber };
  } catch {
    return { title: (await getTranslations("finance"))("kind.invoice") };
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
  const { context, invoice } = await loadInvoice(invoiceId);

  const may = invoice.capabilities;
  const t = await getTranslations("finance");
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "INVOICE", invoice.id) : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={await invoiceBreadcrumbs(invoice)}
        title={invoice.invoiceNumber}
        subtitle={invoice.client.name}
        status={invoice.status}
        badges={
          <Badge tone={SETTLEMENT_TONES[invoice.settlementStatus]}>
            {t(`settlement.${invoice.settlementStatus}`)}
          </Badge>
        }
        meta={[
          {
            label: t("columns.total"),
            value: <Money amount={invoice.totalAmount} currency={invoice.currency} emphasis />,
          },
          {
            label: t("columns.outstanding"),
            value: (
              <Money amount={invoice.outstandingAmount} currency={invoice.currency} />
            ),
          },
          { label: t("columns.due"), value: formatDate(invoice.dueDate) },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="invoice" entityId={invoice.id} />
            <InvoiceActions
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoiceNumber}
              capabilities={may}
              cycle={cycle}
            />
          </>
        }
      />

      <FinanceRecordTabs
        basePath={`/finance/invoices/${invoice.id}`}
        active="overview"
        show={{ documents: may.canViewDocuments, activity: may.canViewActivity }}
      />

      {invoice.status === "ARCHIVED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("invoices.archivedNote")}
        </p>
      ) : null}

      {invoice.status === "APPROVED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("invoices.approvedNote")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("lines.lineItems")}</h2>

          {/* A labelled, keyboard-scrollable region: five figures a line do not fit a phone (AUD-04 §5, D-02-10). */}
          <div className="mt-4 overflow-x-auto" role="region" aria-label={t("invoices.lineItems")} tabIndex={0}>
            <table className="w-full min-w-[32rem] text-table">
              <caption className="sr-only">{t("invoices.lineItems")}</caption>
              <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th scope="col" className="py-2 text-left font-medium">
                    {t("lines.description")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("invoices.qty")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("lines.unitPrice")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("lines.tax")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("columns.total")}
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
                    <td className="py-2.5 text-right tabular-nums text-fg-muted">
                      {/* The stored price, to its four decimals, on screen — not only in a hover title (AUD-04 §5, MW-09, D-02-05). */}
                      {unitPriceLabel(line.unitPrice, invoice.currency)}
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
            <SummaryRow label={t("lines.subtotal")}>
              <Money amount={invoice.subtotal} currency={invoice.currency} />
            </SummaryRow>
            <SummaryRow label={t("lines.tax")}>
              <Money amount={invoice.taxAmount} currency={invoice.currency} />
            </SummaryRow>
            <SummaryRow label={t("columns.total")}>
              <Money amount={invoice.totalAmount} currency={invoice.currency} emphasis />
            </SummaryRow>
            <SummaryRow label={t("columns.paid")}>
              <Money amount={invoice.paidAmount} currency={invoice.currency} />
            </SummaryRow>
            <SummaryRow label={t("columns.outstanding")}>
              <Money amount={invoice.outstandingAmount} currency={invoice.currency} emphasis />
            </SummaryRow>
          </dl>

          {invoice.notes ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-table font-medium text-fg">{t("form.notes")}</h3>
              <p className="mt-1 whitespace-pre-wrap text-table text-fg-muted">{invoice.notes}</p>
            </div>
          ) : null}
        </section>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: t("invoiceForm.client"),
                  value: (
                    <Link href={`/clients/${invoice.client.id}`} className="hover:text-accent">
                      {invoice.client.name}
                    </Link>
                  ),
                },
                {
                  label: t("form.project"),
                  value: invoice.project ? (
                    <Link href={`/projects/${invoice.project.id}`} className="hover:text-accent">
                      {invoice.project.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: t("columns.issued"), value: formatDate(invoice.issueDate) },
                { label: t("columns.due"), value: formatDate(invoice.dueDate) },
                { label: t("form.currency"), value: invoice.currency },
                {
                  label: t("invoices.sent"),
                  value: invoice.sentAt ? formatDateTime(invoice.sentAt) : t("invoices.notYet"),
                },
                { label: t("invoices.raisedBy"), value: invoice.createdBy ? <PersonLink memberId={invoice.createdBy.memberId} name={invoice.createdBy.fullName} /> : "—" },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.approvals")}</h2>
            <ApprovalHistory approvals={invoice.approvals} />
          </section>
        </div>
      </div>

      <section className="nesto-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-card font-semibold text-fg">{t("captions.payments")}</h2>
          {may.canRecordPayment ? (
            <Button asChild size="sm">
              <Link href={`/finance/payments/new?invoiceId=${invoice.id}`}>{t("panel.recordPayment")}</Link>
            </Button>
          ) : null}
        </div>

        {invoice.payments.length === 0 ? (
          <p className="mt-4 text-table text-fg-subtle">
            {invoice.status === "SENT"
              ? t("invoices.nothingReceived")
              : t("invoices.paymentsAfterSent")}
          </p>
        ) : (
          <div className="mt-4">
            <PaymentTable payments={invoice.payments} listId="finance.invoice-payments" />
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

/**
 * A unit price as stored: up to four decimals (`Decimal(18, 4)`), at least two.
 * The decimal string goes to `Intl` as a string, so no float rounds it
 * (AUD-01); money totals keep `formatAmount`'s two decimals.
 */
function unitPriceLabel(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(amount as unknown as number);
  } catch {
    return `${amount} ${currency}`;
  }
}
