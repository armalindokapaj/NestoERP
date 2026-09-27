import { History } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import * as activity from "@/lib/modules/sales/sales.activity";
import { formatRelativeTime } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

/**
 * One sales record's history (PRD #17 §147, §148, §410).
 *
 * Read for one record at a time, after the caller has already been shown to
 * reach it. There is no module-wide feed: a company-wide commercial history
 * would hand somebody the values and lost reasons from every deal they cannot
 * open (PRD #17 §148).
 */
export async function SalesActivityFeed({
  context,
  entityType,
  entityId,
}: {
  context: UserContext;
  entityType: "Lead" | "Opportunity" | "Proposal";
  entityId: string;
}) {
  const t = await getTranslations("sales");
  const result = await activity.listRecordActivity(context, entityType, entityId, { limit: 50 });

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title={t("activity.emptyTitle")}
        description={t("activity.emptyDescription")}
      />
    );
  }

  return (
    <ol className="nesto-card divide-y divide-line">
      {result.data.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
          <p className="min-w-0 text-table text-fg">
            {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("activity.somebody")}</span>}{" "}
            <span className="text-fg-muted">{entry.message ?? entry.action}</span>
          </p>
          <time className="shrink-0 text-meta text-fg-subtle" dateTime={entry.createdAt}>
            {formatRelativeTime(entry.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
