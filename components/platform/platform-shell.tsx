"use client";

import { BreadcrumbRegistryProvider } from "@/components/navigation/breadcrumb-registry";
import { BreadcrumbBar } from "@/components/ui/breadcrumbs";
import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, UserRound, X } from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { useSignOut } from "@/components/layout/use-sign-out";
import { activeDestination, activeTab, adminDestinations, SIDEBAR_COOKIE, visibleTo, type AdminDestination } from "@/components/platform/admin-navigation";
import { PlatformQuickCreate } from "@/components/platform/platform-quick-create";
import { PlatformSearch } from "@/components/platform/platform-search";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { logout } from "@/lib/auth/client-lifecycle";
import { unsaved } from "@/lib/unsaved/coordinator";
import { cn } from "@/lib/utils/cn";

type User = { name: string; email: string | null; username: string };

function ContextLabel({ className }: { className?: string }) {
  return <span className={cn("rounded-md bg-fg px-2 py-1 text-micro font-semibold uppercase tracking-wider text-canvas", className)} data-testid="platform-context">Platform Admin</span>;
}

function NavRow({ item, active, collapsed, onNavigate }: { item: AdminDestination; active: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      data-testid={`admin-nav-${item.key}`}
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-table transition-colors touch:min-h-11",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        // Pending shows before the route commits (§28), not by colour alone.
        "data-[nav-pending]:bg-hover data-[nav-pending]:[&>svg]:animate-pulse",
        active ? "bg-accent-soft font-semibold text-accent-strong" : "text-fg-muted hover:bg-hover hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      <item.icon className="size-[18px] shrink-0" aria-hidden="true" />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function Navigation({ permissions, collapsed = false, onNavigate }: { permissions: readonly string[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = activeDestination(pathname)?.key;
  const items = visibleTo(adminDestinations, permissions);
  const row = (item: AdminDestination) => <li key={item.key}><NavRow item={item} active={item.key === current} collapsed={collapsed} onNavigate={onNavigate} /></li>;
  return (
    <nav aria-label="Platform administration" className="px-3 py-4">
      <ul className="space-y-0.5">{items.filter((item) => !item.utility).map(row)}</ul>
      <ul className="mt-4 space-y-0.5 border-t border-line pt-4">{items.filter((item) => item.utility).map(row)}</ul>
    </nav>
  );
}

function ProfileMenu({ user }: { user: User }) {
  const [pending, startTransition] = React.useTransition();
  const initials = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Account menu for ${user.name}`} data-testid="admin-profile" className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-surface-muted text-table font-semibold text-fg hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 touch:size-11">
          {initials || <UserRound className="size-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-micro font-semibold uppercase tracking-wider text-fg-subtle">Platform Admin</span>
          <span className="mt-1 block text-body font-medium text-fg">{user.name}</span>
          <span className="block truncate text-meta text-fg-subtle">{user.email ?? user.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/admin/account" className="cursor-pointer"><UserRound aria-hidden="true" className="size-4" />Account</Link></DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            // Unsaved work first, before the session ends (AUD-03 §7).
            void unsaved.requestDeparture({ kind: "identity", action: "sign-out" }).then((approval) => {
              if (!approval || !approval.run(() => undefined)) return;
              startTransition(async () => { await logout(); });
            });
          }}
        >
          <LogOut aria-hidden="true" className="size-4" />{pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The signed-in person, Account and Sign out at the foot of the phone drawer: the top bar has room only for the initials. */
function DrawerAccount({ user, onNavigate }: { user: User; onNavigate: () => void }) {
  const { signOut, signingOut } = useSignOut();
  const row = "flex h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-table text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
  return (
    <div className="mt-auto border-t border-line p-3" data-testid="admin-drawer-account">
      <p className="px-3 pb-2 pt-1">
        <span className="block truncate text-body font-medium text-fg">{user.name}</span>
        <span className="block truncate text-meta text-fg-subtle">{user.email ?? user.username}</span>
      </p>
      <Link href="/admin/account" onClick={onNavigate} className={row}><UserRound aria-hidden="true" className="size-[18px]" />Account</Link>
      <button type="button" disabled={signingOut} onClick={() => void signOut()} className={row}><LogOut aria-hidden="true" className="size-[18px]" />{signingOut ? "Signing out…" : "Sign out"}</button>
    </div>
  );
}

/** A destination's secondary pages, shown only on those pages themselves (Admin IA §23). */
function SectionTabs({ permissions }: { permissions: readonly string[] }) {
  const pathname = usePathname();
  const hit = activeTab(pathname);
  if (!hit) return null;
  const tabs = visibleTo(hit.destination.tabs ?? [], permissions);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={`${hit.destination.label} sections`} className="nesto-context-tabs mb-5 overflow-x-auto" data-context-tabs data-testid="admin-section-tabs">
      <div className="border-b border-line">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.href === hit.tab.href;
          return (
            <li key={tab.href}>
              <Link href={tab.href} aria-current={active ? "page" : undefined} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[nav-pending]:text-fg", active ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg")}>
                {tab.label}
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
 * The Platform Admin shell (Admin IA §10-§15, §38, §39): one sidebar of eight
 * destinations, collapsible on desktop and a drawer below it; a top bar with
 * search, the one Create and the account menu; "Platform Admin" always in
 * view. It lives in the /admin layout, so moving between admin pages swaps
 * only the main region (§54).
 */
export function PlatformShell({ user, permissions, initialCollapsed, devActions, children }: { user: User; permissions: readonly string[]; initialCollapsed: boolean; devActions?: React.ReactNode; children: React.ReactNode }) {
  const [mobile, setMobile] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  const pathname = usePathname();
  React.useEffect(() => setMobile(false), [pathname]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Per browser, and read by the layout so a refresh renders the right width at once (§13, §70).
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="min-h-dvh bg-canvas" data-sidebar={collapsed ? "collapsed" : "expanded"}>
      <aside className={cn("fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-surface transition-[width] duration-150 lg:flex", collapsed ? "w-16" : "w-60")} data-testid="admin-sidebar">
        <div className={cn("flex h-16 shrink-0 items-center gap-2 border-b border-line", collapsed ? "justify-center px-2" : "px-4")}>
          {collapsed ? <span role="img" aria-label="NESTO Platform Admin" className="grid size-9 place-items-center rounded-md bg-fg text-micro font-bold text-canvas">PA</span> : <><NestoLogo /><ContextLabel /></>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto"><Navigation permissions={permissions} collapsed={collapsed} /></div>
        <div className={cn("border-t border-line p-3", collapsed && "flex justify-center")}>
          <button type="button" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed} data-testid="admin-sidebar-toggle" className="flex h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-table text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden="true" /> : <><PanelLeftClose className="size-[18px]" aria-hidden="true" /><span>Collapse</span></>}
          </button>
        </div>
      </aside>
      <Drawer open={mobile} onOpenChange={setMobile}>
        <DrawerContent side="left" className="bg-surface lg:hidden" aria-describedby={undefined}>
          <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
            <span className="flex items-center gap-2"><NestoLogo /><ContextLabel /></span>
            <DrawerTitle className="sr-only">Platform administration</DrawerTitle>
            <DrawerClose asChild>
              <button type="button" aria-label="Close navigation" className="grid size-11 cursor-pointer place-items-center rounded-lg text-fg-muted hover:bg-hover"><X className="size-5" /></button>
            </DrawerClose>
          </div>
          <Navigation permissions={permissions} onNavigate={() => setMobile(false)} />
          <DrawerAccount user={user} onNavigate={() => setMobile(false)} />
        </DrawerContent>
      </Drawer>
      {/* The admin header is 64px at every width; the breadcrumb bar pins beneath it (Sticky Navigation §33). */}
      <BreadcrumbRegistryProvider>
      <div className={cn("transition-[padding] duration-150", collapsed ? "lg:pl-16" : "lg:pl-60")} style={{ "--nesto-shell-header-h": "4rem" } as React.CSSProperties} data-admin-shell>
        <header className="sticky top-0 z-[var(--nesto-z-shell-header)] border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex min-h-16 items-center gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:px-6">
            <button type="button" onClick={() => setMobile(true)} aria-label="Open navigation" aria-expanded={mobile} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-fg-muted hover:bg-hover lg:hidden"><Menu className="size-5" /></button>
            <ContextLabel className="shrink-0 max-sm:hidden lg:hidden" />
            <PlatformSearch />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <PlatformQuickCreate permissions={permissions} />
              {devActions}
              <ProfileMenu user={user} />
            </div>
          </div>
        </header>
        <BreadcrumbBar root={{ label: "NESTO Admin", href: "/admin" }} />
        <main id="nesto-main" tabIndex={-1} className="w-full min-w-0 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 outline-none sm:px-6 lg:px-8 [&_.grid>*]:min-w-0">
          <SectionTabs permissions={permissions} />
          {children}
        </main>
      </div>
      </BreadcrumbRegistryProvider>
    </div>
  );
}
