import type { Metadata } from "next";

import { getIcon } from "@/components/layout/nav-icon";
import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Badge } from "@/components/ui/badge";
import { modules as moduleRegistry, isModuleKey } from "@/config/modules";
import { requireSettingsSection } from "../settings-access";
import { getCompanyModules } from "@/lib/database/queries";

export const metadata: Metadata = {
  title: "Modules",
};

/** Company module activation (spec §48). All modules are on in V0.1. */
export default async function ModulesSettingsPage() {
  const user = await requireSettingsSection("modules");
  const companyModules = await getCompanyModules(user.companyId);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Modules"
        description="Which NESTO modules are active for your company."
      />

      <div className="nesto-card divide-y divide-line">
        {companyModules.map((item) => {
          const definition = isModuleKey(item.key) ? moduleRegistry[item.key] : null;
          const Icon = getIcon(definition?.icon ?? "Boxes");

          return (
            <div key={item.key} className="flex items-center gap-3 px-5 py-3.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-hover text-fg-muted">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-table font-medium text-fg">{item.name}</p>
                <p className="truncate text-meta text-fg-subtle">
                  {definition?.description ?? item.key}
                </p>
              </div>
              <Badge tone={item.enabled ? "success" : "default"}>
                {item.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          );
        })}
      </div>

      <p className="text-meta text-fg-subtle">
        Every module is enabled during V0.1 development. Per-company activation
        becomes editable once module configuration is functional.
      </p>
    </div>
  );
}
