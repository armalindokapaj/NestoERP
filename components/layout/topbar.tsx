import { Suspense } from "react";

import { DevUserSwitcher } from "@/components/layout/dev-user-switcher";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileHeader } from "@/components/layout/mobile-header";
import { ActivityBell } from "@/components/layout/activity-bell";
import { QuickCreate } from "@/components/layout/quick-create";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import type { NavigationGroup } from "@/config/navigation";
import { isDevMode } from "@/lib/auth/dev-mode";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import type { ShellCoreDTO } from "@/lib/workspace/shell-core";

/**
 * Universal top bar (PRD #3 §16, §76). Identical for every role.
 *
 * 56px on mobile, 64px from tablet up. It carries search, + Create, Activity
 * and the profile (PRD #3 §17; OW §19, §108) and no page title: every page
 * already names itself in its own PageHeader directly below, so a module name
 * up here only said the same thing twice. The organization and the workspace
 * are not here either: they lead the sidebar, where the workspace is switched
 * (OW §2, §19), and a demonstration tenant says so at the sidebar's foot.
 *
 * Two zones. Search leads the left one, straight after the navigation
 * controls, and the left zone takes all the leftover width while the account
 * cluster keeps its own. Nothing before the search bar depends on who is
 * signed in, so its position is the same for every role, and it only gives up
 * width once the account cluster leaves it less than 420px (PRD #3 §18). Held
 * by roles/topbar-search-position.spec.ts.
 *
 * At 320px every control is a 44px target (AUD-04 §4, MW-02): the icons sit
 * edge to edge on a phone (hit areas adjacent, never overlapping), the account
 * chevron gives way, and the development user switcher — the one control a
 * phone's bar has no room for — moves into the navigation drawer's foot, still
 * labelled and one tap away. The gutters include the safe-area insets, so a
 * phone on its side keeps the controls clear of the notch.
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

  return (
    // The blur sits on a layer behind the bar, not on the bar: a backdrop filter makes its
    // element the box that `position: fixed` children are placed in, which pinned the phone's
    // + Create bottom sheet to the bar's lower edge, above the screen (NAV-01 Q24).
    <header data-shell-region className="sticky top-0 z-[var(--nesto-z-shell-header)] flex h-14 items-center gap-2 border-b border-line pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-surface/85 before:backdrop-blur-md md:h-16 md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] xl:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileHeader
          navigation={navigation}
          isDemo={context.parentGroup.isDemo}
          drawerFooter={
            isDevMode ? (
              <Suspense fallback={null}>
                <DevUserSwitcher variant="drawer" />
              </Suspense>
            ) : null
          }
        />

        {/* The navigation collapse control sits out here rather than in the
            sidebar: the rail header has one slot and the organization's mark
            already owns it (PRD #3 §14, OW §47). */}
        <SidebarToggle />

        {/* Up to 420px. The margin separates it from the mark at tablet
            width; from lg nothing precedes it but the toggle, whose own
            padding already does that, so it lines up with the page gutter. */}
        <div className="ml-auto min-w-0 md:ml-2 md:w-full md:max-w-[420px] lg:ml-0">
          <GlobalSearch contextKey={core.contextKey} />
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-0 sm:gap-1 md:gap-2">
        {/* Development only: signs in as another demo user (C-01 §15). Streamed,
            so reading the roster never holds up the page. Below sm it lives in
            the navigation drawer instead (AUD-04 §4). */}
        {isDevMode ? (
          <div className="contents max-sm:hidden">
            <Suspense fallback={null}>
              <DevUserSwitcher />
            </Suspense>
          </div>
        ) : null}
        {/* One bell for notifications and announcements alike, across every company (Activity Center §3, §31). */}
        {/* Only what this person may create here; hidden when that is nothing (Quick Create §4, §150).
            The button comes from the shell's summary; the menu loads only when opened (NAV-01 QC-01). */}
        <QuickCreate userKey={context.userId} summary={core.quickCreate} />
        <ActivityBell contextKey={core.contextKey} canManageAnnouncements={context.permissions.includes("announcement.create")} />
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px shrink-0 bg-line lg:block" />
        {/* Phone: the account lives in More (MOB-02 §39). */}
        <div className="contents max-md:hidden">
        <UserMenu
          user={{
            firstName: context.firstName,
            lastName: context.lastName,
            avatarUrl: context.avatarUrl,
            roleLabel: t(`${context.role}.label`),
            companyName: workspaceName,
          }}
        />
        </div>
      </div>
    </header>
  );
}
