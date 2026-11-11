"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { ChevronUp } from "@/components/icons";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { useSectionLevels } from "@/components/navigation/section-registry";
import type { SectionItem } from "@/components/navigation/section-store";
import { activeNavigationKey, groupOfPath, isRibbonTab, isNavigationItemActive, type NavigationGroup, type NavigationItem, type RibbonTab } from "@/config/navigation";
import { RIBBON_COOKIE } from "@/lib/layout/nav-layout";
import { cn } from "@/lib/utils/cn";

/**
 * The Ribbon (docs/ui/UI-04-navigation-layouts.md), from `lg`: Office's
 * ribbon, in the top bar.
 *
 * Four tabs — Work, Sales, Procurement, Finance — sit centred in the bar's
 * own row. Under the bar, the open tab's ribbon: its modules in captioned sets,
 * centred, and, while you are in one of its modules, that module's sections
 * first. The page keeps its own row of section tabs under its title too.
 *
 * On the Dashboard, and anywhere outside the four tabs, Work is open; in a
 * module, the module's own tab. A tab picked by hand lasts until the next
 * navigation. Click the open tab, or the arrow at the ribbon's end, to fold the
 * ribbon away and keep the bar alone; click any tab to open it again. Folded
 * or open is kept in a cookie and on `<html data-ribbon>`, so the shell's height
 * (`--nesto-shell-header-h`, styles/globals.css) is right on the first paint.
 *
 * It renders what the one navigation resolver produced for this person, so a
 * tab or a module they cannot open is not here.
 */
export function Ribbon({ navigation, folded: foldedAtFirst }: { navigation: NavigationGroup[]; folded: boolean }) {
  const t = useTranslations("shell");
  const moduleNames = useTranslations("modules");
  const pathname = usePathname();
  const levels = useSectionLevels();
  const activeKey = activeNavigationKey(pathname);

  const tabs = navigation.filter((group): group is NavigationGroup & { group: RibbonTab } => isRibbonTab(group.group));
  const home = groupOfPath(navigation, pathname);
  const fallback: RibbonTab | null = home && isRibbonTab(home) ? home : (tabs.find((tab) => tab.group === "work") ?? tabs[0])?.group ?? null;

  const [picked, setPicked] = React.useState<RibbonTab | null>(null);
  React.useEffect(() => setPicked(null), [pathname]);
  const [folded, setFolded] = React.useState(foldedAtFirst);

  const current = picked && tabs.some((tab) => tab.group === picked) ? picked : fallback;
  const group = tabs.find((tab) => tab.group === current) ?? null;
  // The module's own sections, while the open tab holds the module you are in.
  const pageLevel = home === current ? (levels.find((level) => level.module && level.items.length > 1) ?? null) : null;
  const currentItem = navigation.flatMap((candidate) => candidate.items).find((item) => item.module === activeKey) ?? null;

  function fold(next: boolean) {
    setFolded(next);
    document.cookie = `${RIBBON_COOKIE}=${next ? "folded" : "open"}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.ribbon = next ? "folded" : "open";
  }

  // Click the open tab to fold the ribbon; any other tab opens, on that tab.
  function choose(tab: RibbonTab) {
    if (tab === current && !folded) return fold(true);
    setPicked(tab);
    if (folded) fold(false);
  }

  const tabRefs = React.useRef(new Map<RibbonTab, HTMLButtonElement>());
  const baseId = React.useId();

  // A tab list behaves like one (AUD-11 §3): one Tab stop, the arrow keys move between tabs and show them.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const edge = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.group === current);
    const next = tabs[edge ?? (index + step! + tabs.length) % tabs.length]!.group;
    setPicked(next);
    if (folded) fold(false);
    tabRefs.current.get(next)?.focus();
  }

  if (!current || !group) return null;

  // The sets in the layout's order, each with the modules this person has.
  const sets: { key: NavigationItem["set"]; items: NavigationItem[] }[] = [];
  for (const item of group.items) {
    const last = sets[sets.length - 1];
    if (last && last.key === item.set) last.items.push(item);
    else sets.push({ key: item.set, items: [item] });
  }

  return (
    // Draws no box of its own: the tabs are placed in the bar's row, the ribbon under it. It names the module
    // you are in, whichever tab is open, for tests and for anything that reads the shell.
    <div
      data-ribbon
      data-folded={folded || undefined}
      data-current-module={currentItem?.key}
      data-current-href={currentItem?.href}
      data-current-label={currentItem ? moduleNames(`${currentItem.key}.label`) : undefined}
      className="contents"
    >
      {/* The four tabs, centred in the bar's row and standing on its lower edge. */}
      <div
        role="tablist"
        aria-label={t("ribbon.label")}
        onKeyDown={onKeyDown}
        className="absolute left-1/2 top-0 flex h-(--nesto-topbar-row-h) -translate-x-1/2 items-end gap-1 max-lg:hidden"
      >
        {tabs.map((tab) => {
          const selected = tab.group === current;
          return (
            <button
              key={tab.group}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.group, node);
                else tabRefs.current.delete(tab.group);
              }}
              type="button"
              role="tab"
              id={`${baseId}-${tab.group}`}
              aria-selected={selected}
              aria-expanded={selected ? !folded : undefined}
              aria-controls={selected && !folded ? `${baseId}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              title={selected && !folded ? t("ribbon.fold") : undefined}
              onClick={() => choose(tab.group)}
              data-testid={`ribbon-tab-${tab.group}`}
              data-here={home === tab.group || undefined}
              className={cn(
                "relative h-12 whitespace-nowrap rounded-t-[10px] px-5 text-[0.9375rem] transition-colors",
                "after:absolute after:inset-x-4 after:bottom-0 after:h-[3px] after:rounded-t-[3px]",
                selected ? "font-semibold text-fg after:bg-accent" : "text-fg-muted hover:bg-hover hover:text-fg",
                selected && !folded && "bg-surface",
              )}
            >
              {t(`groups.${tab.group}`)}
            </button>
          );
        })}
      </div>

      {/* The open tab's ribbon: its sets, centred, with the module's sections first while you are in it. */}
      {folded ? null : (
        <div
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-${current}`}
          data-shell-region
          data-testid="ribbon-panel"
          className="flex h-(--nesto-ribbon-body-h) bg-surface max-lg:hidden"
        >
          {/* As wide as the fold's column, so the sets are centred on the window. */}
          <span aria-hidden="true" className="w-12 shrink-0" />
          {/* Centred; scrolls sideways when a tab holds more than the window shows. */}
          <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
          <div className="mx-auto flex h-full w-max items-stretch pb-1.5 pt-2">
            {pageLevel ? (
              <RibbonGroup caption={t("ribbon.sections")}>
                {/* In reading order, wrapping to a second line when a module has many sections (HSE has 14). */}
                <div className="flex max-w-[40rem] flex-wrap content-start gap-1 overflow-y-auto">
                  {pageLevel.items.map((item) => (
                    <SectionButton key={item.key} item={item} />
                  ))}
                </div>
              </RibbonGroup>
            ) : null}
            {sets.map((set) => (
              <RibbonGroup key={set.key} caption={t(`ribbon.sets.${set.key}`)}>
                <div className="flex items-start gap-0.5">
                  {set.items.map((item) => (
                    <ModuleButton key={item.key} item={item} active={isNavigationItemActive(item, pathname)} />
                  ))}
                </div>
              </RibbonGroup>
            ))}
          </div>
          </div>
          <div className="flex w-12 shrink-0 items-end justify-center pb-2">
            <button
              type="button"
              onClick={() => fold(true)}
              aria-label={t("ribbon.fold")}
              title={t("ribbon.fold")}
              data-testid="ribbon-fold"
              className="grid size-8 place-items-center rounded-full text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <ChevronUp aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A group of commands with its caption under it, as Office draws one. */
function RibbonGroup({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 shrink-0 flex-col justify-between gap-1 border-r border-line px-2 last:border-r-0 xl:px-3">
      {children}
      <span className="nesto-eyebrow whitespace-nowrap text-center text-[0.5625rem] text-fg-subtle">{caption}</span>
    </div>
  );
}

/** A module: its icon over its name, the whole button the target. The module you are in is marked. */
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
        "relative flex min-h-[4.25rem] min-w-[4.25rem] max-w-[7rem] flex-col items-center gap-1.5 rounded-lg px-1.5 pb-1.5 pt-2.5 text-center text-meta leading-tight text-fg transition-colors xl:min-w-[4.75rem] xl:px-2",
        active ? "bg-hover font-semibold ring-1 ring-inset ring-line-strong" : "hover:bg-hover",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-[22px] shrink-0", active ? "text-fg" : "text-fg-subtle")} />
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
        "relative inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-table font-medium transition-colors",
        item.active ? "bg-primary text-primary-fg" : "text-fg-muted ring-1 ring-inset ring-line hover:bg-hover hover:text-fg",
      )}
    >
      {item.label}
      {item.count ? <span className="rounded-full bg-accent-soft px-1.5 text-micro tabular-nums text-accent-strong">{item.count}</span> : null}
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}
