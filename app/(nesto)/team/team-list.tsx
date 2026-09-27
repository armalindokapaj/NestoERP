import { UsersRound } from "lucide-react";
import { redirect } from "next/navigation";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { TeamTable } from "@/components/team/team-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
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
  const query = parseTeamListQuery(searchParams, VARIANT_DEFAULTS[variant]);

  const [result, options] = await Promise.all([
    team.listMembers(context, query),
    teamFilterOptions(context),
  ]);

  const hasFilters = Boolean(query.search || query.roleId || query.departmentId);

  const filters: FilterConfig[] = [
    // Role and department options come from the members this reader can
    // already see, so a dropdown never names somebody's department that they
    // have no access to (PRD #14 §52, §221).
    {
      param: "roleId",
      label: "Role",
      options: options.roles.map((role) => ({ value: role.id, label: role.name })),
    },
    {
      param: "departmentId",
      label: "Department",
      options: options.departments.map((department) => ({
        value: department.id,
        label: department.name,
      })),
    },
    ...(variant === "people"
      ? [
          {
            param: "status",
            label: "Status",
            options: [
              { value: "ACTIVE", label: "Active" },
              { value: "INVITED", label: "Invited" },
            ],
          },
        ]
      : [
          {
            param: "status",
            label: "Status",
            options: [
              { value: "INACTIVE", label: "Inactive" },
              { value: "SUSPENDED", label: "Suspended" },
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
        searchPlaceholder="Search name, email or job title…"
        filters={filters}
        sortOptions={[
          { value: "name-asc", label: "Name A–Z" },
          { value: "name-desc", label: "Name Z–A" },
          { value: "role-asc", label: "Role" },
          { value: "department-asc", label: "Department" },
          { value: "created-desc", label: "Recently added" },
          { value: "updated-desc", label: "Recently updated" },
          ...(showLastLogin ? [{ value: "last-login-desc", label: "Last login" }] : []),
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<UsersRound />}
            title="No people match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: basePath }}
          />
        ) : (
          <EmptyState
            icon={<UsersRound />}
            title={variant === "people" ? "No team members yet." : "Nobody is inactive."}
            description={
              variant === "people"
                ? "Invite someone to give them access to this workspace."
                : "Everyone in your view still has access."
            }
            action={
              variant === "people" && can(context, "team.member.invite")
                ? { label: "Invite member", href: "/team/invite" }
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
