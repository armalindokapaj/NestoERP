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
import { clientsLabel } from "@/lib/i18n/modules/clients/labels";
import { getTranslations } from "@/lib/i18n/server";

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
  const t = await getTranslations("clients");
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
      label: t("list.type"),
      options: [
        { value: "COMPANY", label: clientsLabel(t, "clientType", "COMPANY", "Company") },
        { value: "INDIVIDUAL", label: clientsLabel(t, "clientType", "INDIVIDUAL", "Individual") },
        { value: "PUBLIC_ENTITY", label: clientsLabel(t, "clientType", "PUBLIC_ENTITY", "Public Entity") },
        { value: "OTHER", label: clientsLabel(t, "clientType", "OTHER", "Other") },
      ],
    },
    ...(variant === "active" || variant === "archived"
      ? []
      : [
          {
            param: "status",
            label: t("list.status"),
            options: [
              { value: "ACTIVE", label: clientsLabel(t, "status", "ACTIVE", "Active") },
              { value: "INACTIVE", label: clientsLabel(t, "status", "INACTIVE", "Inactive") },
            ],
          },
        ]),
    // Country and project options come from the scoped client and project
    // graphs, so a dropdown can never name a record the user may not open
    // (PRD #12 §35, §297).
    {
      param: "country",
      label: t("list.country"),
      options: options.countries.map((country) => ({ value: country, label: country })),
    },
    {
      param: "projectId",
      label: t("list.project"),
      options: options.projects.map((project) => ({ value: project.id, label: project.name })),
    },
    {
      param: "hasActiveProject",
      label: t("list.activeProject"),
      options: [
        { value: "yes", label: t("list.hasActiveProject") },
        { value: "no", label: t("list.noActiveProject") },
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
        searchPlaceholder={t("list.search")}
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: t("list.sortUpdated") },
          { value: "created-desc", label: t("list.sortCreated") },
          { value: "name-asc", label: t("list.sortNameAsc") },
          { value: "name-desc", label: t("list.sortNameDesc") },
          { value: "projects-desc", label: t("list.sortProjects") },
          { value: "type-asc", label: t("list.sortType") },
          { value: "status-asc", label: t("list.sortStatus") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Users />}
            title={t("list.noMatchTitle")}
            description={t("list.noMatchDescription")}
            action={{ label: t("list.clearFilters"), href: clearHref }}
          />
        ) : (
          <EmptyState
            icon={<Users />}
            title={t(EMPTY_TITLE[variant])}
            description={t(EMPTY_DESCRIPTION[variant])}
            action={
              variant !== "archived" && can(context, "client.create")
                ? { label: t("common.newClient"), href: "/clients/new" }
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
const EMPTY_TITLE = {
  all: "list.emptyAll",
  active: "list.emptyActive",
  archived: "list.emptyArchived",
} as const satisfies Record<ClientListVariant, string>;

const EMPTY_DESCRIPTION = {
  all: "list.emptyAllDescription",
  active: "list.emptyActiveDescription",
  archived: "list.emptyArchivedDescription",
} as const satisfies Record<ClientListVariant, string>;
