"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, CircleHelp, LogOut, RefreshCw, Search, Settings } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { OrganizationWorkspaceHeader } from "@/components/layout/organization-workspace-header";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useSignOut } from "@/components/layout/use-sign-out";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { Avatar } from "@/components/ui/avatar";
import { LineCaption } from "@/components/ui/lined";
import { findInNavigation, type Navigation, type NavigationGroup, type NavigationItem } from "@/config/navigation";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { requestPageRefresh } from "@/lib/navigation/refresh-event";
import { cn } from "@/lib/utils/cn";

export type MenuAccount = {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  roleLabel: string;
  workspaceName: string;
};

/**
 * Menu, the phone's fifth place (docs/ui/UI-04-navigation-layouts.md §Phone):
 * the map of Nesto. The workspace, which switches it where there is somewhere
 * else to work; you; a field that finds any module or section by name; Home's
 * own pages; then the five departments — Work, Company, Sales, Procurement and
 * Finance — as lines that open in place, their modules in the Ribbon's
 * captioned sets; and at the foot your settings, Day or Night, Help and Sign
 * out.
 *
 * Renders what the one navigation resolver produced for this person, so a
 * module they cannot open is not here.
 */
export function PhoneMenu({ navigation, account }: { navigation: Navigation; account: MenuAccount }) {
  const t = useTranslations("shell");
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(navigation.ribbon[0]?.group ?? null);
  const found = query.trim() ? findInNavigation(navigation, query) : null;
  const home = navigation.menu.find((group) => group.group === "primary")?.items ?? [];
  let number = 0;
  const next = () => String(++number).padStart(2, "0");

  return (
    <div className="-mx-(--nesto-gutter) -mt-(--nesto-space-page-y) max-w-2xl md:mx-auto" data-testid="phone-menu">
      <div className="border-b border-line-strong px-4 py-2 sm:px-6">
        <OrganizationWorkspaceHeader />
      </div>
      <Link href="/settings/profile" navSource="mobile" className="flex min-h-20 items-center gap-4 border-b border-line-strong px-4 py-4 transition-colors hover:bg-hover sm:px-6" data-testid="phone-menu-you">
        <Avatar firstName={account.firstName} lastName={account.lastName} src={account.avatarUrl} size="lg" className="rounded-none border-transparent bg-accent font-display font-medium text-accent-fg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-card font-semibold text-fg">{`${account.firstName} ${account.lastName}`.trim()}</span>
          <span className="block truncate text-table text-fg-muted">{[account.roleLabel, account.workspaceName].filter(Boolean).join(" · ")}</span>
          <span className="sr-only">{t("myProfile")}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      </Link>

      <div className="px-4 py-4 sm:px-6">
        <label className="flex h-[3.25rem] items-center gap-3 border border-control bg-surface px-4 focus-within:ring-2 focus-within:ring-ring">
          <Search aria-hidden="true" className="size-[18px] shrink-0 text-fg-subtle" />
          <span className="sr-only">{t("modulesPanel.find")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("modulesPanel.find")}
            data-testid="phone-menu-find"
            className="h-full min-w-0 flex-1 bg-transparent text-[1rem] text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:appearance-none"
          />
        </label>
      </div>

      {found ? (
        <section aria-label={t("modulesPanel.find")} className="mt-2">
          <LineCaption number={next()} label={t("phone.found")} count={found.reduce((sum, group) => sum + group.items.length, 0)} />
          {found.length === 0 ? (
            <p role="status" className="px-4 py-8 text-center text-table text-fg-muted sm:px-6">
              {t("modulesPanel.noMatch")}
            </p>
          ) : (
            <ul className="grid grid-cols-2 border-b border-line-strong bg-surface">
              {found.flatMap((group) => group.items).map((item) => (
                <li key={item.key} className="min-w-0">
                  <Module item={item} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {home.length > 0 ? (
            <section aria-label={t("phone.home")} className="mt-2">
              <LineCaption number={next()} label={t("phone.home")} count={home.length} />
              <ul className="grid grid-cols-2 border-b border-line-strong bg-surface">
                {home.map((item) => (
                  <li key={item.key} className="min-w-0">
                    <Module item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {navigation.ribbon.length > 0 ? (
            <section aria-label={t("phone.departments")} className="mt-7">
              <LineCaption number={next()} label={t("phone.departments")} count={navigation.ribbon.length} />
              {navigation.ribbon.map((group) => (
                <Department key={group.group} group={group} open={open === group.group} onToggle={() => setOpen(open === group.group ? null : group.group)} />
              ))}
            </section>
          ) : null}
        </>
      )}

      <section aria-label={t("phone.you")} className="mt-7" data-testid="phone-account">
        <LineCaption number={next()} label={t("phone.you")} />
        <You />
      </section>
    </div>
  );
}

/** A department: a line that opens in place, its modules below it in the Ribbon's sets. */
function Department({ group, open, onToggle }: { group: NavigationGroup; open: boolean; onToggle: () => void }) {
  const t = useTranslations("shell");
  const panel = React.useId();
  const sets: { key: NavigationItem["set"]; items: NavigationItem[] }[] = [];
  for (const item of group.items) {
    const last = sets[sets.length - 1];
    if (last && last.key === item.set) last.items.push(item);
    else sets.push({ key: item.set, items: [item] });
  }
  const Icon = getIcon(GROUP_ICONS[group.group] ?? "Building2");
  return (
    <div data-testid={`phone-department-${group.group}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        className="flex min-h-16 w-full items-center gap-3.5 border-b border-line-strong px-4 text-left transition-colors hover:bg-hover sm:px-6"
      >
        <span className="grid size-10 shrink-0 place-items-center border border-line-strong text-fg">
          <Icon aria-hidden="true" className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[1.0625rem] font-semibold text-fg">{t(`groups.${group.group}`)}</span>
        <span className="font-mono text-meta font-medium tabular-nums text-fg-subtle">{group.items.length}</span>
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div id={panel} className="border-b border-line-strong bg-surface pb-2">
          {sets.map((set) => (
            <div key={set.key} role="group" aria-label={t(`ribbon.sets.${set.key}`)}>
              <p aria-hidden="true" className="nesto-eyebrow px-4 pb-1 pt-3.5 text-fg-subtle sm:px-6">{t(`ribbon.sets.${set.key}`)}</p>
              <ul className="grid grid-cols-2">
                {set.items.map((item) => (
                  <li key={item.key} className="min-w-0">
                    <Module item={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const GROUP_ICONS: Record<string, string> = { work: "HardHat", company: "Building2", sales: "Handshake", procurement: "NestoProcurement", finance: "NestoFinance" };

function Module({ item }: { item: NavigationItem }) {
  const Icon = getIcon(item.icon);
  const pending = usePendingDestination(item.href);
  return (
    <Link
      href={item.href}
      navSource="mobile"
      intent
      data-pending={pending || undefined}
      data-testid={`phone-module-${item.key}`}
      onNavigate={() => emitNavigationEvent("navigation_destination_opened", { module: item.key, source: "phone_menu" })}
      className="relative flex min-h-[3.25rem] items-center gap-2.5 px-4 text-[0.9375rem] text-fg transition-colors hover:bg-hover sm:px-6"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}

/** You: Settings, Refresh, Day or Night, Help and Sign out. */
function You() {
  const t = useTranslations("shell");
  const { signOut, signingOut } = useSignOut(() => undefined);
  const row = "flex min-h-14 w-full items-center gap-3.5 border-b border-line px-4 text-left text-body font-medium text-fg transition-colors hover:bg-hover sm:px-6";
  return (
    <div>
      <Link href="/settings" navSource="mobile" className={row}>
        <Settings aria-hidden="true" className="size-5 text-fg-subtle" />
        <span className="flex-1">{t("settings")}</span>
        <ChevronRight aria-hidden="true" className="size-4 text-fg-subtle" />
      </Link>
      <button type="button" data-testid="phone-refresh" onClick={() => requestPageRefresh()} className={row}>
        <RefreshCw aria-hidden="true" className="size-5 text-fg-subtle" />
        <span className="flex-1">{t("phone.refresh")}</span>
      </button>
      <ThemeToggle variant="row" className="min-h-14 gap-3.5 px-4 font-sans text-body normal-case tracking-normal sm:px-6 [&_svg]:size-5" />
      <Link href="/help" navSource="mobile" className={row}>
        <CircleHelp aria-hidden="true" className="size-5 text-fg-subtle" />
        <span className="flex-1">{t("account.help")}</span>
        <ChevronRight aria-hidden="true" className="size-4 text-fg-subtle" />
      </Link>
      <button type="button" disabled={signingOut} onClick={() => void signOut()} className={cn(row, "border-b-0 text-danger-strong hover:bg-danger-soft disabled:opacity-60")}>
        <LogOut aria-hidden="true" className="size-5" />
        {signingOut ? t("signingOut") : t("account.signOut")}
      </button>
    </div>
  );
}
