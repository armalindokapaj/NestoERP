import type { Metadata } from "next";

import { IntegrationSettingsForm } from "@/components/settings/integration-settings-form";
import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { getIntegrationSettings } from "@/lib/modules/settings/integration-settings.service";
import { requireSettingsSection } from "../settings-access";

export const metadata: Metadata = { title: "Integrations" };

/** Cross-module integration toggles (PRD #24 §71-§85). */
export default async function IntegrationSettingsPage() {
  const context = await requireSettingsSection("integrations");
  const settings = await getIntegrationSettings(context);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Integrations"
        description="Product-defined handoffs between modules. Turning one off changes future work only — records already created stay as they are."
      />
      <IntegrationSettingsForm settings={settings} />
    </div>
  );
}
