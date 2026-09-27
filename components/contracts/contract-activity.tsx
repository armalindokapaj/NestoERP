import { History } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import * as activity from "@/lib/modules/contracts/contract.activity";
import { formatRelativeTime } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

/**
 * One contract's history (PRD #18 §209, §210).
 *
 * Read for one record at a time, after the caller has already been shown to
 * reach it. The messages name the record and the action and nothing else — the
 * value, the legal note and the termination reason live in metadata, which this
 * reader does not return (PRD #18 §210).
 */
export async function ContractActivityFeed({
  context,
  contractId,
}: {
  context: UserContext;
  contractId: string;
}) {
  const t = await getTranslations("contracts");
  const result = await activity.listRecordActivity(context, "Contract", contractId, { limit: 50 });

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title={t("activityFeed.emptyTitle")}
        description={t("activityFeed.emptyDescription")}
      />
    );
  }

  return (
    <ol className="nesto-card divide-y divide-line">
      {result.data.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
          <p className="min-w-0 text-table text-fg">
            {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("activityFeed.somebody")}</span>}{" "}
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
