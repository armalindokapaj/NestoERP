import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { getTranslations } from "@/lib/i18n/server";
import { getSalesSettings } from "@/lib/modules/settings/sales-settings.service";
import { requireSettingsSection } from "../settings-access";
import { SalesSettingsForm } from "./sales-settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.sales.label") };
}

/** The company's defaults for selling units (E-05E §24): how long a reservation lasts. */
export default async function SalesSettingsPage() {
  const context = await requireSettingsSection("sales");
  const [settings, t] = await Promise.all([getSalesSettings(context), getTranslations("settings")]);
  return (
    <div className="space-y-5">
      <SettingsPageHeader title={t("sections.sales.label")} description={t("sales.description")} />
      <SalesSettingsForm settings={settings} />
    </div>
  );
}
