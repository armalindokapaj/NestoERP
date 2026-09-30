import type * as React from "react";

import { MobileNav } from "@/components/layout/mobile-nav";
import { OrganizationHomeMark, OrganizationWorkspaceHeader } from "@/components/layout/organization-workspace-header";
import type { NavigationGroup } from "@/config/navigation";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Mobile and tablet-portrait header cluster (design spec §37, §45).
 *
 * `☰ [mark]` — the drawer trigger and the organization's mark, which leads
 * home (OW §5, §6). Composed by Topbar rather than being a second header, so
 * there is still exactly one app shell.
 */
export async function MobileHeader({
  navigation,
  isDemo,
  drawerFooter,
}: {
  navigation: NavigationGroup[];
  isDemo: boolean;
  /** Shown in the drawer's foot: controls a phone's top bar has no room for (AUD-04 §4). */
  drawerFooter?: React.ReactNode;
}) {
  const t = await getTranslations("shell");

  return (
    <>
      {/* Phone (MOB-02 §8, §9): the workspace as one line of context. Tapping it opens the
          workspace sheet; navigation is the bottom bar and More, so no drawer trigger. */}
      <div className="min-w-0 flex-1 md:hidden" data-testid="mobile-context">
        <OrganizationWorkspaceHeader variant="drawer" />
      </div>
      {/* Tablet portrait: the drawer stays. Edge to edge below sm: two 44px targets side by side, never overlapping (AUD-04 §4). */}
      <div className="hidden items-center gap-0 sm:gap-1 md:flex lg:hidden">
        <MobileNav navigation={navigation} isDemo={isDemo} footer={drawerFooter} />
        <OrganizationHomeMark label={t("dashboardLink")} />
      </div>
    </>
  );
}
