import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import type { InvoiceDetailDTO } from "@/lib/modules/finance/finance.types";

/**
 * Loads an invoice for every page under /finance/invoices/[invoiceId].
 *
 * An invoice outside the caller's scope is a 404, not a 403, so the page cannot
 * be used to discover that it exists (PRD #15 §174).
 */
export async function loadInvoice(
  invoiceId: string,
): Promise<{ context: UserContext; invoice: InvoiceDetailDTO }> {
  const context = await requireModule("finance");

  try {
    return { context, invoice: await invoices.getInvoice(context, invoiceId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function invoiceBreadcrumbs(invoice: InvoiceDetailDTO, trailing?: string): Crumb[] {
  const crumbs: Crumb[] = [
    { label: "Finance", href: "/finance" },
    { label: "Invoices", href: "/finance/invoices" },
    trailing
      ? { label: invoice.invoiceNumber, href: `/finance/invoices/${invoice.id}` }
      : { label: invoice.invoiceNumber },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
