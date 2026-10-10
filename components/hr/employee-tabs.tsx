"use client";

import { ContextTabs } from "@/components/navigation/context-tabs";

import { useHrTranslations } from "./hr-text";

/**
 * Tabs on an employment record (PRD #16 §45).
 *
 * Each tab is permission-aware, and a tab the reader may not open is absent
 * rather than disabled. Compensation is the sharp case: without
 * `hr.compensation.view` the tab does not exist, rather than showing a locked
 * placeholder that confirms a salary is on file (PRD #16 §317).
 */
const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "employment", label: "Employment", suffix: "/employment" },
  { key: "history", label: "History", suffix: "/history" },
  { key: "compensation", label: "Compensation", suffix: "/compensation" },
  { key: "leave", label: "Leave", suffix: "/leave" },
  { key: "attendance", label: "Attendance", suffix: "/attendance" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export type EmployeeTabKey = (typeof TABS)[number]["key"];

export function EmployeeTabs({
  employeeId,
  show,
}: {
  /** The employment (E-04 §14). */
  employeeId: string;
  show: Partial<Record<EmployeeTabKey, boolean>>;
}) {
  const t = useHrTranslations();
  const tabs = TABS.filter((tab) => tab.key === "overview" || tab.key === "employment" || show[tab.key]).map((tab) => ({
    key: tab.key,
    label: t(`tabs.${tab.key}`),
    href: `/hr/employees/${employeeId}${tab.suffix}`,
  }));

  // The active tab follows the URL, so the tabs can sit in the layout and stay put.
  return <ContextTabs label={t("tabs.sections")} tabs={tabs} rootKey="overview" />;
}
