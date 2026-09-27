"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { CalendarDays, CheckCircle2, Megaphone, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { AnnouncementCardDTO, AnnouncementFeedDTO, FeedTab } from "@/lib/modules/announcements/announcement.types";
import { cn } from "@/lib/utils/cn";
import { announcementApi, failureMessage } from "./announcement-api";
import { AnnouncementStatusBadge, formatDay, formatDayTime, PinnedMark, PriorityMark } from "./announcement-ui";

/**
 * The feed (PRD #45 §59, §60, §200, §207, §220-§224).
 *
 * An internal publication, not a social feed: a hairline-bordered card per
 * announcement with its scope, priority, author, date, a clean excerpt and
 * what it asks of the reader. No reactions, no counters. The Manage tab lists
 * drafts, schedules and published notices for the people who write them.
 */

function Card({ item, zone, manage }: { item: AnnouncementCardDTO; zone: string; manage: boolean }) {
  const unread = !manage && item.status === "PUBLISHED" && !item.read;
  const awaiting = !manage && item.requiresAcknowledgment && !item.acknowledgedAt && item.status === "PUBLISHED";
  return (
    <li>
      <Link
        href={item.href}
        className={cn(
          "group block rounded-xl border bg-surface px-5 py-4 transition-colors hover:border-line-strong",
          item.priority === "CRITICAL" && item.status === "PUBLISHED" ? "border-danger/35" : "border-line",
        )}
        data-testid="announcement-card"
      >
        <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
          {/* aria-label on a bare span is not announced; the state is real text (AUD-11 §5, AV-06). */}
          {unread ? <><span aria-hidden="true" className="size-2 rounded-full bg-accent" /><span className="sr-only">Unread</span></> : null}
          <span className="font-medium uppercase tracking-[0.08em] text-fg-subtle" data-testid="announcement-scope">
            {item.audience.label}
          </span>
          <PriorityMark priority={item.priority} />
          {item.pinned ? <PinnedMark /> : null}
          {manage ? <AnnouncementStatusBadge status={item.status} /> : null}
          <span className="flex-1" />
          <span className="tabular-nums">
            {manage && item.status === "SCHEDULED" ? `Publishes ${formatDayTime(item.publishAt, zone)}` : manage && item.status === "DRAFT" ? `Edited ${formatDay(item.updatedAt, zone)}` : formatDay(item.publishedAt, zone)}
          </span>
        </div>
        <h2 className={cn("mt-2 text-card tracking-tight text-fg group-hover:text-accent-strong", unread ? "font-semibold" : "font-medium")}>{item.title}</h2>
        {item.excerpt ? <p className="mt-1.5 line-clamp-2 text-table leading-6 text-fg-muted">{item.excerpt}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-fg-muted">
          {item.author ? <span>{item.author.name}</span> : null}
          {item.eventStartsAt ? (
            <span className="inline-flex items-center gap-1">
              <CalendarDays aria-hidden="true" className="size-3.5" />
              {formatDayTime(item.eventStartsAt, zone)}
            </span>
          ) : null}
          {item.attachmentCount ? (
            <span className="inline-flex items-center gap-1">
              <Paperclip aria-hidden="true" className="size-3.5" />
              {item.attachmentCount} {item.attachmentCount === 1 ? "attachment" : "attachments"}
            </span>
          ) : null}
          {item.edited ? <span>Updated</span> : null}
          {awaiting ? <span className="font-medium text-warning-strong">Acknowledgment required</span> : null}
          {item.acknowledgedAt && !manage ? (
            <span className="inline-flex items-center gap-1 text-success-strong">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              Acknowledged
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

export function AnnouncementList({ initial, tab, query, zone }: { initial: AnnouncementFeedDTO; tab: FeedTab; query: string; zone: string }) {
  const [items, setItems] = React.useState(initial.items);
  const [cursor, setCursor] = React.useState(initial.nextCursor);
  const [total, setTotal] = React.useState(initial.total);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Which applied query a "Load more" belongs to: a response that arrives after
  // the filters changed is dropped, so the cards always match the filters shown
  // (AUD-08 §3, DT-20).
  const generation = React.useRef(0);

  React.useEffect(() => {
    generation.current += 1;
    setItems(initial.items);
    setCursor(initial.nextCursor);
    setTotal(initial.total);
    setPending(false);
    setError(null);
  }, [initial]);

  async function more() {
    if (!cursor || pending) return;
    const mine = generation.current;
    setPending(true);
    setError(null);
    try {
      const next = await announcementApi<AnnouncementFeedDTO>(`/api/announcements?${query}${query ? "&" : ""}cursor=${cursor}`);
      if (mine !== generation.current) return;
      // Offsets are a live view: a notice published meanwhile can shift the next slice, so a card
      // already shown is not shown twice (AUD-08 §4).
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...next.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(next.nextCursor);
      setTotal(next.total);
    } catch (failure) {
      if (mine === generation.current) setError(failureMessage(failure));
    } finally {
      if (mine === generation.current) setPending(false);
    }
  }

  if (!items.length) {
    const empty: Record<FeedTab, string> = {
      for_me: "No current announcements.",
      pinned: "Nothing is pinned.",
      unread: "You are all caught up.",
      acknowledge: "Nothing is waiting for your acknowledgment.",
      history: "No announcements yet.",
      manage: "No announcements to manage.",
    };
    return <EmptyState icon={<Megaphone />} title={empty[tab]} description={tab === "manage" ? "Drafts, scheduled and published announcements you can manage appear here." : "Company, department and project notices addressed to you appear here."} />;
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3" data-testid="announcement-feed">
        {items.map((item) => (
          <Card key={item.id} item={item} zone={zone} manage={tab === "manage"} />
        ))}
      </ul>
      <p className="text-table text-fg-muted" aria-live="polite" data-testid="announcement-count">
        Showing <span className="tabular-nums">{items.length}</span> of <span className="tabular-nums">{Math.max(total, items.length)}</span>
      </p>
      {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
      {cursor ? (
        <div className="flex justify-center">
          <Button type="button" variant="secondary" size="sm" onClick={() => void more()} disabled={pending}>
            {pending ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
