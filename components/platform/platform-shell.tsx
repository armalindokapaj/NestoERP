"use client";

import { BreadcrumbRegistryProvider } from "@/components/navigation/breadcrumb-registry";
import { BreadcrumbBar } from "@/components/ui/breadcrumbs";
import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, UserRound, X } from "lucide-react";

import { OrganizationMark } from "@/components/layout/organization-mark";
import { PoweredBy } from "@/components/layout/powered-by";
import { SidebarProvider, useSidebar } from "@/components/layout/sidebar-provider";
import { LocaleSwitch } from "@/components/i18n/locale-switch";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { usePhone } from "@/components/layout/use-phone";
import { useSignOut } from "@/components/layout/use-sign-out";
import { adminText } from "@/components/platform/admin-i18n";
import { activeDestination, activeTab, adminDestinations, adminTabKey, visibleTo, type AdminDestination } from "@/components/platform/admin-navigation";
import { PlatformQuickCreate } from "@/components/platform/platform-quick-create";
import { PlatformSearch } from "@/components/platform/platform-search";
import { AccountPanel } from "@/components/shell/account-panel";
import { ContextNotifications } from "@/components/shell/context-notifications";
import { QUICK_CREATE } from "@/components/platform/quick-create-items";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageContainer } from "@/components/ui/page-container";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SidebarState } from "@/lib/layout/sidebar-state";
import { cn } from "@/lib/utils/cn";

type User = { id: string; name: string; firstName: string; lastName: string; email: string | null; username: string };

/** The mark, the name and the workspace line, as the platform's sidebar header has them (OW §2-§18). */
function AdminIdentity() {
  const t = useTranslations("admin");
  return (
    <Link href="/admin" aria-label={t("shell.dashboardLink")} data-testid="platform-context" className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left">
      <OrganizationMark name="NESTO Platform" logoUrl={null} />
      <span className="nesto-nav-label min-w-0 flex-1 leading-tight">
        <span className="block truncate text-body font-semibold text-fg max-md:text-meta max-md:font-bold max-md:uppercase max-md:tracking-[0.08em]">{t("shell.platformName")}</span>
        <span className="mt-0.5 block truncate text-meta text-fg-muted">{t("shell.platformAdmin")}</span>
      </span>
    </Link>
  );
}

/* The platform's navigation row (components/layout/sidebar-nav.tsx): a light accent ground, accent icon and text, a 2px left marker. */
function NavRow({ item, active, dense, onNavigate }: { item: AdminDestination; active: boolean; dense: boolean; onNavigate?: () => void }) {
  const { isRail } = useSidebar();
  const t = useTranslations("admin");
  const label = adminText(t, `nav.dest.${item.key}`, item.label);
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      data-testid={`admin-nav-${item.key}`}
      className={cn(
        "nesto-nav-item group relative flex items-center gap-3 overflow-hidden rounded-lg px-3 text-body font-medium transition-colors",
        dense ? "min-h-11 py-2.5" : "py-2.5 touch:min-h-11",
        // Pending shows before the route commits (§28), not by colour alone.
        "data-[nav-pending]:bg-hover data-[nav-pending]:[&>svg]:animate-pulse",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        active ? "bg-accent-soft text-accent-strong" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {active ? <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" /> : null}
      <item.icon aria-hidden="true" strokeWidth={1.6} className={cn("size-[18px] shrink-0", active ? "text-accent" : "text-accent-strong group-hover:text-accent")} />
      <span className="nesto-nav-label truncate">{label}</span>
    </Link>
  );
  if (dense || !isRail) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Navigation({ permissions, utility = false, dense = false, onNavigate }: { permissions: readonly string[]; utility?: boolean; dense?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useTranslations("admin");
  const current = activeDestination(pathname)?.key;
  const items = visibleTo(adminDestinations, permissions).filter((item) => Boolean(item.utility) === utility);
  if (!items.length) return null;
  return (
    <nav aria-label={utility ? t("shell.navLabelSystem") : t("shell.navLabel")} className={cn("flex flex-col px-3 py-2", dense ? "gap-4" : "gap-6")}>
      <ul className="space-y-0.5">
        {items.map((item) => <li key={item.key}><NavRow item={item} active={item.key === current} dense={dense} onNavigate={onNavigate} /></li>)}
      </ul>
    </nav>
  );
}

/** The collapse control lives in the top bar, as the platform's does (components/layout/sidebar-toggle.tsx). */
function SidebarToggle() {
  const { state, toggle } = useSidebar();
  const t = useTranslations("admin");
  const collapsed = state === "collapsed";
  const label = collapsed ? t("shell.expand") : t("shell.collapse");
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={toggle} aria-label={label} aria-pressed={collapsed} data-testid="admin-sidebar-toggle" className="hidden size-8 shrink-0 cursor-pointer place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg xl:-ml-5 xl:grid touch:size-11">
          <Icon aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The signed-in person, Account and Sign out at the foot of the phone drawer: the top bar has room only for the initials. */
function DrawerAccount({ user, onNavigate }: { user: User; onNavigate: () => void }) {
  const { signOut, signingOut } = useSignOut();
  const t = useTranslations("admin");
  const row = "flex h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-table text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
  return (
    <div className="mt-auto border-t border-line p-3" data-testid="admin-drawer-account">
      <div className="flex items-center justify-between gap-2 pb-2 pl-3 pt-1">
        <p className="min-w-0">
          <span className="block truncate text-body font-medium text-fg">{user.name}</span>
          <span className="block truncate text-meta text-fg-subtle">{user.email ?? user.username}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1"><LocaleSwitch label={t("shell.language")} className="h-11 px-3" /><ThemeToggle /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link href="/admin/account" onClick={onNavigate} className={row}><UserRound aria-hidden="true" className="size-[18px]" />{t("shell.account")}</Link>
        <button type="button" disabled={signingOut} onClick={() => void signOut()} className={row}><LogOut aria-hidden="true" className="size-[18px]" />{signingOut ? t("shell.signingOut") : t("shell.signOut")}</button>
      </div>
    </div>
  );
}

/* A bar cell, as in the platform's phone bottom bar (components/layout/mobile-bottom-nav.tsx): icon over label, the whole cell the target, a gold dot above the active one. */
const cellClass =
  "relative flex h-14 w-full cursor-pointer flex-col items-center justify-center gap-0.5 px-1 text-micro font-semibold leading-tight text-fg-subtle transition-colors hover:text-fg data-[active=true]:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * The phone and tablet bottom bar, the same floating bar the platform has:
 * three destinations, Create in the middle and More, which opens the drawer.
 * `data-mobile-bottom-nav` is what makes the page leave room for it and the bar
 * step aside for a form's action bar or the keyboard (styles/globals.css).
 */
function AdminBottomNav({ permissions, onMore }: { permissions: readonly string[]; onMore: () => void }) {
  const pathname = usePathname();
  const t = useTranslations("admin");
  const current = activeDestination(pathname)?.key;
  const items = visibleTo(adminDestinations, permissions).filter((item) => ["dashboard", "organizations", "projects"].includes(item.key));
  const create = QUICK_CREATE.filter((item) => permissions.includes(item.permission));
  const left = items.slice(0, Math.ceil(items.length / 2));
  const right = items.slice(left.length);
  const link = (item: AdminDestination) => {
    const active = item.key === current;
    return (
      <li key={item.key} className="min-w-0 flex-1">
        <Link href={item.href} aria-current={active ? "page" : undefined} data-active={active} data-testid={`admin-bar-${item.key}`} className={cellClass}>
          {active ? <span aria-hidden="true" className="absolute left-1/2 top-0.5 size-1 -translate-x-1/2 rounded-full bg-accent" /> : null}
          <item.icon className="size-[22px] shrink-0" aria-hidden="true" />
          <span className="max-w-full truncate">{adminText(t, `nav.dest.${item.key}`, item.label)}</span>
        </Link>
      </li>
    );
  };
  return (
    <nav
      aria-label={t("shell.barLabel")}
      data-mobile-bottom-nav
      className="nesto-bottom-nav fixed inset-x-[max(0.75rem,var(--nesto-safe-left))] bottom-[calc(0.875rem+var(--nesto-safe-bottom))] z-[var(--nesto-z-shell-tabs)] mx-auto h-[68px] max-w-xl rounded-[24px] border border-line bg-surface/85 px-1.5 shadow-menu backdrop-blur-xl lg:hidden"
    >
      <ul className="flex h-full items-center">
        {left.map(link)}
        {create.length ? (
          <li className="flex min-w-0 flex-1 justify-center md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={t("shell.create")} data-testid="admin-bar-create" className="-mt-[26px] grid size-[54px] cursor-pointer place-items-center rounded-full border-4 border-canvas bg-accent text-accent-fg shadow-menu transition-transform active:scale-95">
                  <Plus aria-hidden="true" className="size-[22px]" strokeWidth={2.2} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" className="min-w-44">
                {create.map((item) => (
                  <DropdownMenuItem key={item.key} asChild>
                    <Link href={item.href} className="cursor-pointer"><item.icon aria-hidden="true" className="size-4" />{adminText(t, `create.${item.key}`, item.label)}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ) : null}
        {right.map(link)}
        <li className="min-w-0 flex-1">
          <button type="button" onClick={onMore} aria-haspopup="dialog" data-testid="admin-bar-more" className={cellClass}>
            <MoreHorizontal className="size-[22px] shrink-0" aria-hidden="true" />
            <span className="max-w-full truncate">{t("shell.more")}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** A destination's secondary pages, shown only on those pages themselves (Admin IA §23). */
function SectionTabs({ permissions }: { permissions: readonly string[] }) {
  const pathname = usePathname();
  const t = useTranslations("admin");
  const hit = activeTab(pathname);
  if (!hit) return null;
  const tabs = visibleTo(hit.destination.tabs ?? [], permissions);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t("shell.sections", { name: adminText(t, `nav.dest.${hit.destination.key}`, hit.destination.label) })} className="nesto-context-tabs mb-5 overflow-x-auto" data-context-tabs data-testid="admin-section-tabs">
      <div className="border-b border-line">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.href === hit.tab.href;
          return (
            <li key={tab.href}>
              <Link href={tab.href} aria-current={active ? "page" : undefined} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[nav-pending]:text-fg", active ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg")}>
                {adminText(t, `nav.tab.${adminTabKey(tab.href)}`, tab.label)}
              </Link>
            </li>
          );
        })}
      </ul>
      </div>
    </nav>
  );
}

/**
 * The Platform Admin shell, built from the platform's own parts (Admin IA §10-§15,
 * §38, §39): the same sidebar (the mark and names at the top, the navigation, the
 * foot), top bar (collapse control, search, Create, theme, account, and on a phone
 * the menu at the top right), breadcrumb bar, page container and bottom bar. It
 * lives in the /admin layout, so moving between admin pages swaps only the main
 * region (§54).
 */
export function PlatformShell({ user, permissions, initialSidebar, devActions, children }: { user: User; permissions: readonly string[]; initialSidebar: SidebarState; devActions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <SidebarProvider initial={initialSidebar} className="min-h-dvh bg-canvas">
      <Shell user={user} permissions={permissions} devActions={devActions}>{children}</Shell>
    </SidebarProvider>
  );
}

function Shell({ user, permissions, devActions, children }: { user: User; permissions: readonly string[]; devActions?: React.ReactNode; children: React.ReactNode }) {
  const [mobile, setMobile] = React.useState(false);
  const phone = usePhone();
  const pathname = usePathname();
  const t = useTranslations("admin");
  React.useEffect(() => setMobile(false), [pathname]);

  return (
    <>
      <aside className="nesto-rail fixed inset-y-0 left-0 z-40 hidden w-[var(--nesto-nav-width)] flex-col border-r border-accent/25 bg-canvas transition-[width] lg:flex" data-testid="admin-sidebar">
        <div className="flex h-16 shrink-0 items-center px-3" data-testid="sidebar-header"><AdminIdentity /></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><Navigation permissions={permissions} /></div>
        <div className="shrink-0 border-t border-accent/25 pb-1"><Navigation permissions={permissions} utility /></div>
        <div className="nesto-sidebar-footer shrink-0 px-5 pb-5 pt-4"><PoweredBy isDemo={false} /></div>
      </aside>
      <Drawer open={mobile} onOpenChange={setMobile}>
        <DrawerContent side={phone ? "right" : "left"} className="bg-canvas lg:hidden" aria-describedby={undefined}>
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-accent/25 pl-4 pr-2">
            <DrawerTitle className="font-serif text-[1.375rem] font-normal text-fg">{t("shell.menu")}</DrawerTitle>
            <DrawerClose asChild>
              <button type="button" aria-label={t("shell.closeNavigation")} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-fg-muted transition-colors hover:bg-hover hover:text-fg"><X aria-hidden="true" className="size-5" strokeWidth={1.6} /></button>
            </DrawerClose>
          </div>
          <Navigation permissions={permissions} dense onNavigate={() => setMobile(false)} />
          <div className="border-t border-accent/25"><Navigation permissions={permissions} utility dense onNavigate={() => setMobile(false)} /></div>
          <DrawerAccount user={user} onNavigate={() => setMobile(false)} />
        </DrawerContent>
      </Drawer>
      <BreadcrumbRegistryProvider>
      <div className="pl-[var(--nesto-nav-width)] transition-[padding]" data-admin-shell>
        <header data-shell-region className="sticky top-0 z-[var(--nesto-z-shell-header)] flex h-14 items-center gap-2 border-b border-accent/25 bg-canvas pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:h-16 md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] xl:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* Tablet: the drawer opens from the left. A phone has its menu at the right, as the platform does. */}
            <button type="button" onClick={() => setMobile(true)} aria-label={t("shell.openNavigation")} aria-expanded={mobile} className="hidden size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-fg-muted hover:bg-hover md:grid lg:hidden"><Menu className="size-5" /></button>
            <SidebarToggle />
            {/* A page action, not a universal control: it stays left so the cluster keeps the right edge (UI-01 §5.1). */}
            <span className="max-md:hidden"><PlatformQuickCreate permissions={permissions} /></span>
          </div>
          {/* The universal cluster, the same three controls in the same order on every surface (UI-01 §1, §13). */}
          <div className="flex min-w-0 items-center justify-end gap-0 sm:gap-1" data-testid="global-actions">
            {devActions}
            <PlatformSearch recentKey={`platformAdmin.search.recent.${user.id}`} />
            <ContextNotifications context={t("shell.platformAdmin")} />
            <AccountPanel
              model={{
                user: { firstName: user.firstName, lastName: user.lastName, avatarUrl: null },
                roleLabel: t("shell.platformAdmin"),
                workspaceName: t("shell.platformName"),
                destinations: { profile: "/admin/account", settings: "/admin/account", help: "/admin/help", whatsNew: "/admin/whats-new" },
              }}
            />
            <button type="button" onClick={() => setMobile(true)} aria-label={t("shell.openNavigation")} aria-expanded={mobile} data-testid="admin-menu" className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-fg transition-colors hover:bg-hover active:bg-hover md:hidden"><Menu aria-hidden="true" className="size-[22px]" strokeWidth={1.6} /></button>
          </div>
        </header>
        <BreadcrumbBar root={{ label: t("shell.breadcrumbRoot"), href: "/admin" }} />
        <PageContainer as="main" id="nesto-main" tabIndex={-1} className="outline-none">
          <SectionTabs permissions={permissions} />
          {children}
        </PageContainer>
        <AdminBottomNav permissions={permissions} onMore={() => setMobile(true)} />
      </div>
      </BreadcrumbRegistryProvider>
    </>
  );
}
