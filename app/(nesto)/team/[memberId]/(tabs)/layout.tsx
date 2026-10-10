import Link from "@/components/navigation/nav-link";

import { RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { MemberActions } from "@/components/team/member-actions";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils/format";
import { loadMember, memberBreadcrumbs } from "../member-context";
import { MemberTabs } from "../member-tabs";

type Props = { children: React.ReactNode; params: Promise<{ memberId: string }> };

/**
 * The member record's frame: header and tabs live here, so moving between
 * Overview, Projects and Activity swaps only the content beneath the tabs.
 */
export default async function MemberTabsLayout({ children, params }: Props) {
  const { memberId } = await params;
  const { context, member } = await loadMember(memberId);
  const t = await getTranslations("team");
  const isSelf = member.id === context.membershipId;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={memberBreadcrumbs(t, member)}
        title={member.profile.fullName}
        subtitle={member.membership.jobTitle ?? member.membership.role.name}
        status={member.membership.status}
        badges={
          <>
            <Badge tone="neutral">{member.membership.role.name}</Badge>
            {member.membership.department ? (
              <Badge tone="default">{member.membership.department.name}</Badge>
            ) : null}
            {isSelf ? <Badge tone="info">{t("member.you")}</Badge> : null}
          </>
        }
        meta={[
          {
            label: t("member.email"),
            value: (
              <a href={`mailto:${member.profile.email}`} className="hover:text-accent">
                {member.profile.email}
              </a>
            ),
          },
          {
            label: t("member.projects"),
            value: (
              <Link
                href={`/team/${member.id}/projects`}
                className="text-fg transition-colors hover:text-accent"
              >
                {member.counts.visibleProjects}
              </Link>
            ),
          },
          {
            label: t("member.joined"),
            value: member.membership.joinedAt ? formatDate(member.membership.joinedAt) : "—",
          },
          ...(member.personId
            ? [
                {
                  label: t("member.profile"),
                  value: <PersonLink personId={member.personId} name={member.profile.fullName} />,
                },
              ]
            : []),
        ]}
        actions={<MemberActions member={member} />}
      />

      <MemberTabs memberId={member.id} show={{ projects: true, activity: member.capabilities.canViewActivity }} />

      {children}
    </div>
  );
}
