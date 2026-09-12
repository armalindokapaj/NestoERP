import { Scale } from "lucide-react";

import { ContractTable } from "@/components/contracts/contract-table";
import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { parseContractQuery } from "@/lib/modules/contracts/contract.query";
import {
  CONTRACT_TYPES,
  RENEWAL_TYPES,
  contractTypeLabels,
  type ContractView,
} from "@/lib/modules/contracts/contracts/contract.schema";
import {
  CONTRACT_STATUSES,
  contractStatusLabels,
  renewalTypeLabels,
} from "@/lib/modules/contracts/contracts/contract.status";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { canSeeCommercial } from "@/lib/modules/contracts/contract.dto";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The contract list, shared by every view (PRD #18 §81–§93).
 *
 * The named views are the same list with a different default filter, which is
 * why there is one component rather than eight: `/contracts/drafts` and
 * `/contracts/all?status=DRAFT` must not be able to disagree.
 *
 * The value filters are absent for a reader without commercial permission. A
 * range filter over a hidden figure is a way to find out what it is
 * (PRD #18 §298).
 */
export async function ContractList({
  context,
  searchParams,
  view,
  basePath,
  emptyTitle,
  emptyDescription,
}: {
  context: UserContext;
  searchParams: SearchParams;
  view: ContractView;
  basePath: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const query = parseContractQuery(searchParams, { view });

  const [result, options] = await Promise.all([
    contracts.listContracts(context, query),
    contracts.contractFilterOptions(context),
  ]);

  const commercial = canSeeCommercial(context);

  const hasFilters = Boolean(
    query.search ||
      query.status?.length ||
      query.contractType?.length ||
      query.renewalType?.length ||
      query.clientId ||
      query.projectId ||
      query.ownerMemberId ||
      query.currency,
  );

  const filters: FilterConfig[] = [
    ...(view === "all"
      ? [
          {
            param: "status",
            label: "Status",
            options: CONTRACT_STATUSES.filter((status) => status !== "ARCHIVED").map((value) => ({
              value,
              label: contractStatusLabels[value],
            })),
          },
        ]
      : []),
    {
      param: "type",
      label: "Type",
      options: CONTRACT_TYPES.map((value) => ({ value, label: contractTypeLabels[value] })),
    },
    ...(options.clients.length > 0
      ? [
          {
            param: "clientId",
            label: "Client",
            options: options.clients.map((client) => ({ value: client.id, label: client.name })),
          },
        ]
      : []),
    ...(options.projects.length > 0
      ? [
          {
            param: "projectId",
            label: "Project",
            options: options.projects.map((project) => ({
              value: project.id,
              label: `${project.code} — ${project.name}`,
            })),
          },
        ]
      : []),
    ...(options.owners.length > 1
      ? [
          {
            param: "owner",
            label: "Owner",
            options: options.owners.map((owner) => ({
              value: owner.id,
              label: `${owner.user.firstName} ${owner.user.lastName}`,
            })),
          },
        ]
      : []),
    {
      param: "renewal",
      label: "Renewal",
      options: RENEWAL_TYPES.map((value) => ({ value, label: renewalTypeLabels[value] })),
    },
    ...(commercial && options.currencies.length > 1
      ? [
          {
            param: "currency",
            label: "Currency",
            options: options.currencies.map((code) => ({ value: code, label: code })),
          },
        ]
      : []),
    ...(view === "expiring"
      ? [
          {
            param: "within",
            label: "Within",
            options: [
              { value: "30", label: "30 days" },
              { value: "60", label: "60 days" },
              { value: "90", label: "90 days" },
              { value: "180", label: "180 days" },
            ],
          },
        ]
      : []),
  ];

  const sortOptions = [
    { value: "updated-desc", label: "Recently updated" },
    { value: "created-desc", label: "Recently created" },
    { value: "number-asc", label: "Contract number" },
    { value: "title-asc", label: "Title A–Z" },
    { value: "effective-desc", label: "Effective date" },
    { value: "expiry-asc", label: "Expiry soonest" },
    ...(commercial ? [{ value: "value-desc", label: "Value high–low" }] : []),
    { value: "status-asc", label: "Status" },
  ];

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search number, title, counterparty…"
        filters={filters}
        sortOptions={sortOptions}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Scale />}
            title="No contracts match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: basePath }}
          />
        ) : (
          <EmptyState
            icon={<Scale />}
            title={emptyTitle}
            description={emptyDescription}
            action={
              can(context, "legal.contract.create")
                ? { label: "New contract", href: "/contracts/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <ContractTable contracts={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
