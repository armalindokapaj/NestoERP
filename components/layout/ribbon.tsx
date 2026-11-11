"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { ChevronUp } from "@/components/icons";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { useUnitsHref } from "@/components/layout/phone-ribbon";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { groupOfPath, isNavigationItemActive, isRibbonTab, itemForPath, type Navigation, type NavigationGroup, type NavigationItem, type RibbonTab } from "@/config/navigation";
import { RIBBON_COOKIE } from "@/lib/layout/nav-layout";
import { cn } from "@/lib/utils/cn";

/**
 * The Ribbon (docs/ui/UI-04-navigation-layouts.md), from `lg`: Office's
 * ribbon, in the top bar. Three parts sharing one state:
 *
 * - `RibbonProvider` wraps the bar's row and the panel, and names the module
 *   you are in for tests and for anything that reads the shell.
 * - `RibbonTabs`: the five tabs — Work, Company, Sales, Procurement, Finance —
 *   as one segmented control in the bar's centre column, on the same line and
 *   at the same height and type as every other control in the bar.
 * - `RibbonPanel`: under the bar, the open tab's buttons in captioned sets of
 *   three or four, centred. A button opens a module or one of its sections
 *   (Orders, Drawings, Leads), so the modules spread evenly across the tabs.
 *
 * On the Dashboard, and anywhere outside the five tabs, Work is open; on a
 * page, the tab holding its button. A tab picked by hand lasts until the next
 * navigation. Click the open tab, or the arrow at the ribbon's end, to fold the
 * ribbon away and keep the bar alone; click any tab to open it again. Folded
 * or open is kept in a cookie and on `<html data-ribbon>`, so the shell's height
 * (`--nesto-shell-header-h`, styles/globals.css) is right on the first paint.
 *
 * It renders what the one navigation resolver produced for this person, so a
 * tab or a module they cannot open is not here.
 */
type RibbonState = {
  tabs: (NavigationGroup & { group: RibbonTab })[];
  /** Every button on every tab, for which one the page is under. */
  items: NavigationItem[];
  current: RibbonTab | null;
  /** The tab holding the module you are in, if one does. */
  home: RibbonTab | null;
  folded: boolean;
  choose: (tab: RibbonTab) => void;
  show: (tab: RibbonTab) => void;
  fold: (next: boolean) => void;
  baseId: string;
};

const RibbonContext = React.createContext<RibbonState | null>(null);

function useRibbon(): RibbonState {
  const state = React.useContext(RibbonContext);
  if (!state) throw new Error("The Ribbon's tabs and panel are drawn inside RibbonProvider.");
  return state;
}

export function RibbonProvider({ navigation, folded: foldedAtFirst, children }: { navigation: Navigation; folded: boolean; children: React.ReactNode }) {
  const pathname = usePathname();

  const tabs = navigation.ribbon.filter((group): group is NavigationGroup & { group: RibbonTab } => isRibbonTab(group.group));
  const items = tabs.flatMap((tab) => tab.items);
  const inGroup = groupOfPath(navigation, pathname);
  const home = inGroup && isRibbonTab(inGroup) ? inGroup : null;
  const fallback: RibbonTab | null = home ?? (tabs.find((tab) => tab.group === "work") ?? tabs[0])?.group ?? null;

  const [picked, setPicked] = React.useState<RibbonTab | null>(null);
  React.useEffect(() => setPicked(null), [pathname]);
  const [folded, setFolded] = React.useState(foldedAtFirst);
  const baseId = React.useId();

  const current = picked && tabs.some((tab) => tab.group === picked) ? picked : fallback;
  // The panel's entry the page is under: a module, or Units.
  const currentItem = itemForPath(navigation.menu.flatMap((group) => group.items), pathname);

  function fold(next: boolean) {
    setFolded(next);
    document.cookie = `${RIBBON_COOKIE}=${next ? "folded" : "open"}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.ribbon = next ? "folded" : "open";
  }

  function show(tab: RibbonTab) {
    setPicked(tab);
    if (folded) fold(false);
  }

  // Click the open tab to fold the ribbon; any other tab opens, on that tab.
  function choose(tab: RibbonTab) {
    if (tab === current && !folded) fold(true);
    else show(tab);
  }

  return (
    <RibbonContext.Provider value={{ tabs, items, current, home, folded, choose, show, fold, baseId }}>
      {/* Draws no box of its own: the bar's row and the panel are its children. */}
      <div
        data-ribbon
        data-folded={folded || undefined}
        data-current-module={currentItem?.module}
        data-current-href={currentItem?.href}
        data-current-label={currentItem?.label}
        className="contents"
      >
        {children}
      </div>
    </RibbonContext.Provider>
  );
}

/**
 * The five tabs, one segmented control: the open tab raised on the track. The
 * tab holding the page you are on carries the homepage's small gold square,
 * whichever tab is open, and with the ribbon folded.
 */
export function RibbonTabs({ className }: { className?: string }) {
  const t = useTranslations("shell");
  const { tabs, current, home, folded, choose, show, baseId } = useRibbon();
  const tabRefs = React.useRef(new Map<RibbonTab, HTMLButtonElement>());

  // A tab list behaves like one (AUD-11 §3): one Tab stop, the arrow keys move between tabs and show them.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const edge = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.group === current);
    const next = tabs[edge ?? (index + step! + tabs.length) % tabs.length]!.group;
    show(next);
    tabRefs.current.get(next)?.focus();
  }

  if (!current) return null;

  return (
    <div
      role="tablist"
      aria-label={t("ribbon.label")}
      onKeyDown={onKeyDown}
      className={cn("flex h-10 items-center gap-0.5 rounded-full bg-surface-muted p-1 ring-1 ring-inset ring-line max-lg:hidden", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.group === current;
        const raised = selected && !folded;
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
            aria-controls={raised ? `${baseId}-panel` : undefined}
            tabIndex={selected ? 0 : -1}
            title={raised ? t("ribbon.fold") : undefined}
            onClick={() => choose(tab.group)}
            data-testid={`ribbon-tab-${tab.group}`}
            data-here={home === tab.group || undefined}
            className={cn(
              "relative inline-flex h-8 items-center whitespace-nowrap rounded-full px-3 text-body font-medium transition-[color,background-color,box-shadow]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              raised ? "bg-surface text-fg shadow-[0_1px_2px_rgb(15_20_26/0.12)] ring-1 ring-line" : "text-fg-muted hover:text-fg",
              // The page you are on is in this tab: the gold square, centred under the name.
              "data-here:after:absolute data-here:after:bottom-[3px] data-here:after:left-1/2 data-here:after:size-[3px] data-here:after:-translate-x-1/2 data-here:after:bg-accent",
            )}
          >
            {t(`groups.${tab.group}`)}
          </button>
        );
      })}
    </div>
  );
}

/** The open tab's ribbon: its sets, centred under the bar, and the arrow that folds it away. */
export function RibbonPanel() {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const { tabs, items, current, folded, fold, baseId } = useRibbon();
  const group = tabs.find((tab) => tab.group === current) ?? null;
  if (folded || !current || !group) return null;

  // The sets in the layout's order, each with the modules this person has.
  const sets: { key: NavigationItem["set"]; items: NavigationItem[] }[] = [];
  for (const item of group.items) {
    const last = sets[sets.length - 1];
    if (last && last.key === item.set) last.items.push(item);
    else sets.push({ key: item.set, items: [item] });
  }

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel`}
      aria-labelledby={`${baseId}-${current}`}
      data-shell-region
      data-testid="ribbon-panel"
      className="flex h-(--nesto-ribbon-body-h) border-t border-line bg-surface max-lg:hidden"
    >
      {/* As wide as the fold's column, so the sets are centred on the window. Below 1440px both give their room to the sets; the open tab still folds it. */}
      <span aria-hidden="true" className="hidden w-12 shrink-0 min-[90rem]:block" />
      {/* Centred; scrolls sideways when a tab holds more than the window shows. */}
      <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
        <div className="mx-auto flex h-full w-max items-stretch pb-1.5 pt-2">
          {sets.map((set) => (
            <RibbonGroup key={set.key} caption={t(`ribbon.sets.${set.key}`)}>
              {set.items.map((item) => (
                <RibbonButton key={item.key} item={item} active={isNavigationItemActive(item, pathname, items)} />
              ))}
            </RibbonGroup>
          ))}
        </div>
      </div>
      <div className="hidden w-12 shrink-0 items-end justify-center pb-2 min-[90rem]:flex">
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
  );
}

/** A group of commands with its caption under it, as Office draws one. */
function RibbonGroup({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 shrink-0 flex-col justify-between gap-1 border-r border-line px-1.5 last:border-r-0 min-[90rem]:px-3">
      <div className="flex items-start gap-0.5">{children}</div>
      <span className="nesto-eyebrow whitespace-nowrap text-center text-[0.5625rem] text-fg-subtle">{caption}</span>
    </div>
  );
}

/** A module or a section: its icon over its name, the whole button the target. The one the page is under is marked. */
function RibbonButton({ item, active }: { item: NavigationItem; active: boolean }) {
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
        "relative flex min-h-[4.25rem] min-w-[4rem] max-w-[7rem] flex-col items-center gap-1.5 rounded-lg px-1.5 pb-1.5 pt-2.5 text-center text-meta leading-tight text-fg transition-colors min-[90rem]:min-w-[4.75rem] min-[90rem]:px-2",
        active ? "bg-hover font-semibold ring-1 ring-inset ring-line-strong" : "hover:bg-hover",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-[22px] shrink-0", active ? "text-fg" : "text-fg-subtle")} />
      <span className="line-clamp-2 max-w-full">{item.label}</span>
      {pending ? <PendingDot className="absolute right-1.5 top-1.5 text-accent" /> : null}
    </Link>
  );
}

/**
 * Units, pinned in the bar: every unit across the projects — or, inside a
 * project, that project's units — one click from any tab, for every role that
 * may see units. Below 1440px it is the icon alone, so the company's name
 * keeps its room.
 */
export function RibbonUnits({ navigation }: { navigation: Navigation }) {
  const t = useTranslations("shell");
  const units = useUnitsHref(navigation);
  const pending = usePendingDestination(units?.href ?? null);
  if (!units) return null;
  const Icon = getIcon("Layers3");
  return (
    <Link
      href={units.href}
      navSource="sidebar"
      intent
      aria-current={units.current ? "page" : undefined}
      aria-label={t("nav.units")}
      title={t("nav.units")}
      data-pending={pending || undefined}
      data-testid="topbar-units"
      className={cn(
        "relative inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-full text-body font-medium ring-1 ring-inset transition-colors max-lg:hidden min-[90rem]:w-auto min-[90rem]:px-4 touch:h-11 touch:min-w-11",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        units.current ? "bg-accent-soft text-accent-strong ring-accent" : "text-fg ring-line hover:bg-hover",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", units.current ? "text-current" : "text-fg-subtle")} />
      <span className="hidden min-[90rem]:inline">{t("nav.units")}</span>
      {pending ? <PendingDot className="absolute right-1 top-1 text-accent" /> : null}
    </Link>
  );
}
