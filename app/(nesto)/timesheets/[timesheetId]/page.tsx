import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { TimesheetReview } from "@/components/timesheets/timesheet-review";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getTimesheet } from "@/lib/modules/timesheets/timesheet.service";
import { weekLabel } from "@/lib/modules/timesheets/timesheet.time";

type Params = { params: Promise<{ timesheetId: string }> };

async function load(timesheetId: string) {
  const context = await requireModule("timesheets");
  try {
    return await getTimesheet(context, timesheetId);
  } catch (error) {
    if (error instanceof AccessError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { timesheetId } = await params;
  try {
    const week = await load(timesheetId);
    return { title: `Timesheet · ${week.member.name} · ${weekLabel(week.periodStart)}` };
  } catch {
    return { title: "Timesheet" };
  }
}

/**
 * One week, for its member, its approver and team readers (PRD #42 §79,
 * §107-§109, §117-§125). Anybody else is told it does not exist (§231).
 */
export default async function TimesheetPage({ params }: Params) {
  const { timesheetId } = await params;
  const week = await load(timesheetId);
  return <TimesheetReview week={week} discussion={<CollaborationPanel key="discussion" parentType="timesheet" parentId={timesheetId} />} />;
}
