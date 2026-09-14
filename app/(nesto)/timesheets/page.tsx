import type { Metadata } from "next";

import { ModulePage } from "@/components/modules/module-page";
import { TimesheetWeek } from "@/components/timesheets/timesheet-week";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { isLocalDate } from "@/lib/modules/calendar/calendar.time";
import { getMyWeek, timesheetFormOptions } from "@/lib/modules/timesheets/timesheet.service";

export const metadata: Metadata = { title: "My Timesheet" };

/** The signed-in member's week — this week unless another is asked for (PRD #42 §5, §43, §57). */
export default async function MyTimesheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("timesheets");
  const experience = resolveModuleExperience(context, "timesheets");
  const params = await searchParams;
  const requested = typeof params.week === "string" && isLocalDate(params.week) ? params.week : undefined;
  const [week, options] = await Promise.all([getMyWeek(context, { week: requested }), timesheetFormOptions(context)]);

  return (
    <ModulePage experience={experience} activeSection="me" description="Log where your working time goes, then submit the week for approval.">
      <TimesheetWeek key={week.periodStart} initial={week} options={options} />
    </ModulePage>
  );
}
