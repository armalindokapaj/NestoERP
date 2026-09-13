import type { Metadata } from "next";

import { IntegrationSettingsForm } from "@/components/settings/integration-settings-form";
import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { getTranslations } from "@/lib/i18n/server";
import { getIntegrationSettings } from "@/lib/modules/settings/integration-settings.service";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.integrations.label") };
}

/** Cross-module integration toggles (PRD #24 §71-§85). */
export default async function IntegrationSettingsPage() {
  const context = await requireSettingsSection("integrations");
  const [settings, t] = await Promise.all([
    getIntegrationSettings(context),
    getTranslations("settings"),
  ]);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.integrations.label")}
        description={t("integrations.description")}
      />
      <IntegrationSettingsForm settings={settings} />
    </div>
  );
}
