"use client";

import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils/cn";

/**
 * The shared context tab model (Sticky Navigation §26). Tabs arrive already
 * filtered by permission, module and scope on the server; this only draws them.
 */
export type ContextTab = { key: string; label: string; href: string; newTab?: boolean };

/** The tab a path is in: an exact match for the root tab, otherwise the longest route it starts with. */
function activeFor(tabs: ContextTab[], pathname: string, rootKey?: string) {
  const exact = tabs.find((tab) => tab.href === pathname);
  if (exact) return exact.key;
  const candidates = tabs
    .filter((tab) => tab.key !== rootKey && !tab.newTab && pathname.startsWith(`${tab.href.split("?")[0]}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return candidates[0]?.key;
}

/**
 * Sticky context tabs with an optional "More" menu (§9, §11): `primary` names the
 * tabs always shown; the rest fold into More, which carries the active tab's
 * name while one of them is open. The active tab follows the URL, so back,
 * forward, refresh and deep links all land on the right one (§35, §36).
 */
export function ContextTabs({ label, tabs, primary, rootKey }: { label: string; tabs: ContextTab[]; primary?: string[]; rootKey?: string }) {
  const t = useTranslations("ui");
  const pathname = usePathname();
  if (tabs.length <= 1) return null;
  const active = activeFor(tabs, pathname, rootKey);
  const shown = primary ? tabs.filter((tab) => primary.includes(tab.key)) : tabs;
  const more = primary ? tabs.filter((tab) => !primary.includes(tab.key)) : [];
  const activeInMore = more.find((tab) => tab.key === active);

  return (
    <ContextTabsFrame label={label}>
      {shown.map((tab) => (
        <Link
          navSource="tab"
          key={tab.key}
          href={tab.href}
          target={tab.newTab ? "_blank" : undefined}
          rel={tab.newTab ? "noopener noreferrer" : undefined}
          aria-current={tab.key === active ? "page" : undefined}
          className={contextTabClass(tab.key === active)}
        >
          {tab.label}
        </Link>
      ))}
      {more.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(contextTabClass(Boolean(activeInMore)), "data-[state=open]:text-fg")} aria-current={activeInMore ? "page" : undefined}>
              {activeInMore ? activeInMore.label : t("moreSections")}
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-96 min-w-48 overflow-y-auto">
            {more.map((tab) => (
              <DropdownMenuItem key={tab.key} asChild>
                <Link
                  href={tab.href}
                  target={tab.newTab ? "_blank" : undefined}
                  rel={tab.newTab ? "noopener noreferrer" : undefined}
                  aria-current={tab.key === active ? "page" : undefined}
                  className={cn(tab.key === active && "font-semibold text-fg")}
                >
                  {tab.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </ContextTabsFrame>
  );
}
