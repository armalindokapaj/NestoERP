import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { PasswordForm } from "@/components/settings/password-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { SessionList } from "@/components/settings/session-list";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSettingsSection } from "../settings-access";
import { getTranslations } from "@/lib/i18n/server";
import * as account from "@/lib/modules/account/account.service";
import { formatDateTime, fullName } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.profile.label") };
}

/**
 * Profile (spec §47, PRD #38 §20) — the current user's own account: their name,
 * their password and the sessions signed in as them. What the company controls
 * about them — position, department, role — is shown but not editable here.
 */
export default async function ProfileSettingsPage() {
  const user = await requireSettingsSection("profile");
  const [t, tRoles] = await Promise.all([getTranslations("settings"), getTranslations("roles")]);

  const [profile, sessions] = await Promise.all([account.getProfile(user), account.listSessions(user)]);

  const fields = [
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
        <div className="mt-4">
          <ProfileForm
            initial={{ firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone }}
            username={profile.username}
            email={profile.email}
          />
        </div>
        <div className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
          {fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <Label htmlFor={field.id}>{field.label}</Label>
              <Input id={field.id} defaultValue={field.value} readOnly disabled />
            </div>
          ))}
        </div>
        <p className="mt-3 text-meta text-fg-subtle">{t("profile.managedHint")}</p>
      </section>

      <section className="nesto-card p-6">
        <h2 className="text-card font-semibold text-fg">{t("profile.password.title")}</h2>
        <p className="mt-1 text-table text-fg-muted">{t("profile.password.description")}</p>
        <div className="mt-4">
          <PasswordForm />
        </div>
      </section>

      <section className="nesto-card p-6">
        <h2 className="text-card font-semibold text-fg">{t("profile.sessions.title")}</h2>
        <p className="mt-1 text-table text-fg-muted">{t("profile.sessions.description")}</p>
        <div className="mt-4">
          <SessionList
            sessions={sessions.map((session) => ({
              id: session.id,
              current: session.current,
              device: session.device,
              companyName: session.companyName,
              ipAddress: session.ipAddress,
              startedLabel: formatDateTime(session.createdAt),
              expiresLabel: formatDateTime(session.expiresAt),
            }))}
          />
        </div>
      </section>
    </div>
  );
}
