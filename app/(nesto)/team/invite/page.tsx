import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { InviteForm } from "@/components/team/invite-form";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { teamFormOptions } from "@/lib/modules/team/team.options";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("team"))("meta.inviteMember") };
}

/**
 * Invite a member (PRD #14 §61).
 *
 * Inviting somebody also decides their role, so the page needs both grants —
 * the service asserts the same pair, and this check only avoids offering a
 * form that cannot be submitted (PRD #14 §65, §148).
 */
export default async function InviteMemberPage() {
  const context = await requireModule("team");

  if (!can(context, "team.member.invite") || !can(context, "team.member.role.assign")) {
    redirect("/access-denied");
  }

  const options = await teamFormOptions(context);
  const t = await getTranslations("team");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[{ label: t("member.crumbTeam"), href: "/team" }, { label: t("invite.title") }]}
        title={t("invite.title")}
        subtitle={t("invite.subtitle")}
      />

      <InviteForm
        roles={options.roles}
        departments={options.departments}
        cancelHref="/team/people"
      />
    </div>
  );
}
