import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { CopyButton } from "@/components/ui/copy-button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { modules } from "@/config/modules";
import { roleLabel, roles } from "@/config/roles";
import { requirePermission } from "@/lib/auth/session";
import { getTeamMember } from "@/lib/database/queries";
import { fullName } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Team member",
};

/** Team member detail — basic information only in V0.1 (spec §44; design spec §64, §65). */
export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const currentUser = await requirePermission(modules.team.viewPermission);
  const { userId } = await params;

  const member = await getTeamMember(currentUser.companyId, userId);
  if (!member) notFound();

  const details = [
    { label: "Email", value: member.email, copyable: true },
    { label: "Phone", value: member.phone ?? "—", copyable: Boolean(member.phone) },
    { label: "Role", value: roleLabel(member.role) },
    { label: "Department", value: member.department ?? "—" },
    { label: "Position", value: member.jobTitle ?? "—" },
    { label: "Company", value: currentUser.companyName },
  ];

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Team", href: "/team" },
          { label: fullName(member.firstName, member.lastName) },
        ]}
      />

      <div className="nesto-card p-6">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar
            firstName={member.firstName}
            lastName={member.lastName}
            src={member.avatar}
            size="xl"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-section font-semibold text-fg">
              {fullName(member.firstName, member.lastName)}
            </h1>
            <p className="mt-1 text-body text-fg-muted">{member.jobTitle}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="info">{roleLabel(member.role)}</Badge>
              <Badge tone={member.status === "ACTIVE" ? "success" : "default"}>
                {member.status === "ACTIVE" ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
        </div>

        <p className="mt-5 max-w-2xl text-table leading-relaxed text-fg-muted">
          {roles[member.role].description}
        </p>
      </div>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Details</h2>
        <dl className="mt-3 divide-y divide-line">
          {details.map((detail) => (
            <div key={detail.label} className="flex items-center justify-between gap-3 py-2">
              <dt className="text-table text-fg-muted">{detail.label}</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="truncate text-table font-medium text-fg">{detail.value}</span>
                {detail.copyable ? (
                  <CopyButton value={detail.value} label={detail.label} />
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
