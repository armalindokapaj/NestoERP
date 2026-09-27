import { redirect } from "next/navigation";
import Link from "@/components/navigation/nav-link";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { PersonLink } from "@/components/people/person-link";
import type { UserContext } from "@/lib/context/types";
import * as activity from "@/lib/modules/hse/hse.activity";
import { formatRelativeTime } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

/**
 * One record's history (PRD #22 §196, §197).
 *
 * The messages name the record and the act and nothing else: an injury flag, a
 * root cause and a stop-work reason live on the record itself, where the
 * permissions that guard them apply.
 *
 * Newest first, 50 at a time, with the true number of entries (AUD-08 §4).
 */
export async function HseActivityFeed({
  context,
  entityType,
  entityId,
  page = 1,
  buildHref,
  moreHref,
}: {
  context: UserContext;
  entityType: string;
  entityId: string;
  /** The page to show, on a record's own Activity page. */
  page?: number;
  /** Paginates the feed (the record's Activity page); without it the feed shows the newest 50. */
  buildHref?: (page: number) => string;
  /** Where the whole history lives, linked when the embedded feed is not all of it. */
  moreHref?: string;
}) {
  const result = await activity.listRecordActivity(context, entityType, entityId, { page, limit: 50 });
  const t = await getTranslations("hse");
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (buildHref && result.pagination.page !== page) redirect(buildHref(result.pagination.page));

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title={t("activity.emptyTitle")}
        description={t("activity.emptyDescription")}
      />
    );
  }

  const feed = (
    <ol className="nesto-card divide-y divide-line">
      {result.data.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
          <p className="min-w-0 text-table text-fg">
            <span className="font-medium">
              {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : t("activity.somebody")}
            </span>{" "}
            <span className="text-fg-muted">{entry.message ?? entry.action}</span>
          </p>
          <time className="shrink-0 text-meta text-fg-subtle" dateTime={entry.createdAt}>
            {formatRelativeTime(entry.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );

  // Never a silent stop at 50 (AUD-08 §4, DT-01): the record's Activity page
  // pages through everything; an embedded feed says how much it shows.
  if (buildHref) {
    return (
      <div className="space-y-3">
        {feed}
        <Pagination meta={result.pagination} buildHref={buildHref} />
      </div>
    );
  }
  if (result.pagination.total <= result.data.length) return feed;
  return (
    <div className="space-y-2">
      {feed}
      <p className="text-meta text-fg-muted" data-testid="activity-count">
        {t("activity.showing", { shown: result.data.length, total: result.pagination.total })}
        {moreHref ? (
          <>
            {" "}
            <Link href={moreHref} className="text-accent hover:underline">
              {t("activity.seeFull")}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
