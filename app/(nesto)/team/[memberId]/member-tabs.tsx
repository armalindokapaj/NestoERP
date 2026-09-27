"use client";

import Link from "@/components/navigation/nav-link";

import { cn } from "@/lib/utils/cn";

/**
 * Member record tabs (PRD #14 §42).
 *
 * A tab renders only when the reader may open what it leads to, so somebody
 * without project access sees no Projects tab rather than one that refuses
 * them (PRD #14 §142).
 */
const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "projects", label: "Projects", suffix: "/projects" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export type MemberTabKey = (typeof TABS)[number]["key"];

export function MemberTabs({
  memberId,
  active,
  show,
}: {
  memberId: string;
  active: MemberTabKey;
  show: Partial<Record<MemberTabKey, boolean>>;
}) {
  const visible = TABS.filter((tab) => tab.key === "overview" || show[tab.key]);

  return (
    <nav aria-label="Member sections" className="border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link navSource="tab"
                href={`/team/${memberId}${tab.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors touch:h-11",
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
