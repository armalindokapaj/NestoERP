import { History } from "@/components/icons";

import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import { formatRelativeTime } from "@/lib/i18n/format";
import * as activity from "@/lib/modules/inventory/inventory.activity";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { localizeActivity } from "@/lib/i18n/system";

/**
 * One record's history (PRD #20 §199, §200).
 *
 * The stock ledger is the real audit trail here — every movement says who
 * posted it, when and against what — so this feed carries the document-level
 * events around it rather than duplicating the ledger.
 */
export async function InventoryActivityFeed({
  context,
  entityType,
  entityId,
}: {
  context: UserContext;
  entityType: string;
  entityId: string;
}) {
  const t = await getTranslations("inventory");
  const locale = await getLocale();
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
            <span className="text-fg-muted">{localizeActivity(locale, entry) ?? entry.action}</span>
          </p>
          <time className="shrink-0 text-meta text-fg-subtle" dateTime={entry.createdAt}>
            {formatRelativeTime(entry.createdAt, locale)}
          </time>
        </li>
      ))}
    </ol>
  );
}
