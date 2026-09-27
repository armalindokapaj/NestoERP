import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DailyLogList } from "@/components/daily-logs/daily-log-list";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { getTranslations } from "@/lib/i18n/server";
import { listDailyLogs } from "@/lib/modules/daily-logs/daily-log.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("dailyLogs"))("meta.review") };
}

/**
 * Submitted logs waiting for this reviewer, oldest first (PRD #43 §87, §217).
 * Every one of them, with a count and pages — before, the queue stopped
 * silently at 100 (AUD-08 §4, DT-05).
 */
export default async function DailyLogReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("dailyLogs");
  if (!can(context, "daily_log.review")) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "dailyLogs");
  const params = await searchParams;
  const query = listQuerySchema.parse({ pageSize: 50, page: Array.isArray(params.page) ? params.page[0] : params.page });
  const [list, t] = await Promise.all([listDailyLogs(context, query, { reviewQueue: true }), getTranslations("dailyLogs")]);
  if (list.page !== query.page) redirect(listPageRedirect("/daily-logs/review", params, list.page));
  return (
    <ModulePage experience={experience} activeSection="review" description={t("review.description")}>
      <div className="space-y-4">
        <DailyLogList items={list.items} showProject emptyTitle={t("review.emptyTitle")} emptyDescription={t("review.emptyDescription")} />
        <Pagination meta={{ page: list.page, limit: list.pageSize, total: list.total, totalPages: Math.max(1, Math.ceil(list.total / list.pageSize)) }} buildHref={(page) => pageHref("/daily-logs/review", params, page)} />
      </div>
    </ModulePage>
  );
}
