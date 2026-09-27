import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Target } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { getTranslations } from "@/lib/i18n/server";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
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
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

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
  const t = await getTranslations("sales");
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
      ? [{ param: "company", label: t("lists.company"), options: options.companies.map((company) => ({ value: company.id, label: company.name })) }]
      : [];

  const filters: FilterConfig[] = [
    ...companyFilter,
    {
      param: "stage",
      label: t("lists.stage"),
      options: OPPORTUNITY_STAGE_VALUES.map((value) => ({
        value,
        label: salesLabel(t, "stage", value, opportunityStageLabels[value]),
      })),
    },
    {
      param: "outcome",
      label: t("lists.outcome"),
      options: OPPORTUNITY_OUTCOMES.map((value) => ({ value, label: salesLabel(t, "outcome", value, OUTCOME_LABELS[value]) })),
    },
    // Drawn from the opportunities this reader can already see (PRD #17 §222).
    {
      param: "owner",
      label: t("lists.owner"),
      options: options.owners.map((owner) => ({
        value: owner.memberId,
        label: `${owner.active ? owner.fullName : t("lists.inactive", { name: owner.fullName })}${owner.company ? ` · ${owner.company}` : ""}`,
      })),
    },
    {
      param: "clientId",
      label: t("lists.client"),
      options: options.clients.map((client) => ({ value: client.id, label: client.company ? `${client.name} · ${client.company}` : client.name })),
    },
    ...(options.currencies.length > 1
      ? [
          {
            param: "currency",
            label: t("lists.currency"),
            options: options.currencies.map((code) => ({ value: code, label: code })),
          },
        ]
      : []),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/sales/opportunities", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/sales/opportunities", searchParams, page);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListToolbar
          searchPlaceholder={t("lists.searchOpportunities")}
          filters={filters}
          sortOptions={[
            { value: "updated-desc", label: t("lists.recentlyUpdated") },
            { value: "close-asc", label: t("lists.closingSoonest") },
            { value: "value-desc", label: t("lists.highestValue") },
            { value: "weighted-desc", label: t("lists.highestWeighted") },
            { value: "probability-desc", label: t("lists.mostLikely") },
            { value: "stage-asc", label: t("lists.stage") },
            { value: "name-asc", label: t("lists.nameAz") },
          ]}
          className="flex-1"
        />
        <Button asChild variant={query.mine ? "primary" : "secondary"} size="sm">
          <Link href={query.mine ? "/sales/opportunities" : "/sales/opportunities?mine=1"}>
            {query.mine ? t("lists.allDeals") : t("lists.onlyMine")}
          </Link>
        </Button>
      </div>

      {result.data.length === 0 ? (
        hasFilters || query.mine ? (
          <EmptyState
            icon={<Target />}
            title={t("lists.noMatchTitle")}
            description={t("lists.noMatchDescription")}
            action={{ label: t("lists.clearFilters"), href: "/sales/opportunities" }}
          />
        ) : grouped ? (
          // Nothing to read is not an error in the group (Workspace Context §76).
          <EmptyState
            icon={<Target />}
            title={t("lists.noAccessTitle")}
            description={t("lists.noAccessOpportunities")}
          />
        ) : (
          <EmptyState
            icon={<Target />}
            title={t("lists.noOpportunitiesTitle")}
            description={t("lists.noOpportunitiesDescription")}
            action={
              can(context, "sales.opportunity.create")
                ? { label: t("lists.newOpportunity"), href: "/sales/opportunities/new" }
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
