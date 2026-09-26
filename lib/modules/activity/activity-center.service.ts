import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { resolvePersonalContexts } from "@/lib/context/workspace-access";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { getUnreadCountForWorkspace, markAllReadForWorkspace, markRecordNotificationsRead, readableRows, WITHDRAWN_TITLE, withdrawnNotificationIds } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { excerpt } from "@/lib/modules/announcements/announcement.body";
import { announcementsOpen, reachWhere } from "@/lib/modules/announcements/announcement.permissions";
import { acknowledgeAnnouncement, live, markRead as markAnnouncementRead, markSeenMany } from "@/lib/modules/announcements/announcement.service";
import { resolveProductivitySettings } from "@/lib/modules/productivity/productivity.settings";

/**
 * The Activity Center read model (Activity Center PRD §2, §6-§10, §66-§69, §184).
 *
 * One stream for the user, two domains underneath: Notifications stay the
 * personal, event-driven rows their producers write; Announcements stay the
 * broadcast records their authors publish, with per-person seen and
 * acknowledged state. This service only reads and merges them — it creates
 * neither (§67, §68) — and it is user-global: every company of the person's
 * group they may use, whatever the workspace (§31, §78). Nothing the person
 * cannot open appears, or counts (§77, §143).
 */

export const ACTIVITY_TYPES = ["ALL", "NOTIFICATION", "ANNOUNCEMENT"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type ActivityPriority = "NORMAL" | "IMPORTANT" | "CRITICAL";

export type ActivityCenterItem = {
  /** `${sourceType}:${sourceId}` — unique across both sources (§65). */
  key: string;
  id: string;
  sourceType: "NOTIFICATION" | "ANNOUNCEMENT";
  title: string;
  bodyPreview: string | null;
  createdAt: string;
  readState: "UNREAD" | "READ";
  priority: ActivityPriority;
  /** Whose it is — the company, or the group for a Group announcement (§33, §169). */
  company: { id: string; name: string } | null;
  scope: "GROUP" | "COMPANY";
  project: { id: string; name: string } | null;
  moduleKey: string | null;
  recordType: string | null;
  recordId: string | null;
  /** The re-authorising route: `/notifications/:id/open` or the announcement's page (§48, §140). */
  href: string | null;
  /** The company whose workspace the item opens in, when it is not the one the session is in (§49). */
  openIn: { id: string; name: string } | null;
  requiresAcknowledgement: boolean;
  acknowledgedAt: string | null;
  /** A critical announcement still waiting on the person, held above the stream (§8, §26). */
  pinned: boolean;
  actor: { id: string; displayName: string } | null;
};

export type ActivityFilters = {
  type?: ActivityType;
  companyId?: string | null;
  moduleKey?: string | null;
  priority?: ActivityPriority | null;
  readState?: "UNREAD" | "READ" | null;
  q?: string | null;
  from?: Date | null;
  to?: Date | null;
  cursor?: string | null;
  limit?: number;
};

export type ActivityPage = {
  items: ActivityCenterItem[];
  nextCursor: string | null;
  /** Only companies the person may use; never a count of anything else (§38, §137). */
  companies: Array<{ id: string; name: string }>;
  workspace: { scopeType: "GROUP" | "COMPANY"; companyId: string | null };
};

export type ActivityCounts = { total: number; notifications: number; announcements: number; critical: number; attention: number };

const NOTIFICATION_PRIORITY: Record<string, ActivityPriority> = { LOW: "NORMAL", NORMAL: "NORMAL", HIGH: "IMPORTANT", CRITICAL: "CRITICAL" };
const TO_NOTIFICATION_PRIORITY: Record<ActivityPriority, Array<"LOW" | "NORMAL" | "HIGH" | "CRITICAL">> = { NORMAL: ["LOW", "NORMAL"], IMPORTANT: ["HIGH"], CRITICAL: ["CRITICAL"] };

/**
 * A published announcement also notifies its audience. In the Activity Center
 * the announcement is the item, so those notification rows are neither listed
 * nor counted beside it (§60, §61); seeing the announcement reads them too.
 */
// Spelled with the null branch: in SQL, `NOT entityType = 'announcement'` also drops every row without a record.
const NOT_ANNOUNCEMENT_ECHO: Prisma.NotificationWhereInput = { OR: [{ entityType: null }, { entityType: { not: "announcement" } }] };

/** The stream's order key: newest first, then source and id, so equal instants still page stably (§74). */
const sortKey = (item: Pick<ActivityCenterItem, "createdAt" | "key">) => `${item.createdAt}|${item.key}`;

function workspaceOf(session: UserContext): ActivityPage["workspace"] {
  return session.workspace.scopeType === "GROUP" ? { scopeType: "GROUP", companyId: null } : { scopeType: "COMPANY", companyId: session.companyId };
}

/** An unknown or foreign company filter is refused outright (§142): it must not answer "empty" for a company the person cannot see either. */
function narrow(contexts: UserContext[], companyId: string | null | undefined): UserContext[] {
  if (!companyId) return contexts;
  const narrowed = contexts.filter((context) => context.companyId === companyId);
  if (narrowed.length === 0) throw new AccessError("FORBIDDEN", "You cannot filter by that company.", { code: "ACTIVITY_COMPANY_FORBIDDEN" });
  return narrowed;
}

/* -------------------------------------------------------------------------- */
/* Announcements, per reader membership                                        */
/* -------------------------------------------------------------------------- */

/** The contexts in which the person reads announcements at all: module open, and the company's switch on. */
async function announcementContexts(contexts: UserContext[]): Promise<UserContext[]> {
  const settings = await Promise.all(contexts.map((context) => resolveProductivitySettings(context.companyId)));
  return contexts.filter((context, index) => announcementsOpen(context) && settings[index].announcementsEnabled);
}

/**
 * Every live announcement addressed to the person, once each (§61) — a Group
 * announcement reaches them through each of their memberships, and is shown
 * through the one in its own company where they have one.
 */
async function liveAnnouncements(contexts: UserContext[], extra: Prisma.AnnouncementWhereInput, now: Date) {
  const readers = await announcementContexts(contexts);
  if (readers.length === 0) return { rows: [], via: new Map<string, UserContext>(), memberIds: [] as string[] };
  const where: Prisma.AnnouncementWhereInput = { AND: [live(now), { OR: readers.map((context) => reachWhere(context)) }, extra] };
  const rows = await prisma.announcement.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: 500,
    select: {
      id: true,
      companyId: true,
      title: true,
      body: true,
      priority: true,
      audienceType: true,
      publishedAt: true,
      requiresAcknowledgment: true,
      authorMemberId: true,
      departmentId: true,
      projectId: true,
      project: { select: { id: true, name: true } },
      company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } },
    },
  });
  // Which of the person's memberships each one reaches them through — asked of the database, per reader (never assumed).
  const via = new Map<string, UserContext>();
  const byReader = await Promise.all(readers.map(async (context) => ({ context, ids: new Set((await prisma.announcement.findMany({ where: { AND: [{ id: { in: rows.map((row) => row.id) } }, reachWhere(context)] }, select: { id: true } })).map((row) => row.id)) })));
  for (const row of rows) {
    const own = byReader.find((entry) => entry.context.companyId === row.companyId && entry.ids.has(row.id));
    const any = own ?? byReader.find((entry) => entry.ids.has(row.id));
    if (any) via.set(row.id, any.context);
  }
  return { rows: rows.filter((row) => via.has(row.id)), via, memberIds: readers.map((context) => context.membershipId) };
}

async function announcementItems(contexts: UserContext[], filters: ActivityFilters, now: Date): Promise<ActivityCenterItem[]> {
  if (filters.moduleKey && filters.moduleKey !== "announcements") return [];
  const term = filters.q?.trim();
  const extra: Prisma.AnnouncementWhereInput = {
    AND: [
      filters.priority ? { priority: filters.priority } : {},
      filters.from ? { publishedAt: { gte: filters.from } } : {},
      filters.to ? { publishedAt: { lte: filters.to } } : {},
      term ? { OR: [{ title: { contains: term, mode: "insensitive" } }, { body: { contains: term, mode: "insensitive" } }, { project: { is: { name: { contains: term, mode: "insensitive" } } } }] } : {},
    ],
  };
  const { rows, via, memberIds } = await liveAnnouncements(contexts, extra, now);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [reads, acks, authors] = await Promise.all([
    prisma.announcementRead.findMany({ where: { announcementId: { in: ids }, memberId: { in: memberIds } }, select: { announcementId: true } }),
    prisma.announcementAcknowledgment.findMany({ where: { announcementId: { in: ids }, memberId: { in: memberIds } }, select: { announcementId: true, acknowledgedAt: true } }),
    prisma.companyMember.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.authorMemberId))] }, companyId: { in: [...new Set(rows.map((row) => row.companyId))] } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }),
  ]);
  const seen = new Set(reads.map((row) => row.announcementId));
  const acknowledged = new Map(acks.map((row) => [row.announcementId, row.acknowledgedAt.toISOString()]));
  const authorName = new Map(authors.map((row) => [row.id, `${row.user.firstName} ${row.user.lastName}`.trim()]));

  return rows
    .map((row): ActivityCenterItem => {
      const reader = via.get(row.id)!;
      const unread = !seen.has(row.id) && !acknowledged.has(row.id);
      const group = row.audienceType === "GROUP";
      const readerProjectOpen = row.project && reader.companyId === row.companyId;
      return {
        key: `ANNOUNCEMENT:${row.id}`,
        id: row.id,
        sourceType: "ANNOUNCEMENT",
        title: row.title,
        bodyPreview: excerpt(row.body, 160) || null,
        createdAt: (row.publishedAt ?? now).toISOString(),
        readState: unread ? "UNREAD" : "READ",
        priority: row.priority,
        company: group ? { id: row.company.parentGroup.id, name: row.company.parentGroup.name } : { id: row.company.id, name: row.company.name },
        scope: group ? "GROUP" : "COMPANY",
        project: readerProjectOpen ? row.project : null,
        moduleKey: "announcements",
        recordType: "announcement",
        recordId: row.id,
        href: `/announcements/${row.id}`,
        openIn: { id: reader.companyId, name: reader.company.name },
        requiresAcknowledgement: row.requiresAcknowledgment,
        acknowledgedAt: acknowledged.get(row.id) ?? null,
        pinned: row.priority === "CRITICAL" && (row.requiresAcknowledgment ? !acknowledged.has(row.id) : unread),
        actor: authorName.has(row.authorMemberId) ? { id: row.authorMemberId, displayName: authorName.get(row.authorMemberId)! } : null,
      };
    })
    .filter((item) => !filters.readState || item.readState === filters.readState)
    .filter((item) => !filters.companyId || item.openIn?.id === filters.companyId || item.company?.id === filters.companyId);
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

async function notificationItems(contexts: UserContext[], filters: ActivityFilters, before: Date | null, take: number): Promise<ActivityCenterItem[]> {
  const term = filters.q?.trim();
  const fetched = await prisma.notification.findMany({
    where: {
      AND: [
        readableRows(contexts),
        NOT_ANNOUNCEMENT_ECHO,
        filters.moduleKey ? { moduleKey: filters.moduleKey } : {},
        filters.priority ? { priority: { in: TO_NOTIFICATION_PRIORITY[filters.priority] } } : {},
        filters.readState ? { readState: filters.readState } : {},
        filters.from ? { createdAt: { gte: filters.from } } : {},
        filters.to ? { createdAt: { lte: filters.to } } : {},
        before ? { createdAt: { lte: before } } : {},
        term ? { OR: [{ title: { contains: term, mode: "insensitive" } }, { body: { contains: term, mode: "insensitive" } }] } : {},
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
  // Rows about a record the reader can no longer open keep no title (AUD-06
  // RP-18). A search never answers with one: a match would confirm what the
  // withheld text said.
  const withdrawn = await withdrawnNotificationIds(contexts, fetched);
  const rows = term ? fetched.filter((row) => !withdrawn.has(row.id)) : fetched;
  const companies = new Map(contexts.map((context) => [context.companyId, context]));
  const actorIds = [...new Set(rows.map((row) => row.actorMemberId).filter((id): id is string => Boolean(id)))];
  const [projects, actors] = await Promise.all([
    // A project is named only where the reader can open it (§34, §146) — one query per company, batched (§130, §131).
    Promise.all(
      contexts.map(async (context) => {
        const ids = rows.filter((row) => row.companyId === context.companyId && row.projectId).map((row) => row.projectId!);
        if (ids.length === 0 || !context.moduleAccess.projects?.enabled || context.moduleAccess.projects.accessLevel === "NONE") return [];
        const { buildProjectScopeWhere } = await import("@/lib/access/scope");
        return prisma.project.findMany({ where: { AND: [buildProjectScopeWhere(context), { id: { in: ids } }] }, select: { id: true, name: true } });
      }),
    ).then((lists) => new Map(lists.flat().map((project) => [project.id, project]))),
    actorIds.length
      ? prisma.companyMember.findMany({ where: { id: { in: actorIds }, companyId: { in: [...companies.keys()] } }, select: { id: true, companyId: true, user: { select: { firstName: true, lastName: true } } } })
      : Promise.resolve([]),
  ]);
  const actorName = new Map(actors.map((row) => [`${row.companyId}:${row.id}`, `${row.user.firstName} ${row.user.lastName}`.trim()]));
  return rows.map((row): ActivityCenterItem => {
    const context = companies.get(row.companyId)!;
    const actorKey = row.actorMemberId ? `${row.companyId}:${row.actorMemberId}` : null;
    const gone = withdrawn.has(row.id);
    return {
      key: `NOTIFICATION:${row.id}`,
      id: row.id,
      sourceType: "NOTIFICATION",
      title: gone ? WITHDRAWN_TITLE : row.title,
      bodyPreview: gone ? null : row.body,
      createdAt: row.createdAt.toISOString(),
      readState: row.readState === "UNREAD" ? "UNREAD" : "READ",
      priority: NOTIFICATION_PRIORITY[row.priority] ?? "NORMAL",
      company: { id: context.companyId, name: context.company.name },
      scope: "COMPANY",
      project: !gone && row.projectId ? (projects.get(row.projectId) ?? null) : null,
      moduleKey: row.moduleKey,
      recordType: gone ? null : row.entityType,
      recordId: gone ? null : row.entityId,
      // The open route reads the record again now, enters the company if it has to, and marks it read (§42, §51).
      href: !gone && row.entityType && row.entityId ? `/notifications/${row.id}/open` : null,
      openIn: null,
      requiresAcknowledgement: false,
      acknowledgedAt: null,
      pinned: false,
      actor: actorKey && actorName.has(actorKey) ? { id: row.actorMemberId!, displayName: actorName.get(actorKey)! } : null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* The stream                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One page of the merged stream, newest first by cursor (§7, §8, §73-§75).
 * The first page carries the critical announcements still waiting on the
 * person above the chronology; they are not repeated below it.
 */
export async function listActivity(session: UserContext, filters: ActivityFilters = {}): Promise<ActivityPage> {
  const started = performance.now();
  const all = await resolvePersonalContexts(session);
  const contexts = narrow(all, filters.companyId);
  const type = filters.type ?? "ALL";
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 50);
  const now = new Date();
  const cursorAt = filters.cursor ? new Date(filters.cursor.split("|")[0]) : null;
  const cursor = filters.cursor && !Number.isNaN(cursorAt?.getTime()) ? filters.cursor : null;

  const [notifications, announcements] = await Promise.all([
    type === "ANNOUNCEMENT" ? Promise.resolve([]) : notificationItems(contexts, filters, cursor ? cursorAt : null, limit + 25),
    type === "NOTIFICATION" ? Promise.resolve([]) : announcementItems(all, { ...filters, companyId: filters.companyId }, now),
  ]);

  const pinned = cursor ? [] : announcements.filter((item) => item.pinned);
  const pinnedKeys = new Set(pinned.map((item) => item.key));
  const stream = [...notifications, ...announcements.filter((item) => !pinnedKeys.has(item.key)).map((item) => ({ ...item, pinned: false }))]
    .filter((item) => !cursor || sortKey(item) < cursor)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const page = stream.slice(0, limit);
  incrementCounter(Metric.ACTIVITY_CENTER_LOAD_MS, { type }, Math.max(0, performance.now() - started));
  return {
    items: [...pinned, ...page],
    nextCursor: stream.length > limit && page.length > 0 ? sortKey(page[page.length - 1]) : null,
    companies: all.map((context) => ({ id: context.companyId, name: context.company.name })).sort((a, b) => a.name.localeCompare(b.name)),
    workspace: workspaceOf(session),
  };
}

/**
 * The bell (§10, §76, §77, §182-§184): unread notifications plus live
 * announcements the person has not seen, each counted once. Two indexed counts
 * and one id list — no bodies are loaded to count.
 */
export async function activityCounts(session: UserContext): Promise<ActivityCounts> {
  const contexts = await resolvePersonalContexts(session);
  const readers = await announcementContexts(contexts);
  const memberIds = readers.map((context) => context.membershipId);
  const unreadWhere: Prisma.NotificationWhereInput = { AND: [readableRows(contexts), NOT_ANNOUNCEMENT_ECHO, { readState: "UNREAD" }] };
  const [unreadNotifications, criticalNotifications, attention, unseen] = await Promise.all([
    prisma.notification.count({ where: unreadWhere }),
    prisma.notification.count({ where: { AND: [unreadWhere, { priority: "CRITICAL" }] } }),
    getUnreadCountForWorkspace(session).then((counts) => counts.activeAttention),
    readers.length
      ? prisma.announcement.findMany({
          where: { AND: [live(new Date()), { OR: readers.map((context) => reachWhere(context)) }, { reads: { none: { memberId: { in: memberIds } } } }, { acknowledgments: { none: { memberId: { in: memberIds } } } }] },
          select: { id: true, priority: true },
        })
      : Promise.resolve([]),
  ]);
  const announcements = unseen.length;
  return {
    total: unreadNotifications + announcements,
    notifications: unreadNotifications,
    announcements,
    critical: criticalNotifications + unseen.filter((row) => row.priority === "CRITICAL").length,
    attention,
  };
}

/**
 * "Mark all as read" (§29, §186): every eligible notification read and every
 * live announcement seen — never acknowledged. A required acknowledgment stays
 * pending until the person gives it.
 */
export async function markAllActivityRead(session: UserContext): Promise<{ notifications: number; announcements: number }> {
  const contexts = await resolvePersonalContexts(session);
  const [notifications, live] = await Promise.all([markAllReadForWorkspace(session), liveAnnouncements(contexts, {}, new Date())]);
  const now = new Date();
  const unseen = await prisma.announcement.findMany({ where: { id: { in: live.rows.map((row) => row.id) }, reads: { none: { memberId: { in: live.memberIds } } } }, select: { id: true } });
  await markSeenMany(unseen.map((row) => ({ announcementId: row.id, memberId: live.via.get(row.id)!.membershipId })), now);
  return { notifications, announcements: unseen.length };
}

/** The membership through which the person reads this announcement, or not found (§136, §137). */
async function readerOf(session: UserContext, announcementId: string): Promise<UserContext> {
  const readers = await announcementContexts(await resolvePersonalContexts(session));
  const own = await prisma.announcement.findFirst({ where: { id: announcementId }, select: { companyId: true } });
  const ordered = own ? [...readers.filter((context) => context.companyId === own.companyId), ...readers.filter((context) => context.companyId !== own.companyId)] : readers;
  for (const context of ordered) {
    if (await prisma.announcement.count({ where: { AND: [{ id: announcementId }, reachWhere(context)] } })) return context;
  }
  throw new AccessError("NOT_FOUND", "That announcement could not be found.", { code: "ANNOUNCEMENT_NOT_FOUND" });
}

/** Seen — from any workspace, for the person's own membership only (§44, §55, §72). */
export async function markAnnouncementSeen(session: UserContext, announcementId: string) {
  const reader = await readerOf(session, announcementId);
  const seen = await markAnnouncementRead(reader, announcementId);
  await readEchoes(await resolvePersonalContexts(session), [announcementId]);
  return seen;
}

/** The notifications an announcement sent the person, read along with it. */
async function readEchoes(contexts: UserContext[], announcementIds: string[]) {
  await markRecordNotificationsRead(contexts, "announcement", announcementIds);
}

/** Acknowledged — explicit, never implied by "seen" or "mark all" (§11, §28, §72). */
export async function acknowledgeAnnouncementFor(session: UserContext, announcementId: string) {
  return acknowledgeAnnouncement(await readerOf(session, announcementId), announcementId);
}
