import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FinanceRecordDocuments } from "@/components/finance/record-documents";
import { getTranslations } from "@/lib/i18n/server";
import { loadInvoice } from "../../invoice-context";

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
      <FinanceRecordDocuments
        context={context}
        entityType="invoice"
        entityId={invoice.id}
        canAttach={invoice.status !== "ARCHIVED"}
      />
    </div>
  );
}
