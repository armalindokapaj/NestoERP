import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DailyLogSettingsForm } from "@/components/daily-logs/daily-log-settings-form";
import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { resolveDailyLogSettings } from "@/lib/modules/daily-logs/daily-log.settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("dailyLogs"))("meta.settings") };
}

export default async function DailyLogSettingsPage() {
  const context = await requireModule("dailyLogs");
  if (!can(context, "daily_log.settings.manage")) notFound();
  const experience = resolveModuleExperience(context, "dailyLogs");
  const [settings, t] = await Promise.all([resolveDailyLogSettings(context.companyId), getTranslations("dailyLogs")]);
  return (
    <ModulePage experience={experience} activeSection="settings" description={t("settings.description")}>
      <DailyLogSettingsForm initial={settings} />
    </ModulePage>
  );
}
