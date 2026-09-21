import { UserPlus } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { LeadTable } from "@/components/sales/lead-table";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { LEAD_SOURCES, LEAD_STATUSES } from "@/lib/modules/sales/leads/lead.schema";
import { leadSourceLabels, leadStatusLabels } from "@/lib/modules/sales/leads/lead.status";
import * as leads from "@/lib/modules/sales/leads/lead.service";
import { parseLeadQuery } from "@/lib/modules/sales/sales.query";

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
      ? [{ param: "company", label: "Company", options: options.companies.map((company) => ({ value: company.id, label: company.name })) }]
      : [];

  const filters: FilterConfig[] = [
    ...companyFilter,
    {
      param: "status",
      label: "Status",
      options: LEAD_STATUSES.filter((status) => status !== "ARCHIVED").map((value) => ({
        value,
        label: leadStatusLabels[value],
      })),
    },
    {
      param: "source",
      label: "Source",
      options: LEAD_SOURCES.map((value) => ({ value, label: leadSourceLabels[value] })),
    },
    // Only owners who appear on leads this reader can already see: a filter
    // must not become a company directory (PRD #17 §222, §337).
    {
      param: "owner",
      label: "Owner",
      options: options.owners.map((owner) => ({
        value: owner.memberId,
        label: `${owner.active ? owner.fullName : `${owner.fullName} (inactive)`}${owner.company ? ` · ${owner.company}` : ""}`,
      })),
    },
  ];

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `/sales/leads?${search}` : "/sales/leads";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search name, company, email…"
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "created-desc", label: "Recently created" },
          { value: "name-asc", label: "Name A–Z" },
          { value: "value-desc", label: "Highest value" },
          { value: "status-asc", label: "Status" },
          { value: "owner-asc", label: "Owner" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<UserPlus />}
            title="No Sales records match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/sales/leads" }}
          />
        ) : grouped ? (
          // Nothing to read is not an error in the group (Workspace Context §76).
          <EmptyState
            icon={<UserPlus />}
            title="No accessible data for this module."
            description="None of the companies you can open holds leads you may read."
          />
        ) : (
          <EmptyState
            icon={<UserPlus />}
            title="No leads yet."
            description="People who get in touch, before they are qualified, appear here."
            action={
              can(context, "sales.lead.create")
                ? { label: "New lead", href: "/sales/leads/new" }
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
