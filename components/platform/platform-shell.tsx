"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { usePathname } from "next/navigation";
import {
  Activity, BadgeEuro, Boxes, Building2, ChevronDown, Database, Flag, Gauge,
  History, LayoutDashboard, Menu, Orbit, SearchCheck, Settings, ShieldCheck,
  SlidersHorizontal, Users, Wrench, X,
} from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { PlatformSearch } from "@/components/platform/platform-search";
import { cn } from "@/lib/utils/cn";

type NavItem = { label: string; href: string; icon?: React.ComponentType<{ className?: string }> };
type NavGroup = { label: string; icon: React.ComponentType<{ className?: string }>; items: NavItem[] };

const groups: NavGroup[] = [
  { label: "Overview", icon: LayoutDashboard, items: [{ label: "Dashboard", href: "/platform-admin", icon: LayoutDashboard }] },
  { label: "Organizations", icon: Building2, items: [
    { label: "Groups", href: "/platform-admin/organizations/groups" }, { label: "Companies", href: "/platform-admin/organizations/companies" }, { label: "Projects", href: "/platform-admin/organizations/projects" }, { label: "Implementations", href: "/platform-admin/organizations/implementations" },
  ] },
  { label: "People & Access", icon: Users, items: [
    { label: "People", href: "/platform-admin/people" }, { label: "User Accounts", href: "/platform-admin/access/users" }, { label: "Memberships", href: "/platform-admin/access/memberships" }, { label: "Roles", href: "/platform-admin/access/roles" }, { label: "Permissions", href: "/platform-admin/access/permissions" }, { label: "Access Grants", href: "/platform-admin/access/grants" }, { label: "Access Inspector", href: "/platform-admin/access/inspector", icon: SearchCheck }, { label: "Sessions", href: "/platform-admin/access/sessions" },
  ] },
  { label: "Product", icon: Boxes, items: [
    { label: "Modules", href: "/platform-admin/product/modules" }, { label: "Feature Flags", href: "/platform-admin/product/feature-flags", icon: Flag }, { label: "Templates", href: "/platform-admin/product/templates" }, { label: "Pricing", href: "/platform-admin/pricing", icon: BadgeEuro },
  ] },
  { label: "3D Platform", icon: Orbit, items: [
    { label: "3D Experiences", href: "/platform-admin/3d" }, { label: "Model Library", href: "/platform-admin/3d/models" }, { label: "Publishing", href: "/platform-admin/3d/publishing" }, { label: "Diagnostics", href: "/platform-admin/3d/diagnostics" },
  ] },
  { label: "Data", icon: Database, items: [
    { label: "Storage", href: "/platform-admin/data/storage" }, { label: "Diagnostics", href: "/platform-admin/data/diagnostics" },
  ] },
  { label: "Operations", icon: Activity, items: [
    { label: "Jobs", href: "/platform-admin/operations/jobs" }, { label: "System Health", href: "/platform-admin/operations/health", icon: Gauge },
  ] },
  { label: "Security", icon: ShieldCheck, items: [
    { label: "Failed Logins", href: "/platform-admin/security/failed-logins" }, { label: "Access Changes", href: "/platform-admin/security/access-changes" }, { label: "Security Audit", href: "/platform-admin/security/audit" },
  ] },
  { label: "Platform", icon: SlidersHorizontal, items: [
    { label: "Support", href: "/platform-admin/support" }, { label: "Global Audit", href: "/platform-admin/audit", icon: History }, { label: "Demo / Development", href: "/platform-admin/demo" }, { label: "Settings", href: "/platform-admin/settings", icon: Settings }, { label: "Maintenance", href: "/platform-admin/settings/maintenance", icon: Wrench },
  ] },
];

function activePath(pathname: string, href: string) {
  if (href === "/platform-admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Navigation({ close }: { close?: () => void }) {
  const pathname = usePathname();
  return <nav className="space-y-4 px-3 py-4" aria-label="Platform administration">
    {groups.map((group) => {
      const open = group.items.some((item) => activePath(pathname, item.href));
      return <details key={group.label} open={open || group.label === "Overview"} className="group/nav">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 touch:min-h-11 text-table font-semibold uppercase tracking-[0.08em] text-fg-subtle hover:bg-hover hover:text-fg">
          <group.icon className="size-4" /><span className="flex-1">{group.label}</span>{group.items.length > 1 ? <ChevronDown className="size-3.5 transition group-open/nav:rotate-180" /> : null}
        </summary>
        <div className="mt-1 space-y-0.5">
          {group.items.map((item) => {
            const active = activePath(pathname, item.href);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} onClick={close} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-table transition touch:min-h-11", active ? "bg-accent-soft font-semibold text-accent-strong" : "text-fg-muted hover:bg-hover hover:text-fg", group.items.length > 1 && "pl-9")}>
              {Icon ? <Icon className="size-4" /> : null}<span>{item.label}</span>
            </Link>;
          })}
        </div>
      </details>;
    })}
  </nav>;
}

/*
 * AUD-04 §4 (D-09-16, D-09-17, MW-02, MW-19): the phone navigation is the
 * shared Drawer (a Radix dialog) instead of a hand-rolled overlay, so it is a
 * modal with focus moved in and trapped, Escape and backdrop close, the page
 * behind locked and the safe areas padded. It also closes on any route change
 * (a search result, not only a nav link). Menu, close and nav rows are 44px
 * under touch.
 */
export function PlatformShell({ user, actions, children }: { user: string; actions: React.ReactNode; children: React.ReactNode }) {
  const [mobile, setMobile] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setMobile(false), [pathname]);
  return <div className="min-h-dvh bg-canvas">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-line bg-surface lg:block">
      <div className="flex h-16 items-center gap-3 border-b border-line px-5"><NestoLogo /><span className="rounded-md bg-fg px-2 py-1 text-micro font-semibold uppercase tracking-wider text-canvas">Admin</span></div>
      <div className="h-[calc(100dvh-4rem)] overflow-y-auto"><Navigation /></div>
    </aside>
    <Drawer open={mobile} onOpenChange={setMobile}>
      <DrawerContent side="left" className="bg-surface lg:hidden" aria-describedby={undefined}>
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
          <NestoLogo />
          <DrawerTitle className="sr-only">Platform administration</DrawerTitle>
          <DrawerClose asChild>
            <button type="button" aria-label="Close navigation" className="grid size-11 place-items-center rounded-lg text-fg-muted hover:bg-hover">
              <X className="size-5" />
            </button>
          </DrawerClose>
        </div>
        <Navigation close={() => setMobile(false)} />
      </DrawerContent>
    </Drawer>
    <div className="lg:pl-72">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
          <button type="button" onClick={() => setMobile(true)} aria-label="Open navigation" aria-expanded={mobile} className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-hover lg:hidden"><Menu className="size-5" /></button>
          <PlatformSearch />
          <div className="ml-auto flex items-center gap-3"><Link href="/platform-admin/account" title="My Account & Security" className="max-w-40 truncate rounded-md px-1 text-table text-fg-muted hover:text-fg hover:underline">{user}</Link>{actions}</div>
        </div>
      </header>
      <main id="nesto-main" tabIndex={-1} className="mx-auto max-w-[1600px] px-4 py-6 outline-none sm:px-6 lg:px-8">{children}</main>
    </div>
  </div>;
}

export { groups as platformNavigation };
