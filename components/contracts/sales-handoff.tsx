import Link from "next/link";
import { FileSignature, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can, isModuleEnabled } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { contractStatusLabels } from "@/lib/modules/contracts/contracts/contract.status";

/**
 * "Create contract" on a won opportunity or an accepted proposal
 * (PRD #18 §12, §366, §367).
 *
 * The handoff is a prefilled link into the ordinary create form, not a second
 * way to make a contract: the same canonical Contract, the same validation, the
 * same service. Sales owns no contract table of its own.
 *
 * The contracts already drawn from this source are listed above the button, so
 * a second click meets the first agreement rather than quietly making another
 * one. That is a warning and not a unique constraint — one accepted proposal
 * can legitimately produce two agreements, and Legal is allowed to say so
 * (PRD #18 §506, §507).
 *
 * The proposal total prefills the contract value; it does not fix it. A
 * contract that differs from the proposal it came from is normal, and the
 * figure stays editable while the contract is a draft (PRD #18 §367).
 */
export async function SalesContractHandoff({
  context,
  source,
  prefill,
}: {
  context: UserContext;
  source: { opportunityId?: string; proposalId?: string };
  prefill: {
    title: string;
    clientId?: string | null;
    currency?: string | null;
    contractValue?: string | null;
  };
}) {
  // Module off, or no legal reach at all: Sales sees nothing rather than a
  // button that would refuse them (PRD #18 §518).
  if (!isModuleEnabled(context, "contracts")) return null;
  if (!can(context, "legal.view")) return null;

  const mayCreate = can(context, "legal.contract.create");
  const existing = await contracts.listForSalesSource(context, source);

  // Nothing to offer and nothing to warn about.
  if (!mayCreate && existing.length === 0) return null;

  const params = new URLSearchParams();
  if (source.opportunityId) params.set("opportunityId", source.opportunityId);
  if (source.proposalId) params.set("proposalId", source.proposalId);
  if (prefill.clientId) params.set("clientId", prefill.clientId);
  if (prefill.title) params.set("title", prefill.title);
  if (prefill.currency) params.set("currency", prefill.currency);
  if (prefill.contractValue) params.set("contractValue", prefill.contractValue);

  return (
    <section className="nesto-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-card font-semibold text-fg">Contract</h2>
          <p className="mt-1 text-table text-fg-muted">
            {existing.length === 0
              ? "Draw up the agreement behind this deal. The value and dates stay editable while it is a draft."
              : "Already drawn from this sales record."}
          </p>
        </div>
        {mayCreate ? (
          <Button asChild variant={existing.length > 0 ? "secondary" : "primary"} size="sm">
            <Link href={`/contracts/new?${params.toString()}`}>
              <FileSignature aria-hidden="true" />
              {existing.length > 0 ? "Create another" : "Create contract"}
            </Link>
          </Button>
        ) : null}
      </div>

      {existing.length > 0 ? (
        <>
          <p className="mt-4 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-meta text-warning-strong">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {existing.length === 1
                ? "A contract already exists for this sales record. Create another only if the deal genuinely produced a second agreement."
                : `${existing.length} contracts already exist for this sales record.`}
            </span>
          </p>
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {existing.map((contract) => (
              <li key={contract.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <Link
                  href={`/contracts/${contract.id}`}
                  className="min-w-0 text-table font-medium text-accent-strong"
                >
                  {contract.contractNumber} — {contract.title}
                </Link>
                <Badge tone="neutral">{contractStatusLabels[contract.status]}</Badge>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
