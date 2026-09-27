import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { CalendarCheck } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { AttendanceTable } from "@/components/hr/attendance-table";
import { DateRangeFilter } from "@/components/hr/date-range-filter";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import { parseAttendanceQuery } from "@/lib/modules/hr/hr.query";
import { ATTENDANCE_SORT_KEYS, ATTENDANCE_STATUSES } from "@/lib/modules/hr/hr.schema";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The attendance list (PRD #16 §114, §115).
 *
 * "Exceptions" is a query rather than a filter applied in memory — an absence,
 * or a day somebody checked in and never checked out — so paging stays honest.
 */
export async function AttendanceList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const query = parseAttendanceQuery(searchParams);
  const result = await attendance.listAttendance(context, query);
  const t = await getTranslations("hr");

  const seesOthers = can(context, "hr.attendance.view");
  const hasFilters = Boolean(
    query.search || query.status?.length || query.from || query.to || query.exceptionsOnly,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: t("columns.status"),
      options: ATTENDANCE_STATUSES.map((value) => ({
        value,
        label: hrLabel(t, "attendanceStatus", value),
      })),
    },
  ];

  function withParam(key: string, value: string | null) {
    const params = new URLSearchParams();
    for (const [param, entry] of Object.entries(searchParams)) {
      if (typeof entry === "string" && param !== key && param !== "page") params.set(param, entry);
    }
    if (value) params.set(key, value);
    const search = params.toString();
    return search ? `/hr/attendance?${search}` : "/hr/attendance";
  }

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/hr/attendance", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/hr/attendance", searchParams, page);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListToolbar
          searchPlaceholder={t("common.searchEmployee")}
          filters={filters}
          sortOptions={[
            { value: "date-desc", label: t("attendance.sort.newest") },
            { value: "date-asc", label: t("attendance.sort.oldest") },
          ]}
          className="flex-1"
        />
        <Button
          asChild
          variant={query.exceptionsOnly ? "primary" : "secondary"}
          size="sm"
        >
          <Link href={withParam("exceptions", query.exceptionsOnly ? null : "1")}>
            {query.exceptionsOnly ? t("attendance.allDays") : t("attendance.exceptions")}
          </Link>
        </Button>
        {seesOthers ? (
          <Button asChild variant={query.mine ? "primary" : "secondary"} size="sm">
            <Link href={withParam("mine", query.mine ? null : "1")}>
              {query.mine ? t("attendance.everyone") : t("leave.onlyMine")}
            </Link>
          </Button>
        ) : null}
      </div>

      <DateRangeFilter label={t("attendance.days")} basePath="/hr/attendance" />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<CalendarCheck />}
            title={t("employees.noMatchTitle")}
            description={t("common.adjustFilters")}
            action={{ label: t("common.clearFilters"), href: "/hr/attendance" }}
          />
        ) : (
          <EmptyState
            icon={<CalendarCheck />}
            title={t("attendance.emptyPeriodTitle")}
            description={t("attendance.emptyDescription")}
            action={
              can(context, "hr.attendance.create") || can(context, "hr.self.attendance")
                ? { label: t("attendance.recordDay"), href: "/hr/attendance/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <AttendanceTable records={result.data} showEmployee={seesOthers && !query.mine} sort={{ value: query.sort, keys: ATTENDANCE_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
