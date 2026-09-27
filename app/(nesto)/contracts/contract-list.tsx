import { Scale } from "lucide-react";
import { redirect } from "next/navigation";

import { ContractTable } from "@/components/contracts/contract-table";
import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmptyState, hasActiveFilters } from "@/components/ui/empty-state";
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
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { contractsLabel } from "@/lib/i18n/modules/contracts/labels";
import { getTranslations } from "@/lib/i18n/server";

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
  const t = await getTranslations("contracts");
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
      query.currency ||
      // "Within N days" on the expiring view narrows too (AUD-05 §6, UX-11).
      hasActiveFilters(searchParams, ["within"]),
  );

  const filters: FilterConfig[] = [
    ...(view === "all"
      ? [
          {
            param: "status",
            label: t("list.status"),
            options: CONTRACT_STATUSES.filter((status) => status !== "ARCHIVED").map((value) => ({
              value,
              label: contractsLabel(t, "contractStatus", value, contractStatusLabels[value]),
            })),
          },
        ]
      : []),
    {
      param: "type",
      label: t("list.type"),
      options: CONTRACT_TYPES.map((value) => ({ value, label: contractsLabel(t, "contractType", value, contractTypeLabels[value]) })),
    },
    ...(options.clients.length > 0
      ? [
          {
            param: "clientId",
            label: t("list.client"),
            options: options.clients.map((client) => ({ value: client.id, label: client.name })),
          },
        ]
      : []),
    ...(options.projects.length > 0
      ? [
          {
            param: "projectId",
            label: t("list.project"),
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
            label: t("list.owner"),
            options: options.owners.map((owner) => ({
              value: owner.id,
              label: `${owner.user.firstName} ${owner.user.lastName}`,
            })),
          },
        ]
      : []),
    {
      param: "renewal",
      label: t("list.renewal"),
      options: RENEWAL_TYPES.map((value) => ({ value, label: contractsLabel(t, "renewalType", value, renewalTypeLabels[value]) })),
    },
    ...(commercial && options.currencies.length > 1
      ? [
          {
            param: "currency",
            label: t("list.currency"),
            options: options.currencies.map((code) => ({ value: code, label: code })),
          },
        ]
      : []),
    ...(view === "expiring"
      ? [
          {
            param: "within",
            label: t("list.within"),
            options: [
              { value: "30", label: t("list.days", { count: 30 }) },
              { value: "60", label: t("list.days", { count: 60 }) },
              { value: "90", label: t("list.days", { count: 90 }) },
              { value: "180", label: t("list.days", { count: 180 }) },
            ],
          },
        ]
      : []),
  ];

  const sortOptions = [
    { value: "updated-desc", label: t("list.sortUpdated") },
    { value: "created-desc", label: t("list.sortCreated") },
    { value: "number-asc", label: t("list.sortNumber") },
    { value: "title-asc", label: t("list.sortTitle") },
    { value: "effective-desc", label: t("list.sortEffective") },
    { value: "expiry-asc", label: t("list.sortExpiry") },
    ...(commercial ? [{ value: "value-desc", label: t("list.sortValue") }] : []),
    { value: "status-asc", label: t("list.sortStatus") },
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref(basePath, searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("list.searchPlaceholder")}
        filters={filters}
        sortOptions={sortOptions}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Scale />}
            title={t("list.noMatchTitle")}
            description={t("list.noMatchDescription")}
            action={{ label: t("list.clearFilters"), href: basePath }}
          />
        ) : (
          <EmptyState
            icon={<Scale />}
            title={emptyTitle}
            description={emptyDescription}
            action={
              can(context, "legal.contract.create")
                ? { label: t("common.newContract"), href: "/contracts/new" }
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
