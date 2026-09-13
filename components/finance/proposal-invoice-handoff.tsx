import Link from "next/link";
import { Receipt, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/finance/money";
import { InvoiceFromProposalButton } from "@/components/finance/invoice-from-proposal-button";
import { can, isModuleEnabled } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";

/**
 * "Raise invoice" on an accepted proposal (PRD #35 §180, PRD #23 §43).
 *
 * Unlike the contract handoff next to it, this is not a prefilled link into a
 * form. The figures must be a snapshot of exactly what the client accepted, and
 * routing them through a form would invite them to be edited on the way — so
 * the service copies the lines and the invoice opens as a draft, where anything
 * that genuinely needs changing can be changed.
 *
 * The invoices already drawn are listed, because staged billing against one
 * accepted quote is ordinary and a second click should meet the first invoice
 * rather than quietly making a duplicate.
 */
export async function ProposalInvoiceHandoff({
  context,
  proposalId,
  proposalStatus,
}: {
  context: UserContext;
  proposalId: string;
  proposalStatus: string;
}) {
  // Finance off, or no reach into it at all: Sales sees nothing rather than a
  // button that would refuse them.
  if (!isModuleEnabled(context, "finance")) return null;
  if (!can(context, "finance.invoice.view")) return null;

  const existing = await invoices.listInvoicesForProposal(context, proposalId);
  const mayCreate = can(context, "finance.invoice.create") && proposalStatus === "ACCEPTED";

  if (!mayCreate && existing.length === 0) return null;

  return (
    <section className="nesto-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-card font-semibold text-fg">Invoice</h2>
          <p className="mt-1 text-table text-fg-muted">
            {existing.length === 0
              ? "Bill what the client accepted. The lines are copied across and the invoice opens as a draft."
              : "Already raised from this proposal."}
          </p>
        </div>
        {mayCreate ? (
          <InvoiceFromProposalButton
            proposalId={proposalId}
            label={existing.length > 0 ? "Raise another" : "Raise invoice"}
          />
        ) : null}
      </div>

      {existing.length > 0 ? (
        <>
          <p className="mt-4 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-meta text-warning-strong">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {existing.length === 1
                ? "An invoice has already been raised from this proposal. Raise another only for a genuinely separate stage of billing."
                : `${existing.length} invoices have already been raised from this proposal.`}
            </span>
          </p>
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {existing.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <Link
                  href={`/finance/invoices/${invoice.id}`}
                  className="min-w-0 text-table font-medium text-accent-strong"
                >
                  <Receipt aria-hidden="true" className="mr-1.5 inline size-3.5" />
                  {invoice.invoiceNumber}
                </Link>
                <div className="flex items-center gap-2">
                  <Money amount={invoice.totalAmount} currency={invoice.currency} />
                  <Badge tone="default">{invoice.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
