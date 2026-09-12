import { History } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import * as activity from "@/lib/modules/qaqc/qaqc.activity";
import { formatRelativeTime } from "@/lib/utils/format";

/**
 * One record's history (PRD #21 §186, §187).
 *
 * The messages name the record and the action and nothing else: a root cause, a
 * rejection reason and a closure note live on the record itself, where the
 * permissions that guard them apply.
 */
export async function QaqcActivityFeed({
  context,
  entityType,
  entityId,
}: {
  context: UserContext;
  entityType: string;
  entityId: string;
}) {
  const result = await activity.listRecordActivity(context, entityType, entityId, { limit: 50 });

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title="Nothing recorded yet."
        description="Changes to this record appear here as they happen."
      />
    );
  }

  return (
    <ol className="nesto-card divide-y divide-line">
      {result.data.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
          <p className="min-w-0 text-table text-fg">
            <span className="font-medium">{entry.actor ?? "Somebody"}</span>{" "}
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
