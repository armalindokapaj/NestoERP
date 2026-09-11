import { DevRoleSwitcher } from "@/components/layout/dev-role-switcher";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileHeader } from "@/components/layout/mobile-header";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { PageTitle } from "@/components/layout/page-title";
import { UserMenu } from "@/components/layout/user-menu";
import type { NavigationGroup } from "@/config/navigation";
import { isDevMode } from "@/lib/auth/dev-role";
import type { UserContext } from "@/lib/context/types";

/**
 * Universal top bar (PRD #3 §16, §76). Identical for every role.
 *
 * 56px on mobile, 64px from tablet up. The page title stays in the main
 * content; here the bar only carries context, search, notifications and the
 * user menu (PRD #3 §17).
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
      <MobileHeader navigation={navigation} companyName={context.company.name} />

      <div className="hidden min-w-0 lg:block">
        <PageTitle />
      </div>

      {/* Up to 440px, centred, and free to shrink — at the 768px tablet
          boundary a fixed width pushes the account cluster off screen
          (PRD #3 §18). */}
      <div className="mx-auto hidden min-w-0 max-w-[420px] flex-1 px-2 md:block">
        <GlobalSearch />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
        {isDevMode ? (
          <DevRoleSwitcher
            role={context.role}
            actualRole={context.actualRole}
            isOverridden={context.roleIsOverridden}
          />
        ) : null}
        <NotificationsMenu />
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line lg:block" />
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
