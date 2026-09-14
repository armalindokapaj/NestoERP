import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StartLogForm } from "@/components/daily-logs/start-log-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { resolveDailyLogSettings } from "@/lib/modules/daily-logs/daily-log.settings";
import { addLocalDays, localDate } from "@/lib/modules/daily-logs/daily-log.time";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../../project-context";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Start a daily log" };

/** Start a log for today or a day within the backdating window (PRD #43 §5, §17, §18). */
export default async function NewDailyLogPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  if (!projects.projectActions(context).canViewDailyLogs || !can(context, "daily_log.create")) redirect("/access-denied");
  const settings = await resolveDailyLogSettings(context.companyId, project.id);
  const today = localDate(new Date(), settings.timezone);
  return (
    <div className="space-y-5">
      <RecordContextHeader breadcrumbs={[...projectBreadcrumbs(project, "Daily Logs").slice(0, 2), { label: "Daily Logs", href: `/projects/${project.id}/daily-logs` }, { label: "Start a log" }]} title="Start a daily log" subtitle={project.name} />
      <div className="nesto-card max-w-lg px-5 py-4">
        <p className="mb-3 text-table text-fg-muted">Choose the day. A day that already has a log opens that log. Days up to {settings.backdateDays} days back can be started; a log started after its day is marked as a late entry.</p>
        <StartLogForm projectId={project.id} today={today} earliest={addLocalDays(today, -settings.backdateDays)} />
      </div>
    </div>
  );
}
