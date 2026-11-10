import type * as React from "react";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileHeader } from "@/components/layout/mobile-header";
import { ActivityBell } from "@/components/layout/activity-bell";
import { QuickCreate } from "@/components/layout/quick-create";
import { OrganizationWorkspaceHeader, WorkspaceSwitcher } from "@/components/layout/organization-workspace-header";
import { AccountPanel } from "@/components/shell/account-panel";
import { can, canAccessModule } from "@/lib/access/can";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import type { ShellCoreDTO } from "@/lib/workspace/shell-core";

/**
 * Universal top bar (PRD #3 §16, §76; UI-01 §5). Identical for every role.
 *
 * 56px on mobile, 64px from tablet up; version 2 adds a 60px tablet step
 * (UI-02 §7) — one height, `--nesto-shell-header-h`, which every layer pinned
 * under the bar is offset by. The left zone carries the navigation
 * controls, the company switcher and, after it, + Create; the right zone is
 * the universal cluster, always in the order Search, Notifications, Account
 * (UI-01 §1) and 44px targets at every width. Page titles are not here: every
 * page names itself in its own PageHeader. The sidebar's header names the
 * workspace being worked in and leads to its dashboard.
 *
 * Every panel opened from this bar starts on the breadcrumb bar's top line
 * (lib/layout/topbar-line.ts), so they read as one family.
 *
 * From `lg` the bar starts with the workspace's own name, the way to its
 * dashboard, and with the Ribbon chosen in Settings the Ribbon is drawn under
 * the bar's row, inside the same sticky header: `--nesto-shell-header-h` then
 * covers both, so every layer pinned under the header still lines up
 * (docs/ui/UI-04-navigation-layouts.md).
 *
 * Below `lg` (phones and tablets) the navigation is the phone Ribbon at the
 * bottom (components/layout/pocket-ribbon.tsx, action-ribbon.tsx), which also
 * carries the page's sections as This page: the top left carries no drawer
 * trigger (mobile-header.tsx). On a phone the account lives under the Ribbon's
 * Company tab. The gutters include the safe-area insets.
 */
export async function Topbar({
  context,
  core,
  ribbon,
}: {
  context: UserContext;
  core: ShellCoreDTO;
  /** The desktop Ribbon, when it is the chosen navigation (components/layout/ribbon.tsx). */
  ribbon?: React.ReactNode;
}) {
  const [t, shell] = await Promise.all([getTranslations("roles"), getTranslations("shell")]);
  // The profile names the workspace beside the role, and switches nothing (OW §43, §66).
  const workspaceName = context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name;
  // Company Settings is offered only where its own page would open (settings-access.ts), never by title.
  const companySettings = context.workspace.scopeType === "COMPANY" && canAccessModule(context, "settings") && can(context, "company.name.update");

  return (
    // The blur sits on a layer behind the bar, not on the bar: a backdrop filter makes its
    // element the box that `position: fixed` children are placed in, which pinned the phone's
    // + Create bottom sheet to the bar's lower edge, above the screen (NAV-01 Q24).
    <header data-shell-region className="sticky top-0 z-[var(--nesto-z-shell-header)] flex h-(--nesto-shell-header-h) flex-col border-b bg-canvas border-fg">
      <div data-topbar-row className="flex min-h-0 flex-1 items-center gap-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] xl:px-8 max-md:pl-[max(1.25rem,env(safe-area-inset-left))] max-md:pr-[max(1.25rem,env(safe-area-inset-right))]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileHeader />

        {/* From lg: the workspace's own name, the way to its dashboard. */}
        <div className="max-w-60 shrink-0 max-lg:hidden" data-testid="topbar-home">
          <OrganizationWorkspaceHeader variant="home" />
        </div>
        {/* A demonstration tenant says so on every page (D-01 §68). */}
        {context.parentGroup.isDemo ? (
          <span title={shell("demoDisclaimer")} data-testid="demo-notice" className="inline-flex shrink-0 rounded-full border border-line px-2 py-px text-micro font-medium text-fg-muted max-lg:hidden">
            <span aria-hidden="true">{shell("demoData")}</span>
            <span className="sr-only">{shell("demoDisclaimer")}</span>
          </span>
        ) : null}

        {/* The company switcher, first: built like + Create, which follows it; only where there is another workspace to enter. */}
        <WorkspaceSwitcher />

        {/* Only what this person may create here; hidden when that is nothing (Quick Create §4, §150).
            A page action, not a universal control: it sits on the left so the three controls keep the
            right edge (UI-01 §5.1). The menu loads only when opened (NAV-01 QC-01). */}
        <QuickCreate userKey={context.userId} summary={core.quickCreate} />
      </div>

      {/* The universal cluster, in this order on every surface: Search, Notifications, Account (UI-01 §1). */}
      <div className="flex min-w-0 items-center justify-end gap-0 sm:gap-1" data-testid="global-actions">
        <GlobalSearch contextKey={core.contextKey} />
        {/* One bell for notifications and announcements alike, across every company (Activity Center §3, §31). */}
        <ActivityBell contextKey={core.contextKey} canManageAnnouncements={context.permissions.includes("announcement.create")} />
        {/* Phone: the account lives under the phone Ribbon's Company tab. */}
        <div className="contents max-md:hidden">
          <AccountPanel
            model={{
              user: { firstName: context.firstName, lastName: context.lastName, avatarUrl: context.avatarUrl },
              roleLabel: t(`${context.role}.label`),
              workspaceName,
              destinations: {
                profile: "/settings/profile",
                settings: "/settings",
                help: "/help",
                whatsNew: "/whats-new",
                organizationSettings: companySettings ? { href: "/settings/company", kind: "company" } : undefined,
              },
            }}
          />
        </div>
      </div>
      </div>
      {ribbon}
    </header>
  );
}
