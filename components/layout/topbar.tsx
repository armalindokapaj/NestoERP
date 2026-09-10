import { DevRoleSwitcher } from "@/components/layout/dev-role-switcher";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileHeader } from "@/components/layout/mobile-header";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { PageTitle } from "@/components/layout/page-title";
import { UserMenu } from "@/components/layout/user-menu";
import { isDevMode } from "@/lib/auth/dev-role";
import type { CurrentUser } from "@/lib/auth/types";

/**
 * Universal top bar (design spec §15, §37, §45). Identical for every role.
 *
 * 56px on mobile, 64px from tablet up. The page title stays in the main
 * content on desktop; here it only says which module you are in.
 */
export function Topbar({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/85 px-4 backdrop-blur-md md:h-16 md:px-6 xl:px-8">
      <MobileHeader role={user.role} companyName={user.companyName} />

      <div className="hidden min-w-0 lg:block">
        <PageTitle />
      </div>

      {/* §16: up to 440px, centred, and free to shrink — at the 768px tablet
          boundary a fixed width pushes the account cluster off screen. */}
      <div className="mx-auto hidden min-w-0 max-w-[420px] flex-1 px-2 md:block">
        <GlobalSearch />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
        {isDevMode ? (
          <DevRoleSwitcher
            role={user.role}
            actualRole={user.actualRole}
            isOverridden={user.roleIsOverridden}
          />
        ) : null}
        <NotificationsMenu />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
