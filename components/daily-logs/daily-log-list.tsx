import Link from "next/link";
import { Camera, NotebookPen } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { shortDayLabel } from "@/lib/modules/daily-logs/daily-log.time";
import type { DailyLogListItemDTO } from "@/lib/modules/daily-logs/daily-log.types";
import { CorrectedBadge, DailyLogStatusBadge, LateEntryBadge } from "./daily-log-ui";

/**
 * A list of site days (PRD #43 §162, §214, §219-§221): the day, its status and
 * badges, what it says, and its numbers — a card per log, which reads the same
 * on a phone and a desktop.
 */
export function DailyLogList({ items, showProject, emptyTitle, emptyDescription, action }: { items: DailyLogListItemDTO[]; showProject: boolean; emptyTitle: string; emptyDescription: string; action?: { label: string; href: string } }) {
  if (items.length === 0) return <EmptyState icon={<NotebookPen />} title={emptyTitle} description={emptyDescription} action={action} />;
  return (
    <ul className="nesto-card divide-y divide-line" data-testid="daily-log-list">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={item.href} className="flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-row-hover sm:flex-row sm:items-center sm:gap-4 sm:px-5" data-testid="daily-log-row">
            <span className="w-28 shrink-0">
              <span className="block text-table font-semibold text-fg">{shortDayLabel(item.workDate)}</span>
              <span className="block text-meta text-fg-subtle">{item.workDate.slice(0, 4)}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                {showProject ? <span className="text-table font-medium text-fg">{item.project.name}</span> : null}
                <DailyLogStatusBadge status={item.status} />
                {item.lateEntry ? <LateEntryBadge /> : null}
                {item.corrected ? <CorrectedBadge /> : null}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-table text-fg-muted">{item.summary ?? "No summary yet."}</span>
            </span>
            <span className="flex shrink-0 gap-4 text-meta text-fg-muted">
              <span><span className="font-semibold tabular-nums text-fg">{item.workforceTotal}</span> on site</span>
              <span><span className="font-semibold tabular-nums text-fg">{item.activities}</span> activities</span>
              {item.delays ? <span className="text-warning-strong"><span className="font-semibold tabular-nums">{item.delays}</span> {item.delays === 1 ? "delay" : "delays"}</span> : null}
              {item.photos ? (
                <span className="inline-flex items-center gap-1">
                  <Camera className="size-3.5" aria-hidden="true" />
                  <span className="tabular-nums">{item.photos}</span>
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
