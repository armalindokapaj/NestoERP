import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InvoiceForm } from "@/components/finance/invoice-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { updateInvoiceAction } from "@/lib/actions/finance";
import { isAutoNumbered } from "@/lib/core/numbering/numbering.service";
import { companyToday, resolveFinanceSettings } from "@/lib/modules/finance/finance.settings";
import { invoiceFormOptions } from "@/lib/modules/finance/invoices/invoice.repository";
import { getTranslations } from "@/lib/i18n/server";
import { invoiceBreadcrumbs, loadInvoice } from "../invoice-context";

type Params = { params: Promise<{ invoiceId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.editInvoice") };
}

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
  const t = await getTranslations("finance");

  const [options, settings, autoNumbered, today] = await Promise.all([
    invoiceFormOptions(context),
    resolveFinanceSettings(context.companyId),
    isAutoNumbered({ companyId: context.companyId, moduleKey: "finance", entityType: "invoice" }),
    companyToday(context.companyId),
  ]);

  async function action(formData: FormData) {
    "use server";
    return updateInvoiceAction(invoiceId, formData);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <RecordContextHeader
        breadcrumbs={await invoiceBreadcrumbs(invoice, t("crumbs.edit"))}
        title={t("edit.title", { label: invoice.invoiceNumber })}
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
        defaultCurrency={settings.baseCurrency}
        today={today}
        versionUpdatedAt={invoice.updatedAt}
        cancelHref={`/finance/invoices/${invoice.id}`}
        submitLabel={t("edit.save")}
        pendingLabel={t("settings.saving")}
      />
    </div>
  );
}
