import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DailyLogSettingsForm } from "@/components/daily-logs/daily-log-settings-form";
import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { resolveDailyLogSettings } from "@/lib/modules/daily-logs/daily-log.settings";

export const metadata: Metadata = { title: "Daily log settings" };

export default async function DailyLogSettingsPage() {
  const context = await requireModule("dailyLogs");
  if (!can(context, "daily_log.settings.manage")) notFound();
  const experience = resolveModuleExperience(context, "dailyLogs");
  const settings = await resolveDailyLogSettings(context.companyId);
  return (
    <ModulePage experience={experience} activeSection="settings" description="When logs are required, how far back they can be started, and who reviews them.">
      <DailyLogSettingsForm initial={settings} />
    </ModulePage>
  );
}
