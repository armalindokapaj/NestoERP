import { FileText } from "lucide-react";
import { redirect } from "next/navigation";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { getTranslations } from "@/lib/i18n/server";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
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
  const t = await getTranslations("sales");

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
      label: t("lists.status"),
      options: PROPOSAL_STATUSES.filter((status) => status !== "ARCHIVED").map((value) => ({
        value,
        label: salesLabel(t, "proposalStatus", value, proposalStatusLabels[value]),
      })),
    },
    {
      param: "clientId",
      label: t("lists.client"),
      options: options.clients.map((client) => ({ value: client.id, label: client.name })),
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
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/sales/proposals", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/sales/proposals", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("lists.searchProposals")}
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: t("lists.recentlyUpdated") },
          { value: "number-asc", label: t("lists.numberAz") },
          { value: "amount-desc", label: t("lists.highestTotal") },
          { value: "valid-asc", label: t("lists.expiringSoonest") },
          { value: "status-asc", label: t("lists.status") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<FileText />}
            title={t("lists.noMatchTitle")}
            description={t("lists.noMatchDescription")}
            action={{ label: t("lists.clearFilters"), href: "/sales/proposals" }}
          />
        ) : (
          <EmptyState
            icon={<FileText />}
            title={t("lists.noProposalsTitle")}
            description={t("lists.noProposalsDescription")}
            action={
              can(context, "sales.proposal.create")
                ? { label: t("lists.newProposal"), href: "/sales/proposals/new" }
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
