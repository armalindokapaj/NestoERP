import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FinanceRecordDocuments } from "@/components/finance/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import { getTranslations } from "@/lib/i18n/server";
import { invoiceBreadcrumbs, loadInvoice } from "../invoice-context";
import { FinanceRecordTabs } from "../record-tabs";

type Params = { params: Promise<{ invoiceId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.invoiceDocuments") };
}

/** Files attached to this invoice, through the canonical Documents module. */
export default async function InvoiceDocumentsPage({ params }: Params) {
  const { invoiceId } = await params;
  const { context, invoice } = await loadInvoice(invoiceId);

  if (!invoice.capabilities.canViewDocuments) notFound();
  const t = await getTranslations("finance");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={await invoiceBreadcrumbs(invoice, t("crumbs.documents"))}
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
