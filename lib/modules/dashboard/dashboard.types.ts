import type { WidgetDefinition } from "@/config/widgets";
import type { KpiDefinition } from "@/config/kpis";
import type { QuickActionDefinition } from "@/config/quick-actions";
import type { PersonRef } from "@/components/people/person-link";

/** One row in a list widget. */
export type WidgetListItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  status?: string;
  href?: string;
  /** The row is a person: its title leads to their profile (E-08 §71). */
  person?: PersonRef;
  /**
   * The company the row is about, on a group widget: following `href` enters that
   * company first, then goes on (Workspace Context §74).
   */
  companyId?: string;
};

/** One slice of a breakdown widget. */
export type WidgetBreakdownItem = {
  label: string;
  value: number;
  /** Formatted display value, when a raw count is not the point. */
  display?: string;
  status?: string;
  href?: string;
  /** As on a list row: the company that `href` enters (Workspace Context §74). */
  companyId?: string;
};

/** Priority levels for the attention area (PRD #4 §63). */
export type AlertPriority = "CRITICAL" | "WARNING" | "INFO";

export type WidgetAlert = {
  id: string;
  priority: AlertPriority;
  title: string;
  detail: string;
  href?: string;
  /** On the group's attention list: the company it is about, which `href` enters (Workspace Context §71). */
  company?: string;
  companyId?: string;
};

export type WidgetApproval = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export type WidgetActivityItem = {
  id: string;
  actor: string;
  /** Null when NESTO itself did it. */
  actorMemberId: string | null;
  message: string;
  createdAt: string;
  /** The company it happened in, on a view across the group's companies. */
  context?: string;
};

/** A project as a card on the group's dashboard (D-01 §31). */
export type WidgetProjectCard = {
  id: string;
  name: string;
  href: string;
  company: string;
  location: string | null;
  /** Its type, and the kinds of unit it holds. */
  tags: string[];
  status: string;
  /** Completed milestones over those not cancelled; null when its plan is not the reader's to read. */
  progress: number | null;
  /** Null when there is no cover or the reader cannot open its document. */
  coverUrl: string | null;
};

/**
 * What a widget could not read, in a sentence ("Finance could not be loaded, so
 * this list may be incomplete."): shown above its rows, and in place of the
 * empty message — a list with a source missing is never "nothing waiting"
 * (AUD-10 §4, CW-03).
 */
export type WidgetIncomplete = { incomplete?: string };

export type WidgetPayload =
  | ({ kind: "list"; items: WidgetListItem[] } & WidgetIncomplete)
  | ({ kind: "breakdown"; items: WidgetBreakdownItem[]; total?: string } & WidgetIncomplete)
  | { kind: "alerts"; items: WidgetAlert[] }
  | ({ kind: "approvals"; items: WidgetApproval[] } & WidgetIncomplete)
  | { kind: "activity"; items: WidgetActivityItem[] }
  | { kind: "progress"; items: WidgetBreakdownItem[] }
  | { kind: "projects"; items: WidgetProjectCard[] }
  | { kind: "error" };

export type ResolvedWidget = {
  definition: WidgetDefinition;
  payload: WidgetPayload;
};

export type ResolvedKpi = {
  definition: KpiDefinition;
  value: string;
  hint?: string;
  /** A group total with each company's own figure beside it, for "view by company" (Workspace Context §73). */
  breakdown?: Array<{ companyId: string; company: string; value: number; incomplete?: boolean }>;
  /** The figure is what could be read, and some of it could not (AUD-10 §4): shown as "at least". */
  incomplete?: boolean;
};

export type ResolvedDashboard = {
  focus: string;
  kpis: ResolvedKpi[];
  widgets: ResolvedWidget[];
  quickActions: QuickActionDefinition[];
};
