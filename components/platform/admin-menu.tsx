"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, CircleHelp, Languages, LogOut, Search } from "@/components/icons";

import { useChangeLocale } from "@/components/i18n/use-change-locale";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useSignOut } from "@/components/layout/use-sign-out";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { ADMIN_TABS, type AdminArea } from "@/components/platform/admin-navigation";
import { useAdminPages, type AdminUser, type ShownPage } from "@/components/platform/admin-shell";
import { Avatar } from "@/components/ui/avatar";
import { LineCaption } from "@/components/ui/lined";
import { matchScore } from "@/lib/core/search/palette";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils/cn";

const AREA_ICONS: Record<AdminArea, string> = { home: "LayoutDashboard", customers: "Building2", people: "UsersRound", product: "Package", operations: "Gauge", security: "ShieldCheck" };

/**
 * Menu, the phone bar's last place in the Admin Console, as the company app's
 * (components/layout/phone-menu.tsx): you; a field that finds any page by
 * name; Home's own pages; the five areas as lines that open in place, their
 * pages in the Ribbon's captioned sets; then Day or Night, the language, Help
 * and Sign out.
 */
export function AdminMenu({ user, permissions }: { user: AdminUser; permissions: readonly string[] }) {
  const t = useTranslations("admin");
  const pages = useAdminPages(permissions);
  const [query, setQuery] = React.useState("");
  const areas = ADMIN_TABS.filter((area) => pages.some((page) => page.area === area));
  const [open, setOpen] = React.useState<AdminArea | null>(areas[0] ?? null);
  const found = query.trim() ? pages.filter((page) => matchScore(query, page.label, [page.setLabel, page.areaLabel]) > 0) : null;
  const home = pages.filter((page) => page.area === "home");
  let number = 0;
  const next = () => String(++number).padStart(2, "0");

  return (
    <div className="-mx-(--nesto-gutter) -mt-(--nesto-space-page-y) max-w-2xl md:mx-auto" data-testid="admin-menu">
      <Link href="/admin/account" navSource="mobile" className="flex min-h-20 items-center gap-4 border-b border-line-strong px-4 py-4 transition-colors hover:bg-hover sm:px-6" data-testid="admin-menu-you">
        <Avatar firstName={user.firstName} lastName={user.lastName} src={null} size="lg" className="rounded-none border-transparent bg-accent font-display font-medium text-accent-fg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-card font-semibold text-fg">{user.name}</span>
          <span className="block truncate text-table text-fg-muted">{[t("shell.platformAdmin"), user.email ?? user.username].join(" · ")}</span>
          <span className="sr-only">{t("shell.account")}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      </Link>

      <div className="px-4 py-4 sm:px-6">
        <label className="flex h-[3.25rem] items-center gap-3 border border-control bg-surface px-4 focus-within:ring-2 focus-within:ring-ring">
          <Search aria-hidden="true" className="size-[18px] shrink-0 text-fg-subtle" />
          <span className="sr-only">{t("shell.pagesFind")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("shell.pagesFind")}
            data-testid="admin-menu-find"
            className="h-full min-w-0 flex-1 bg-transparent text-[1rem] text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:appearance-none"
          />
        </label>
      </div>

      {found ? (
        <section aria-label={t("shell.pagesFind")} className="mt-2">
          <LineCaption number={next()} label={t("shell.pagesFind")} count={found.length} />
          {found.length === 0 ? (
            <p role="status" className="px-4 py-8 text-center text-table text-fg-muted sm:px-6">
              {t("shell.pagesNoMatch")}
            </p>
          ) : (
            <PageGrid pages={found} />
          )}
        </section>
      ) : (
        <>
          {home.length > 0 ? (
            <section aria-label={t("nav.area.home")} className="mt-2">
              <LineCaption number={next()} label={t("nav.area.home")} count={home.length} />
              <PageGrid pages={home} />
            </section>
          ) : null}
          {areas.length > 0 ? (
            <section aria-label={t("shell.areas")} className="mt-7">
              <LineCaption number={next()} label={t("shell.areas")} count={areas.length} />
              {areas.map((area) => (
                <Area key={area} area={area} pages={pages.filter((page) => page.area === area)} open={open === area} onToggle={() => setOpen(open === area ? null : area)} />
              ))}
            </section>
          ) : null}
        </>
      )}

      <section aria-label={t("shell.you")} className="mt-7" data-testid="admin-menu-account">
        <LineCaption number={next()} label={t("shell.you")} />
        <You />
      </section>
    </div>
  );
}

function PageGrid({ pages }: { pages: ShownPage[] }) {
  return (
    <ul className="grid grid-cols-2 border-b border-line-strong bg-surface">
      {pages.map((page) => (
        <li key={page.key} className="min-w-0">
          <PageLink page={page} />
        </li>
      ))}
    </ul>
  );
}

/** An area: a line that opens in place, its pages below it in the Ribbon's sets. */
function Area({ area, pages, open, onToggle }: { area: AdminArea; pages: ShownPage[]; open: boolean; onToggle: () => void }) {
  const t = useTranslations("admin");
  const panel = React.useId();
  const sets: { key: string; label: string; pages: ShownPage[] }[] = [];
  for (const page of pages) {
    const last = sets[sets.length - 1];
    if (last && last.key === page.set) last.pages.push(page);
    else sets.push({ key: page.set, label: page.setLabel, pages: [page] });
  }
  const Icon = getIcon(AREA_ICONS[area]);
  return (
    <div data-testid={`admin-menu-area-${area}`}>
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
        <span className="min-w-0 flex-1 truncate text-[1.0625rem] font-semibold text-fg">{t(`nav.area.${area}`)}</span>
        <span className="font-mono text-meta font-medium tabular-nums text-fg-subtle">{pages.length}</span>
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div id={panel} className="border-b border-line-strong bg-surface pb-2">
          {sets.map((set) => (
            <div key={set.key} role="group" aria-label={set.label}>
              <p aria-hidden="true" className="nesto-eyebrow px-4 pb-1 pt-3.5 text-fg-subtle sm:px-6">{set.label}</p>
              <ul className="grid grid-cols-2">
                {set.pages.map((page) => (
                  <li key={page.key} className="min-w-0">
                    <PageLink page={page} />
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

function PageLink({ page }: { page: ShownPage }) {
  const Icon = getIcon(page.icon);
  const pending = usePendingDestination(page.href);
  return (
    <Link
      href={page.href}
      navSource="mobile"
      intent
      data-pending={pending || undefined}
      data-testid={`admin-menu-page-${page.key}`}
      className="relative flex min-h-[3.25rem] items-center gap-2.5 px-4 text-[0.9375rem] text-fg transition-colors hover:bg-hover sm:px-6"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1 truncate">{page.label}</span>
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}

/** You: Day or Night, the language, Help and Sign out. */
function You() {
  const t = useTranslations("admin");
  const { signOut, signingOut } = useSignOut();
  const { choice, change, isPending } = useChangeLocale();
  const nextLocale = LOCALES[(LOCALES.indexOf(choice) + 1) % LOCALES.length]!;
  const row = "flex min-h-14 w-full items-center gap-3.5 border-b border-line px-4 text-left text-body font-medium text-fg transition-colors hover:bg-hover sm:px-6";
  return (
    <div>
      <ThemeToggle variant="row" className="min-h-14 gap-3.5 px-4 font-sans text-body normal-case tracking-normal sm:px-6 [&_svg]:size-5" />
      <button type="button" disabled={isPending} onClick={() => change(nextLocale)} className={row} data-testid="admin-menu-language">
        <Languages aria-hidden="true" className="size-5 text-fg-subtle" />
        <span className="flex-1">{t("shell.language")}</span>
        <span className="font-mono text-meta uppercase tracking-[0.08em] text-fg-muted">{LOCALE_NAMES[choice]}</span>
      </button>
      <Link href="/admin/help" navSource="mobile" className={row}>
        <CircleHelp aria-hidden="true" className="size-5 text-fg-subtle" />
        <span className="flex-1">{t("shell.help")}</span>
        <ChevronRight aria-hidden="true" className="size-4 text-fg-subtle" />
      </Link>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => void signOut()}
        data-testid="admin-menu-sign-out"
        className={cn(
          row,
          "border-b-0 bg-danger-soft font-semibold text-danger-strong shadow-[inset_3px_0_0_var(--nesto-danger)] hover:bg-[color-mix(in_oklab,var(--nesto-danger-soft),var(--nesto-danger)_10%)] disabled:opacity-60",
        )}
      >
        <LogOut aria-hidden="true" className="size-5" />
        {signingOut ? t("shell.signingOut") : t("shell.signOut")}
      </button>
    </div>
  );
}
