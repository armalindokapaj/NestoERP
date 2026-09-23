import { Suspense } from "react";

import { DEMO_DISCLAIMER } from "@/components/dashboard/group-hero";
import { DevUserSwitcher } from "@/components/layout/dev-user-switcher";
import { GlobalSearch } from "@/components/layout/global-search";
import { MobileHeader } from "@/components/layout/mobile-header";
import { ActivityCenterMenu } from "@/components/layout/activity-center-menu";
import { QuickCreate } from "@/components/layout/quick-create";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import type { NavigationGroup } from "@/config/navigation";
import { isDevMode } from "@/lib/auth/dev-mode";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import type { WorkspacesDTO } from "@/lib/workspace/workspace.service";

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
export async function Topbar({
  context,
  navigation,
  workspaces,
}: {
  context: UserContext;
  navigation: NavigationGroup[];
  workspaces: WorkspacesDTO;
}) {
  const t = await getTranslations("roles");
  // The workspace names itself: the group above, or the company (Workspace Context §10).
  const workspaceName = context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/85 px-4 backdrop-blur-md md:h-16 md:px-6 xl:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileHeader navigation={navigation} companyName={workspaceName} />

        {/* The navigation collapse control sits out here rather than in the
            sidebar: the rail header has one slot and the mark already owns it
            (PRD #3 §14). */}
        <SidebarToggle />

        {/* Up to 420px. The margin separates it from the wordmark at tablet
            width; from lg nothing precedes it but the toggle, whose own
            padding already does that, so it lines up with the page gutter. */}
        <div className="ml-auto min-w-0 md:ml-2 md:w-full md:max-w-[420px] lg:ml-0">
          <GlobalSearch userKey={context.userId} />
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1 md:gap-2">
        {/* Development only: signs in as another demo user (C-01 §15). Streamed,
            so reading the roster never holds up the page. */}
        {isDevMode ? (
          <Suspense fallback={null}>
            <DevUserSwitcher />
          </Suspense>
        ) : null}
        {/* A demonstration tenant says so on every page (D-01 §68, §69). */}
        {context.parentGroup.isDemo ? (
          <span
            title={DEMO_DISCLAIMER}
            aria-label={DEMO_DISCLAIMER}
            data-testid="demo-notice"
            className="hidden shrink-0 rounded-full border border-line px-2.5 py-0.5 text-meta font-medium text-fg-muted sm:inline-flex"
          >
            Demo data
          </span>
        ) : null}
        {/* The group and the companies this person may work in; shown only when
            there is a choice to make (Workspace Context §5, §9). */}
        <WorkspaceSwitcher workspaces={workspaces} />
        {/* One bell for notifications and announcements alike, across every company (Activity Center §3, §31). */}
        {/* Only what this person may create here; hidden when that is nothing (Quick Create §4, §150). */}
        <QuickCreate userKey={context.userId} />
        <ActivityCenterMenu userKey={context.userId} canManageAnnouncements={context.permissions.includes("announcement.create")} />
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px shrink-0 bg-line lg:block" />
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
    </header>
  );
}
