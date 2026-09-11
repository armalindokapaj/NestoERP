import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Badge } from "@/components/ui/badge";
import { modules as registry, isModuleKey } from "@/config/modules";
import { listNumberingSchemes } from "@/lib/modules/settings/numbering.service";
import { requireSettingsSection } from "../settings-access";

export const metadata: Metadata = { title: "Numbering" };

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
  const schemes = await listNumberingSchemes(context);

  const byModule = new Map<string, typeof schemes>();
  for (const scheme of schemes) {
    const list = byModule.get(scheme.moduleKey) ?? [];
    list.push(scheme);
    byModule.set(scheme.moduleKey, list);
  }

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Numbering"
        description="How human-readable record numbers are generated. Changes apply to future records only."
      />

      {[...byModule.entries()].map(([moduleKey, list]) => (
        <section key={moduleKey} className="nesto-card">
          <header className="border-b border-line px-5 py-3">
            <h2 className="text-table font-medium text-fg">
              {isModuleKey(moduleKey) ? registry[moduleKey].label : moduleKey}
            </h2>
          </header>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-meta text-fg-subtle">
                <th scope="col" className="px-5 py-2 text-left font-medium">Record type</th>
                <th scope="col" className="px-5 py-2 text-left font-medium">Mode</th>
                <th scope="col" className="px-5 py-2 text-left font-medium">Next number</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((scheme) => (
                <tr key={`${scheme.moduleKey}:${scheme.entityType}`}>
                  <td className="px-5 py-3 text-table text-fg">{entityLabel(scheme.entityType)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={scheme.mode === "AUTO" ? "success" : "default"}>
                      {scheme.mode === "AUTO" ? "Automatic" : "Manual"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 font-mono text-meta text-fg-muted">
                    {scheme.mode === "AUTO" ? scheme.preview : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
