import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Badge } from "@/components/ui/badge";
import { accessLevelLabels, dataScopeLabels } from "@/config/access";
import { MODULE_KEYS, modules } from "@/config/modules";
import { roleModuleAccess } from "@/config/role-defaults";
import { roleList } from "@/config/roles";
import { requireSettingsSection } from "../settings-access";

export const metadata: Metadata = { title: "Roles" };

/**
 * The role × module access matrix, read straight from configuration
 * (PRD #5 §10).
 *
 * This page cannot drift from the running system: it renders the same
 * `roleModuleAccess` that resolves navigation, dashboards and route guards.
 */
export default async function RolesSettingsPage() {
  await requireSettingsSection("roles");

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Roles"
        description="The 16 NESTO roles, the access level each holds in every module, and the data scope that applies."
      />

      <div className="space-y-4">
        {roleList.map((role) => {
          const access = roleModuleAccess[role.key];
          const granted = MODULE_KEYS.filter(
            (key) => key !== "dashboard" && access[key].accessLevel !== "NONE",
          );
          const permissionCount = new Set(
            MODULE_KEYS.flatMap((key) => access[key].permissions),
          ).size;

          return (
            <section key={role.key} className="nesto-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-card font-semibold text-fg">{role.label}</h2>
                  <p className="mt-0.5 text-table text-fg-muted">{role.description}</p>
                </div>
                <p className="text-meta tabular-nums text-fg-subtle">
                  {granted.length} modules · {permissionCount} permissions
                </p>
              </div>

              {granted.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">No module access.</p>
              ) : (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {granted.map((key) => (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
                    >
                      <span className="truncate text-table text-fg">{modules[key].label}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Badge tone="neutral">
                          {accessLevelLabels[access[key].accessLevel]}
                        </Badge>
                        <span className="text-micro text-fg-subtle">
                          {dataScopeLabels[access[key].scope]}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
