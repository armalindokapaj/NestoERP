import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InvoiceForm } from "@/components/finance/invoice-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createInvoiceAction } from "@/lib/actions/finance";
import { requireModule } from "@/lib/context/current-user";
import { isAutoNumbered } from "@/lib/core/numbering/numbering.service";
import { resolveFinanceSettings } from "@/lib/modules/finance/finance.settings";
import { invoiceFormOptions } from "@/lib/modules/finance/invoices/invoice.repository";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; projectId?: string }>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.invoice.create")) redirect("/access-denied");

  const [options, settings, autoNumbered] = await Promise.all([
    invoiceFormOptions(context),
    resolveFinanceSettings(context.companyId),
    isAutoNumbered({ companyId: context.companyId, moduleKey: "finance", entityType: "invoice" }),
  ]);
  const params = await searchParams;

  async function action(formData: FormData) {
    "use server";
    return createInvoiceAction(formData);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Invoices", href: "/finance/invoices" },
          { label: "New invoice" },
        ]}
        title="New invoice"
        subtitle="Saved as a draft. It goes out only once it has been approved and marked sent."
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
        values={
          params.clientId || params.projectId
            ? {
                invoiceNumber: "",
                clientId: params.clientId ?? "",
                projectId: params.projectId ?? null,
                issueDate: new Date().toISOString().slice(0, 10),
                dueDate: "",
                currency: settings.baseCurrency,
                notes: null,
                lineItems: [],
              }
            : undefined
        }
        defaultTaxRate={settings.defaultTaxRate}
        defaultPaymentTermsDays={settings.defaultPaymentTermsDays}
        cancelHref="/finance/invoices"
        submitLabel="Create invoice"
        pendingLabel="Creating…"
      />
    </div>
  );
}
