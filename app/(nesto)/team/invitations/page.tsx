import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { MailPlus } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { InvitationList } from "@/components/team/invitation-list";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import * as invitations from "@/lib/modules/team/invitations/invite.service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("team"))("meta.invitations") };
}

/**
 * Invitations (PRD #14 §35, §68).
 *
 * Accepted and cancelled invitations stay listed rather than disappearing: the
 * question people actually have is "did that invitation ever go anywhere?"
 * (PRD #14 §70).
 */
export default async function TeamInvitationsPage() {
  const context = await requireModule("team");

  if (!can(context, "team.invitation.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "team");
  const t = await getTranslations("team");
  const rows = await invitations.listInvitations(context);
  const canInvite = can(context, "team.member.invite") && can(context, "team.member.role.assign");

  return (
    <ModulePage
      experience={experience}
      activeSection="invitations"
      actions={
        canInvite ? (
          <Button asChild size="sm">
            <Link href="/team/invite">{t("overview.inviteMember")}</Link>
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<MailPlus />}
          title={t("invitations.emptyTitle")}
          description={t("invitations.emptyDescription")}
          action={canInvite ? { label: t("overview.inviteMember"), href: "/team/invite" } : undefined}
        />
      ) : (
        <InvitationList
          invitations={rows}
          canResend={can(context, "team.invitation.resend")}
          canCancel={can(context, "team.invitation.cancel")}
        />
      )}
    </ModulePage>
  );
}
