import * as React from "react";
import { Pin } from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import type { Locale } from "@/lib/i18n/config";
import { calendarParts, monthName } from "@/lib/i18n/format";
import { PRIORITY_LABELS, type AnnouncementPriority, type AnnouncementStatus, STATUS_LABELS } from "@/lib/modules/announcements/announcement.types";
import { cn } from "@/lib/utils/cn";
import { AnnouncementsLabel, AnnouncementsText } from "./announcements-text";

/**
 * Announcement presentation pieces (PRD #45 §26, §60, §207, §210, §211, §219).
 * Priority is a word as well as a mark; ordinary announcements carry none.
 */

/** "14 Sep 2026" in the reader's zone, with fixed month names so server and browser agree. */
export function formatDay(iso: string | null, zone: string, locale: Locale): string {
  if (!iso) return "—";
  const at = calendarParts(new Date(iso), zone);
  return `${at.day} ${monthName(at.month, "short", locale)} ${at.year}`;
}

export function formatDayTime(iso: string | null, zone: string, locale: Locale): string {
  if (!iso) return "—";
  const at = calendarParts(new Date(iso), zone);
  const time = `${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")}`;
  return `${formatDay(iso, zone, locale)}, ${time}`;
}

export function PriorityMark({ priority, className }: { priority: AnnouncementPriority; className?: string }) {
  if (priority === "NORMAL") return null;
  return (
    <Badge tone={priority === "CRITICAL" ? "danger" : "warning"} className={cn("font-mono uppercase tracking-wide", className)} data-testid="announcement-priority">
      <AnnouncementsLabel group="priority" value={priority} fallback={PRIORITY_LABELS[priority]} />
    </Badge>
  );
}

export function PinnedMark() {
  return (
    <span className="inline-flex items-center gap-1 text-meta font-medium text-fg-muted">
      <Pin aria-hidden="true" className="size-3.5 rotate-45" />
      <AnnouncementsText k="ui.pinned" />
    </span>
  );
}

const STATUS_TONE: Record<AnnouncementStatus, "default" | "neutral" | "info" | "success" | "warning"> = { DRAFT: "neutral", SCHEDULED: "info", PUBLISHED: "success", EXPIRED: "default", ARCHIVED: "default" };

export function AnnouncementStatusBadge({ status }: { status: AnnouncementStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-testid="announcement-status">
      <AnnouncementsLabel group="status" value={status} fallback={STATUS_LABELS[status]} />
    </Badge>
  );
}
