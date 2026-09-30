"use client";

import Link from "@/components/navigation/nav-link";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";

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
  active,
  show,
}: {
  /** The employment (E-04 §14). */
  employeeId: string;
  active: EmployeeTabKey;
  show: Partial<Record<EmployeeTabKey, boolean>>;
}) {
  const t = useHrTranslations();
  const visible = TABS.filter(
    (tab) => tab.key === "overview" || tab.key === "employment" || show[tab.key],
  );

  return (
    <ContextTabsFrame label={t("tabs.sections")}>
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link key={tab.key} navSource="tab"
                href={`/hr/employees/${employeeId}${tab.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={contextTabClass(isActive)}
              >
                {t(`tabs.${tab.key}`)}
              </Link>
          );
        })}
      </ContextTabsFrame>
  );
}
