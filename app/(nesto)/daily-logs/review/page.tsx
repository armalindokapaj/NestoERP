import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DailyLogList } from "@/components/daily-logs/daily-log-list";
import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { listDailyLogs } from "@/lib/modules/daily-logs/daily-log.service";

export const metadata: Metadata = { title: "Daily logs to review" };

/** Submitted logs waiting for this reviewer, oldest first (PRD #43 §87, §217). */
export default async function DailyLogReviewPage() {
  const context = await requireModule("dailyLogs");
  if (!can(context, "daily_log.review")) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "dailyLogs");
  const list = await listDailyLogs(context, listQuerySchema.parse({ pageSize: 100 }), { reviewQueue: true });
  return (
    <ModulePage experience={experience} activeSection="review" description="Submitted logs waiting for your review, the oldest first.">
      <DailyLogList items={list.items} showProject emptyTitle="Nothing to review." emptyDescription="Logs submitted on the projects you review appear here." />
    </ModulePage>
  );
}
