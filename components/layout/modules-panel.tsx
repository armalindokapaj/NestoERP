"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { Search, X } from "@/components/icons";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { OrganizationMark } from "@/components/layout/organization-mark";
import { OrganizationWorkspaceHeader } from "@/components/layout/organization-workspace-header";
import { AccountBlock, type PhoneAccount } from "@/components/layout/phone-ribbon";
import { useShellCore } from "@/components/layout/shell-slots";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { isNavigationItemActive, type NavigationGroup, type NavigationItem } from "@/config/navigation";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { cn } from "@/lib/utils/cn";

/**
 * The company logo at the start of the top bar, and what it opens: every
 * module this person may open, by group — Home, Work, Sales, Procurement,
 * Finance, Company — in a panel on the left third of the screen, the way
 * Office's app launcher opens (docs/ui/UI-04-navigation-layouts.md). The
 * panel's header is the workspace, and switches it where there is somewhere
 * else to work; a field finds a module by name. On a phone, where the top bar
 * has no account button, the panel ends with you: the profile, Settings,
 * Refresh, the theme and Logout.
 *
 * Renders what the one navigation resolver produced, so a module this person
 * cannot open is not here.
 */
export function ModulesPanel({ navigation, account }: { navigation: NavigationGroup[]; account: PhoneAccount }) {
  const t = useTranslations("shell");
  const moduleNames = useTranslations("modules");
  const { activeWorkspace, organization } = useShellCore();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const navigated = React.useRef(false);
  React.useEffect(() => setOpen(false), [pathname]);

  const needle = query.trim().toLocaleLowerCase();
  const groups = needle
    ? navigation
        .map((group) => ({ ...group, items: group.items.filter((item) => moduleNames(`${item.key}.label`).toLocaleLowerCase().includes(needle)) }))
        .filter((group) => group.items.length > 0)
    : navigation;

  const done = () => {
    navigated.current = true;
    setOpen(false);
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          emitNavigationEvent("more_opened", { tab: "all", levels: 0 });
        }
      }}
    >
      {/* The logo: the workspace's mark, with a small grid that says it opens every module. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("modulesPanel.open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("modulesPanel.open")}
        data-testid="modules-panel-trigger"
        className="relative shrink-0 rounded-[12px] p-1 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <OrganizationMark name={activeWorkspace.label} logoUrl={organization.logoUrl} size="sm" className="size-9! rounded-[9px]! text-[0.8125rem]! border border-accent bg-surface text-accent-strong" />
        <span aria-hidden="true" className="absolute bottom-0 right-0 grid grid-cols-3 gap-[1.5px] rounded-[4px] bg-fg p-[2.5px]">
          {Array.from({ length: 9 }, (_, index) => (
            <i key={index} className="block size-[3px] bg-canvas" />
          ))}
        </span>
      </button>

      <DrawerContent
        side="left"
        data-testid="modules-panel"
        aria-describedby={undefined}
        className="inset-y-0 left-0 w-full max-w-none rounded-none border-0 border-r border-fg bg-canvas pl-[env(safe-area-inset-left)] backdrop-blur-none sm:w-[max(26rem,33.333vw)]"
        onCloseAutoFocus={(event) => {
          if (!navigated.current) return;
          // The route's own focus handling takes the person to the new page (components/layout/route-focus.tsx).
          navigated.current = false;
          event.preventDefault();
        }}
      >
        <DrawerTitle className="sr-only">{t("modulesPanel.title")}</DrawerTitle>
        {/* The workspace, which switches it where there is somewhere else to work; then Close. */}
        <div className="flex h-(--nesto-topbar-row-h) shrink-0 items-center gap-2 border-b border-fg pl-3 pr-2">
          <div className="min-w-0 flex-1">
            <OrganizationWorkspaceHeader onSwitchStart={() => setOpen(false)} />
          </div>
          <DrawerClose aria-label={t("modulesPanel.close")} className="grid size-10 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-hover hover:text-fg touch:size-11">
            <X aria-hidden="true" className="size-5" />
          </DrawerClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-4">
          <label className="flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 focus-within:ring-2 focus-within:ring-ring">
            <Search aria-hidden="true" className="size-[18px] shrink-0 text-fg-subtle" />
            <span className="sr-only">{t("modulesPanel.find")}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("modulesPanel.find")}
              data-testid="modules-panel-find"
              className="h-full min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:appearance-none"
            />
          </label>

          {groups.length === 0 ? (
            <p role="status" className="py-8 text-center text-table text-fg-muted">
              {t("modulesPanel.noMatch")}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.group} aria-labelledby={`modules-panel-${group.group}`} data-testid={`modules-panel-${group.group}`}>
                <h3 id={`modules-panel-${group.group}`} className="nesto-eyebrow mb-2 mt-5 flex items-center gap-2.5 text-fg-subtle after:h-px after:flex-1 after:bg-line">
                  {t(`groups.${group.group}`)}
                </h3>
                <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.key} className="min-w-0">
                      <ModuleLink item={item} active={isNavigationItemActive(item, pathname)} onDone={done} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}

          {/* A phone's top bar has no account button: you are here instead. */}
          <div className="mt-8 md:hidden">
            <AccountBlock account={account} onDone={done} />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function ModuleLink({ item, active, onDone }: { item: NavigationItem; active: boolean; onDone: () => void }) {
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
      data-testid={`modules-panel-module-${item.key}`}
      onNavigate={() => {
        emitNavigationEvent("navigation_destination_opened", { module: item.key, source: "modules_panel" });
        onDone();
      }}
      className={cn(
        "relative flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-table transition-colors touch:min-h-12",
        active ? "bg-accent-soft font-semibold text-accent-strong" : "text-fg hover:bg-hover",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-[18px] shrink-0", active ? "text-current" : "text-fg-subtle")} />
      <span className="min-w-0 flex-1 truncate">{t(`${item.key}.label`)}</span>
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}

/**
 * Home: the workspace's name in the top bar — the company, or the group in
 * the Group workspace — which goes straight to its Dashboard, with a small
 * Home under it so it reads as the way home. It switches nothing: the switch
 * is the logo's panel.
 */
export function HomeLink() {
  const t = useTranslations("workspace");
  const shell = useTranslations("shell");
  const { activeWorkspace } = useShellCore();
  const inGroup = activeWorkspace.scopeType === "GROUP";
  const current = inGroup ? `${activeWorkspace.groupLabel} — ${t("groupWorkspaceName")}` : activeWorkspace.label;
  return (
    <Link
      href="/dashboard"
      intent
      aria-label={t("homeLabel", { name: current })}
      data-testid="topbar-home"
      data-scope={activeWorkspace.scopeType}
      className="flex min-w-0 shrink flex-col items-start gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span data-testid="workspace-label" className="max-w-full truncate font-mono text-[0.75rem] font-medium uppercase leading-none tracking-[0.2em] text-fg">
        {activeWorkspace.label}
      </span>
      <span aria-hidden="true" className="font-mono text-[0.5625rem] uppercase leading-none tracking-[0.16em] text-fg-subtle">
        {shell("ribbon.home")}
      </span>
    </Link>
  );
}
