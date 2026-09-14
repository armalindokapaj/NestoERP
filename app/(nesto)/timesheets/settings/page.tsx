import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { ApproverAssignments, TimesheetSettingsForm } from "@/components/timesheets/timesheet-settings-form";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { approverOptions, listApproverAssignments } from "@/lib/modules/timesheets/timesheet.approvers";
import { getTimesheetSettings } from "@/lib/modules/timesheets/timesheet.settings";

export const metadata: Metadata = { title: "Timesheet settings" };

/** The company's timesheet rules and who approves whom (PRD #42 §73, §74, §217). */
export default async function TimesheetSettingsPage() {
  const context = await requireModule("timesheets");
  if (!can(context, "timesheet.settings.manage")) notFound();
  const experience = resolveModuleExperience(context, "timesheets");
  const [settings, assignments, options] = await Promise.all([getTimesheetSettings(context), listApproverAssignments(context), approverOptions(context)]);

  return (
    <ModulePage experience={experience} activeSection="settings" description="The working week, the rules entries follow, and who approves each person's time.">
      <div className="space-y-5">
        <TimesheetSettingsForm initial={settings} />
        <ApproverAssignments assignments={assignments} options={options} />
      </div>
    </ModulePage>
  );
}
