"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Home, Menu, Plus, Search, UsersRound, X, Building2, type IconComponent } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { OrganizationMark } from "@/components/layout/organization-mark";
import { PhoneSections } from "@/components/layout/phone-sections";
import { PhoneTitle } from "@/components/layout/phone-title";
import { RibbonPanel, RibbonProvider, RibbonTabs, type RibbonModel } from "@/components/layout/ribbon";
import { BreadcrumbRegistryProvider } from "@/components/navigation/breadcrumb-registry";
import Link from "@/components/navigation/nav-link";
import { PageMenuProvider } from "@/components/navigation/page-menu";
import { SectionStoreProvider } from "@/components/navigation/section-registry";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { adminText } from "@/components/platform/admin-i18n";
import { ADMIN_AREAS, ADMIN_HOME, ADMIN_MENU, ADMIN_TABS, adminPagesFor, adminPlaceOf, adminUp, type AdminArea, type AdminPage, type AdminPlace } from "@/components/platform/admin-navigation";
import { AdminSearch } from "@/components/platform/admin-search";
import { QUICK_CREATE } from "@/components/platform/quick-create-items";
import { AccountPanel } from "@/components/shell/account-panel";
import { ContextNotifications } from "@/components/shell/context-notifications";
import { BreadcrumbBar } from "@/components/ui/breadcrumbs";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { PageContainer } from "@/components/ui/page-container";
import { itemForPath } from "@/config/navigation";
import { matchScore } from "@/lib/core/search/palette";
import { cn } from "@/lib/utils/cn";

export type AdminUser = { id: string; name: string; firstName: string; lastName: string; email: string | null; username: string };

/** A page with its name, area and set in the reader's language. */
export type ShownPage = AdminPage & { areaLabel: string; setLabel: string };

/** The pages this person may open, named in the reader's language. */
export function useAdminPages(permissions: readonly string[]): ShownPage[] {
  const t = useTranslations("admin");
  return React.useMemo(
    () =>
      adminPagesFor(permissions).map((page) => ({
        ...page,
        label: adminText(t, `nav.page.${page.key}`, page.label),
        areaLabel: t(`nav.area.${page.area}`),
        setLabel: adminText(t, `nav.set.${page.set}`, page.set),
      })),
    [permissions, t],
  );
}

/**
 * The Admin Console's shell (docs/ui/UI-09-admin-console.md): the company
 * app's shell, laid out the same and working the same, around the console's
 * own pages.
 *
 *   [ logo · NESTO Platform ]   ( Customers | People | Product | Operations | Security )   [ Search…  ⌘K · bell · account ]
 *
 * The logo opens every page by area on the left third of the screen; NESTO
 * Platform is Home, the Overview. The five areas are the Ribbon's tabs, the
 * open tab's pages in captioned sets under the bar (components/layout/ribbon.tsx).
 * Create is the dial at the bottom right from lg.
 *
 * Below lg: the page's name in the bar, Back on a page deeper than the
 * navigation, then search and the bell in cells of their own; at the bottom
 * the phone's bar, Home · Customers · New · People · Menu.
 */
export function AdminShell({ user, permissions, ribbonFolded, children }: { user: AdminUser; permissions: readonly string[]; ribbonFolded: boolean; children: React.ReactNode }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const pages = useAdminPages(permissions);
  const create = React.useMemo(
    () => QUICK_CREATE.filter((item) => permissions.includes(item.permission)).map((item) => ({ key: item.key, href: item.href, icon: item.icon, label: adminText(t, `create.${item.key}`, item.label) })),
    [permissions, t],
  );

  const ribbon = React.useMemo<RibbonModel>(() => {
    const tabs = ADMIN_TABS.map((area) => ({
      key: area,
      label: t(`nav.area.${area}`),
      items: pages.filter((page) => page.area === area).map(({ key, href, icon, label, set }) => ({ key, href, icon, label, set })),
    })).filter((tab) => tab.items.length > 0);
    return {
      tabs,
      sets: Object.fromEntries(pages.map((page) => [page.set, page.setLabel])),
      places: pages.map((page) => ({ key: page.key, href: page.href, label: page.label, tab: page.area === "home" ? null : page.area })),
      fallback: tabs[0]?.key ?? null,
    };
  }, [pages, t]);

  return (
    <BreadcrumbRegistryProvider>
      {/* A page's tab row hands its tabs to the phone's section row below lg; its tips and secondary actions fold into its ⋯ (as in the company app). */}
      <SectionStoreProvider>
      <PageMenuProvider>
      {/* `data-app-shell`: a signed-in shell's root (styles/globals.css); `data-admin-shell`: the console's own rules. */}
      <div data-app-shell data-admin-shell className="min-h-dvh bg-canvas">
        <header data-shell-region className="sticky top-0 z-[var(--nesto-z-shell-header)] flex h-(--nesto-shell-header-h) flex-col border-b border-fg">
          {/* Glass on a layer behind the bar, as in the company app: a backdrop filter on the bar would trap fixed panels inside it. */}
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/82 backdrop-blur-[14px] backdrop-saturate-[1.3]" />
          <RibbonProvider model={ribbon} folded={ribbonFolded}>
            <div
              data-topbar-row
              className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-stretch pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-x-4 lg:pl-[max(1.5rem,env(safe-area-inset-left))] lg:pr-[max(1.5rem,env(safe-area-inset-right))] xl:gap-x-8 xl:px-8"
            >
              {/* Below lg: Back, and where you are. */}
              <PhoneTitle up={adminUp(pathname, pages)} backLabel={t("shell.phone.back")} />
              {/* From lg: the logo, which opens every page, and Home. */}
              <div className="col-start-1 flex min-w-0 items-center gap-1.5 max-lg:hidden lg:w-full lg:max-w-(--nesto-bar-side)">
                <PagesPanel pages={pages} />
                <Link
                  href={ADMIN_HOME}
                  intent
                  aria-label={t("shell.homeLabel")}
                  data-testid="admin-home"
                  className="inline-flex h-10 min-w-0 shrink items-center gap-2 rounded-none px-3 text-body font-medium text-fg transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
                >
                  <Home aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 truncate">{t("shell.platformName")}</span>
                </Link>
              </div>

              {/* From lg: the five areas, in the middle. */}
              <RibbonTabs className="col-start-2" />

              {/* The universal cluster in its order: Search, Notifications, Account (UI-01 §1). Below lg, search and the bell in cells. */}
              <div className="col-start-3 flex min-w-0 items-center justify-end justify-self-end max-lg:items-stretch lg:w-full lg:max-w-(--nesto-bar-side) lg:gap-1.5" data-testid="global-actions">
                <div className="flex w-14 items-center justify-center border-l border-line-strong lg:contents">
                  <AdminSearch pages={pages.map((page) => ({ key: page.key, label: page.label, href: page.href, icon: page.icon, place: page.areaLabel }))} create={create} recentKey={`platformAdmin.search.recent.${user.id}`} />
                </div>
                <div className="flex w-14 items-center justify-center border-l border-line-strong lg:contents">
                  <ContextNotifications context={t("shell.platformAdmin")} />
                </div>
                {/* Below lg, you are in Menu. */}
                <div className="contents max-lg:hidden">
                  <AccountPanel
                    model={{
                      user: { firstName: user.firstName, lastName: user.lastName, avatarUrl: null },
                      roleLabel: t("shell.platformAdmin"),
                      workspaceName: t("shell.platformName"),
                      destinations: { profile: "/admin/account", settings: "/admin/account", help: "/admin/help", whatsNew: "/admin/whats-new" },
                    }}
                  />
                </div>
              </div>
            </div>
            {/* From lg: the open area's pages. */}
            <RibbonPanel />
          </RibbonProvider>
        </header>
        {/* Below lg: the page's tabs, pinned under the top bar. */}
        <PhoneSections />

        <PageContainer as="main" id="nesto-main" tabIndex={-1} className="outline-none">
          {/* Where the page is: the page head's mono line, scrolling with it, as in the company shell. */}
          <BreadcrumbBar root={{ label: t("shell.breadcrumbRoot"), href: ADMIN_HOME }} />
          {children}
        </PageContainer>

        <CreateDial items={create} />
        <PhoneBar pages={pages} create={create} />
      </div>
      </PageMenuProvider>
      </SectionStoreProvider>
    </BreadcrumbRegistryProvider>
  );
}

type CreateItem = { key: string; href: string; icon: IconComponent; label: string };

/** The logo, and what it opens: every page this person may open, by area, on the left third of the screen. */
function PagesPanel({ pages }: { pages: ShownPage[] }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  React.useEffect(() => setOpen(false), [pathname]);

  const shown = query.trim() ? pages.filter((page) => matchScore(query, page.label, [page.setLabel, page.areaLabel]) > 0) : pages;
  const current = itemForPath(pages.filter((page) => page.href !== ADMIN_HOME), pathname)?.key ?? (pathname === ADMIN_HOME ? "overview" : null);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("shell.pagesOpen")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("shell.pagesOpen")}
        data-testid="admin-pages-trigger"
        className="relative grid size-10 shrink-0 place-items-center rounded-none transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
      >
        <OrganizationMark name={t("shell.platformName")} logoUrl={null} size="sm" className="size-9! text-[0.8125rem]! border border-accent bg-surface text-accent-strong" />
        <span aria-hidden="true" className="absolute -bottom-px -right-px grid grid-cols-3 gap-[1.5px] bg-fg p-[2.5px]">
          {Array.from({ length: 9 }, (_, index) => (
            <i key={index} className="block size-[3px] bg-canvas" />
          ))}
        </span>
      </button>

      <DrawerContent side="left" data-testid="admin-pages" aria-describedby={undefined} className="inset-y-0 left-0 w-full max-w-none rounded-none border-0 border-r border-fg bg-canvas pl-[env(safe-area-inset-left)] backdrop-blur-none sm:w-[max(26rem,33.333vw)]">
        <DrawerTitle className="sr-only">{t("shell.pagesTitle")}</DrawerTitle>
        <div className="flex h-(--nesto-topbar-row-h) shrink-0 items-center gap-3 border-b border-fg pl-4 pr-2">
          <OrganizationMark name={t("shell.platformName")} logoUrl={null} size="sm" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-body font-semibold text-fg">{t("shell.platformName")}</span>
            <span className="block truncate text-meta text-fg-muted">{t("shell.platformAdmin")}</span>
          </span>
          <DrawerClose aria-label={t("shell.pagesClose")} className="grid size-10 shrink-0 place-items-center rounded-none text-fg-muted hover:bg-hover hover:text-fg touch:size-11">
            <X aria-hidden="true" className="size-5" />
          </DrawerClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-4">
          <label className="flex h-11 items-center gap-2 rounded-none border border-line-strong bg-surface px-4 focus-within:ring-2 focus-within:ring-ring">
            <Search aria-hidden="true" className="size-[18px] shrink-0 text-fg-subtle" />
            <span className="sr-only">{t("shell.pagesFind")}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("shell.pagesFind")}
              data-testid="admin-pages-find"
              className="h-full min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:appearance-none"
            />
          </label>

          {shown.length === 0 ? (
            <p role="status" className="py-8 text-center text-table text-fg-muted">
              {t("shell.pagesNoMatch")}
            </p>
          ) : (
            ADMIN_AREAS.map((area) => {
              const items = shown.filter((page) => page.area === area);
              if (!items.length) return null;
              return (
                <section key={area} aria-labelledby={`admin-pages-${area}`} data-testid={`admin-pages-${area}`}>
                  <h3 id={`admin-pages-${area}`} className="nesto-eyebrow mb-2 mt-5 flex items-center gap-2.5 text-fg-subtle after:h-px after:flex-1 after:bg-line">
                    {t(`nav.area.${area}`)}
                  </h3>
                  <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {items.map((page) => (
                      <li key={page.key} className="min-w-0">
                        <PageLink page={page} active={page.key === current} onDone={() => setOpen(false)} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function PageLink({ page, active, onDone }: { page: ShownPage; active: boolean; onDone: () => void }) {
  const Icon = getIcon(page.icon);
  const pending = usePendingDestination(page.href);
  return (
    <Link
      href={page.href}
      intent
      aria-current={active ? "page" : undefined}
      data-pending={pending || undefined}
      data-testid={`admin-page-${page.key}`}
      onNavigate={onDone}
      className={cn(
        "relative flex min-h-10 items-center gap-2.5 rounded-none px-2.5 text-table transition-colors touch:min-h-12",
        active ? "bg-accent-soft font-semibold text-accent-strong" : "text-fg hover:bg-hover",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-[18px] shrink-0", active ? "text-current" : "text-fg-subtle")} />
      <span className="min-w-0 flex-1 truncate">{page.label}</span>
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}

/**
 * Create, from lg: the + floating at the bottom right, as in the company app
 * (docs/ui/UI-06-create-dial.md). A pointer resting on it, or a keyboard
 * landing on it, fans out what this person may create; a click does too.
 */
function CreateDial({ items }: { items: CreateItem[] }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => setOpen(false), [pathname]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!items.length) return null;

  const fanOut = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const foldSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 260);
  };

  return (
    <div
      data-create-dial=""
      data-dial-open={open || undefined}
      className="fixed bottom-[max(40px,calc(env(safe-area-inset-bottom)+16px))] right-[max(30px,calc(env(safe-area-inset-right)+12px))] z-40 max-lg:hidden"
      onPointerEnter={(event) => event.pointerType === "mouse" && fanOut()}
      onPointerLeave={(event) => event.pointerType === "mouse" && foldSoon()}
      onFocus={(event) => event.target.matches(":focus-visible") && fanOut()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("shell.create")}
        aria-expanded={open}
        data-testid="admin-create"
        className={cn(
          "relative z-[2] grid size-[62px] place-items-center rounded-full bg-primary text-primary-fg shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_10px_24px_-10px_rgb(15_20_26/0.55),0_2px_6px_rgb(15_20_26/0.18)] transition-transform duration-250 ease-out hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95",
          open && "scale-[1.08]",
        )}
      >
        <Plus aria-hidden="true" className={cn("size-[26px] transition-transform duration-300 ease-out", open && "rotate-45")} />
      </button>
      <ul aria-label={t("shell.create")}>
        {items.map((item, index) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-label={t("shell.createNamed", { name: item.label })}
              data-testid={`admin-create-${item.key}`}
              className="nesto-dial-item group absolute bottom-[9px] right-[9px] z-[1] grid size-11 place-items-center rounded-full bg-surface text-fg shadow-[0_0_0_1px_var(--color-line-strong),0_8px_18px_-10px_rgb(15_20_26/0.45)] hover:bg-accent hover:text-accent-fg focus-visible:bg-accent focus-visible:text-accent-fg focus-visible:outline-none"
              style={{ "--i": index, "--n": items.length, "--ty": `${-(72 + 52 * index)}px` } as React.CSSProperties}
            >
              <item.icon aria-hidden="true" className="size-5" />
              <span
                aria-hidden="true"
                className="absolute right-[52px] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[7px] bg-canvas/92 px-[9px] py-[7px] font-mono text-meta font-medium uppercase leading-none tracking-[0.08em] text-fg shadow-[0_0_0_1px_var(--color-line-strong)] group-hover:bg-accent group-hover:text-accent-fg group-hover:shadow-none group-focus-visible:bg-accent group-focus-visible:text-accent-fg group-focus-visible:shadow-none"
              >
                {item.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One cell: an icon over a 12px label, the whole cell the target. */
const cell =
  "relative flex h-full w-full flex-col items-center justify-center gap-1.5 text-meta font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * The phone's bar, below lg, as the company app's (components/layout/phone-bar.tsx):
 * Home · Customers · New · People · Menu. New, in ink, opens what this
 * person may create in the phone's sheet.
 */
function PhoneBar({ pages, create }: { pages: ShownPage[]; create: CreateItem[] }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const here = adminPlaceOf(pathname, pages);
  const [sheet, setSheet] = React.useState(false);
  React.useEffect(() => setSheet(false), [pathname]);
  const first = (area: AdminArea) => pages.find((page) => page.area === area)?.href ?? null;
  const customers = first("customers");
  const people = first("people");

  return (
    <nav aria-label={t("shell.phone.label")} data-mobile-bottom-nav="bar" data-testid="admin-phone-bar" className="fixed inset-x-0 bottom-0 z-(--nesto-z-shell-tabs) border-t border-line-strong pb-(--nesto-safe-bottom) lg:hidden">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/82 backdrop-blur-[14px] backdrop-saturate-[1.3]" />
      <ul className="mx-auto grid h-16 max-w-xl grid-flow-col auto-cols-fr">
        <Place place="home" here={here} href={ADMIN_HOME} icon={Home} label={t("shell.phone.home")} />
        {customers ? <Place place="customers" here={here} href={customers} icon={Building2} label={t("shell.phone.customers")} /> : null}
        {create.length ? (
          <li className="min-w-0">
            <Drawer open={sheet} onOpenChange={setSheet}>
              <button
                type="button"
                onClick={() => setSheet((value) => !value)}
                aria-label={sheet ? t("shell.phone.close") : t("shell.phone.new")}
                aria-haspopup="dialog"
                aria-expanded={sheet}
                data-testid="admin-phone-new"
                className={cn(cell, "bg-primary text-primary-fg hover:bg-primary-hover")}
              >
                {sheet ? <X aria-hidden="true" className="size-6 shrink-0" /> : <Plus aria-hidden="true" className="size-6 shrink-0" />}
                <span aria-hidden="true">{sheet ? t("shell.phone.close") : t("shell.phone.new")}</span>
              </button>
              <DrawerContent side="bottom" aria-describedby={undefined} className="bg-canvas" data-testid="admin-phone-create">
                <DrawerTitle className="flex h-11 items-center border-b border-line-strong px-4 font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg">{t("shell.create")}</DrawerTitle>
                <ul>
                  {create.map((item) => (
                    <li key={item.key}>
                      <Link href={item.href} className="flex min-h-14 items-center gap-3.5 border-b border-line px-4 text-body font-medium text-fg transition-colors last:border-b-0 hover:bg-hover">
                        <span className="grid size-9 shrink-0 place-items-center border border-line-strong">
                          <item.icon aria-hidden="true" className="size-[18px]" />
                        </span>
                        {t("shell.createNamed", { name: item.label })}
                      </Link>
                    </li>
                  ))}
                </ul>
              </DrawerContent>
            </Drawer>
          </li>
        ) : null}
        {people ? <Place place="people" here={here} href={people} icon={UsersRound} label={t("shell.phone.people")} /> : null}
        <Place place="menu" here={here} href={ADMIN_MENU} icon={Menu} label={t("shell.phone.menu")} />
      </ul>
    </nav>
  );
}

function Place({ place, here, href, icon: Icon, label }: { place: AdminPlace; here: AdminPlace; href: string; icon: IconComponent; label: string }) {
  const current = place === here;
  const pending = usePendingDestination(href);
  return (
    <li className="min-w-0 border-l border-line first:border-l-0">
      <Link
        href={href}
        navSource="mobile"
        intent
        aria-current={current ? "page" : undefined}
        data-pending={pending || undefined}
        data-testid={`admin-place-${place}`}
        className={cn(cell, current ? "text-fg before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-accent" : "text-fg-subtle hover:bg-hover hover:text-fg")}
      >
        <Icon aria-hidden="true" className="size-[22px] shrink-0" />
        <span className="max-w-full truncate px-1">{label}</span>
        {pending ? <PendingDot className="absolute right-2 top-2 text-accent" /> : null}
      </Link>
    </li>
  );
}
