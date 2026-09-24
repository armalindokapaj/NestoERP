import { MobileNav } from "@/components/layout/mobile-nav";
import { OrganizationHomeMark } from "@/components/layout/organization-workspace-header";
import type { NavigationGroup } from "@/config/navigation";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Mobile and tablet-portrait header cluster (design spec §37, §45).
 *
 * `☰ [mark]` — the drawer trigger and the organization's mark, which leads
 * home (OW §5, §6). Composed by Topbar rather than being a second header, so
 * there is still exactly one app shell.
 */
export async function MobileHeader({ navigation, isDemo }: { navigation: NavigationGroup[]; isDemo: boolean }) {
  const t = await getTranslations("shell");

  return (
    <div className="flex items-center gap-1 lg:hidden">
      <MobileNav navigation={navigation} isDemo={isDemo} />
      <OrganizationHomeMark label={t("dashboardLink")} />
    </div>
  );
}
