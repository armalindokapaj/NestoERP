import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSettingsSection } from "../settings-access";
import { getTranslations } from "@/lib/i18n/server";
import { fullName } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.profile.label") };
}

/**
 * Profile (spec §47) — the current user's real record.
 * Fields are read-only in V0.1; editing arrives with the settings module.
 */
export default async function ProfileSettingsPage() {
  const user = await requireSettingsSection("profile");
  const [t, tRoles] = await Promise.all([getTranslations("settings"), getTranslations("roles")]);

  const fields = [
    { id: "firstName", label: t("profile.firstName"), value: user.firstName },
    { id: "lastName", label: t("profile.lastName"), value: user.lastName },
    { id: "email", label: t("profile.email"), value: user.email },
    { id: "position", label: t("profile.position"), value: user.jobTitle ?? "—" },
    { id: "department", label: t("profile.department"), value: user.department?.name ?? "—" },
    { id: "company", label: t("profile.company"), value: user.company.name },
  ];

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.profile.label")}
        description={t("sections.profile.description")}
      />

      <section className="nesto-card p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar
            firstName={user.firstName}
            lastName={user.lastName}
            src={user.avatarUrl}
            size="xl"
          />
          <div className="min-w-0">
            <p className="text-card font-semibold text-fg">
              {fullName(user.firstName, user.lastName)}
            </p>
            <p className="mt-0.5 text-body text-fg-muted">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="info">{tRoles(`${user.role}.label`)}</Badge>
              {user.roleIsOverridden ? (
                <Badge tone="warning">
                  {t("profile.devOverride", { role: tRoles(`${user.actualRole}.label`) })}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="nesto-card p-6">
        <h2 className="text-card font-semibold text-fg">{t("profile.details")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <Label htmlFor={field.id}>{field.label}</Label>
              <Input id={field.id} defaultValue={field.value} readOnly disabled />
            </div>
          ))}
        </div>
        <p className="mt-4 text-meta text-fg-subtle">{t("profile.editingLater")}</p>
      </section>
    </div>
  );
}
