import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DailyLogWorkspace } from "@/components/daily-logs/daily-log-workspace";
import { RecordFavorite } from "@/components/productivity/record-favorite";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getDailyLog } from "@/lib/modules/daily-logs/daily-log.service";
import { resolveDailyLogSettings } from "@/lib/modules/daily-logs/daily-log.settings";
import { dateLabel } from "@/lib/modules/daily-logs/daily-log.time";

type Params = { params: Promise<{ projectId: string; dailyLogId: string }> };

async function load(projectId: string, dailyLogId: string) {
  const context = await requireModule("dailyLogs");
  try {
    const log = await getDailyLog(context, dailyLogId);
    if (log.project.id !== projectId) notFound();
    return { context, log };
  } catch (error) {
    if (error instanceof AccessError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { projectId, dailyLogId } = await params;
  try {
    const { log } = await load(projectId, dailyLogId);
    return { title: (await getTranslations("projects"))("dailyLogs.logMeta", { project: log.project.name, date: dateLabel(log.workDate) }) };
  } catch {
    return { title: (await getTranslations("projects"))("dailyLogs.log") };
  }
}

/** One site day (PRD #43 §5, §122-§125, §145-§160). Anybody who cannot open the project is told it does not exist (§229, §230). */
export default async function DailyLogPage({ params }: Params) {
  const { projectId, dailyLogId } = await params;
  const { context, log } = await load(projectId, dailyLogId);
  const settings = await resolveDailyLogSettings(context.companyId, log.project.id);
  return <DailyLogWorkspace initial={log} zone={settings.timezone} discussion={<CollaborationPanel key="discussion" parentType="daily_log" parentId={log.id} />} favorite={<RecordFavorite context={context} entityType="daily_log" entityId={log.id} compact />} />;
}
