import { redirect } from "next/navigation";
import { Users } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ClientTable } from "@/components/clients/client-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { parseClientListQuery, type ClientQueryDefaults } from "@/lib/modules/clients/client.query";
import { clientFilterOptions } from "@/lib/modules/clients/client.repository";
import { CLIENT_SORT_KEYS } from "@/lib/modules/clients/client.schema";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { clearListFilters } from "@/lib/tables/list-url";
import * as clients from "@/lib/modules/clients/client.service";

type SearchParams = Record<string, string | string[] | undefined>;

export type ClientListVariant = "all" | "active" | "archived";

const VARIANT_DEFAULTS: Record<ClientListVariant, ClientQueryDefaults> = {
  all: {},
  active: { status: ["ACTIVE"] },
  archived: { archived: true },
};

/**
 * The shared list body behind All Clients, Active and Archived
 * (PRD #12 §24–§27).
 *
 * The three sections differ by their query defaults, not by three
 * implementations — scope, search, filters, sort and pagination are identical.
 */
export async function ClientsList({
  context,
  searchParams,
  variant,
  basePath,
}: {
  context: UserContext;
  searchParams: SearchParams;
  variant: ClientListVariant;
  basePath: string;
}) {
  const query = parseClientListQuery(searchParams, VARIANT_DEFAULTS[variant]);

  const [result, options] = await Promise.all([
    clients.listClients(context, query),
    clientFilterOptions(context),
  ]);
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, searchParams, result.pagination.page));

  const hasFilters = Boolean(
    query.search ||
      query.type?.length ||
      query.country ||
      query.projectId ||
      query.hasActiveProject !== undefined ||
      (query.status?.length && variant !== "active"),
  );

  const filters: FilterConfig[] = [
    {
      param: "type",
      label: "Type",
      options: [
        { value: "COMPANY", label: "Company" },
        { value: "INDIVIDUAL", label: "Individual" },
        { value: "PUBLIC_ENTITY", label: "Public Entity" },
        { value: "OTHER", label: "Other" },
      ],
    },
    ...(variant === "active" || variant === "archived"
      ? []
      : [
          {
            param: "status",
            label: "Status",
            options: [
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ],
          },
        ]),
    // Country and project options come from the scoped client and project
    // graphs, so a dropdown can never name a record the user may not open
    // (PRD #12 §35, §297).
    {
      param: "country",
      label: "Country",
      options: options.countries.map((country) => ({ value: country, label: country })),
    },
    {
      param: "projectId",
      label: "Project",
      options: options.projects.map((project) => ({ value: project.id, label: project.name })),
    },
    {
      param: "hasActiveProject",
      label: "Active project",
      options: [
        { value: "yes", label: "Has an active project" },
        { value: "no", label: "No active project" },
      ],
    },
  ];

  const buildHref = (page: number) => pageHref(basePath, searchParams, page);
  // Clear filters drops only this list's filter and search keys; the sort and
  // any other route key stay (AUD-08 §3).
  const cleared = clearListFilters(pageHref("", searchParams, 1).slice(1), ["search", "type", "status", "country", "projectId", "hasActiveProject"]);
  const clearHref = cleared ? `${basePath}?${cleared}` : basePath;

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search clients…"
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "created-desc", label: "Recently created" },
          { value: "name-asc", label: "Name A–Z" },
          { value: "name-desc", label: "Name Z–A" },
          { value: "projects-desc", label: "Active projects" },
          { value: "type-asc", label: "Type" },
          { value: "status-asc", label: "Status" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Users />}
            title="No clients match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: clearHref }}
          />
        ) : (
          <EmptyState
            icon={<Users />}
            title={EMPTY_TITLE[variant]}
            description={EMPTY_DESCRIPTION[variant]}
            action={
              variant !== "archived" && can(context, "client.create")
                ? { label: "New client", href: "/clients/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <ClientTable clients={result.data} sort={{ value: query.sort, keys: CLIENT_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}

/** Empty-state copy from PRD #12 §190–§194. */
const EMPTY_TITLE: Record<ClientListVariant, string> = {
  all: "No clients yet.",
  active: "No active clients.",
  archived: "No archived clients.",
};

const EMPTY_DESCRIPTION: Record<ClientListVariant, string> = {
  all: "Clients added to your company will appear here.",
  active: "Clients you work with will appear here.",
  archived: "Clients removed from active lists will appear here.",
};
