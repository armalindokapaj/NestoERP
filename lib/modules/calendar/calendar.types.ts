import type { CalendarEventType, CalendarParticipantStatus, CalendarReminderChannel, CalendarVisibility } from "@prisma/client";

import type { ModuleKey } from "@/config/modules";
import type { UserContext } from "@/lib/context/types";

/**
 * Calendar contracts (PRD #39 §11-§16, §67).
 *
 * The calendar is a lens, not a store: every event it shows comes from a
 * provider, and every provider answers from its own module with that module's
 * permissions and scope. The only events the calendar owns are the ones in
 * `calendar_events` — company events, holidays, personal events — and they
 * arrive through a provider like everything else.
 */

export const CALENDAR_CATEGORIES = [
  "TASK",
  "MEETING",
  "PROJECT",
  "MILESTONE",
  "HR",
  "FINANCE",
  "LEGAL",
  "PROCUREMENT",
  "QA_QC",
  "HSE",
  "DOCUMENT",
  "COMPANY",
  "PERSONAL",
] as const;
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];

export type CalendarPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export const CALENDAR_VIEWS = ["month", "week", "day", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export type CalendarEventDTO = {
  /** Unique within one response: provider, source and occurrence. */
  id: string;
  sourceType: string;
  sourceId: string;
  providerKey: string;

  title: string;
  subtitle?: string;
  startsAt: string;
  endsAt?: string;
  allDay: boolean;

  category: CalendarCategory;
  status?: string;
  priority?: CalendarPriority;
  /** Only for genuine severity — an overdue item, a critical permit (PRD #39 §153). */
  severity?: "warning" | "critical";

  project?: { id: string; name: string; code?: string };
  participants?: Array<{ memberId: string; name: string; avatarUrl?: string }>;
  location?: string;
  href: string;

  editable: boolean;
  draggable: boolean;
  resizable: boolean;

  /** BUSY_ONLY events carry nothing but a time and the word "Busy"/"Unavailable" (PRD #39 §47). */
  privacyMode?: "FULL" | "BUSY_ONLY";

  metadata?: { sourceLabel?: string; ownerName?: string; moduleKey?: string };
  /** For recurring Calendar-owned events: the series id and this occurrence's start. */
  occurrence?: { seriesId: string; recurring: boolean };
};

export type CalendarRange = { from: Date; to: Date };

export type CalendarFilters = {
  providers?: string[];
  categories?: CalendarCategory[];
  projectIds?: string[];
  memberIds?: string[];
  /** Only what is mine: assigned to me, attended by me, created by me. */
  myOnly?: boolean;
  includeAllDay?: boolean;
};

export type CalendarProviderContext = {
  context: UserContext;
  range: CalendarRange;
  filters: CalendarFilters;
  /** The company's IANA zone: all-day dates are read in it (PRD #39 §73). */
  timezone: string;
};

export type CalendarProvider = {
  key: string;
  /** The module that owns the source data; a disabled module is never queried (PRD #39 §177). */
  moduleKey: ModuleKey;
  categories: CalendarCategory[];
  capabilities: { draggable: boolean; resizable: boolean; quickEdit: boolean };
  /** Whether this reader could see anything from this provider at all. */
  enabled(context: UserContext): boolean;
  getEvents(input: CalendarProviderContext): Promise<CalendarEventDTO[]>;
};

export type CalendarResponse = {
  range: { from: string; to: string };
  timezone: string;
  events: CalendarEventDTO[];
  meta: {
    providerCounts: Record<string, number>;
    partialFailureProviders?: string[];
    truncated?: boolean;
  };
  capabilities: {
    canCreate: boolean;
    canCreateCompanyEvent: boolean;
    canViewAvailability: boolean;
  };
  workingHours: { start: string; end: string; days: number[] };
};

export type CalendarEventDetailDTO = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  eventType: CalendarEventType;
  visibility: CalendarVisibility;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  timezone: string;
  recurrence: RecurrenceInput | null;
  project: { id: string; name: string; code: string } | null;
  department: { id: string; name: string } | null;
  createdBy: { memberId: string; fullName: string };
  participants: Array<{ memberId: string; fullName: string; status: CalendarParticipantStatus }>;
  reminders: Array<{ id: string; minutesBefore: number; channel: CalendarReminderChannel }>;
  archived: boolean;
  capabilities: { canEdit: boolean; canArchive: boolean; canRespond: boolean; canManageParticipants: boolean };
  myStatus: CalendarParticipantStatus | null;
  href: string;
};

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type RecurrenceInput = {
  frequency: RecurrenceFrequency;
  interval: number;
  byDay?: Weekday[];
  /** Local date (YYYY-MM-DD) in the event's zone; the series ends at the end of that day. */
  until?: string;
  count?: number;
};

export type ConflictDTO = { memberId: string; fullName: string; busy: Array<{ startsAt: string; endsAt: string }> };
