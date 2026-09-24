import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { MemberActions } from "@/components/team/member-actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
    return { title: "Team member" };
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

  const activity = may.canViewActivity
    ? await team.listMemberActivity(context, memberId, { page: 1, limit: 5 })
    : null;

  const isSelf = member.id === context.membershipId;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={memberBreadcrumbs(member)}
        title={member.profile.fullName}
        subtitle={member.membership.jobTitle ?? member.membership.role.name}
        status={member.membership.status}
        badges={
          <>
            <Badge tone="neutral">{member.membership.role.name}</Badge>
            {member.membership.department ? (
              <Badge tone="default">{member.membership.department.name}</Badge>
            ) : null}
            {isSelf ? <Badge tone="info">You</Badge> : null}
          </>
        }
        meta={[
          {
            label: "Email",
            value: (
              <a href={`mailto:${member.profile.email}`} className="hover:text-accent">
                {member.profile.email}
              </a>
            ),
          },
          {
            label: "Projects",
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
            label: "Joined",
            value: member.membership.joinedAt ? formatDate(member.membership.joinedAt) : "—",
          },
          ...(member.personId
            ? [
                {
                  label: "Profile",
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
          This member is suspended. They cannot sign in until the suspension is lifted.
        </p>
      ) : null}

      {member.membership.status === "INACTIVE" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This member no longer has access. Their history stays in place and they can be
          reactivated.
        </p>
      ) : null}

      {member.membership.status === "INVITED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This invitation has not been accepted yet. Manage it from{" "}
          <Link href="/team/invitations" className="text-accent-strong hover:underline">
            Invitations
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
              <h2 className="text-card font-semibold text-fg">Membership</h2>
              <p className="text-meta text-fg-subtle">
                What this person can reach inside this company.
              </p>
            </div>
          </div>

          <DetailGrid
            className="mt-4"
            items={[
              { label: "Role", value: member.membership.role.name },
              { label: "Department", value: orDash(member.membership.department?.name) },
              { label: "Job title", value: orDash(member.membership.jobTitle) },
              {
                label: "Phone",
                value: member.profile.phone ? (
                  <a href={`tel:${member.profile.phone}`} className="hover:text-accent">
                    {member.profile.phone}
                  </a>
                ) : (
                  "—"
                ),
              },
              {
                label: "Invited",
                value: member.membership.invitedAt
                  ? formatDate(member.membership.invitedAt)
                  : "—",
              },
              {
                label:
                  member.membership.status === "INACTIVE" ||
                  member.membership.status === "SUSPENDED"
                    ? "Access removed"
                    : "Deactivated",
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
                      label: "Last login",
                      value: member.securityMetadata.lastLoginAt
                        ? formatDateTime(member.securityMetadata.lastLoginAt)
                        : "Never",
                    },
                  ]
                : []),
            ]}
          />

          {/* Personal details belong to the person, not to the company that
              employs them (PRD #14 §86, §87). */}
          <p className="mt-4 border-t border-line pt-4 text-meta text-fg-subtle">
            {isSelf
              ? "Your name, phone and photo are part of your own profile and are changed in Settings."
              : "Name, phone and photo belong to this person's own profile and can only be changed by them."}
          </p>
        </section>

        <section className="nesto-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-card font-semibold text-fg">Recent activity</h2>
            {may.canViewActivity ? (
              <Link
                href={`/team/${member.id}/activity`}
                className="text-table font-medium text-accent-strong"
              >
                All
              </Link>
            ) : null}
          </div>

          {!activity ? (
            <p className="mt-4 text-table text-fg-subtle">
              You do not have access to membership history.
            </p>
          ) : activity.data.length === 0 ? (
            <p className="mt-4 text-table text-fg-subtle">
              No membership changes have been recorded.
            </p>
          ) : (
            <ol className="mt-4 divide-y divide-line">
              {activity.data.map((entry) => (
                <li key={entry.id} className="py-2.5 first:pt-0">
                  <p className="text-table text-fg">
                    {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">Someone</span>}{" "}
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
