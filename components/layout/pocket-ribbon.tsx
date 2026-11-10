"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ChevronUp, X } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import {
  AccountBlock,
  CreateButton,
  GROUP_ICONS,
  ModuleTiles,
  SectionTiles,
  ThisPageLabel,
  UnitsLink,
  useCloseOnLeave,
  useGroupLabel,
  usePageSections,
  type PhoneAccount,
  type PhoneTab,
} from "@/components/layout/phone-ribbon";
import type { NavigationGroup } from "@/config/navigation";
import { groupOf, phoneTabs } from "@/lib/navigation/phone";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { cn } from "@/lib/utils/cn";

/**
 * The Pocket Ribbon, the default phone navigation (docs/ui/UI-04-navigation-layouts.md):
 * the desktop Ribbon folded into the bottom of the phone, below `lg`.
 *
 * The bar is the Ribbon's tabs — Home, Work, Department, Company — in the
 * thumb's reach. A tab opens its modules as large tiles just above it, the
 * module you are in marked gold; the tab holding it is marked too, so you
 * always know where you are. Company also holds you: the profile, Settings,
 * Refresh, the theme and Logout.
 *
 * Above the bar floats the strip: This page — the section you are on, which
 * opens the page's sections — then Units and Create, one tap from anywhere.
 * A page's main action still has its own bar above the strip (components/ui/mobile-action-bar.tsx).
 *
 * Renders what the one navigation resolver produced for this person, so a
 * module they cannot open is not here. Content keeps clear of it by
 * `--nesto-bottom-nav-space` (styles/globals.css), so no page pads itself.
 */
export function PocketRibbon({ navigation, canCreate, account }: { navigation: NavigationGroup[]; canCreate: boolean; account: PhoneAccount }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const groupLabel = useGroupLabel();
  const { levels, label } = usePageSections();
  const [open, setOpen] = React.useState<PhoneTab | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  const panelId = React.useId();

  const tabs = React.useMemo(() => phoneTabs(navigation), [navigation]);
  const here = groupOf(navigation, pathname);
  const shown = open === "page" ? null : tabs.find((group) => group.group === open) ?? null;

  // Closed by Escape or its Close button, focus goes back to what opened it — once it is drawn again.
  const restore = React.useRef(false);
  const close = React.useCallback((back: boolean) => {
    restore.current = back;
    setOpen(null);
  }, []);
  React.useEffect(() => {
    if (open || !restore.current) return;
    restore.current = false;
    opener.current?.focus({ preventScroll: true });
  }, [open]);
  useCloseOnLeave(() => setOpen(null));

  const toggle = (tab: PhoneTab) => (event: React.MouseEvent<HTMLElement>) => {
    if (open === tab) return close(false);
    opener.current = event.currentTarget;
    emitNavigationEvent(tab === "page" ? "section_menu_opened" : "more_opened", { tab, levels: levels.length });
    setOpen(tab);
  };

  // Opened, the panel takes focus on what you are on (or its first tile); Escape closes it, back to its tab.
  React.useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>('a[aria-current="page"]') ?? panel?.querySelector<HTMLElement>("a[href]");
    target?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const done = () => setOpen(null);

  return (
    <nav
      aria-label={t("phone.label")}
      data-mobile-bottom-nav="pocket"
      data-testid="phone-navigation"
      className={cn("fixed inset-x-0 bottom-0 lg:hidden", open ? "z-40" : "z-(--nesto-z-shell-tabs)")}
    >
      {open ? (
        <>
          {/* The page behind, dimmed: a tap on it closes the panel. */}
          <button type="button" tabIndex={-1} aria-label={t("phone.close")} onClick={() => close(false)} className="fixed inset-0 bg-[rgb(15_20_26/0.32)]" />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={open === "page" ? t("ribbon.thisPage") : groupLabel(open)}
            data-testid="phone-panel"
            className="absolute inset-x-0 bottom-full mx-auto flex max-h-[min(72dvh,42rem)] max-w-xl flex-col rounded-t-[20px] border border-b-0 border-line bg-canvas shadow-menu"
          >
            <div className="flex shrink-0 items-start justify-between gap-2 pb-2.5 pl-5 pr-3 pt-4">
              <div className="min-w-0">
                <p className={cn("nesto-eyebrow", open === "page" ? "text-accent-strong" : "text-fg-subtle")}>{open === "page" ? t("ribbon.thisPage") : t("ribbon.modules")}</p>
                <h2 className="truncate font-display text-[1.75rem] leading-tight text-fg">{open === "page" ? label : groupLabel(open)}</h2>
              </div>
              <button type="button" aria-label={t("phone.close")} onClick={() => close(true)} className="grid size-12 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-hover hover:text-fg">
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-5">
              {open === "page" ? <SectionTiles levels={levels} onDone={done} /> : null}
              {shown && shown.items.length > 0 ? <ModuleTiles items={shown.items} onDone={done} /> : null}
              {shown?.group === "company" ? <AccountBlock account={account} onDone={done} /> : null}
            </div>
          </div>
        </>
      ) : null}
      {/* The strip: This page, Units, Create. Hidden while a panel is open, which covers its place. */}
      <div hidden={open !== null} className="pointer-events-none absolute inset-x-0 bottom-full px-2.5 pb-2">
        <div data-testid="phone-strip" className="pointer-events-auto mx-auto flex max-w-xl items-center gap-1.5 rounded-[18px] border border-line bg-surface/90 p-1 shadow-menu backdrop-blur-xl">
          {levels.length > 0 ? (
            <button
              type="button"
              aria-label={t("sectionMenu.trigger", { section: label ?? "" })}
              aria-haspopup="dialog"
              aria-expanded={open === "page"}
              data-testid="section-menu-trigger"
              onClick={toggle("page")}
              className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2.5 rounded-[13px] bg-accent-soft px-3 text-left"
            >
              <ThisPageLabel label={label} />
              <ChevronUp aria-hidden="true" className="size-5 shrink-0 text-accent-strong" />
            </button>
          ) : (
            <div className="flex min-h-[52px] min-w-0 flex-1 items-center px-3" data-testid="phone-this-page">
              <ThisPageLabel label={label} />
            </div>
          )}
          <UnitsLink navigation={navigation} className="h-[52px] w-[3.75rem] shrink-0 rounded-[13px] border border-line bg-surface aria-[current=page]:border-accent" />
          <CreateButton canCreate={canCreate} variant="round" />
        </div>
      </div>

      {/* The bar: the Ribbon's tabs. */}
      <div className="relative border-t border-line bg-surface pb-(--nesto-safe-bottom)">
        <ul className="mx-auto flex h-[4.75rem] max-w-xl items-center gap-1 px-2">
          {tabs.map((group) => {
            const Icon = GROUP_ICONS[group.group];
            const expanded = open === group.group;
            return (
              <li key={group.group} className="min-w-0 flex-1">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={expanded ? panelId : undefined}
                  aria-haspopup="dialog"
                  data-testid={`phone-tab-${group.group}`}
                  data-here={here === group.group || undefined}
                  onClick={toggle(group.group)}
                  className={cn(
                    "relative flex h-16 w-full flex-col items-center justify-center gap-1.5 rounded-[16px] font-mono text-[0.625rem] font-medium uppercase leading-none tracking-[0.07em] transition-colors",
                    expanded
                      ? "bg-primary text-primary-fg"
                      : here === group.group
                        ? "text-accent-strong after:absolute after:bottom-1.5 after:h-0.5 after:w-[18px] after:rounded-full after:bg-accent"
                        : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  <Icon aria-hidden="true" className="size-6 shrink-0" />
                  <span className="max-w-full truncate">{groupLabel(group.group)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
