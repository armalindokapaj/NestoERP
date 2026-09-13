import { DevRoleSwitcher } from "@/components/layout/dev-role-switcher";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileHeader } from "@/components/layout/mobile-header";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { PageTitle } from "@/components/layout/page-title";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
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
 *
 * Three zones, and the outer two share the leftover width equally (`flex-1
 * basis-0`) rather than being sized by what is in them. That is what keeps the
 * search bar in one place: sized to content, the left zone moved with the
 * landing module's name and the right zone with the person's name, role label
 * and the dev switcher, so signing in as an Owner and as a QA/QC engineer put
 * the bar in two different positions (PRD #3 §18). `min-w-0` on both side
 * zones is what holds that: without it the wider cluster claims more than its
 * half and pushes the bar off centre again. Held by
 * roles/topbar-search-position.spec.ts.
 *
 * The zones are equal, so at tablet width the account cluster has to fit in
 * half of what the search bar leaves. What gives way there is the development
 * role switcher, not the person's name — see DevRoleSwitcher.
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
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2">
        <MobileHeader navigation={navigation} companyName={context.company.name} />

        {/* The navigation collapse control sits out here rather than in the
            sidebar: the rail header has one slot and the mark already owns it
            (PRD #3 §14). */}
        <SidebarToggle />

        <div className="hidden min-w-0 lg:block">
          <PageTitle />
        </div>
      </div>

      {/* Up to 420px and centred. It does not grow into the leftover width —
          the side zones absorb all of it — so the bar's x depends on the
          viewport alone. Below 420px of room it is free to shrink, because at
          the 768px tablet boundary a hard width pushes the account cluster off
          screen (PRD #3 §18). */}
      <div className="hidden w-full min-w-0 max-w-[420px] px-2 md:block">
        <GlobalSearch />
      </div>

      <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-1 md:gap-2">
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
