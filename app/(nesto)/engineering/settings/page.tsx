import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { EngineeringSettingsForm } from "@/components/engineering/settings-form";
import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { resolveEngineeringSettings } from "@/lib/modules/engineering/engineering.settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("engineering"))("pages.settings") };
}

/** Company defaults for RFIs, reviews and contractor compliance (PRD #46 §279). */
export default async function EngineeringSettingsPage() {
  const context = await requireModule("engineering");
  if (!can(context, "engineering.settings.manage")) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "engineering");
  const settings = await resolveEngineeringSettings(context.companyId);
  const t = await getTranslations("engineering");
  return (
    <ModulePage experience={experience} activeSection="settings" title={t("pages.settings")} description={t("pages.settingsBody")}>
      <EngineeringSettingsForm initial={settings} />
    </ModulePage>
  );
}
