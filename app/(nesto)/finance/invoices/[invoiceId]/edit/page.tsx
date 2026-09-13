import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InvoiceForm } from "@/components/finance/invoice-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { updateInvoiceAction } from "@/lib/actions/finance";
import { isAutoNumbered } from "@/lib/core/numbering/numbering.service";
import { resolveFinanceSettings } from "@/lib/modules/finance/finance.settings";
import { invoiceFormOptions } from "@/lib/modules/finance/invoices/invoice.repository";
import { invoiceBreadcrumbs, loadInvoice } from "../invoice-context";

type Params = { params: Promise<{ invoiceId: string }> };

export const metadata: Metadata = { title: "Edit invoice" };

/**
 * Editing is only ever a draft or a rejected invoice (PRD #15 §59, §60).
 *
 * Past that the financial fields are frozen, so the page redirects rather than
 * rendering a form the service would refuse.
 */
export default async function EditInvoicePage({ params }: Params) {
  const { invoiceId } = await params;
  const { context, invoice } = await loadInvoice(invoiceId);

  if (!invoice.capabilities.canEdit) redirect(`/finance/invoices/${invoiceId}`);

  const [options, settings, autoNumbered] = await Promise.all([
    invoiceFormOptions(context),
    resolveFinanceSettings(context.companyId),
    isAutoNumbered({ companyId: context.companyId, moduleKey: "finance", entityType: "invoice" }),
  ]);

  async function action(formData: FormData) {
    "use server";
    return updateInvoiceAction(invoiceId, formData);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <RecordContextHeader
        breadcrumbs={invoiceBreadcrumbs(invoice, "Edit")}
        title={`Edit ${invoice.invoiceNumber}`}
        subtitle={invoice.client.name}
        status={invoice.status}
      />

      <InvoiceForm
        autoNumbered={autoNumbered}
        action={action}
        clients={options.clients.map((client) => ({ value: client.id, label: client.name }))}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.name} (${project.code})`,
          clientId: project.clientId,
        }))}
        values={{
          invoiceNumber: invoice.invoiceNumber,
          clientId: invoice.client.id,
          projectId: invoice.project?.id ?? null,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          currency: invoice.currency,
          notes: invoice.notes,
          lineItems: invoice.lineItems.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
          })),
        }}
        defaultTaxRate={settings.defaultTaxRate}
        defaultPaymentTermsDays={settings.defaultPaymentTermsDays}
        versionUpdatedAt={invoice.updatedAt}
        cancelHref={`/finance/invoices/${invoice.id}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </div>
  );
}
