import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { MemberActions } from "@/components/team/member-actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "@/lib/i18n/server";
import * as team from "@/lib/modules/team/team.service";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { loadMember, memberBreadcrumbs } from "./member-context";
import { MemberTabs } from "./member-tabs";

type Params = { params: Promise<{ memberId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { memberId } = await params;
  try {
    const { member } = await loadMember(memberId);
    return { title: member.profile.fullName };
  } catch {
    return { title: (await getTranslations("team"))("meta.teamMember") };
  }
}

/**
 * Member profile (PRD #14 §42–§49).
 *
 * Membership information only. Salary, bank details, national identifiers,
 * home address and medical data belong to HR and are never rendered here, no
 * matter who is reading (PRD #14 §44, §174).
 */
export default async function MemberOverviewPage({ params }: Params) {
  const { memberId } = await params;
  const { context, member } = await loadMember(memberId);

  const may = member.capabilities;
  const t = await getTranslations("team");

  const activity = may.canViewActivity
    ? await team.listMemberActivity(context, memberId, { page: 1, limit: 5 })
    : null;

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

      <MemberTabs
        memberId={member.id}
        active="overview"
        show={{ projects: true, activity: may.canViewActivity }}
      />

      {member.membership.status === "SUSPENDED" ? (
        <p className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong">
          {t("member.suspendedNote")}
        </p>
      ) : null}

      {member.membership.status === "INACTIVE" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("member.inactiveNote")}
        </p>
      ) : null}

      {member.membership.status === "INVITED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("member.invitedNote")}{" "}
          <Link href="/team/invitations" className="text-accent-strong hover:underline">
            {t("member.invitations")}
          </Link>
          .
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <div className="flex items-center gap-3">
            <Avatar
              firstName={member.profile.firstName}
              lastName={member.profile.lastName}
              src={member.profile.avatarUrl}
              size="lg"
            />
            <div className="min-w-0">
              <h2 className="text-card font-semibold text-fg">{t("member.membership")}</h2>
              <p className="text-meta text-fg-subtle">
                {t("member.membershipDescription")}
              </p>
            </div>
          </div>

          <DetailGrid
            className="mt-4"
            items={[
              { label: t("member.role"), value: member.membership.role.name },
              { label: t("member.department"), value: orDash(member.membership.department?.name) },
              { label: t("member.jobTitle"), value: orDash(member.membership.jobTitle) },
              {
                label: t("member.phone"),
                value: member.profile.phone ? (
                  <a href={`tel:${member.profile.phone}`} className="hover:text-accent">
                    {member.profile.phone}
                  </a>
                ) : (
                  "—"
                ),
              },
              {
                label: t("member.invited"),
                value: member.membership.invitedAt
                  ? formatDate(member.membership.invitedAt)
                  : "—",
              },
              {
                label:
                  member.membership.status === "INACTIVE" ||
                  member.membership.status === "SUSPENDED"
                    ? t("member.accessRemoved")
                    : t("member.deactivated"),
                value: member.membership.deactivatedAt
                  ? formatDate(member.membership.deactivatedAt)
                  : "—",
              },
              // Present only when the reader holds the security-metadata grant,
              // because "when did they last sign in" is a different question
              // from "who works here" (PRD #14 §49).
              ...(member.securityMetadata
                ? [
                    {
                      label: t("member.lastLogin"),
                      value: member.securityMetadata.lastLoginAt
                        ? formatDateTime(member.securityMetadata.lastLoginAt)
                        : t("member.never"),
                    },
                  ]
                : []),
            ]}
          />

          {/* Personal details belong to the person, not to the company that
              employs them (PRD #14 §86, §87). */}
          <p className="mt-4 border-t border-line pt-4 text-meta text-fg-subtle">
            {isSelf
              ? t("member.selfNote")
              : t("member.otherNote")}
          </p>
        </section>

        <section className="nesto-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-card font-semibold text-fg">{t("member.recentActivity")}</h2>
            {may.canViewActivity ? (
              <Link
                href={`/team/${member.id}/activity`}
                className="text-table font-medium text-accent-strong"
              >
                {t("member.all")}
              </Link>
            ) : null}
          </div>

          {!activity ? (
            <p className="mt-4 text-table text-fg-subtle">
              {t("member.noActivityAccess")}
            </p>
          ) : activity.data.length === 0 ? (
            <p className="mt-4 text-table text-fg-subtle">
              {t("member.noChanges")}
            </p>
          ) : (
            <ol className="mt-4 divide-y divide-line">
              {activity.data.map((entry) => (
                <li key={entry.id} className="py-2.5 first:pt-0">
                  <p className="text-table text-fg">
                    {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("member.someone")}</span>}{" "}
                    {entry.message ?? entry.action}
                  </p>
                  <p className="mt-0.5 text-meta text-fg-subtle">
                    {formatDateTime(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
