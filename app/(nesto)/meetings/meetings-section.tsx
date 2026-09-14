import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { MeetingEmptyIcon, MeetingList } from "@/components/meetings/meeting-list";
import { EmptyState } from "@/components/ui/empty-state";
import { can, canAccessModule } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { meetingTimezone } from "@/lib/modules/meetings/meeting.repository";
import { meetingListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { listMeetings } from "@/lib/modules/meetings/meeting.service";
import { MEETING_STATUS_LABELS, MEETING_TYPE_LABELS, MEETING_TYPES } from "@/lib/modules/meetings/meeting.types";

type SearchParams = Record<string, string | string[] | undefined>;
type Section = "upcoming" | "mine" | "past";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

const EMPTY: Record<Section, { title: string; description: string }> = {
  upcoming: { title: "Nothing scheduled.", description: "Meetings you can open appear here, soonest first." },
  mine: { title: "No meetings on your calendar.", description: "Meetings you organize or are invited to appear here." },
  past: { title: "No past meetings yet.", description: "Held and cancelled meetings stay here, with their minutes and actions." },
};

/**
 * The body behind Upcoming, My Meetings and Past (PRD #40 §90-§92, §121, §122):
 * one list with three sets of defaults, filtered by type, status and project,
 * searched by title, project and people.
 */
export async function MeetingsSection({ context, section, searchParams, basePath }: { context: UserContext; section: Section; searchParams: SearchParams; basePath: string }) {
  const query = meetingListQuerySchema.parse({
    section,
    q: one(searchParams.q),
    type: one(searchParams.type),
    status: one(searchParams.status),
    projectId: one(searchParams.projectId),
    page: one(searchParams.page),
  });
  const [result, zone, projects] = await Promise.all([
    listMeetings(context, query),
    meetingTimezone(context.companyId),
    canAccessModule(context, "projects") && can(context, "project.view")
      ? prisma.project.findMany({ where: { AND: [buildProjectScopeWhere(context), { archivedAt: null }] }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true } })
      : [],
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const filters: FilterConfig[] = [
    { param: "type", label: "Type", options: MEETING_TYPES.map((type) => ({ value: type, label: MEETING_TYPE_LABELS[type] })) },
    ...(section === "past"
      ? [{ param: "status", label: "Status", options: (["COMPLETED", "CANCELLED", "SCHEDULED"] as const).map((status) => ({ value: status, label: MEETING_STATUS_LABELS[status] })) }]
      : [{ param: "status", label: "Status", options: (["SCHEDULED", "IN_PROGRESS", "DRAFT"] as const).map((status) => ({ value: status, label: MEETING_STATUS_LABELS[status] })) }]),
    ...(projects.length ? [{ param: "projectId", label: "Project", options: projects.map((project) => ({ value: project.id, label: project.name })) }] : []),
  ];
  const filtered = Boolean(query.q || query.type?.length || query.status?.length || query.projectId);

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) if (typeof value === "string" && key !== "page") params.set(key, value);
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

  return (
    <div className="space-y-4">
      <ListToolbar searchPlaceholder="Search meetings…" searchParam="q" filters={filters} />
      {result.data.length === 0 ? (
        filtered ? (
          <EmptyState icon={<MeetingEmptyIcon />} title="No meetings match these filters." description="Adjust or clear the filters to see more." action={{ label: "Clear filters", href: basePath }} />
        ) : (
          <EmptyState
            icon={<MeetingEmptyIcon />}
            title={EMPTY[section].title}
            description={EMPTY[section].description}
            action={section !== "past" && can(context, "meeting.create") ? { label: "New meeting", href: "/meetings/new" } : undefined}
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
