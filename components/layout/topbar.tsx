import { DevRoleSwitcher } from "@/components/layout/dev-role-switcher";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileHeader } from "@/components/layout/mobile-header";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import type { NavigationGroup } from "@/config/navigation";
import { isDevMode } from "@/lib/auth/dev-role";
import type { UserContext } from "@/lib/context/types";

/**
 * Universal top bar (PRD #3 §16, §76). Identical for every role.
 *
 * 56px on mobile, 64px from tablet up. It carries search, notifications and
 * the user menu (PRD #3 §17) and no page title: every page already names
 * itself in its own PageHeader directly below, so a module name up here only
 * said the same thing twice.
 *
 * Two zones. Search leads the left one, straight after the navigation
 * controls, and the left zone takes all the leftover width while the account
 * cluster keeps its own. Nothing before the search bar depends on who is
 * signed in, so its position is the same for every role, and it only gives up
 * width once the account cluster leaves it less than 420px (PRD #3 §18). Held
 * by roles/topbar-search-position.spec.ts.
 */
export function Topbar({
  context,
  navigation,
}: {
  context: UserContext;
  navigation: NavigationGroup[];
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/85 px-4 backdrop-blur-md md:h-16 md:px-6 xl:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileHeader navigation={navigation} companyName={context.company.name} />

        {/* The navigation collapse control sits out here rather than in the
            sidebar: the rail header has one slot and the mark already owns it
            (PRD #3 §14). */}
        <SidebarToggle />

        {/* Up to 420px. The margin separates it from the wordmark at tablet
            width; from lg nothing precedes it but the toggle, whose own
            padding already does that, so it lines up with the page gutter. */}
        <div className="hidden w-full min-w-0 max-w-[420px] md:ml-2 md:block lg:ml-0">
          <GlobalSearch />
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1 md:gap-2">
        {isDevMode ? (
          <DevRoleSwitcher
            role={context.role}
            actualRole={context.actualRole}
            isOverridden={context.roleIsOverridden}
          />
        ) : null}
        <NotificationsMenu />
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px shrink-0 bg-line lg:block" />
        <UserMenu
          user={{
            firstName: context.firstName,
            lastName: context.lastName,
            avatarUrl: context.avatarUrl,
            roleLabel: context.roleLabel,
            companyName: context.company.name,
          }}
        />
      </div>
    </header>
  );
}
