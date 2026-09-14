import {
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckSquare,
  DraftingCompass,
  FileText,
  Flag,
  FolderKanban,
  Landmark,
  type LucideIcon,
  Scale,
  ShieldAlert,
  ShoppingCart,
  UserRound,
  Users,
} from "lucide-react";

import { addLocalDays, daysBetween, instantFromLocal, localDate, localMinutes, localWeekday } from "@/lib/modules/calendar/calendar.time";
import type { CalendarCategory, CalendarEventDTO, CalendarView } from "@/lib/modules/calendar/calendar.types";

/**
 * Calendar view model (PRD #39 §7, §24-§27, §152).
 *
 * Pure functions over local dates in the company zone: which days a view
 * shows, what to call the period, how overlapping events share a column. The
 * week starts on Monday.
 */

export const CATEGORY_META: Record<CalendarCategory, { label: string; icon: LucideIcon; token: string }> = {
  TASK: { label: "Tasks", icon: CheckSquare, token: "var(--nesto-cal-task)" },
  MEETING: { label: "Meetings", icon: Users, token: "var(--nesto-cal-meeting)" },
  PROJECT: { label: "Project events", icon: FolderKanban, token: "var(--nesto-cal-project)" },
  MILESTONE: { label: "Milestones", icon: Flag, token: "var(--nesto-cal-milestone)" },
  HR: { label: "Leave & absence", icon: UserRound, token: "var(--nesto-cal-hr)" },
  FINANCE: { label: "Finance", icon: Landmark, token: "var(--nesto-cal-finance)" },
  LEGAL: { label: "Legal", icon: Scale, token: "var(--nesto-cal-legal)" },
  PROCUREMENT: { label: "Procurement", icon: ShoppingCart, token: "var(--nesto-cal-procurement)" },
  QA_QC: { label: "QA/QC", icon: BadgeCheck, token: "var(--nesto-cal-qaqc)" },
  HSE: { label: "HSE", icon: ShieldAlert, token: "var(--nesto-cal-hse)" },
  DOCUMENT: { label: "Documents", icon: FileText, token: "var(--nesto-cal-document)" },
  ENGINEERING: { label: "Engineering", icon: DraftingCompass, token: "var(--nesto-cal-engineering)" },
  COMPANY: { label: "Company events", icon: Building2, token: "var(--nesto-cal-company)" },
  PERSONAL: { label: "Personal", icon: CalendarDays, token: "var(--nesto-cal-personal)" },
};

/** The categories a filter offers, in reading order. Meetings and milestones arrive with PRDs #40 and #44. */
export const FILTER_CATEGORIES: CalendarCategory[] = ["TASK", "PROJECT", "COMPANY", "PERSONAL", "HR", "FINANCE", "LEGAL", "PROCUREMENT", "QA_QC", "HSE", "DOCUMENT", "ENGINEERING"];

export function isView(value: string | null | undefined): value is CalendarView {
  return value === "month" || value === "week" || value === "day" || value === "agenda";
}

export function mondayOf(date: string, zone: string): string {
  const weekday = localWeekday(instantFromLocal(date, "12:00", zone), zone);
  return addLocalDays(date, -(weekday - 1));
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthLength(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return `${first.slice(0, 8)}${String(Math.min(d, monthLength(first))).padStart(2, "0")}`;
}

/** The local days a view renders. */
export function visibleDays(view: CalendarView, date: string, zone: string): string[] {
  if (view === "day") return [date];
  if (view === "week") {
    const monday = mondayOf(date, zone);
    return Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index));
  }
  if (view === "agenda") return Array.from({ length: 14 }, (_, index) => addLocalDays(date, index));
  // Month: whole weeks around the month, six rows at most.
  const first = firstOfMonth(date);
  const start = mondayOf(first, zone);
  const last = addLocalDays(first, monthLength(first) - 1);
  const weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => addLocalDays(start, index));
}

export function rangeFor(view: CalendarView, date: string, zone: string): { from: Date; to: Date } {
  const days = visibleDays(view, date, zone);
  return { from: instantFromLocal(days[0], "00:00", zone), to: instantFromLocal(addLocalDays(days.at(-1)!, 1), "00:00", zone) };
}

export function step(view: CalendarView, date: string, direction: 1 | -1): string {
  if (view === "month") return addMonths(date, direction);
  if (view === "week") return addLocalDays(date, 7 * direction);
  if (view === "agenda") return addLocalDays(date, 14 * direction);
  return addLocalDays(date, direction);
}

const monthFormat = (zone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, month: "long", year: "numeric" });
const shortFormat = (zone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" });

export function periodLabel(view: CalendarView, date: string, zone: string): string {
  const noon = (value: string) => instantFromLocal(value, "12:00", zone);
  if (view === "month") return monthFormat(zone).format(noon(date));
  if (view === "day") {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(noon(date));
  }
  const days = visibleDays(view, date, zone);
  const first = noon(days[0]);
  const last = noon(days.at(-1)!);
  const sameMonth = days[0].slice(0, 7) === days.at(-1)!.slice(0, 7);
  return sameMonth
    ? `${new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric" }).format(first)}–${shortFormat(zone).format(last)} ${days[0].slice(0, 4)}`
    : `${shortFormat(zone).format(first)} – ${shortFormat(zone).format(last)} ${days.at(-1)!.slice(0, 4)}`;
}

export function dayHeading(date: string, zone: string, today: string): string {
  if (date === today) return "Today";
  if (date === addLocalDays(today, 1)) return "Tomorrow";
  if (date === addLocalDays(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(instantFromLocal(date, "12:00", zone));
}

export function todayIn(zone: string): string {
  return localDate(new Date(), zone);
}

/** Local days an event touches, clipped to the given days. */
export function eventDays(event: CalendarEventDTO, zone: string): string[] {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : start;
  const first = localDate(start, zone);
  // An end at exactly local midnight belongs to the previous day.
  const lastInstant = end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : end;
  const last = localDate(lastInstant, zone);
  const span = Math.max(0, daysBetween(first, last));
  return Array.from({ length: span + 1 }, (_, index) => addLocalDays(first, index));
}

export function eventsByDay(events: CalendarEventDTO[], days: string[], zone: string): Map<string, CalendarEventDTO[]> {
  const map = new Map<string, CalendarEventDTO[]>(days.map((day) => [day, []]));
  for (const event of events) {
    for (const day of eventDays(event, zone)) map.get(day)?.push(event);
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt) || severityRank(b) - severityRank(a));
  }
  return map;
}

function severityRank(event: CalendarEventDTO): number {
  return event.severity === "critical" ? 2 : event.severity === "warning" ? 1 : 0;
}

export type PlacedEvent = { event: CalendarEventDTO; top: number; height: number; column: number; columns: number };

/**
 * Side-by-side layout for timed events on one day (PRD #39 §152): each cluster
 * of overlapping events is split into as many columns as it needs.
 */
export function placeTimedEvents(events: CalendarEventDTO[], day: string, zone: string, minuteHeight: number): PlacedEvent[] {
  const dayStart = instantFromLocal(day, "00:00", zone).getTime();
  const dayEnd = instantFromLocal(addLocalDays(day, 1), "00:00", zone).getTime();
  const items = events
    .filter((event) => !event.allDay)
    .map((event) => {
      const start = Math.max(new Date(event.startsAt).getTime(), dayStart);
      const endRaw = event.endsAt ? new Date(event.endsAt).getTime() : start + 30 * 60_000;
      const end = Math.min(Math.max(endRaw, start + 15 * 60_000), dayEnd);
      const startMinutes = start === dayStart ? 0 : localMinutes(new Date(start), zone);
      const minutes = Math.max(15, Math.round((end - start) / 60_000));
      return { event, start, end, top: startMinutes * minuteHeight, height: Math.max(minutes * minuteHeight, 18) };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed: PlacedEvent[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columnsEnd: number[] = [];
    const assigned = cluster.map((item) => {
      let column = columnsEnd.findIndex((end) => end <= item.start);
      if (column === -1) {
        column = columnsEnd.length;
        columnsEnd.push(item.end);
      } else {
        columnsEnd[column] = item.end;
      }
      return { item, column };
    });
    for (const { item, column } of assigned) {
      placed.push({ event: item.event, top: item.top, height: item.height, column, columns: columnsEnd.length });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of items) {
    if (cluster.length > 0 && item.start >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length > 0) flush();
  return placed;
}

export function minutesFromTime(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
