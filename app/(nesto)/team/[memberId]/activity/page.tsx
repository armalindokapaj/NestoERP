import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import * as team from "@/lib/modules/team/team.service";
import { formatDateTime } from "@/lib/utils/format";
import { loadMember, memberBreadcrumbs } from "../member-context";
import { MemberTabs } from "../member-tabs";
import { listPageRedirect } from "@/lib/modules/shared/list-query";

type Params = {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Member activity" };

/**
 * Membership history (PRD #14 §55–§58).
 *
 * Role changes, department moves and access changes — who did what, and when.
 * Authentication events are not shown: a login trail is a security record, not
 * a team record (PRD #14 §57).
 */
export default async function MemberActivityPage({ params, searchParams }: Params) {
  const { memberId } = await params;
  const { context, member } = await loadMember(memberId);

  if (!member.capabilities.canViewActivity) notFound();

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await team.listMemberActivity(context, memberId, { page, limit: 25 });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (activity.pagination.page !== page) redirect(listPageRedirect(`/team/${memberId}/activity`, query, activity.pagination.page));

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={memberBreadcrumbs(member, "Activity")}
        title={member.profile.fullName}
        subtitle={member.membership.role.name}
        status={member.membership.status}
      />

      <MemberTabs memberId={member.id} active="activity" show={{ projects: true, activity: true }} />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No membership changes recorded."
          description="Role, department and access changes will be listed here."
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
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
          <Pagination
            meta={activity.pagination}
            buildHref={(next) =>
              next > 1
                ? `/team/${member.id}/activity?page=${next}`
                : `/team/${member.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
