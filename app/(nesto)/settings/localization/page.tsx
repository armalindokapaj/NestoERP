import type { Metadata } from "next";

import { LocalizationForm } from "@/components/settings/localization-form";
import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { can } from "@/lib/access/can";
import {
  baseCurrencyLocked,
  getCompanySettings,
} from "@/lib/modules/settings/company-settings.service";
import { requireSettingsSection } from "../settings-access";

export const metadata: Metadata = { title: "Localization" };

/** Company localisation and finance defaults (PRD #24 §182-§192). */
export default async function LocalizationSettingsPage() {
  const context = await requireSettingsSection("localization");

  const [settings, currencyLocked] = await Promise.all([
    getCompanySettings(context),
    baseCurrencyLocked(context.companyId),
  ]);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Localization"
        description="Language, timezone, date format and the company-wide finance defaults every module reads."
      />
      <LocalizationForm
        settings={settings}
        currencyLocked={currencyLocked}
        canUpdate={can(context, "company.settings.update")}
      />
    </div>
  );
}
