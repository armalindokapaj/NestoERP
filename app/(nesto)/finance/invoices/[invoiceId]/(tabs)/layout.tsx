import { RecordFavorite } from "@/components/productivity/record-favorite";
import { Money } from "@/components/finance/money";
import { InvoiceActions } from "@/components/finance/invoice-actions";
import { RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "@/lib/i18n/server";
import { pendingCycle } from "@/lib/modules/finance/approvals/approval.service";
import { formatDate } from "@/lib/utils/format";
import { invoiceBreadcrumbs, loadInvoice } from "../invoice-context";
import { FinanceRecordTabs } from "../record-tabs";

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

type Props = { children: React.ReactNode; params: Promise<{ invoiceId: string }> };

/** The record's frame: header and tabs stay mounted while Overview, Documents and Activity swap beneath them. */
export default async function InvoiceTabsLayout({ children, params }: Props) {
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
        show={{ documents: may.canViewDocuments, activity: may.canViewActivity }}
      />

      {children}
    </div>
  );
}
