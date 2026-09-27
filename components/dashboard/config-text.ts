import { dashboardConfigEn } from "@/lib/i18n/modules/dashboard/config-en";
import type { MessageKey, Translate } from "@/lib/i18n/translator";

/**
 * The dashboard configuration (config/dashboards, widgets, kpis, quick-actions)
 * stays English; its wording is translated here, by id, where it is drawn.
 * An id without a translation falls back to the configuration's own text.
 */
type T = Translate<"dashboard">;

function lookup(t: T, key: string, fallback: string): string {
  const value = t(key as MessageKey<"dashboard">);
  return value === key ? fallback : value;
}

export function widgetText(t: T, key: string, field: "title" | "description" | "emptyMessage", fallback: string): string {
  return lookup(t, `widgets.${key}.${field}`, fallback);
}

export function kpiLabel(t: T, key: string, fallback: string): string {
  return lookup(t, `kpis.${key}`, fallback);
}

export function quickActionLabel(t: T, key: string, fallback: string): string {
  return lookup(t, `quickActions.${key}`, fallback);
}

/** The role's focus line, found by its English text (the plan carries only the text). */
export function focusText(t: T, focus: string): string {
  const id = Object.entries(dashboardConfigEn.focus).find(([, english]) => english === focus)?.[0];
  return id ? lookup(t, `focus.${id}`, focus) : focus;
}

export function greetingText(t: T, date = new Date()): string {
  const hour = date.getHours();
  return t(hour < 12 ? "greeting.morning" : hour < 18 ? "greeting.afternoon" : "greeting.evening");
}
