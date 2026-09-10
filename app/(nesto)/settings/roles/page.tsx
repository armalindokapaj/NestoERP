import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Badge } from "@/components/ui/badge";
import { modules } from "@/config/modules";
import { navigationForRole } from "@/config/navigation";
import { permissionsForRole } from "@/config/permissions";
import { roleList } from "@/config/roles";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Roles",
};

/**
 * Roles and permissions, read straight from configuration.
 * This is the definitive answer to "what can this role actually do?" — the same
 * data the sidebar and the route guards use.
 */
export default async function RolesSettingsPage() {
  await requirePermission("settings.manage");

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Roles"
        description="The 16 NESTO roles and the permissions each one holds."
      />

      <div className="space-y-4">
        {roleList.map((role) => {
          const permissions = permissionsForRole(role.key);
          const navigation = navigationForRole(role.key);

          return (
            <section key={role.key} className="nesto-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-micro tabular-nums text-fg-subtle">{role.code}</span>
                    <h2 className="text-card font-semibold text-fg">{role.label}</h2>
                    {role.readOnly ? <Badge tone="warning">Read only</Badge> : null}
                  </div>
                  <p className="mt-1 text-table text-fg-muted">{role.description}</p>
                </div>
                <Badge>{role.department}</Badge>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-fg-subtle">
                    Navigation ({navigation.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {navigation.map((key) => (
                      <Badge key={key} tone="neutral">
                        {modules[key].label}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-fg-subtle">
                    Permissions ({permissions.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {permissions.map((permission) => (
                      <span
                        key={permission}
                        className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-micro text-fg-muted"
                      >
                        {permission}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
