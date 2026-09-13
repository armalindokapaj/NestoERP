import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { ModuleToggleList } from "@/components/settings/module-toggle-list";
import { listCompanyModules } from "@/lib/modules/settings/module-toggle.service";
import { requireSettingsSection } from "../settings-access";

export const metadata: Metadata = {
  title: "Modules",
};

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

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Modules"
        description="Which NESTO modules are active for your company."
      />

      <ModuleToggleList modules={companyModules} />

      <p className="text-meta text-fg-subtle">
        Turning a module off hides it for everyone and refuses its routes at
        once. Records already created are kept, not deleted, and reappear if the
        module is turned back on.
      </p>
    </div>
  );
}
