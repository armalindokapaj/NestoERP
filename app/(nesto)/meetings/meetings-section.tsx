import { redirect } from "next/navigation";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { MeetingEmptyIcon, MeetingList } from "@/components/meetings/meeting-list";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { meetingsLabel } from "@/lib/i18n/modules/meetings/labels";
import { getTranslations } from "@/lib/i18n/server";
import { meetingTimezone } from "@/lib/modules/meetings/meeting.repository";
import { meetingListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { listMeetingsForWorkspace, meetingFilterOptionsForWorkspace } from "@/lib/modules/meetings/meeting.workspace";
import { MEETING_STATUS_LABELS, MEETING_TYPE_LABELS, MEETING_TYPES } from "@/lib/modules/meetings/meeting.types";

type SearchParams = Record<string, string | string[] | undefined>;
type Section = "upcoming" | "mine" | "past";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * The body behind Upcoming, My Meetings and Past (PRD #40 §90-§92, §121, §122):
 * one list with three sets of defaults, filtered by type, status and project,
 * searched by title, project and people.
 *
 * In the Group workspace it lists every company's meetings the person may open,
 * each row naming its company; a `company` filter narrows it (Workspace Context
 * §34, §45, §86). "Today" and the day headings read in the person's home
 * company's zone, and a meeting held in another zone says so on its row.
 */
export async function MeetingsSection({ context, section, searchParams, basePath }: { context: UserContext; section: Section; searchParams: SearchParams; basePath: string }) {
  const query = meetingListQuerySchema.parse({
    section,
    q: one(searchParams.q),
    type: one(searchParams.type),
    status: one(searchParams.status),
    projectId: one(searchParams.projectId),
    company: one(searchParams.company),
    page: one(searchParams.page),
  });
  const group = inGroupWorkspace(context);
  const t = await getTranslations("meetings");
  const [result, zone, { projects, companies }] = await Promise.all([
    listMeetingsForWorkspace(context, query),
    meetingTimezone(context.companyId),
    meetingFilterOptionsForWorkspace(context),
  ]);
  // A page past the end (after a cancellation, a meeting moving to Past or a
  // narrower filter) moves once to the last real page, page 1 when nothing
  // matches — never an empty "Nothing scheduled" over existing meetings (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, searchParams, result.pagination.page));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const filters: FilterConfig[] = [
    // Group only: a refinement of the list, not the workspace (Workspace Context §86, §87).
    ...(group ? [{ param: "company", label: t("list.company"), options: companies.map((company) => ({ value: company.id, label: company.name })) }] : []),
    { param: "type", label: t("list.type"), options: MEETING_TYPES.map((type) => ({ value: type, label: meetingsLabel(t, "type", type, MEETING_TYPE_LABELS[type]) })) },
    ...(section === "past"
      ? [{ param: "status", label: t("list.status"), options: (["COMPLETED", "CANCELLED", "SCHEDULED"] as const).map((status) => ({ value: status, label: meetingsLabel(t, "status", status, MEETING_STATUS_LABELS[status]) })) }]
      : [{ param: "status", label: t("list.status"), options: (["SCHEDULED", "IN_PROGRESS", "DRAFT"] as const).map((status) => ({ value: status, label: meetingsLabel(t, "status", status, MEETING_STATUS_LABELS[status]) })) }]),
    ...(projects.length ? [{ param: "projectId", label: t("list.project"), options: projects.map((project) => ({ value: project.id, label: project.name })) }] : []),
  ];
  const filtered = Boolean(query.q || query.type?.length || query.status?.length || query.projectId || (group && query.company));

  // Every other query key kept, repeats included (AUD-08 §3).
  const buildHref = (page: number) => pageHref(basePath, searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar searchPlaceholder={t("list.search")} searchParam="q" filters={filters} />
      {result.data.length === 0 ? (
        filtered ? (
          <EmptyState icon={<MeetingEmptyIcon />} title={t("list.noMatchTitle")} description={t("list.noMatchDescription")} action={{ label: t("list.clearFilters"), href: basePath }} />
        ) : (
          <EmptyState
            icon={<MeetingEmptyIcon />}
            title={t(`list.empty.${section}.title`)}
            description={group ? t("common.noAccessibleData") : t(`list.empty.${section}.description`)}
            action={section !== "past" && !group && can(context, "meeting.create") ? { label: t("common.newMeeting"), href: "/meetings/new" } : undefined}
          />
        )
      ) : (
        <>
          <MeetingList meetings={result.data} zone={zone} today={today} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
