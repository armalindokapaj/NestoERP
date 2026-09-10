import type { WidgetDefinition } from "@/config/widgets";
import type { KpiDefinition } from "@/config/kpis";
import type { QuickActionDefinition } from "@/config/quick-actions";

/** One row in a list widget. */
export type WidgetListItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  status?: string;
  href?: string;
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
  message: string;
  createdAt: string;
};

export type WidgetPayload =
  | { kind: "list"; items: WidgetListItem[] }
  | { kind: "breakdown"; items: WidgetBreakdownItem[]; total?: string }
  | { kind: "alerts"; items: WidgetAlert[] }
  | { kind: "approvals"; items: WidgetApproval[] }
  | { kind: "activity"; items: WidgetActivityItem[] }
  | { kind: "progress"; items: WidgetBreakdownItem[] }
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
