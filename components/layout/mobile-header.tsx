import { OrganizationHomeMark, OrganizationWorkspaceHeader } from "@/components/layout/organization-workspace-header";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Mobile and tablet-portrait header cluster (design spec §37, §45).
 *
 * Below `lg` the bottom bar's Menu is the one menu: it opens More, which holds
 * every destination. So the top bar carries no drawer trigger at any width
 * below `lg` — a tablet showed two menus, the top-left hamburger and Menu —
 * only the workspace's context: on a phone its name, which opens the
 * workspace sheet; on a tablet the organization's mark, which leads home, with
 * the company switcher beside it (topbar.tsx). Composed by Topbar rather than
 * being a second header, so there is still exactly one app shell.
 */
export async function MobileHeader() {
  const t = await getTranslations("shell");

  return (
    <>
      {/* Phone (MOB-02 §8, §9): the workspace as one line of context. Tapping it opens the
          workspace sheet; navigation is the bottom bar and More, so no drawer trigger. */}
      <div className="min-w-0 flex-1 md:hidden" data-testid="mobile-context">
        <OrganizationWorkspaceHeader variant="drawer" />
      </div>
      {/* Tablet portrait: the mark, home. Navigation is the bottom bar's Menu, as on a phone. */}
      <div className="hidden items-center md:flex lg:hidden">
        <OrganizationHomeMark label={t("dashboardLink")} />
      </div>
    </>
  );
}
