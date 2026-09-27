import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { StartLogForm } from "@/components/daily-logs/start-log-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { resolveDailyLogSettings } from "@/lib/modules/daily-logs/daily-log.settings";
import { addLocalDays, localDate } from "@/lib/modules/daily-logs/daily-log.time";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../../project-context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("dailyLogs.startTitle") };
}

/** Start a log for today or a day within the backdating window (PRD #43 §5, §17, §18). */
export default async function NewDailyLogPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  if (!projects.projectActions(context).canViewDailyLogs || !can(context, "daily_log.create")) redirect("/access-denied");
  const settings = await resolveDailyLogSettings(context.companyId, project.id);
  const today = localDate(new Date(), settings.timezone);
  return (
    <div className="space-y-5">
      <RecordContextHeader breadcrumbs={[...(await projectBreadcrumbs(project, "Daily Logs")).slice(0, 2), { label: t("tabs.dailyLogs"), href: `/projects/${project.id}/daily-logs` }, { label: t("dailyLogs.startCrumb") }]} title={t("dailyLogs.startTitle")} subtitle={project.name} />
      <div className="nesto-card max-w-lg px-5 py-4">
        <p className="mb-3 text-table text-fg-muted">{t("dailyLogs.startIntro", { days: settings.backdateDays })}</p>
        <StartLogForm projectId={project.id} today={today} earliest={addLocalDays(today, -settings.backdateDays)} />
      </div>
    </div>
  );
}
