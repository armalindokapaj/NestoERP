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
import { LocalizationBasicsForm } from "./localization-basics-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.localization.label") };
}

/**
 * Company localisation and finance defaults (PRD #24 §182-§192).
 *
 * The finance half appears only for a reader holding
 * `company.finance_settings.view`; everybody else configures locale, timezone
 * and date format on a page without it (PRD #47 §61).
 */
export default async function LocalizationSettingsPage() {
  const context = await requireSettingsSection("localization");

  const [settings, t] = await Promise.all([
    getCompanySettings(context),
    getTranslations("settings"),
  ]);
  // The lock is itself a fact about the company's money, so it is only read
  // for somebody who is shown the currency.
  const currencyLocked = settings.financeVisible ? await baseCurrencyLocked(context.companyId) : false;

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.localization.label")}
        description={t("localization.description")}
      />
      {settings.financeVisible ? (
        <LocalizationForm
          settings={settings}
          currencyLocked={currencyLocked}
          canUpdate={can(context, "company.settings.update")}
        />
      ) : (
        <LocalizationBasicsForm settings={settings} canUpdate={can(context, "company.settings.update")} />
      )}
    </div>
  );
}
