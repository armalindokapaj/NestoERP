import * as React from "react";
import { Pin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PRIORITY_LABELS, type AnnouncementPriority, type AnnouncementStatus, STATUS_LABELS } from "@/lib/modules/announcements/announcement.types";
import { cn } from "@/lib/utils/cn";
import { AnnouncementsLabel, AnnouncementsText } from "./announcements-text";

/**
 * Announcement presentation pieces (PRD #45 §26, §60, §207, §210, §211, §219).
 * Priority is a word as well as a mark; ordinary announcements carry none.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Sep 2026" in the reader's zone, with fixed month names so server and browser agree. */
export function formatDay(iso: string | null, zone: string): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return `${get("day")} ${MONTHS[get("month") - 1]} ${get("year")}`;
}

export function formatDayTime(iso: string | null, zone: string): string {
  if (!iso) return "—";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  return `${formatDay(iso, zone)}, ${time}`;
}

export function PriorityMark({ priority, className }: { priority: AnnouncementPriority; className?: string }) {
  if (priority === "NORMAL") return null;
  return (
    <Badge tone={priority === "CRITICAL" ? "danger" : "warning"} className={cn("uppercase tracking-wide", className)} data-testid="announcement-priority">
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
