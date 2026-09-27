import { FileText } from "lucide-react";
import { redirect } from "next/navigation";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ProposalTable } from "@/components/sales/proposal-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { PROPOSAL_SORT_KEYS, PROPOSAL_STATUSES } from "@/lib/modules/sales/proposals/proposal.schema";
import { proposalStatusLabels } from "@/lib/modules/sales/proposals/proposal.status";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import { parseProposalQuery } from "@/lib/modules/sales/sales.query";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

type SearchParams = Record<string, string | string[] | undefined>;

/** The proposal list (PRD #17 §290, §291). */
export async function ProposalList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const query = parseProposalQuery(searchParams);

  const [result, options] = await Promise.all([
    proposals.listProposals(context, query),
    proposals.proposalFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search || query.status?.length || query.clientId || query.currency || query.opportunityId,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: PROPOSAL_STATUSES.filter((status) => status !== "ARCHIVED").map((value) => ({
        value,
        label: proposalStatusLabels[value],
      })),
    },
    {
      param: "clientId",
      label: "Client",
      options: options.clients.map((client) => ({ value: client.id, label: client.name })),
    },
    ...(options.currencies.length > 1
      ? [
          {
            param: "currency",
            label: "Currency",
            options: options.currencies.map((code) => ({ value: code, label: code })),
          },
        ]
      : []),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/sales/proposals", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/sales/proposals", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search number, title, client…"
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "number-asc", label: "Number A–Z" },
          { value: "amount-desc", label: "Highest total" },
          { value: "valid-asc", label: "Expiring soonest" },
          { value: "status-asc", label: "Status" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<FileText />}
            title="No Sales records match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/sales/proposals" }}
          />
        ) : (
          <EmptyState
            icon={<FileText />}
            title="No proposals yet."
            description="Commercial offers raised against an opportunity appear here. A proposal is not an invoice."
            action={
              can(context, "sales.proposal.create")
                ? { label: "New proposal", href: "/sales/proposals/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <ProposalTable proposals={result.data} sort={{ value: query.sort, keys: PROPOSAL_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
