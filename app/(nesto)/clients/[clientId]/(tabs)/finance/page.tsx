import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReceiptText } from "lucide-react";

import { CurrencyTotals } from "@/components/finance/money";
import { InvoiceTable } from "@/components/finance/invoice-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { parseInvoiceQuery } from "@/lib/modules/finance/finance.query";
import { baseCurrency } from "@/lib/modules/finance/finance.settings";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import { loadClient } from "../../client-context";

type Params = { params: Promise<{ clientId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clients"))("meta.finance") };
}

/**
 * Client finance (PRD #15 §185, §186).
 *
 * Invoices raised against this client, and what is still outstanding on them.
 * Generic client access is not enough to reach it: the tab requires a finance
 * permission as well, which is why a Sales user sees it and a Project Manager
 * does not.
 */
export default async function ClientFinancePage({ params }: Params) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);

  if (!client.capabilities.canViewFinance) notFound();
  const t = await getTranslations("clients");

  const [result, currency] = await Promise.all([
    can(context, "finance.invoice.view")
      ? invoices.listInvoices(context, parseInvoiceQuery({ clientId, limit: "50" }))
      : null,
    baseCurrency(context.companyId),
  ]);

  // Outstanding is summed from the page's own rows and grouped by currency:
  // V0.1 never adds two currencies together (PRD #15 §36).
  const outstanding = new Map<string, number>();
  for (const invoice of result?.data ?? []) {
    const value = Number.parseFloat(invoice.outstandingAmount);
    if (value > 0) {
      outstanding.set(invoice.currency, (outstanding.get(invoice.currency) ?? 0) + value);
    }
  }

  return (
    <div className="space-y-5">
      {can(context, "finance.receivables.view") ? (
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("financePage.outstanding")}</h2>
          <CurrencyTotals
            totals={[...outstanding.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([code, amount]) => ({ currency: code, amount: amount.toFixed(2) }))}
            baseCurrency={currency}
            className="mt-2 text-page font-semibold text-fg"
          />
          <p className="mt-2 text-meta text-fg-subtle">
            {t("financePage.outstandingNote")}
          </p>
        </section>
      ) : null}

      {!result ? (
        <EmptyState
          icon={<ReceiptText />}
          title={t("financePage.noAccessTitle")}
          description={t("financePage.noAccessDescription")}
        />
      ) : result.data.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title={t("financePage.emptyTitle")}
          description={t("financePage.emptyDescription")}
          action={
            can(context, "finance.invoice.create")
              ? { label: t("financePage.newInvoice"), href: `/finance/invoices/new?clientId=${client.id}` }
              : undefined
          }
        />
      ) : (
        <InvoiceTable invoices={result.data} />
      )}
    </div>
  );
}
