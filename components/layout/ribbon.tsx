"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { ChevronUp } from "@/components/icons";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { itemForPath } from "@/config/navigation";
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
 * tab or a module they cannot open is not here. The same Ribbon draws the
 * Admin Console's five areas (components/platform/admin-navigation.ts): each
 * shell hands it a `RibbonModel` with its words already in the reader's
 * language.
 */

/** One button: a module, a section or a page. `icon` is a name for `getIcon`. */
export type RibbonItem = { key: string; href: string; icon: string; label: string; set: string };

/** What a shell hands the Ribbon. */
export type RibbonModel = {
  /** The tabs in the bar's order, each with its buttons in their sets' order. */
  tabs: { key: string; label: string; items: RibbonItem[] }[];
  /** Each set's caption, by its key. */
  sets: Record<string, string>;
  /**
   * Every place the shell names, with the tab it belongs to (none outside the
   * tabs): which tab holds the page — the buttons' own finer places first —
   * and what the shell says the page is under (`data-current-*`).
   */
  places: { key: string; href: string; label: string; module?: string; tab: string | null }[];
  /** The tab open where no tab holds the page. */
  fallback: string | null;
};

type RibbonState = {
  tabs: RibbonModel["tabs"];
  sets: RibbonModel["sets"];
  /** Every button on every tab, for which one the page is under. */
  items: RibbonItem[];
  current: string | null;
  /** The tab holding the place you are in, if one does. */
  home: string | null;
  folded: boolean;
  choose: (tab: string) => void;
  show: (tab: string) => void;
  fold: (next: boolean) => void;
  baseId: string;
};

const RibbonContext = React.createContext<RibbonState | null>(null);

function useRibbon(): RibbonState {
  const state = React.useContext(RibbonContext);
  if (!state) throw new Error("The Ribbon's tabs and panel are drawn inside RibbonProvider.");
  return state;
}

export function RibbonProvider({ model, folded: foldedAtFirst, children }: { model: RibbonModel; folded: boolean; children: React.ReactNode }) {
  const pathname = usePathname();

  const { tabs, sets, places } = model;
  const items = tabs.flatMap((tab) => tab.items);
  // The tab the page is in: the buttons' finer places first (Units is Sales, though it lives under Projects), then the shell's.
  const located = itemForPath([...tabs.flatMap((tab) => tab.items.map((item) => ({ href: item.href, tab: tab.key }))), ...places], pathname);
  const home = located?.tab ?? null;
  const fallback = home ?? model.fallback ?? tabs[0]?.key ?? null;

  const [picked, setPicked] = React.useState<string | null>(null);
  React.useEffect(() => setPicked(null), [pathname]);
  const [folded, setFolded] = React.useState(foldedAtFirst);
  const baseId = React.useId();

  const current = picked && tabs.some((tab) => tab.key === picked) ? picked : fallback;
  // The place the page is under: a module, or Units.
  const currentItem = itemForPath(places, pathname);

  function fold(next: boolean) {
    setFolded(next);
    document.cookie = `${RIBBON_COOKIE}=${next ? "folded" : "open"}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.ribbon = next ? "folded" : "open";
  }

  function show(tab: string) {
    setPicked(tab);
    if (folded) fold(false);
  }

  // Click the open tab to fold the ribbon; any other tab opens, on that tab.
  function choose(tab: string) {
    if (tab === current && !folded) fold(true);
    else show(tab);
  }

  return (
    <RibbonContext.Provider value={{ tabs, sets, items, current, home, folded, choose, show, fold, baseId }}>
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
 * The tabs, one segmented control: the open tab raised on the track. The
 * tab holding the page you are on carries the homepage's small gold square,
 * whichever tab is open, and with the ribbon folded.
 */
export function RibbonTabs({ className }: { className?: string }) {
  const t = useTranslations("shell");
  const { tabs, current, home, folded, choose, show, baseId } = useRibbon();
  const tabRefs = React.useRef(new Map<string, HTMLButtonElement>());

  // A tab list behaves like one (AUD-11 §3): one Tab stop, the arrow keys move between tabs and show them.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const edge = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.key === current);
    const next = tabs[edge ?? (index + step! + tabs.length) % tabs.length]!.key;
    show(next);
    tabRefs.current.get(next)?.focus();
  }

  if (!current) return null;

  return (
    <div
      role="tablist"
      aria-label={t("ribbon.label")}
      onKeyDown={onKeyDown}
      className={cn("flex h-10 items-stretch border border-line-strong bg-surface max-lg:hidden", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.key === current;
        const raised = selected && !folded;
        return (
          <button
            key={tab.key}
            ref={(node) => {
              if (node) tabRefs.current.set(tab.key, node);
              else tabRefs.current.delete(tab.key);
            }}
            type="button"
            role="tab"
            id={`${baseId}-${tab.key}`}
            aria-selected={selected}
            aria-expanded={selected ? !folded : undefined}
            aria-controls={raised ? `${baseId}-panel` : undefined}
            tabIndex={selected ? 0 : -1}
            title={raised ? t("ribbon.fold") : undefined}
            onClick={() => choose(tab.key)}
            data-testid={`ribbon-tab-${tab.key}`}
            data-here={home === tab.key || undefined}
            className={cn(
              "relative inline-flex items-center whitespace-nowrap border-r border-line-strong px-3 text-body font-medium transition-colors last:border-r-0",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              raised ? "bg-fg text-canvas" : "text-fg-muted hover:bg-hover hover:text-fg",
              // The page you are on is in this tab: the gold square, centred under the name.
              "data-here:after:absolute data-here:after:bottom-[3px] data-here:after:left-1/2 data-here:after:size-[3px] data-here:after:-translate-x-1/2 data-here:after:bg-accent",
            )}
          >
            {tab.label}
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
  const { tabs, sets: captions, items, current, folded, fold, baseId } = useRibbon();
  const group = tabs.find((tab) => tab.key === current) ?? null;
  if (folded || !current || !group) return null;

  // The sets in the layout's order, each with the buttons this person has.
  const sets: { key: string; items: RibbonItem[] }[] = [];
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
      className="flex h-(--nesto-ribbon-body-h) border-t border-line max-lg:hidden"
    >
      {/* As wide as the fold's column, so the sets are centred on the window. Below 1440px both give their room to the sets; the open tab still folds it. */}
      <span aria-hidden="true" className="hidden w-12 shrink-0 min-[90rem]:block" />
      {/* Centred; scrolls sideways when a tab holds more than the window shows. */}
      <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
        <div className="mx-auto flex h-full w-max items-stretch pb-1.5 pt-2">
          {sets.map((set) => (
            <RibbonGroup key={set.key} caption={captions[set.key] ?? set.key}>
              {set.items.map((item) => (
                <RibbonButton key={item.key} item={item} active={itemForPath(items, pathname)?.key === item.key} />
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
          className="grid size-8 place-items-center rounded-none text-fg-muted transition-colors hover:bg-hover hover:text-fg"
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
function RibbonButton({ item, active }: { item: RibbonItem; active: boolean }) {
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
        "relative flex min-h-[4.25rem] min-w-[4rem] max-w-[7rem] flex-col items-center gap-1.5 rounded-none px-1.5 pb-1.5 pt-2.5 text-center text-meta leading-tight text-fg transition-colors min-[90rem]:min-w-[4.75rem] min-[90rem]:px-2",
        active ? "bg-surface font-semibold ring-1 ring-inset ring-fg" : "hover:bg-hover",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-[22px] shrink-0", active ? "text-fg" : "text-fg-subtle")} />
      <span className="line-clamp-2 max-w-full">{item.label}</span>
      {pending ? <PendingDot className="absolute right-1.5 top-1.5 text-accent" /> : null}
    </Link>
  );
}
