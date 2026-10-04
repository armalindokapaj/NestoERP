"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, LogOut, ShieldCheck, Users } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { LocaleSwitch } from "@/components/i18n/locale-switch";
import { OrganizationMark } from "@/components/layout/organization-mark";
import { PoweredBy } from "@/components/layout/powered-by";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useSignOut } from "@/components/layout/use-sign-out";
import { PageContainer } from "@/components/ui/page-container";
import { cn } from "@/lib/utils/cn";

type Capabilities = { companies: boolean; users: boolean; roles: boolean };

/**
 * The shell of a group-only session (Admin PRD #9 §24, §47): the group's name,
 * the sections its seat may use and the account controls. Navigation is built
 * from the seat's capabilities, so nothing here links to a page that would
 * refuse the person.
 */
export function GroupShell({ group, user, capabilities, children }: { group: { name: string; roleName: string }; user: { name: string }; capabilities: Capabilities; children: React.ReactNode }) {
  const t = useTranslations("group");
  const pathname = usePathname();
  const { signOut, signingOut } = useSignOut();
  const items = [
    { href: "/group", label: t("shell.overview"), icon: LayoutDashboard, show: true },
    { href: "/group/companies", label: t("shell.companies"), icon: Building2, show: capabilities.companies },
    { href: "/group/users", label: t("shell.users"), icon: Users, show: capabilities.users },
    { href: "/group/roles", label: t("shell.roles"), icon: ShieldCheck, show: capabilities.roles },
  ].filter((item) => item.show);
  const active = (href: string) => (href === "/group" ? pathname === "/group" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh flex-col bg-canvas" data-testid="group-shell">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-3 px-4 md:px-6">
          <Link href="/group" className="flex min-w-0 items-center gap-3" data-testid="group-context">
            <OrganizationMark name={group.name} logoUrl={null} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-body font-semibold text-fg">{group.name}</span>
              <span className="block truncate text-meta text-fg-muted">{t("shell.area")} · {group.roleName}</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitch label={t("shell.language")} className="h-10 px-3" />
            <ThemeToggle />
            <span className="mx-2 hidden h-6 w-px bg-line md:block" aria-hidden="true" />
            <span className="hidden max-w-40 truncate text-table text-fg md:block">{user.name}</span>
            <button type="button" disabled={signingOut} onClick={() => void signOut()} aria-label={t("shell.signOut")} data-testid="group-sign-out" className="flex h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-table text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <LogOut aria-hidden="true" className="size-[18px]" />
              <span className="max-md:sr-only">{signingOut ? t("shell.signingOut") : t("shell.signOut")}</span>
            </button>
          </div>
        </div>
        <nav aria-label={t("shell.navLabel")} className="mx-auto w-full max-w-[1400px] overflow-x-auto px-4 md:px-6" data-testid="group-nav">
          <ul className="flex gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={active(item.href) ? "page" : undefined} className={cn("-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-table transition-colors", active(item.href) ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg")}>
                  <item.icon aria-hidden="true" className="size-[18px]" strokeWidth={1.6} />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <PageContainer as="main" id="nesto-main" tabIndex={-1} className="flex-1 outline-none">{children}</PageContainer>
      <footer className="px-4 py-4 md:px-6"><PoweredBy isDemo={false} /></footer>
    </div>
  );
}
