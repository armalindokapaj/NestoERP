import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EngineeringSettingsForm } from "@/components/engineering/settings-form";
import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { resolveEngineeringSettings } from "@/lib/modules/engineering/engineering.settings";

export const metadata: Metadata = { title: "Engineering settings" };

/** Company defaults for RFIs, reviews and contractor compliance (PRD #46 §279). */
export default async function EngineeringSettingsPage() {
  const context = await requireModule("engineering");
  if (!can(context, "engineering.settings.manage")) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "engineering");
  const settings = await resolveEngineeringSettings(context.companyId);
  return (
    <ModulePage experience={experience} activeSection="settings" title="Engineering settings" description="Default due dates, reminder windows and review rules for the whole company.">
      <EngineeringSettingsForm initial={settings} />
    </ModulePage>
  );
}
