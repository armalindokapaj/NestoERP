import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Avatar } from "@/components/ui/avatar";
import { requireModule } from "@/lib/context/current-user";
import { getTeamMember } from "@/lib/database/queries";
import { orDash } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Team member" };

/**
 * Team member detail (PRD #5 §37).
 *
 * The lookup is keyed on the current company, so a user id from another tenant
 * simply does not resolve (PRD #8 §7).
 */
export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const context = await requireModule("team");
  const { userId } = await params;

  const member = await getTeamMember(context.companyId, userId);
  if (!member) notFound();

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[{ label: "Team", href: "/team" }, { label: member.fullName }]}
        title={member.fullName}
        subtitle={member.jobTitle ?? member.roleName}
        status={member.status}
      />

      <section className="nesto-card p-5">
        <div className="flex items-center gap-4">
          <Avatar
            firstName={member.firstName}
            lastName={member.lastName}
            src={member.avatarUrl}
            size="lg"
          />
          <div className="min-w-0">
            <p className="text-card font-semibold text-fg">{member.fullName}</p>
            <p className="text-table text-fg-muted">{member.roleName}</p>
          </div>
        </div>

        <DetailGrid
          className="mt-6"
          items={[
            { label: "Email", value: member.email },
            { label: "Phone", value: orDash(member.phone) },
            { label: "Department", value: orDash(member.department) },
            { label: "Job title", value: orDash(member.jobTitle) },
            { label: "Company", value: context.company.name },
            { label: "Membership", value: member.status },
          ]}
        />
      </section>
    </div>
  );
}
