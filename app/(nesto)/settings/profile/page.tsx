import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { roleLabel } from "@/config/roles";
import { requirePermission } from "@/lib/auth/session";
import { fullName } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Profile",
};

/**
 * Profile (spec §47) — the current user's real record.
 * Fields are read-only in V0.1; editing arrives with the settings module.
 */
export default async function ProfileSettingsPage() {
  const user = await requirePermission("settings.view");

  const fields = [
    { id: "firstName", label: "First name", value: user.firstName },
    { id: "lastName", label: "Last name", value: user.lastName },
    { id: "email", label: "Email", value: user.email },
    { id: "position", label: "Position", value: user.jobTitle ?? "—" },
    { id: "department", label: "Department", value: user.department ?? "—" },
    { id: "company", label: "Company", value: user.companyName },
  ];

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Profile"
        description="Your personal details and contact information."
      />

      <section className="nesto-card p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar
            firstName={user.firstName}
            lastName={user.lastName}
            src={user.avatar}
            size="xl"
          />
          <div className="min-w-0">
            <p className="text-card font-semibold text-fg">
              {fullName(user.firstName, user.lastName)}
            </p>
            <p className="mt-0.5 text-body text-fg-muted">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="info">{roleLabel(user.role)}</Badge>
              {user.roleIsOverridden ? (
                <Badge tone="warning">Dev override — actual role {roleLabel(user.actualRole)}</Badge>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="nesto-card p-6">
        <h2 className="text-card font-semibold text-fg">Details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <Label htmlFor={field.id}>{field.label}</Label>
              <Input id={field.id} defaultValue={field.value} readOnly disabled />
            </div>
          ))}
        </div>
        <p className="mt-4 text-meta text-fg-subtle">
          Profile editing and photo upload arrive with the settings module.
        </p>
      </section>
    </div>
  );
}
