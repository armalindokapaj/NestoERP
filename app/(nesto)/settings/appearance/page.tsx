import type { Metadata } from "next";

import { cookies } from "next/headers";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { NavigationPreference } from "@/components/settings/navigation-preference";
import { ThemePreference } from "@/components/settings/theme-preference";
import { Divider } from "@/components/ui/divider";
import { requirePermission } from "@/lib/auth/session";
import { readThemeChoice, THEME_COOKIE } from "@/lib/layout/theme-state";

export const metadata: Metadata = {
  title: "Appearance",
};

export default async function AppearanceSettingsPage() {
  await requirePermission("settings.view");

  const cookieStore = await cookies();
  const theme = readThemeChoice(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Appearance"
        description="Theme and display preferences."
      />

      <section className="nesto-card p-6">
        <NavigationPreference />

        <Divider className="my-5" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-card font-semibold text-fg">Colour scheme</p>
            <p className="mt-1 text-table text-fg-muted">
              Follow your operating system, or pin NESTO to light or dark.
            </p>
          </div>
          <ThemePreference initial={theme} />
        </div>

        <Divider className="my-5" />

        <div>
          <p className="text-card font-semibold text-fg">Density</p>
          <p className="mt-1 text-table text-fg-muted">
            Comfortable spacing, tuned for long working sessions.
          </p>
        </div>

        <p className="mt-5 text-meta text-fg-subtle">
          Selectable density arrives with the settings module.
        </p>
      </section>
    </div>
  );
}
