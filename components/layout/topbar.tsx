import { GlobalSearch } from "@/components/layout/global-search";
import { SectionMenu } from "@/components/layout/section-menu";
import { MobileHeader } from "@/components/layout/mobile-header";
import { ActivityBell } from "@/components/layout/activity-bell";
import { QuickCreate } from "@/components/layout/quick-create";
import { WorkspaceSwitcher } from "@/components/layout/organization-workspace-header";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { AccountPanel } from "@/components/shell/account-panel";
import { can, canAccessModule } from "@/lib/access/can";
import { getTranslations } from "@/lib/i18n/server";
import { getDesignState } from "@/lib/layout/design-server";
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
 * Below `lg` (phones and tablets) the bell lives in the bottom bar, and the top
 * right is the page's section pill — "Sales ▾" — which opens the page's tabs as
 * a menu, as the tab rows are not drawn there (components/layout/section-menu.tsx).
 * The bottom bar's Menu is the only menu there: the top left carries no drawer
 * trigger (mobile-header.tsx). On a phone the account lives in More (MOB-02
 * §39). The gutters include the safe-area insets.
 */
export async function Topbar({
  context,
  core,
}: {
  context: UserContext;
  core: ShellCoreDTO;
}) {
  const t = await getTranslations("roles");
  // The profile names the workspace beside the role, and switches nothing (OW §43, §66).
  const workspaceName = context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name;
  // Company Settings is offered only where its own page would open (settings-access.ts), never by title.
  const companySettings = context.workspace.scopeType === "COMPANY" && canAccessModule(context, "settings") && can(context, "company.name.update");
  // Which display preferences the panel may offer: the environment's answer (UI-02 §15, §33).
  const { options: appearance } = await getDesignState();

  return (
    // The blur sits on a layer behind the bar, not on the bar: a backdrop filter makes its
    // element the box that `position: fixed` children are placed in, which pinned the phone's
    // + Create bottom sheet to the bar's lower edge, above the screen (NAV-01 Q24).
    <header data-shell-region data-topbar-row className="sticky top-0 z-[var(--nesto-z-shell-header)] flex h-(--nesto-shell-header-h) items-center gap-2 border-b border-accent/25 bg-canvas pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] xl:px-8 ds2:pl-[max(var(--nesto-space-page-x),var(--nesto-safe-left))] ds2:pr-[max(var(--nesto-space-page-x),var(--nesto-safe-right))]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileHeader />

        {/* The navigation collapse control sits out here rather than in the
            sidebar: the rail header has one slot and the organization's mark
            already owns it (PRD #3 §14, OW §47). */}
        <SidebarToggle />

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
        {/* One bell for notifications and announcements alike, across every company (Activity Center §3, §31). Below lg it is the bottom bar's Alerts. */}
        <div className="contents max-lg:hidden">
          <ActivityBell contextKey={core.contextKey} canManageAnnouncements={context.permissions.includes("announcement.create")} />
        </div>
        {/* Phone: the account lives in More (MOB-02 §39). */}
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
              appearance,
            }}
          />
        </div>
        {/* Below lg: the page's sections, as the pill at the top right; nothing on a page without them. */}
        <SectionMenu />
      </div>
    </header>
  );
}
