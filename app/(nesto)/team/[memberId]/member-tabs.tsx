"use client";

import { usePathname } from "next/navigation";
import Link from "@/components/navigation/nav-link";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";

import { useTeamTranslations } from "@/components/team/team-text";

/**
 * Member record tabs (PRD #14 §42).
 *
 * A tab renders only when the reader may open what it leads to, so somebody
 * without project access sees no Projects tab rather than one that refuses
 * them (PRD #14 §142).
 */
const TABS = [
  { key: "overview", suffix: "" },
  { key: "projects", suffix: "/projects" },
  { key: "activity", suffix: "/activity" },
] as const;

export type MemberTabKey = (typeof TABS)[number]["key"];

export function MemberTabs({
  memberId,
  show,
}: {
  memberId: string;
  show: Partial<Record<MemberTabKey, boolean>>;
}) {
  const t = useTeamTranslations();
  const pathname = usePathname();
  // The tab follows the URL, so the header and tabs can live in the layout and stay put.
  const active: MemberTabKey = pathname.endsWith("/projects") ? "projects" : pathname.endsWith("/activity") ? "activity" : "overview";
  const visible = TABS.filter((tab) => tab.key === "overview" || show[tab.key]);

  return (
    <ContextTabsFrame label={t("tabs.sections")}>
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link key={tab.key} navSource="tab"
                href={`/team/${memberId}${tab.suffix}`}
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
