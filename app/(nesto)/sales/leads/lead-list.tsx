import { UserPlus } from "lucide-react";
import { redirect } from "next/navigation";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { getTranslations } from "@/lib/i18n/server";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
import { LeadTable } from "@/components/sales/lead-table";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { LEAD_SOURCES, LEAD_STATUSES } from "@/lib/modules/sales/leads/lead.schema";
import { leadSourceLabels, leadStatusLabels } from "@/lib/modules/sales/leads/lead.status";
import * as leads from "@/lib/modules/sales/leads/lead.service";
import { parseLeadQuery } from "@/lib/modules/sales/sales.query";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

type SearchParams = Record<string, string | string[] | undefined>;

/** The lead list (PRD #17 §37–§39, §290, §291). */
export async function LeadList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const query = parseLeadQuery(searchParams);
  const t = await getTranslations("sales");
  const grouped = inGroupWorkspace(context);

  const [result, options] = await Promise.all([
    leads.listLeadsForWorkspace(context, query),
    leads.leadFilterOptionsForWorkspace(context, query.companyId),
  ]);

  const hasFilters = Boolean(
    query.search ||
      query.status?.length ||
      query.source?.length ||
      query.ownerMemberId ||
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
      param: "status",
      label: t("lists.status"),
      options: LEAD_STATUSES.filter((status) => status !== "ARCHIVED").map((value) => ({
        value,
        label: salesLabel(t, "leadStatus", value, leadStatusLabels[value]),
      })),
    },
    {
      param: "source",
      label: t("lists.source"),
      options: LEAD_SOURCES.map((value) => ({ value, label: salesLabel(t, "leadSource", value, leadSourceLabels[value]) })),
    },
    // Only owners who appear on leads this reader can already see: a filter
    // must not become a company directory (PRD #17 §222, §337).
    {
      param: "owner",
      label: t("lists.owner"),
      options: options.owners.map((owner) => ({
        value: owner.memberId,
        label: `${owner.active ? owner.fullName : t("lists.inactive", { name: owner.fullName })}${owner.company ? ` · ${owner.company}` : ""}`,
      })),
    },
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/sales/leads", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/sales/leads", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("lists.searchLeads")}
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: t("lists.recentlyUpdated") },
          { value: "created-desc", label: t("lists.recentlyCreated") },
          { value: "name-asc", label: t("lists.nameAz") },
          { value: "value-desc", label: t("lists.highestValue") },
          { value: "status-asc", label: t("lists.status") },
          { value: "owner-asc", label: t("lists.owner") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<UserPlus />}
            title={t("lists.noMatchTitle")}
            description={t("lists.noMatchDescription")}
            action={{ label: t("lists.clearFilters"), href: "/sales/leads" }}
          />
        ) : grouped ? (
          // Nothing to read is not an error in the group (Workspace Context §76).
          <EmptyState
            icon={<UserPlus />}
            title={t("lists.noAccessTitle")}
            description={t("lists.noAccessLeads")}
          />
        ) : (
          <EmptyState
            icon={<UserPlus />}
            title={t("lists.noLeadsTitle")}
            description={t("lists.noLeadsDescription")}
            action={
              can(context, "sales.lead.create")
                ? { label: t("lists.newLead"), href: "/sales/leads/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <LeadTable leads={result.data} grouped={grouped} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
