import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { ModuleToggleList } from "@/components/settings/module-toggle-list";
import { getTranslations } from "@/lib/i18n/server";
import { listCompanyModules } from "@/lib/modules/settings/module-toggle.service";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.modules.label") };
}

/**
 * Company module activation (PRD #24 §48, §55).
 *
 * Reads through the module service rather than querying the rows directly, so
 * the page sees the same dependencies and blockers the service enforces —
 * which is what lets the switch explain itself instead of failing on submit.
 */
export default async function ModulesSettingsPage() {
  const context = await requireSettingsSection("modules");
  const companyModules = await listCompanyModules(context);
  const t = await getTranslations("settings");

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.modules.label")}
        description={t("sections.modules.description")}
      />

      <ModuleToggleList modules={companyModules} />

      <p className="text-meta text-fg-subtle">{t("modules.note")}</p>
    </div>
  );
}
