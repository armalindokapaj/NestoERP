"use client";

import Link from "next/link";

import { cn } from "@/lib/utils/cn";

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
  { key: "compensation", label: "Compensation", suffix: "/compensation" },
  { key: "leave", label: "Leave", suffix: "/leave" },
  { key: "attendance", label: "Attendance", suffix: "/attendance" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export type EmployeeTabKey = (typeof TABS)[number]["key"];

export function EmployeeTabs({
  memberId,
  active,
  show,
}: {
  memberId: string;
  active: EmployeeTabKey;
  show: Partial<Record<EmployeeTabKey, boolean>>;
}) {
  const visible = TABS.filter(
    (tab) => tab.key === "overview" || tab.key === "employment" || show[tab.key],
  );

  return (
    <nav aria-label="Employee sections" className="border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={`/hr/employees/${memberId}${tab.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors",
                  isActive
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
