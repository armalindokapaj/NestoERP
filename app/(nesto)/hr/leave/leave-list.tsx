import { CalendarDays } from "lucide-react";
import { redirect } from "next/navigation";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { DateRangeFilter } from "@/components/hr/date-range-filter";
import { LeaveTable } from "@/components/hr/leave-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "@/components/navigation/nav-link";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { parseLeaveQuery } from "@/lib/modules/hr/hr.query";
import { LEAVE_SORT_KEYS, LEAVE_STATUSES, LEAVE_TYPES } from "@/lib/modules/hr/hr.schema";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

type SearchParams = Record<string, string | string[] | undefined>;

/** The leave list (PRD #16 §73, §307). */
export async function LeaveList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const query = parseLeaveQuery(searchParams);
  const result = await leave.listLeave(context, query);
  const t = await getTranslations("hr");

  const seesOthers = can(context, "hr.leave.view");
  const mineOnly = query.mine;

  const hasFilters = Boolean(
    query.search || query.status?.length || query.leaveType?.length || query.from || query.to,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: t("columns.status"),
      options: LEAVE_STATUSES.map((value) => ({ value, label: hrLabel(t, "leaveStatus", value) })),
    },
    {
      param: "leaveType",
      label: t("columns.type"),
      options: LEAVE_TYPES.map((value) => ({ value, label: hrLabel(t, "leaveType", value) })),
    },
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/hr/leave", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/hr/leave", searchParams, page);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListToolbar
          searchPlaceholder={t("common.searchEmployee")}
          filters={filters}
          sortOptions={[
            { value: "start-desc", label: t("leave.sort.latest") },
            { value: "start-asc", label: t("leave.sort.earliest") },
            { value: "created-desc", label: t("leave.sort.recent") },
            { value: "days-desc", label: t("leave.sort.longest") },
          ]}
          className="flex-1"
        />
        {seesOthers ? (
          <Button asChild variant={mineOnly ? "primary" : "secondary"} size="sm">
            <Link href={mineOnly ? "/hr/leave" : "/hr/leave?mine=1"}>
              {mineOnly ? t("leave.allLeave") : t("leave.onlyMine")}
            </Link>
          </Button>
        ) : null}
      </div>

      {/* A date window over the list, which is what V0.1 requires instead of a
          calendar view (PRD #16 §94). */}
      <DateRangeFilter label={t("leave.off")} basePath="/hr/leave" />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<CalendarDays />}
            title={t("employees.noMatchTitle")}
            description={t("common.adjustFilters")}
            action={{ label: t("common.clearFilters"), href: "/hr/leave" }}
          />
        ) : (
          <EmptyState
            icon={<CalendarDays />}
            title={t("leave.noRequests")}
            description={
              seesOthers
                ? t("leave.emptyOthers")
                : t("leave.emptySelf")
            }
            action={
              can(context, "hr.leave.create") || can(context, "hr.self.leave")
                ? { label: t("leave.requestLeave"), href: "/hr/leave/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <LeaveTable requests={result.data} showEmployee={seesOthers && !mineOnly} sort={{ value: query.sort, keys: LEAVE_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
