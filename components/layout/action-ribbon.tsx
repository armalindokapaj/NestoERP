"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { LayoutGrid, Search, X } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import {
  CreateButton,
  GROUP_ICONS,
  ModuleTiles,
  SectionTiles,
  ThisPageLabel,
  UnitsLink,
  cellClass,
  useCloseOnLeave,
  useGroupLabel,
  usePageSections,
  type PhoneTab,
} from "@/components/layout/phone-ribbon";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { MobileActionBarHost } from "@/components/ui/mobile-action-bar";
import { findInNavigation, groupOfPath, type Navigation, type NavigationGroupKey } from "@/config/navigation";
import { phoneTabs } from "@/lib/navigation/phone";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { cn } from "@/lib/utils/cn";

/**
 * The Action Ribbon, the second phone navigation in Settings › Appearance
 * (docs/ui/UI-04-navigation-layouts.md), below `lg`. The bar is about doing:
 *
 *   Ribbon · the page's main actions · Units · Create
 *
 * The page's main actions (Approve, Submit…) sit in the bar itself, so the
 * next step is always under the thumb (`MainAction`, components/ui/mobile-action-bar.tsx).
 * On a page without one, that place is This page: the section you are on,
 * which opens the page's sections. Ribbon opens the whole Ribbon as a sheet —
 * the same tabs as the desktop (Work, Company, Sales, Procurement, Finance)
 * and This page, buttons as large tiles, and a field to find any module or
 * section by name. Home is the company name in the top bar; Home and you are
 * in the logo's panel.
 *
 * Renders what the one navigation resolver produced for this person, so a
 * module they cannot open is not here.
 */
export function ActionRibbon({ navigation, canCreate }: { navigation: Navigation; canCreate: boolean }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const groupLabel = useGroupLabel();
  const { levels, label } = usePageSections();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<PhoneTab>("work");
  const [query, setQuery] = React.useState("");
  const navigated = React.useRef(false);
  useCloseOnLeave(() => setOpen(false));

  const groups = React.useMemo(() => phoneTabs(navigation), [navigation]);
  // The group holding the module you are in: the Ribbon opens on it, and its tab is gold.
  const here = groupOfPath(navigation, pathname);
  const tabs: { id: PhoneTab; label: string }[] = groups.map((group) => ({ id: group.group, label: groupLabel(group.group) }));
  if (levels.length > 0) tabs.push({ id: "page", label: t("ribbon.thisPage") });
  const current: PhoneTab | null = tabs.some((tab) => tab.id === picked) ? picked : (tabs[0]?.id ?? null);
  const group = groups.find((candidate) => candidate.group === current) ?? null;

  // The field finds any module or section, Home's too.
  const found = query.trim() ? findInNavigation(navigation, query) : null;

  const show = (tab: PhoneTab) => {
    navigated.current = false;
    setQuery("");
    setPicked(tab);
    setOpen(true);
    emitNavigationEvent(tab === "page" ? "section_menu_opened" : "more_opened", { tab, levels: levels.length });
  };
  const done = () => {
    navigated.current = true;
    setOpen(false);
  };

  const tabRefs = React.useRef(new Map<PhoneTab, HTMLButtonElement>());
  // A tab list behaves like one: one Tab stop, the arrow keys move between tabs and show them.
  function onTabKey(event: React.KeyboardEvent<HTMLDivElement>) {
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
    <nav
      aria-label={t("phone.label")}
      data-mobile-bottom-nav="action"
      data-testid="phone-navigation"
      className="fixed inset-x-0 bottom-0 z-(--nesto-z-shell-tabs) border-t border-line bg-surface pb-(--nesto-safe-bottom) lg:hidden"
    >
      <div className="mx-auto flex h-20 max-w-xl items-center gap-1 px-2">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="phone-ribbon"
          onClick={() => show(here ?? groups[0]?.group ?? "page")}
          className={cn(cellClass, "w-14 shrink-0", open && "bg-primary text-primary-fg hover:bg-primary hover:text-primary-fg")}
        >
          <LayoutGrid aria-hidden="true" className="size-[22px] shrink-0" />
          {t("phone.ribbon")}
        </button>

        {/* The page's main actions, or This page where it has none (the rule hides it beside a full slot). */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <MobileActionBarHost inline />
          {levels.length > 0 ? (
            <button
              type="button"
              aria-label={t("sectionMenu.trigger", { section: label ?? "" })}
              aria-haspopup="dialog"
              aria-expanded={open && current === "page"}
              data-testid="section-menu-trigger"
              onClick={() => show("page")}
              className="flex h-14 min-w-0 flex-1 items-center gap-2 rounded-none bg-accent-soft px-3 text-left [[data-action-slot]:not(:empty)+&]:hidden"
            >
              <ThisPageLabel label={label} />
            </button>
          ) : (
            <div data-testid="phone-this-page" className="flex h-14 min-w-0 flex-1 items-center px-3 [[data-action-slot]:not(:empty)+&]:hidden">
              <ThisPageLabel label={label} />
            </div>
          )}
        </div>

        <UnitsLink navigation={navigation} className="w-14 shrink-0" />
        <CreateButton canCreate={canCreate} variant="cell" />
      </div>

      {/* The whole Ribbon, as a sheet from the bottom. */}
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          side="bottom"
          className="mx-auto h-[85dvh] max-w-xl overflow-hidden bg-canvas"
          data-testid="phone-ribbon-sheet"
          onCloseAutoFocus={(event) => {
            if (!navigated.current) return;
            // The route's own focus handling takes the person to the new page (components/layout/route-focus.tsx).
            navigated.current = false;
            event.preventDefault();
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 pb-1.5 pl-5 pr-3 pt-3.5">
            <DrawerTitle className="font-display text-[1.75rem] text-fg">{t("phone.ribbon")}</DrawerTitle>
            <DrawerClose aria-label={t("phone.close")} className="grid size-12 shrink-0 place-items-center rounded-none text-fg-muted hover:bg-hover hover:text-fg">
              <X aria-hidden="true" className="size-5" />
            </DrawerClose>
          </div>

          <div role="tablist" aria-label={t("phone.tabs")} onKeyDown={onTabKey} className="flex shrink-0 gap-1 px-3 pb-2.5">
            {tabs.map((tab) => {
              const selected = !found && tab.id === current;
              const page = tab.id === "page";
              const Icon = page ? null : GROUP_ICONS[tab.id as NavigationGroupKey];
              return (
                <button
                  key={tab.id}
                  ref={(node) => {
                    if (node) tabRefs.current.set(tab.id, node);
                    else tabRefs.current.delete(tab.id);
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={tab.id === current ? 0 : -1}
                  data-testid={`phone-tab-${tab.id}`}
                  onClick={() => {
                    setQuery("");
                    setPicked(tab.id);
                  }}
                  className={cn(
                    "flex h-[3.75rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-none font-mono text-[0.5625rem] font-medium uppercase leading-none tracking-[0.05em] transition-colors",
                    page
                      ? selected
                        ? "bg-accent text-accent-fg"
                        : "text-accent-strong ring-1 ring-inset ring-accent"
                      : selected
                        ? "bg-primary text-primary-fg"
                        : tab.id === here
                          ? "text-accent-strong hover:bg-hover"
                          : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  {Icon ? <Icon aria-hidden="true" className="size-5 shrink-0" /> : <span aria-hidden="true" className="size-2 rounded-full bg-current" />}
                  <span className="max-w-full truncate px-0.5">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <label className="mx-4 mb-3 flex h-12 shrink-0 items-center gap-2 rounded-none border border-line bg-surface px-4 focus-within:ring-2 focus-within:ring-ring">
            <Search aria-hidden="true" className="size-[18px] shrink-0 text-fg-subtle" />
            <span className="sr-only">{t("phone.find")}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("phone.find")}
              data-testid="phone-find"
              className="h-full min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:appearance-none"
            />
          </label>

          <div role={found ? undefined : "tabpanel"} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-6">
            {found ? (
              found.length === 0 ? (
                <p role="status" className="py-6 text-center text-table text-fg-muted">
                  {t("phone.noMatch")}
                </p>
              ) : (
                found.map((candidate) => (
                  <section key={candidate.group} aria-label={groupLabel(candidate.group)} className="space-y-2">
                    <h3 className="nesto-eyebrow text-fg-subtle">{groupLabel(candidate.group)}</h3>
                    <ModuleTiles items={candidate.items} onDone={done} />
                  </section>
                ))
              )
            ) : current === "page" ? (
              <SectionTiles levels={levels} onDone={done} />
            ) : (
              group && group.items.length > 0 ? <ModuleTiles items={group.items} onDone={done} /> : null
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </nav>
  );
}
