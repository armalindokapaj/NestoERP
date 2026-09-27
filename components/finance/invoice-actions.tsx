"use client";

import { FinanceRecordActions } from "@/components/finance/record-actions";
import { invoiceLifecycleAction, rejectInvoiceAction } from "@/lib/actions/finance";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { RecordCapabilities } from "@/lib/modules/finance/finance.types";
import type { InvoiceAction } from "@/lib/actions/finance";

/** Binds the shared record actions to the invoice services (PRD #15 §305). */
export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  capabilities,
  cycle,
}: {
  invoiceId: string;
  invoiceNumber: string;
  capabilities: RecordCapabilities;
  /** The approval cycle on screen; a decision names it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  return (
    <FinanceRecordActions
      kind="invoice"
      label={invoiceNumber}
      capabilities={capabilities}
      editHref={`/finance/invoices/${invoiceId}/edit`}
      lifecycle={(action) => invoiceLifecycleAction(invoiceId, action as InvoiceAction, undefined, cycle)}
      reject={(reason) => rejectInvoiceAction(invoiceId, reason, cycle)}
    />
  );
}
