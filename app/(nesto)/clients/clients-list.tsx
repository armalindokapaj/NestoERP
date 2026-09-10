import { Users } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ClientTable } from "@/components/clients/client-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { parseClientListQuery, type ClientQueryDefaults } from "@/lib/modules/clients/client.query";
import { clientFilterOptions } from "@/lib/modules/clients/client.repository";
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
            action={{ label: "Clear filters", href: basePath }}
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
          <ClientTable clients={result.data} />
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
