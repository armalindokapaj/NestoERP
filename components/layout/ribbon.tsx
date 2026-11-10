"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { useSectionLevels } from "@/components/navigation/section-registry";
import type { SectionItem } from "@/components/navigation/section-store";
import { activeNavigationKey, isNavigationItemActive, type NavigationGroup, type NavigationItem } from "@/config/navigation";
import { cn } from "@/lib/utils/cn";

type TabId = NavigationGroup["group"] | "page";

/**
 * The desktop Ribbon (docs/ui/UI-04-navigation-layouts.md), the default
 * desktop navigation: Office's ribbon, drawn under the top bar from `lg`.
 *
 * One tab per navigation group — Home, Work, Department, Company — whose body
 * is that group's modules as large buttons, and, on a module page, a tab for
 * the page you are on, marked "This page" the way Office marks a contextual
 * tab: its body is the module's sections. That tab carries the module's own
 * section row (ModuleTabs registers it as the `module` level), so the page
 * draws no second copy of it (`data-module-row`, styles/globals.css).
 *
 * It renders what the one navigation resolver produced for this person, so a
 * module they cannot open is not here; a section arrives already filtered by
 * the page. The tab shown follows the page: the page's own tab where there is
 * one, else the group holding the current module. A tab picked by hand lasts
 * until the next navigation.
 */
export function Ribbon({ navigation }: { navigation: NavigationGroup[] }) {
  const t = useTranslations("shell");
  const modules = useTranslations("modules");
  const pathname = usePathname();
  const levels = useSectionLevels();
  const pageLevel = levels.find((level) => level.module && level.items.length > 1) ?? null;
  const activeKey = activeNavigationKey(pathname);
  const fallback = navigation.find((group) => group.items.some((item) => item.module === activeKey))?.group ?? navigation[0]?.group ?? "primary";

  const [picked, setPicked] = React.useState<TabId | null>(null);
  React.useEffect(() => setPicked(null), [pathname]);

  const groupLabel = (group: NavigationGroup["group"]) => (group === "primary" ? t("ribbon.home") : t(`groups.${group}`));
  const tabs: { id: TabId; label: string }[] = navigation.map((group) => ({ id: group.group, label: groupLabel(group.group) }));
  if (pageLevel) tabs.push({ id: "page", label: activeKey ? modules(`${activeKey}.label`) : pageLevel.label });
  const current: TabId = picked && tabs.some((tab) => tab.id === picked) ? picked : pageLevel ? "page" : fallback;
  const group = navigation.find((candidate) => candidate.group === current);

  // The module you are in, named on the Ribbon itself whichever tab is showing: for tests and for anything that reads the shell.
  const currentItem = navigation.flatMap((candidate) => candidate.items).find((item) => item.module === activeKey) ?? null;

  const tabRefs = React.useRef(new Map<TabId, HTMLButtonElement>());
  const baseId = React.useId();

  // A tab list behaves like one (AUD-11 §3): one Tab stop, the arrow keys move between tabs and show them.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const edge = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === current);
    const next = tabs[edge ?? (index + step! + tabs.length) % tabs.length]!;
    setPicked(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <div
      data-ribbon
      data-shell-region
      data-current-module={currentItem?.key}
      data-current-href={currentItem?.href}
      data-current-label={currentItem ? modules(`${currentItem.key}.label`) : undefined}
      className="max-lg:hidden"
    >
      <div
        role="tablist"
        aria-label={t("ribbon.label")}
        onKeyDown={onKeyDown}
        className="flex h-(--nesto-ribbon-tabs-h) items-end gap-1 px-6 xl:px-8"
      >
        {tabs.map((tab) => {
          const selected = tab.id === current;
          const page = tab.id === "page";
          return (
            <div key={tab.id} className={cn("flex flex-col", page && "ml-3")}>
              {page ? <span className="nesto-eyebrow rounded-t-[5px] bg-accent-soft px-2 pt-0.5 text-center text-[0.5625rem] text-accent-strong">{t("ribbon.thisPage")}</span> : null}
              <button
                ref={(node) => {
                  if (node) tabRefs.current.set(tab.id, node);
                  else tabRefs.current.delete(tab.id);
                }}
                type="button"
                role="tab"
                id={`${baseId}-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setPicked(tab.id)}
                data-testid={`ribbon-tab-${tab.id}`}
                className={cn(
                  "relative h-8 whitespace-nowrap px-3.5 text-table transition-colors",
                  page ? "rounded-b-none bg-accent-soft" : "rounded-t-lg",
                  selected
                    ? "font-semibold text-fg after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent"
                    : "text-fg-muted hover:bg-hover hover:text-fg",
                )}
              >
                {tab.label}
              </button>
            </div>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-${current}`}
        data-testid="ribbon-panel"
        className="flex h-(--nesto-ribbon-body-h) items-stretch overflow-x-auto overscroll-x-contain border-t border-line px-4 xl:px-6"
      >
        {current === "page" && pageLevel ? (
          <RibbonGroup caption={t("ribbon.sections")}>
            {/* In reading order, wrapping to a second line only when a module has many sections (HSE has 14). */}
            <div className="flex max-w-[60rem] flex-wrap content-start gap-1">
              {pageLevel.items.map((item) => (
                <SectionButton key={item.key} item={item} />
              ))}
            </div>
          </RibbonGroup>
        ) : group ? (
          <RibbonGroup caption={groupLabel(group.group)}>
            <div className="flex items-start gap-0.5">
              {group.items.map((item) => (
                <ModuleButton key={item.key} item={item} active={isNavigationItemActive(item, pathname)} />
              ))}
            </div>
          </RibbonGroup>
        ) : null}
      </div>
    </div>
  );
}

/** A group of commands with its caption under it, as Office draws one. */
function RibbonGroup({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col justify-between border-r border-line px-2 pb-1.5 pt-2 last:border-r-0">
      {children}
      <span className="nesto-eyebrow text-center text-[0.5625rem] text-fg-subtle">{caption}</span>
    </div>
  );
}

/** A module: its icon over its name, the whole button the target. The module you are in is filled. */
function ModuleButton({ item, active }: { item: NavigationItem; active: boolean }) {
  const t = useTranslations("modules");
  const Icon = getIcon(item.icon);
  const pending = usePendingDestination(item.href);
  return (
    <Link
      href={item.href}
      navSource="sidebar"
      intent
      aria-current={active ? "page" : undefined}
      data-pending={pending || undefined}
      data-testid={`ribbon-module-${item.key}`}
      className={cn(
        "relative flex w-[5.25rem] flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-center text-meta leading-tight transition-colors",
        active ? "bg-primary text-primary-fg" : "text-fg hover:bg-hover",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-5 shrink-0", active ? "text-current" : "text-fg-subtle")} />
      <span className="line-clamp-2 max-w-full">{t(`${item.key}.label`)}</span>
      {pending ? <PendingDot className="absolute right-1.5 top-1.5 text-accent" /> : null}
    </Link>
  );
}

/** A section of the module you are in: a pill, filled for the section you are on. */
function SectionButton({ item }: { item: SectionItem }) {
  const pending = usePendingDestination(item.href);
  return (
    <Link
      href={item.href}
      navSource="tab"
      aria-current={item.active ? "page" : undefined}
      data-pending={pending || undefined}
      target={item.newTab ? "_blank" : undefined}
      className={cn(
        "relative inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-table font-medium transition-colors",
        item.active ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {item.label}
      {item.count ? <span className="rounded-full bg-accent-soft px-1.5 text-micro tabular-nums text-accent-strong">{item.count}</span> : null}
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}
