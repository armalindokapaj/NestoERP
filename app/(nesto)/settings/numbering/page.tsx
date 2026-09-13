import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { NumberingSchemeForm } from "@/components/settings/numbering-scheme-form";
import { isModuleKey } from "@/config/modules";
import { getTranslations } from "@/lib/i18n/server";
import { listNumberingSchemes } from "@/lib/modules/settings/numbering.service";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.numbering.label") };
}

function entityLabel(entityType: string): string {
  return entityType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Numbering schemes (PRD #24 §114-§119).
 *
 * Changing a scheme affects future records only — numbers already issued never
 * change, and a number is never reused (PRD #24 §111, §117).
 */
export default async function NumberingSettingsPage() {
  const context = await requireSettingsSection("numbering");
  const [schemes, t, tModules] = await Promise.all([
    listNumberingSchemes(context),
    getTranslations("settings"),
    getTranslations("modules"),
  ]);

  const byModule = new Map<string, typeof schemes>();
  for (const scheme of schemes) {
    const list = byModule.get(scheme.moduleKey) ?? [];
    list.push(scheme);
    byModule.set(scheme.moduleKey, list);
  }

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.numbering.label")}
        description={t("numbering.description")}
      />

      {[...byModule.entries()].map(([moduleKey, list]) => (
        <section key={moduleKey} className="nesto-card">
          <header className="border-b border-line px-5 py-3">
            <h2 className="text-table font-medium text-fg">
              {isModuleKey(moduleKey) ? tModules(`${moduleKey}.label`) : moduleKey}
            </h2>
          </header>
          <div className="divide-y divide-line">
            {list.map((scheme) => (
              <NumberingSchemeForm
                key={`${scheme.moduleKey}:${scheme.entityType}`}
                scheme={scheme}
                label={entityLabel(scheme.entityType)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
