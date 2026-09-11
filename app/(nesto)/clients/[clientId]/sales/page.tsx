import { Prisma } from "@prisma/client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Handshake } from "lucide-react";

import { RecordContextHeader } from "@/components/modules/record-header";
import { OpportunityTable } from "@/components/sales/opportunity-table";
import { ProposalTable } from "@/components/sales/proposal-table";
import { totalsLabel } from "@/components/sales/sales-format";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { currencyTotals } from "@/lib/modules/sales/opportunities/opportunity.forecast";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import { parseOpportunityQuery, parseProposalQuery } from "@/lib/modules/sales/sales.query";
import { clientBreadcrumbs, loadClient } from "../client-context";
import { ClientTabs } from "../client-tabs";

type Params = { params: Promise<{ clientId: string }> };

export const metadata: Metadata = { title: "Client sales" };

/**
 * Client sales (PRD #17 §10, §266, §414).
 *
 * The commercial relationship with this client: what is in play, what has been
 * won and lost, and the proposals behind it. Generic client access is not
 * enough to reach it — the tab needs Sales access too, and every count on it is
 * narrowed by the Sales scope, so it shows the reader's own deals rather than
 * the company's (PRD #17 §414).
 */
export default async function ClientSalesPage({ params }: Params) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);

  if (!client.capabilities.canViewSales) notFound();

  const [openDeals, closedDeals, clientProposals] = await Promise.all([
    opportunities.listOpportunities(
      context,
      parseOpportunityQuery({ clientId, outcome: "OPEN", sort: "value-desc", limit: "50" }),
    ),
    opportunities.listOpportunities(
      context,
      parseOpportunityQuery({ clientId, outcome: "WON,LOST", sort: "updated-desc", limit: "50" }),
    ),
    can(context, "sales.proposal.view")
      ? proposals.listProposals(context, parseProposalQuery({ clientId, limit: "50" }))
      : null,
  ]);

  // Summed from the page's own rows and grouped by currency: V0.1 never adds
  // two currencies together (PRD #17 §31).
  const openTotals = currencyTotals(
    openDeals.data.map((row) => ({
      stage: row.stage,
      currency: row.currency,
      estimatedValue: decimal(row.estimatedValue),
      probabilityOverride: null,
    })),
  );

  const wonTotals = currencyTotals(
    closedDeals.data
      .filter((row) => row.stage === "WON")
      .map((row) => ({
        stage: row.stage,
        currency: row.currency,
        estimatedValue: decimal(row.estimatedValue),
        probabilityOverride: null,
      })),
  );

  const nothing =
    openDeals.data.length === 0 &&
    closedDeals.data.length === 0 &&
    (clientProposals?.data.length ?? 0) === 0;

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={clientBreadcrumbs(client, "Sales")}
        title={client.name}
        subtitle={client.code ?? undefined}
        status={client.status}
      />

      <ClientTabs clientId={client.id} active="sales" capabilities={client.capabilities} />

      {nothing ? (
        <EmptyState
          icon={<Handshake />}
          title="No commercial history."
          description="Opportunities and proposals raised for this client appear here."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="nesto-card p-4">
              <p className="text-table text-fg-muted">Open pipeline</p>
              <p className="mt-2 text-card font-semibold tabular-nums text-fg">
                {totalsLabel(openTotals)}
              </p>
            </div>
            <div className="nesto-card p-4">
              <p className="text-table text-fg-muted">Won</p>
              <p className="mt-2 text-card font-semibold tabular-nums text-fg">
                {totalsLabel(wonTotals)}
              </p>
            </div>
          </div>

          {openDeals.data.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">In play</h2>
              <OpportunityTable opportunities={openDeals.data} showClient={false} />
            </section>
          ) : null}

          {closedDeals.data.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Won and lost</h2>
              <OpportunityTable opportunities={closedDeals.data} showClient={false} />
            </section>
          ) : null}

          {clientProposals && clientProposals.data.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Proposals</h2>
              <ProposalTable proposals={clientProposals.data} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The DTO carries a decimal string; the totals helper works in Decimal. */
function decimal(value: string) {
  return new Prisma.Decimal(value);
}
