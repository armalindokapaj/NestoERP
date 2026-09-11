import { CalendarDays } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { DateRangeFilter } from "@/components/hr/date-range-filter";
import { LeaveTable } from "@/components/hr/leave-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { parseLeaveQuery } from "@/lib/modules/hr/hr.query";
import { LEAVE_STATUSES, LEAVE_TYPES } from "@/lib/modules/hr/hr.schema";
import { leaveStatusLabels, leaveTypeLabels } from "@/lib/modules/hr/hr.status";
import * as leave from "@/lib/modules/hr/leave/leave.service";

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

  const seesOthers = can(context, "hr.leave.view");
  const mineOnly = query.mine;

  const hasFilters = Boolean(
    query.search || query.status?.length || query.leaveType?.length || query.from || query.to,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: LEAVE_STATUSES.map((value) => ({ value, label: leaveStatusLabels[value] })),
    },
    {
      param: "leaveType",
      label: "Type",
      options: LEAVE_TYPES.map((value) => ({ value, label: leaveTypeLabels[value] })),
    },
  ];

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `/hr/leave?${search}` : "/hr/leave";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListToolbar
          searchPlaceholder="Search employee…"
          filters={filters}
          sortOptions={[
            { value: "start-desc", label: "Latest first" },
            { value: "start-asc", label: "Earliest first" },
            { value: "created-desc", label: "Recently requested" },
            { value: "days-desc", label: "Longest first" },
          ]}
          className="flex-1"
        />
        {seesOthers ? (
          <Button asChild variant={mineOnly ? "primary" : "secondary"} size="sm">
            <Link href={mineOnly ? "/hr/leave" : "/hr/leave?mine=1"}>
              {mineOnly ? "All leave" : "Only mine"}
            </Link>
          </Button>
        ) : null}
      </div>

      {/* A date window over the list, which is what V0.1 requires instead of a
          calendar view (PRD #16 §94). */}
      <DateRangeFilter label="Off" basePath="/hr/leave" />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<CalendarDays />}
            title="No HR records match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/hr/leave" }}
          />
        ) : (
          <EmptyState
            icon={<CalendarDays />}
            title="No leave requests."
            description={
              seesOthers
                ? "Requests from people in your view appear here."
                : "Leave you request appears here."
            }
            action={
              can(context, "hr.leave.create") || can(context, "hr.self.leave")
                ? { label: "Request leave", href: "/hr/leave/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <LeaveTable requests={result.data} showEmployee={seesOthers && !mineOnly} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
