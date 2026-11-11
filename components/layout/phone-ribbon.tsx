"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Building2, ExternalLink, Handshake, Home, Layers3, LogOut, NestoFinance, NestoProcurement, NestoProjects, Plus, RefreshCw, Settings, type IconComponent } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useSignOut } from "@/components/layout/use-sign-out";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { useSectionLevels } from "@/components/navigation/section-registry";
import { hasCurrentSection, menuLevels, pageNameFrom, pillFor, type SectionItem, type SectionLevel } from "@/components/navigation/section-store";
import { Avatar } from "@/components/ui/avatar";
import { usePanelOpen } from "@/lib/navigation/panel-host";
import { isNavigationItemActive, type NavigationGroup, type NavigationGroupKey, type NavigationItem } from "@/config/navigation";
import { projectIdFrom } from "@/lib/navigation/phone";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { requestPageRefresh } from "@/lib/navigation/refresh-event";
import { cn } from "@/lib/utils/cn";

/**
 * What the two phone navigations share (docs/ui/UI-04-navigation-layouts.md):
 * the Pocket Ribbon (pocket-ribbon.tsx, the default) and the Action Ribbon
 * (action-ribbon.tsx). Both are the desktop Ribbon brought to the phone — the
 * same four tabs (Work, Sales, Procurement, Finance) and This page, their
 * modules as large tiles — with Units and Create one tap away from anywhere.
 * Home is the company name in the top bar, and Home, Company and you are in the
 * logo's panel (components/layout/modules-panel.tsx).
 */

/**
 * The event the Create buttons raise; Quick Create listens for it (components/layout/quick-create.tsx)
 * and opens — or, when it is already open, closes. Its `detail.opener` is the button pressed, so the
 * panel's pointer can aim at it.
 */
export const OPEN_QUICK_CREATE_EVENT = "nesto:open-quick-create";

export type PhoneAccount = {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  roleLabel: string;
  workspaceName: string;
};

export type PhoneTab = NavigationGroupKey | "page";

export const GROUP_ICONS: Record<NavigationGroupKey, IconComponent> = {
  primary: Home,
  work: NestoProjects,
  sales: Handshake,
  procurement: NestoProcurement,
  finance: NestoFinance,
  company: Building2,
};

/** The tab's name, as the desktop Ribbon names it. */
export function useGroupLabel() {
  const t = useTranslations("shell");
  return (group: NavigationGroupKey) => t(`groups.${group}`);
}

/** Closes whatever is open after a navigation, and when a tablet turns to landscape (from lg the phone bar is gone). */
export function useCloseOnLeave(close: () => void) {
  const pathname = usePathname();
  const latest = React.useRef(close);
  latest.current = close;
  React.useEffect(() => latest.current(), [pathname]);
  React.useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const onChange = () => wide.matches && latest.current();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);
}

/* -------------------------------------------------------------------------- */
/* This page                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The page's sections, which its tab rows registered (section-registry.tsx) —
 * below lg the rows are not drawn, and This page carries them — and the name
 * This page shows: the section the page is on, else the page's own name.
 */
export function usePageSections(): { levels: SectionLevel[]; label: string | null } {
  const levels = menuLevels(useSectionLevels());
  const pageName = usePageName(!hasCurrentSection(levels));
  return { levels, label: pillFor(levels, pageName)?.label ?? pageName };
}

/**
 * The page's own name (section-store.ts, `pageNameFrom`), read while `enabled`
 * — when no section marks the page — and again as the page streams in or its
 * title changes, so it follows a navigation without a reload.
 */
function usePageName(enabled: boolean): string | null {
  const pathname = usePathname();
  const [name, setName] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setName(pageNameFrom(document.getElementById("nesto-main"), document.title)));
    };
    read();
    const observer = new MutationObserver(read);
    const main = document.getElementById("nesto-main");
    if (main) observer.observe(main, { childList: true, subtree: true, characterData: true });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [enabled, pathname]);
  return enabled ? name : null;
}

/** This page: a gold eyebrow over the section you are on (or the page's name). */
export function ThisPageLabel({ label }: { label: string | null }) {
  const t = useTranslations("shell");
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
      <span className="nesto-eyebrow text-[0.5625rem] text-accent-strong">{t("ribbon.thisPage")}</span>
      <span className="truncate text-body font-semibold text-fg" data-testid="section-menu-current">
        {label ?? "\u00a0"}
      </span>
    </span>
  );
}

/** The page's sections as tiles, a heading over each level when there are two (a unit inside its project). */
export function SectionTiles({ levels, onDone }: { levels: SectionLevel[]; onDone: () => void }) {
  const t = useTranslations("shell");
  return (
    <div className="space-y-4" data-testid="section-menu">
      {levels.map((level) => (
        // Several levels are groups, each named as its row is (a unit inside its project).
        <div key={level.id} role={levels.length > 1 ? "group" : undefined} aria-label={levels.length > 1 ? level.label : undefined} data-testid="section-menu-level" className="space-y-2">
          <h3 aria-hidden={levels.length > 1 || undefined} className="nesto-eyebrow text-fg-subtle">{levels.length > 1 ? level.label : t("ribbon.sections")}</h3>
          <ul className="grid grid-cols-2 gap-2">
            {level.items.map((item) => (
              <li key={item.key}>
                <SectionTile item={item} onDone={onDone} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SectionTile({ item, onDone }: { item: SectionItem; onDone: () => void }) {
  const pending = usePendingDestination(item.newTab ? null : item.href);
  return (
    <Link
      href={item.href}
      navSource="tab"
      target={item.newTab ? "_blank" : undefined}
      rel={item.newTab ? "noopener noreferrer" : undefined}
      aria-current={item.active ? "page" : undefined}
      data-pending={pending || undefined}
      onClick={() => {
        emitNavigationEvent("navigation_destination_opened", { section: item.key, source: "section_menu" });
        if (!item.newTab) onDone();
      }}
      className={cn(tileClass(item.active), "min-h-14 flex-row items-center")}
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.count ? <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-meta tabular-nums text-accent-strong">{item.count}</span> : null}
      {item.newTab ? <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" /> : null}
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Modules                                                                     */
/* -------------------------------------------------------------------------- */

/** A tile: large, bordered, the whole of it the target (84px, for gloves on site). The place you are is gold. */
function tileClass(active: boolean) {
  return cn(
    "relative flex w-full gap-2.5 rounded-[12px] border p-3 text-left text-table font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-fg hover:bg-hover active:bg-hover",
  );
}

export function ModuleTiles({ items, onDone }: { items: readonly NavigationItem[]; onDone: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <li key={item.key}>
          <ModuleTile item={item} active={isNavigationItemActive(item, pathname)} onDone={onDone} />
        </li>
      ))}
    </ul>
  );
}

function ModuleTile({ item, active, onDone }: { item: NavigationItem; active: boolean; onDone: () => void }) {
  const t = useTranslations("modules");
  const Icon = getIcon(item.icon);
  const pending = usePendingDestination(item.href);
  return (
    <Link
      href={item.href}
      navSource="mobile"
      intent
      aria-current={active ? "page" : undefined}
      data-pending={pending || undefined}
      data-testid={`phone-module-${item.key}`}
      onNavigate={() => {
        emitNavigationEvent("navigation_destination_opened", { module: item.key, source: "phone_ribbon" });
        onDone();
      }}
      className={cn(tileClass(active), "min-h-[5.25rem] flex-col justify-between")}
    >
      <Icon aria-hidden="true" className={cn("size-[22px] shrink-0", active ? "text-current" : "text-fg-subtle")} />
      <span className="line-clamp-2 leading-tight">{t(`${item.key}.label`)}</span>
      {pending ? <PendingDot className="absolute right-2.5 top-2.5 text-accent" /> : null}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Account                                                                     */
/* -------------------------------------------------------------------------- */

/** You, at the foot of the logo's panel on a phone: the profile, Settings, Refresh, the theme and Logout. */
export function AccountBlock({ account, onDone }: { account: PhoneAccount; onDone: () => void }) {
  const t = useTranslations("shell");
  const { signOut, signingOut } = useSignOut(onDone);
  const name = `${account.firstName} ${account.lastName}`.trim();
  const row = "flex min-h-14 w-full items-center gap-3 border-b border-line px-3 text-left font-mono text-table font-medium uppercase tracking-[0.08em]";
  return (
    <section aria-label={t("phone.you")} className="space-y-2" data-testid="phone-account">
      <h3 className="nesto-eyebrow text-fg-subtle">{t("phone.you")}</h3>
      <Link href="/settings/profile" navSource="mobile" onNavigate={onDone} className="flex min-h-14 items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2 transition-colors hover:bg-hover">
        <Avatar firstName={account.firstName} lastName={account.lastName} src={account.avatarUrl} size="md" className="border-transparent bg-accent font-display font-medium text-accent-fg" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-body font-semibold text-fg">{name}</span>
          <span className="block truncate text-meta text-fg-muted">{[account.roleLabel, account.workspaceName].filter(Boolean).join(" · ")}</span>
          <span className="sr-only">{t("myProfile")}</span>
        </span>
      </Link>
      <div className="border-t border-line">
        <Link href="/settings" navSource="mobile" onNavigate={onDone} className={cn(row, "text-fg hover:bg-hover")}>
          <Settings aria-hidden="true" className="size-[18px] text-fg-subtle" />
          {t("settings")}
        </Link>
        <button
          type="button"
          data-testid="phone-refresh"
          onClick={() => {
            // Reads the page again, as pulling down at its top does, for whoever does not use the gesture.
            onDone();
            requestPageRefresh();
          }}
          className={cn(row, "text-fg hover:bg-hover")}
        >
          <RefreshCw aria-hidden="true" className="size-[18px] text-fg-subtle" />
          {t("phone.refresh")}
        </button>
        <ThemeToggle variant="row" />
        <button type="button" disabled={signingOut} onClick={() => void signOut()} className={cn(row, "border-b-0 text-danger-strong hover:bg-danger-soft disabled:opacity-60")}>
          <LogOut aria-hidden="true" className="size-[18px]" />
          {signingOut ? t("signingOut") : t("logout")}
        </button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Units and Create                                                            */
/* -------------------------------------------------------------------------- */

const LAST_PROJECT_KEY = "nesto.last-project";

/**
 * Where Units goes: the units of the project you are in, else of the last
 * project you were in on this device, else the projects list to pick one.
 * Null when Projects is not in this person's navigation.
 */
export function useUnitsHref(navigation: readonly NavigationGroup[]): { href: string; current: boolean } | null {
  const pathname = usePathname();
  const hasProjects = navigation.some((group) => group.items.some((item) => item.module === "projects"));
  const here = projectIdFrom(pathname);
  const [last, setLast] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      if (here) window.localStorage.setItem(LAST_PROJECT_KEY, here);
      else setLast(window.localStorage.getItem(LAST_PROJECT_KEY));
    } catch {
      // Storage can be unavailable (a private window); Units then goes to the projects list.
    }
  }, [here]);
  if (!hasProjects) return null;
  const project = here ?? last;
  const href = project ? `/projects/${project}/units` : "/projects";
  return { href, current: pathname === href || pathname.startsWith(`${href}/`) };
}

/** A cell of the bar: icon over a small mono label, at least 56px tall. */
export const cellClass =
  "relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] px-1 font-mono text-[0.625rem] font-medium uppercase leading-none tracking-[0.06em] text-fg-muted transition-colors hover:bg-hover hover:text-fg";

export function UnitsLink({ navigation, className }: { navigation: readonly NavigationGroup[]; className?: string }) {
  const t = useTranslations("shell");
  const units = useUnitsHref(navigation);
  const pending = usePendingDestination(units?.href ?? null);
  if (!units) return null;
  return (
    <Link
      href={units.href}
      navSource="mobile"
      intent
      aria-current={units.current ? "page" : undefined}
      data-pending={pending || undefined}
      data-testid="phone-units"
      onNavigate={() => emitNavigationEvent("navigation_destination_opened", { module: "units", source: "phone_ribbon" })}
      className={cn(cellClass, "aria-[current=page]:text-accent-strong", className)}
    >
      <Layers3 aria-hidden="true" className="size-[22px] shrink-0" />
      {t("phone.units")}
      {pending ? <PendingDot className="absolute right-2 top-2 text-accent" /> : null}
    </Link>
  );
}

/**
 * Create: Quick Create, opened from the bar on a phone (a tablet keeps it in
 * the top bar). `round` is the Pocket Ribbon's filled button, `cell` the
 * Action Ribbon's cell. The plus turns to a cross while its panel is open:
 * the same button closes it.
 */
export function CreateButton({ canCreate, variant }: { canCreate: boolean; variant: "round" | "cell" }) {
  const t = useTranslations("shell");
  const [open] = usePanelOpen("quick_create");
  if (!canCreate) return null;
  const plus = <Plus aria-hidden="true" className={cn("transition-transform duration-200", variant === "round" ? "size-[22px]" : "size-3.5", open && "rotate-45")} />;
  return (
    <button
      type="button"
      aria-label={t("phone.create")}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="phone-create"
      onClick={(event) => {
        // One event either way: Quick Create opens on it, and closes when it is already open.
        if (!open) emitNavigationEvent("quick_create_opened", { source: "phone_ribbon" });
        window.dispatchEvent(new CustomEvent(OPEN_QUICK_CREATE_EVENT, { detail: { opener: event.currentTarget } }));
      }}
      className={cn(
        "shrink-0 md:hidden",
        variant === "round"
          ? "grid size-[52px] place-items-center rounded-full bg-primary text-primary-fg shadow-menu transition-transform active:scale-95"
          : cn(cellClass, "w-[3.5rem]"),
      )}
    >
      {variant === "round" ? (
        plus
      ) : (
        <>
          <span className="grid size-[22px] place-items-center rounded-full border-[1.5px] border-current">{plus}</span>
          <span aria-hidden="true">{t("phone.create")}</span>
        </>
      )}
    </button>
  );
}
