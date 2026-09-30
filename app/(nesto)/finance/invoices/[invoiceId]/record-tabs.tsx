"use client";

import Link from "@/components/navigation/nav-link";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";

import { useFinanceTranslations } from "@/components/finance/finance-text";

/**
 * Tabs for a finance record (PRD #15 §176).
 *
 * One component for all four record types: they share the same shape —
 * overview, documents, activity — and a tab renders only when the reader may
 * open what it leads to.
 */
const TABS = [
  { key: "overview", label: "tabs.overview", suffix: "" },
  { key: "documents", label: "tabs.documents", suffix: "/documents" },
  { key: "activity", label: "tabs.activity", suffix: "/activity" },
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
  const t = useFinanceTranslations();
  const visible = TABS.filter((tab) => tab.key === "overview" || show[tab.key]);

  return (
    <ContextTabsFrame label={t("tabs.sections")}>
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link key={tab.key} navSource="tab"
                href={`${basePath}${tab.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={contextTabClass(isActive)}
              >
                {t(tab.label)}
              </Link>
          );
        })}
      </ContextTabsFrame>
  );
}
