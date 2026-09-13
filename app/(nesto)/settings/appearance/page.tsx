import type { Metadata } from "next";

import { cookies } from "next/headers";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { NavigationPreference } from "@/components/settings/navigation-preference";
import { ThemePreference } from "@/components/settings/theme-preference";
import { Divider } from "@/components/ui/divider";
import { requireSettingsSection } from "../settings-access";
import { getTranslations } from "@/lib/i18n/server";
import { readThemeChoice, THEME_COOKIE } from "@/lib/layout/theme-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.appearance.label") };
}

export default async function AppearanceSettingsPage() {
  await requireSettingsSection("appearance");

  const cookieStore = await cookies();
  const theme = readThemeChoice(cookieStore.get(THEME_COOKIE)?.value);
  const t = await getTranslations("settings");

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.appearance.label")}
        description={t("sections.appearance.description")}
      />

      <section className="nesto-card p-6">
        <NavigationPreference />

        <Divider className="my-5" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-card font-semibold text-fg">{t("appearance.colourScheme")}</p>
            <p className="mt-1 text-table text-fg-muted">{t("appearance.colourSchemeHint")}</p>
          </div>
          <ThemePreference initial={theme} />
        </div>

        <Divider className="my-5" />

        <div>
          <p className="text-card font-semibold text-fg">{t("appearance.density")}</p>
          <p className="mt-1 text-table text-fg-muted">{t("appearance.densityHint")}</p>
        </div>

        <p className="mt-5 text-meta text-fg-subtle">{t("appearance.densityLater")}</p>
      </section>
    </div>
  );
}
