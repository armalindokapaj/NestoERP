import { GlobalSearch } from "@/components/layout/global-search";
import { MobileMenuButton } from "@/components/layout/mobile-menu-button";
import { MobileHeader } from "@/components/layout/mobile-header";
import { ActivityBell } from "@/components/layout/activity-bell";
import { QuickCreate } from "@/components/layout/quick-create";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { AccountPanel } from "@/components/shell/account-panel";
import { can, canAccessModule } from "@/lib/access/can";
import type { NavigationGroup } from "@/config/navigation";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import type { ShellCoreDTO } from "@/lib/workspace/shell-core";

/**
 * Universal top bar (PRD #3 §16, §76; UI-01 §5). Identical for every role.
 *
 * 56px on mobile, 64px from tablet up. The left zone carries the navigation
 * controls and + Create; the right zone is the universal cluster, always in
 * the order Search, Notifications, Account (UI-01 §1) and 44px targets at every
 * width. Page titles are not here: every page names itself in its own
 * PageHeader. The organization and the workspace lead the sidebar, where the
 * workspace is switched (OW §2, §19).
 *
 * On a phone the bell lives in the bottom bar and the account in More (MOB-02
 * §39), and the development user switcher moves into the navigation drawer's
 * foot. The gutters include the safe-area insets.
 */
export async function Topbar({
  context,
  navigation,
  core,
}: {
  context: UserContext;
  navigation: NavigationGroup[];
  core: ShellCoreDTO;
}) {
  const t = await getTranslations("roles");
  // The profile names the workspace beside the role, and switches nothing (OW §43, §66).
  const workspaceName = context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name;
  // Company Settings is offered only where its own page would open (settings-access.ts), never by title.
  const companySettings = context.workspace.scopeType === "COMPANY" && canAccessModule(context, "settings") && can(context, "company.name.update");

  return (
    // The blur sits on a layer behind the bar, not on the bar: a backdrop filter makes its
    // element the box that `position: fixed` children are placed in, which pinned the phone's
    // + Create bottom sheet to the bar's lower edge, above the screen (NAV-01 Q24).
    <header data-shell-region className="sticky top-0 z-[var(--nesto-z-shell-header)] flex h-14 items-center gap-2 border-b border-accent/25 bg-canvas pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:h-16 md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] xl:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileHeader navigation={navigation} isDemo={context.parentGroup.isDemo} />

        {/* The navigation collapse control sits out here rather than in the
            sidebar: the rail header has one slot and the organization's mark
            already owns it (PRD #3 §14, OW §47). */}
        <SidebarToggle />

        {/* Only what this person may create here; hidden when that is nothing (Quick Create §4, §150).
            A page action, not a universal control: it sits on the left so the three controls keep the
            right edge (UI-01 §5.1). The menu loads only when opened (NAV-01 QC-01). */}
        <QuickCreate userKey={context.userId} summary={core.quickCreate} />
      </div>

      {/* The universal cluster, in this order on every surface: Search, Notifications, Account (UI-01 §1). */}
      <div className="flex min-w-0 items-center justify-end gap-0 sm:gap-1" data-testid="global-actions">
        <GlobalSearch contextKey={core.contextKey} />
        {/* One bell for notifications and announcements alike, across every company (Activity Center §3, §31). Phone: the bell is in the bottom bar. */}
        <ActivityBell contextKey={core.contextKey} canManageAnnouncements={context.permissions.includes("announcement.create")} />
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
            }}
          />
        </div>
        {/* Phone: the menu, fixed at the top right (More). */}
        <MobileMenuButton />
      </div>
    </header>
  );
}
