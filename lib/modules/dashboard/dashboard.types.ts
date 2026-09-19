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
};

/** One slice of a breakdown widget. */
export type WidgetBreakdownItem = {
  label: string;
  value: number;
  /** Formatted display value, when a raw count is not the point. */
  display?: string;
  status?: string;
  href?: string;
};

/** Priority levels for the attention area (PRD #4 §63). */
export type AlertPriority = "CRITICAL" | "WARNING" | "INFO";

export type WidgetAlert = {
  id: string;
  priority: AlertPriority;
  title: string;
  detail: string;
  href?: string;
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

export type WidgetPayload =
  | { kind: "list"; items: WidgetListItem[] }
  | { kind: "breakdown"; items: WidgetBreakdownItem[]; total?: string }
  | { kind: "alerts"; items: WidgetAlert[] }
  | { kind: "approvals"; items: WidgetApproval[] }
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
};

export type ResolvedDashboard = {
  focus: string;
  kpis: ResolvedKpi[];
  widgets: ResolvedWidget[];
  quickActions: QuickActionDefinition[];
};
