import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FinanceRecordDocuments } from "@/components/finance/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import { invoiceBreadcrumbs, loadInvoice } from "../invoice-context";
import { FinanceRecordTabs } from "../record-tabs";

type Params = { params: Promise<{ invoiceId: string }> };

export const metadata: Metadata = { title: "Invoice documents" };

/** Files attached to this invoice, through the canonical Documents module. */
export default async function InvoiceDocumentsPage({ params }: Params) {
  const { invoiceId } = await params;
  const { context, invoice } = await loadInvoice(invoiceId);

  if (!invoice.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={invoiceBreadcrumbs(invoice, "Documents")}
        title={invoice.invoiceNumber}
        subtitle={invoice.client.name}
        status={invoice.status}
      />

      <FinanceRecordTabs
        basePath={`/finance/invoices/${invoice.id}`}
        active="documents"
        show={{ documents: true, activity: invoice.capabilities.canViewActivity }}
      />

      <FinanceRecordDocuments
        context={context}
        entityType="invoice"
        entityId={invoice.id}
        canAttach={invoice.status !== "ARCHIVED"}
      />
    </div>
  );
}
