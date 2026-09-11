"use client";

import { FinanceRecordActions } from "@/components/finance/record-actions";
import { invoiceLifecycleAction, rejectInvoiceAction } from "@/lib/actions/finance";
import type { RecordCapabilities } from "@/lib/modules/finance/finance.types";
import type { InvoiceAction } from "@/lib/actions/finance";

/** Binds the shared record actions to the invoice services (PRD #15 §305). */
export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  capabilities,
}: {
  invoiceId: string;
  invoiceNumber: string;
  capabilities: RecordCapabilities;
}) {
  return (
    <FinanceRecordActions
      kind="invoice"
      label={invoiceNumber}
      capabilities={capabilities}
      editHref={`/finance/invoices/${invoiceId}/edit`}
      lifecycle={(action) => invoiceLifecycleAction(invoiceId, action as InvoiceAction)}
      reject={(reason) => rejectInvoiceAction(invoiceId, reason)}
    />
  );
}
