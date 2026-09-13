import type { Metadata } from "next";

import { LocalizationForm } from "@/components/settings/localization-form";
import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { can } from "@/lib/access/can";
import { getTranslations } from "@/lib/i18n/server";
import {
  baseCurrencyLocked,
  getCompanySettings,
} from "@/lib/modules/settings/company-settings.service";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.localization.label") };
}

/** Company localisation and finance defaults (PRD #24 §182-§192). */
export default async function LocalizationSettingsPage() {
  const context = await requireSettingsSection("localization");

  const [settings, currencyLocked, t] = await Promise.all([
    getCompanySettings(context),
    baseCurrencyLocked(context.companyId),
    getTranslations("settings"),
  ]);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.localization.label")}
        description={t("localization.description")}
      />
      <LocalizationForm
        settings={settings}
        currencyLocked={currencyLocked}
        canUpdate={can(context, "company.settings.update")}
      />
    </div>
  );
}
