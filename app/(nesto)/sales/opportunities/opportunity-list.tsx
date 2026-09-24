import Link from "@/components/navigation/nav-link";
import { Target } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { OpportunityTable } from "@/components/sales/opportunity-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import {
  OPPORTUNITY_OUTCOMES,
  OPPORTUNITY_STAGE_VALUES,
} from "@/lib/modules/sales/opportunities/opportunity.schema";
import { opportunityStageLabels } from "@/lib/modules/sales/opportunities/opportunity.stage";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import { parseOpportunityQuery } from "@/lib/modules/sales/sales.query";

type SearchParams = Record<string, string | string[] | undefined>;

const OUTCOME_LABELS: Record<(typeof OPPORTUNITY_OUTCOMES)[number], string> = {
  OPEN: "Open",
  WON: "Won",
  LOST: "Lost",
};

/** The opportunity list (PRD #17 §71–§73, §290, §291). */
export async function OpportunityList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const query = parseOpportunityQuery(searchParams);
  const grouped = inGroupWorkspace(context);

  const [result, options] = await Promise.all([
    opportunities.listOpportunitiesForWorkspace(context, query),
    opportunities.opportunityFilterOptionsForWorkspace(context, query.companyId),
  ]);

  const hasFilters = Boolean(
    query.search ||
      query.stage?.length ||
      query.outcome?.length ||
      query.ownerMemberId ||
      query.clientId ||
      query.currency ||
      (grouped && query.companyId),
  );

  // Group workspace only: narrows the companies already read (§86, §87). A menu
  // of one company is not a choice, so it is offered from two.
  const companyFilter: FilterConfig[] =
    grouped && options.companies.length > 1
      ? [{ param: "company", label: "Company", options: options.companies.map((company) => ({ value: company.id, label: company.name })) }]
      : [];

  const filters: FilterConfig[] = [
    ...companyFilter,
    {
      param: "stage",
      label: "Stage",
      options: OPPORTUNITY_STAGE_VALUES.map((value) => ({
        value,
        label: opportunityStageLabels[value],
      })),
    },
    {
      param: "outcome",
      label: "Outcome",
      options: OPPORTUNITY_OUTCOMES.map((value) => ({ value, label: OUTCOME_LABELS[value] })),
    },
    // Drawn from the opportunities this reader can already see (PRD #17 §222).
    {
      param: "owner",
      label: "Owner",
      options: options.owners.map((owner) => ({
        value: owner.memberId,
        label: `${owner.active ? owner.fullName : `${owner.fullName} (inactive)`}${owner.company ? ` · ${owner.company}` : ""}`,
      })),
    },
    {
      param: "clientId",
      label: "Client",
      options: options.clients.map((client) => ({ value: client.id, label: client.company ? `${client.name} · ${client.company}` : client.name })),
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

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `/sales/opportunities?${search}` : "/sales/opportunities";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListToolbar
          searchPlaceholder="Search opportunity, client, owner…"
          filters={filters}
          sortOptions={[
            { value: "updated-desc", label: "Recently updated" },
            { value: "close-asc", label: "Closing soonest" },
            { value: "value-desc", label: "Highest value" },
            { value: "weighted-desc", label: "Highest weighted" },
            { value: "probability-desc", label: "Most likely" },
            { value: "stage-asc", label: "Stage" },
            { value: "name-asc", label: "Name A–Z" },
          ]}
          className="flex-1"
        />
        <Button asChild variant={query.mine ? "primary" : "secondary"} size="sm">
          <Link href={query.mine ? "/sales/opportunities" : "/sales/opportunities?mine=1"}>
            {query.mine ? "All deals" : "Only mine"}
          </Link>
        </Button>
      </div>

      {result.data.length === 0 ? (
        hasFilters || query.mine ? (
          <EmptyState
            icon={<Target />}
            title="No Sales records match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/sales/opportunities" }}
          />
        ) : grouped ? (
          // Nothing to read is not an error in the group (Workspace Context §76).
          <EmptyState
            icon={<Target />}
            title="No accessible data for this module."
            description="None of the companies you can open holds opportunities you may read."
          />
        ) : (
          <EmptyState
            icon={<Target />}
            title="No opportunities yet."
            description="Deals your company is pursuing appear here."
            action={
              can(context, "sales.opportunity.create")
                ? { label: "New opportunity", href: "/sales/opportunities/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <OpportunityTable opportunities={result.data} grouped={grouped} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
