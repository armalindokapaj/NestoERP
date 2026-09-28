import { UsersRound } from "lucide-react";
import { redirect } from "next/navigation";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { TeamTable } from "@/components/team/team-table";
import { EmptyState, hasActiveFilters } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import { parseTeamListQuery, type TeamQueryDefaults } from "@/lib/modules/team/team.query";
import { teamFilterOptions } from "@/lib/modules/team/team.repository";
import * as team from "@/lib/modules/team/team.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { TEAM_SORT_KEYS } from "@/lib/modules/team/team.schema";

type SearchParams = Record<string, string | string[] | undefined>;

export type TeamListVariant = "people" | "inactive";

/**
 * People lists the company's working directory; Inactive is the same list
 * narrowed to the people who no longer have access (PRD #14 §32, §36).
 */
const VARIANT_DEFAULTS: Record<TeamListVariant, TeamQueryDefaults> = {
  people: { status: ["ACTIVE", "INVITED"] },
  inactive: { status: ["INACTIVE", "SUSPENDED"], sort: "updated-desc" },
};

/**
 * The shared list body behind People and Inactive (PRD #14 §32–§39).
 *
 * Scope, search, filters, sort and pagination are identical; only the default
 * status filter differs, which is why there is one implementation rather than
 * two.
 */
export async function TeamList({
  context,
  searchParams,
  variant,
  basePath,
}: {
  context: UserContext;
  searchParams: SearchParams;
  variant: TeamListVariant;
  basePath: string;
}) {
  const t = await getTranslations("team");
  const query = parseTeamListQuery(searchParams, VARIANT_DEFAULTS[variant]);

  const [result, options] = await Promise.all([
    team.listMembers(context, query),
    teamFilterOptions(context),
  ]);

  // A status chosen in the URL narrows the list; the variant's default does not (AUD-05 §6, UX-11).
  const hasFilters = Boolean(query.search || query.roleId || query.departmentId || hasActiveFilters(searchParams, ["status"]));

  const filters: FilterConfig[] = [
    // Role and department options come from the members this reader can
    // already see, so a dropdown never names somebody's department that they
    // have no access to (PRD #14 §52, §221).
    {
      param: "roleId",
      label: t("list.role"),
      options: options.roles.map((role) => ({ value: role.id, label: role.name })),
    },
    {
      param: "departmentId",
      label: t("list.department"),
      options: options.departments.map((department) => ({
        value: department.id,
        label: department.name,
      })),
    },
    ...(variant === "people"
      ? [
          {
            param: "status",
            label: t("list.status"),
            options: [
              { value: "ACTIVE", label: t("list.active") },
              { value: "INVITED", label: t("list.invited") },
            ],
          },
        ]
      : [
          {
            param: "status",
            label: t("list.status"),
            options: [
              { value: "INACTIVE", label: t("list.inactive") },
              { value: "SUSPENDED", label: t("list.suspended") },
            ],
          },
        ]),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref(basePath, searchParams, page);

  const showLastLogin = can(context, "team.member.security_metadata.view");

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("list.searchPlaceholder")}
        filters={filters}
        sortOptions={[
          { value: "name-asc", label: t("list.sortNameAsc") },
          { value: "name-desc", label: t("list.sortNameDesc") },
          { value: "role-asc", label: t("list.sortRole") },
          { value: "department-asc", label: t("list.sortDepartment") },
          { value: "created-desc", label: t("list.sortCreated") },
          { value: "updated-desc", label: t("list.sortUpdated") },
          ...(showLastLogin ? [{ value: "last-login-desc", label: t("list.sortLastLogin") }] : []),
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<UsersRound />}
            title={t("list.noMatchTitle")}
            description={t("list.noMatchDescription")}
            action={{ label: t("list.clearFilters"), href: basePath }}
          />
        ) : (
          <EmptyState
            icon={<UsersRound />}
            title={variant === "people" ? t("overview.emptyTitle") : t("list.nobodyInactive")}
            description={
              variant === "people"
                ? t("overview.emptyDescription")
                : t("list.everyoneHasAccess")
            }
            action={
              variant === "people" && can(context, "team.member.invite")
                ? { label: t("overview.inviteMember"), href: "/team/invite" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <TeamTable members={result.data} showLastLogin={showLastLogin} sort={{ value: query.sort, keys: TEAM_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
