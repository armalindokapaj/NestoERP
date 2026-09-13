import Link from "next/link";

import { MobileNav } from "@/components/layout/mobile-nav";
import { NestoLogo } from "@/components/layout/nesto-logo";
import type { NavigationGroup } from "@/config/navigation";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Mobile and tablet-portrait header cluster (design spec §37, §45).
 *
 * `☰ NESTO` — the drawer trigger and the wordmark. Composed by Topbar rather
 * than being a second header, so there is still exactly one app shell.
 */
export async function MobileHeader({
  navigation,
  companyName,
}: {
  navigation: NavigationGroup[];
  companyName: string;
}) {
  const t = await getTranslations("shell");

  return (
    <div className="flex items-center gap-1 lg:hidden">
      <MobileNav navigation={navigation} companyName={companyName} />
      <Link href="/dashboard" aria-label={t("dashboardLink")}>
        <NestoLogo />
      </Link>
    </div>
  );
}
