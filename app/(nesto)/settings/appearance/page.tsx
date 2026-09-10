import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { NavigationPreference } from "@/components/settings/navigation-preference";
import { Badge } from "@/components/ui/badge";
import { Divider } from "@/components/ui/divider";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Appearance",
};

export default async function AppearanceSettingsPage() {
  await requirePermission("settings.view");

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
          <div>
            <p className="text-card font-semibold text-fg">Theme</p>
            <p className="mt-1 text-table text-fg-muted">
              NESTO currently follows your operating system setting.
            </p>
          </div>
          <Badge tone="neutral">System</Badge>
        </div>

        <Divider className="my-5" />

        <div>
          <p className="text-card font-semibold text-fg">Density</p>
          <p className="mt-1 text-table text-fg-muted">
            Comfortable spacing, tuned for long working sessions.
          </p>
        </div>

        <p className="mt-5 text-meta text-fg-subtle">
          Selectable themes and density arrive with the settings module.
        </p>
      </section>
    </div>
  );
}
