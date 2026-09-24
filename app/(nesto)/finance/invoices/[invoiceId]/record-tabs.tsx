"use client";

import Link from "@/components/navigation/nav-link";

import { cn } from "@/lib/utils/cn";

/**
 * Tabs for a finance record (PRD #15 §176).
 *
 * One component for all four record types: they share the same shape —
 * overview, documents, activity — and a tab renders only when the reader may
 * open what it leads to.
 */
const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export type FinanceTabKey = (typeof TABS)[number]["key"];

export function FinanceRecordTabs({
  basePath,
  active,
  show,
}: {
  basePath: string;
  active: FinanceTabKey;
  show: Partial<Record<FinanceTabKey, boolean>>;
}) {
  const visible = TABS.filter((tab) => tab.key === "overview" || show[tab.key]);

  return (
    <nav aria-label="Record sections" className="border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link navSource="tab"
                href={`${basePath}${tab.suffix}`}
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
