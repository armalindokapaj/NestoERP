import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Badge } from "@/components/ui/badge";
import { MODULE_KEYS } from "@/config/modules";
import { roleModuleAccess } from "@/config/role-defaults";
import { roleList } from "@/config/roles";
import { getTranslations } from "@/lib/i18n/server";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.roles.label") };
}

/**
 * The role × module access matrix, read straight from configuration
 * (PRD #5 §10).
 *
 * This page cannot drift from the running system: it renders the same
 * `roleModuleAccess` that resolves navigation, dashboards and route guards.
 */
export default async function RolesSettingsPage() {
  await requireSettingsSection("roles");
  const [t, tRoles, tModules, tAccess] = await Promise.all([
    getTranslations("settings"),
    getTranslations("roles"),
    getTranslations("modules"),
    getTranslations("access"),
  ]);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.roles.label")}
        description={t("roles.description")}
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
                  <h2 className="text-card font-semibold text-fg">{tRoles(`${role.key}.label`)}</h2>
                  <p className="mt-0.5 text-table text-fg-muted">
                    {tRoles(`${role.key}.description`)}
                  </p>
                </div>
                <p className="text-meta tabular-nums text-fg-subtle">
                  {t("roles.modulesCount", { count: granted.length })} ·{" "}
                  {t("roles.permissionsCount", { count: permissionCount })}
                </p>
              </div>

              {granted.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">{t("roles.noAccess")}</p>
              ) : (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {granted.map((key) => (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
                    >
                      <span className="truncate text-table text-fg">{tModules(`${key}.label`)}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Badge tone="neutral">
                          {tAccess(`levels.${access[key].accessLevel}`)}
                        </Badge>
                        <span className="text-micro text-fg-subtle">
                          {tAccess(`scopes.${access[key].scope}`)}
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
