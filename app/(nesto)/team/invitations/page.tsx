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
import * as invitations from "@/lib/modules/team/invitations/invite.service";

export const metadata: Metadata = { title: "Invitations" };

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
  const rows = await invitations.listInvitations(context);
  const canInvite = can(context, "team.member.invite") && can(context, "team.member.role.assign");

  return (
    <ModulePage
      experience={experience}
      activeSection="invitations"
      actions={
        canInvite ? (
          <Button asChild size="sm">
            <Link href="/team/invite">Invite member</Link>
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<MailPlus />}
          title="No invitations yet."
          description="Invitations you send will be listed here until they are accepted or cancelled."
          action={canInvite ? { label: "Invite member", href: "/team/invite" } : undefined}
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
