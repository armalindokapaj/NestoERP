import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { resolvePersonalContexts } from "@/lib/context/workspace-access";
import { prisma } from "@/lib/database/prisma";
import { currentRequestContext } from "@/lib/core/observability/request-context";
import { loadRecord, reachableRecordKeys } from "@/lib/core/records/record.registry";
import { countReadableAttention } from "./attention.service";
import { normaliseEntityType } from "./notification.dispatch";

/**
 * Notifications (PRD #25 §145-§158).
 *
 * Recipients are resolved server-side and every one is re-checked for active
 * membership, module access, permission and scope before a row is written — a
 * notification must never tell somebody something they could not otherwise see
 * (PRD #25 §37, §42, §49).
 */

export type NotificationListItemDTO = {
  id: string;
  eventType: string;
  moduleKey: string;
  title: string;
  body: string | null;
  priority: string;
  readState: string;
  createdAt: string;
  readAt: string | null;
  category: string | null;
  /** The re-authorising open route, never the record URL itself. */
  href: string | null;
  /** Who caused it, when somebody did: a membership of this company (E-08 §71). */
  actorMemberId: string | null;
  actorName: string | null;
  /** The company it was sent in, named in the Group workspace only (Workspace Context §45). */
  company?: { id: string; name: string };
};

export type UnreadCountDTO = {
  unread: number;
  criticalUnread: number;
  activeAttention: number;
  criticalAttention: number;
};

/**
 * Enqueues a domain event for notification processing, inside the caller's
 * transaction. Nothing is delivered for a mutation that rolls back
 * (PRD #25 §25, §240).
 */
export async function enqueueNotificationEvent(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    eventType: string;
    moduleKey: string;
    entityType: string;
    entityId: string;
    actorMemberId?: string | null;
    projectId?: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.notificationEventOutbox.create({
    data: {
      companyId: input.companyId,
      eventType: input.eventType,
      moduleKey: input.moduleKey,
      entityType: input.entityType,
      entityId: input.entityId,
      actorMemberId: input.actorMemberId ?? null,
      projectId: input.projectId ?? null,
      payloadJson: input.payload as Prisma.InputJsonValue,
      correlationId: currentRequestContext()?.correlationId ?? null,
      nextAttemptAt: new Date(),
    },
  });
}

export type NotificationPage = {
  data: NotificationListItemDTO[];
  /** Pass as `before` to load the next, older page. */
  nextBefore: string | null;
};

/**
 * The reader's own notifications, newest first, by cursor (PRD #38 §72, §152).
 *
 * Every link goes through `/notifications/:id/open`, which re-authorises the
 * record at the moment it is followed: a notification is a message about the
 * past, never a key to the present (PRD #38 §82).
 */
export async function listNotifications(
  context: UserContext,
  options: { readState?: "UNREAD" | "READ"; before?: string; limit?: number } = {},
): Promise<NotificationPage> {
  return pageOfNotifications([context], options, false);
}

/**
 * The person's own notification rows in the contexts a request reads: one
 * company's `(company, member)` pair, or in the Group workspace one pair per
 * company they may use. Both, always — a notification belongs to one member in
 * one company — and each company's own module door narrows its own rows.
 */
export function ownRows(contexts: UserContext[]): Prisma.NotificationWhereInput {
  const own = (context: UserContext): Prisma.NotificationWhereInput => ({ companyId: context.companyId, recipientMemberId: context.membershipId });
  return contexts.length === 1 ? own(contexts[0]) : { OR: contexts.map(own) };
}

/** The person's own rows, narrowed to modules they can open in each company — shared with the Activity Center (§77, §143). */
export function readableRows(contexts: UserContext[]): Prisma.NotificationWhereInput {
  // The panel agrees with the badge: nothing from a module this reader
  // cannot open any more (PRD #25 §279, PRD #47 §26) — in each company, by that company's own switches.
  const readable = (context: UserContext): Prisma.NotificationWhereInput => ({
    companyId: context.companyId,
    recipientMemberId: context.membershipId,
    // Archived rows left the inbox and stop counting (MOB-10 §126).
    archivedAt: null,
    moduleKey: { in: openModuleKeys(context) },
  });
  return contexts.length === 1 ? readable(contexts[0]) : { OR: contexts.map(readable) };
}

/** Shown in place of a title whose record the reader can no longer open (AUD-06 RP-18). */
export const WITHDRAWN_TITLE = "About a record you can no longer open";

/**
 * The notification rows about a record this reader can no longer open.
 *
 * A notification's title and body were written for the reader it was sent to,
 * then; they name records. Once the reader loses that record — a project
 * taken away, a role changed — the stored text is withheld, not deleted: the
 * row still counts, can be marked read, and opens nothing (the open route
 * re-reads the record anyway). One query per record type and company.
 */
export async function withdrawnNotificationIds(
  contexts: UserContext[],
  rows: Array<{ id: string; companyId: string; entityType: string | null; entityId: string | null }>,
): Promise<Set<string>> {
  const withdrawn = new Set<string>();
  await Promise.all(
    contexts.map(async (context) => {
      const about = rows
        .filter((row) => row.companyId === context.companyId && row.entityType && row.entityId)
        .map((row) => ({ row, ref: { type: normaliseEntityType(row.entityType!), id: row.entityId! } }));
      if (about.length === 0) return;
      const reachable = await reachableRecordKeys(context, about.map((item) => item.ref));
      for (const { row, ref } of about) if (!reachable.has(`${ref.type}:${ref.id}`)) withdrawn.add(row.id);
    }),
  );
  return withdrawn;
}

async function pageOfNotifications(
  contexts: UserContext[],
  options: { readState?: "UNREAD" | "READ"; before?: string; limit?: number },
  labelCompany: boolean,
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  let anchor: { createdAt: Date; id: string } | null = null;
  if (options.before) {
    anchor = await prisma.notification.findFirst({
      where: { AND: [{ id: options.before }, ownRows(contexts)] },
      select: { createdAt: true, id: true },
    });
  }

  const rows = await prisma.notification.findMany({
    where: {
      AND: [
        readableRows(contexts),
        ...(options.readState ? [{ readState: options.readState }] : []),
        ...(anchor ? [{ OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] }] : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  const withdrawn = await withdrawnNotificationIds(contexts, page);
  const actorIds = [...new Set(page.map((row) => row.actorMemberId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length
    ? await prisma.companyMember.findMany({
        where: { id: { in: actorIds }, companyId: { in: contexts.map((context) => context.companyId) } },
        select: { id: true, companyId: true, user: { select: { firstName: true, lastName: true } } },
      })
    : [];
  // An actor is a membership of the notification's own company (E-08 §71).
  const actorNames = new Map(actors.map((member) => [`${member.companyId}:${member.id}`, `${member.user.firstName} ${member.user.lastName}`.trim()]));
  const companies = new Map(contexts.map((context) => [context.companyId, { id: context.companyId, name: context.company.name }]));
  return {
    data: page.map((row): NotificationListItemDTO => {
      const actorKey = row.actorMemberId ? `${row.companyId}:${row.actorMemberId}` : null;
      const gone = withdrawn.has(row.id);
      return {
        id: row.id,
        eventType: row.eventType,
        category: row.category,
        moduleKey: row.moduleKey,
        title: gone ? WITHDRAWN_TITLE : row.title,
        body: gone ? null : row.body,
        priority: row.priority,
        readState: row.readState,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
        href: !gone && row.entityType && row.entityId ? `/notifications/${row.id}/open` : null,
        actorMemberId: row.actorMemberId && actorKey && actorNames.has(actorKey) ? row.actorMemberId : null,
        actorName: (actorKey && actorNames.get(actorKey)) || null,
        ...(labelCompany && companies.has(row.companyId) ? { company: companies.get(row.companyId) } : {}),
      };
    }),
    nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * The person's notifications in the active workspace (Workspace Context §45).
 *
 * A notification belongs to one member in one company and stays that way; the
 * Group workspace lists the person's own across every company they may use,
 * each company's rows narrowed by that company's own module switches, every
 * row naming its company. The cursor pages the merged list as one. A company
 * workspace is `listNotifications`, unchanged.
 */
export async function listNotificationsForWorkspace(
  session: UserContext,
  options: { readState?: "UNREAD" | "READ"; before?: string; limit?: number } = {},
): Promise<NotificationPage> {
  return pageOfNotifications(await resolvePersonalContexts(session), options, true);
}

export type OpenedNotification = { href: string } | { unavailable: true };

/**
 * Follows a notification's link (PRD #38 §82).
 *
 * The notification must be the reader's own — another member's id is simply
 * not found — and the record behind it is read again, now, through the record
 * registry. If access has gone, the answer is "unavailable" and nothing about
 * the record is revealed, not even its name.
 */
export async function openNotification(context: UserContext, id: string): Promise<OpenedNotification> {
  const notification = await prisma.notification.findFirst({
    where: { id, companyId: context.companyId, recipientMemberId: context.membershipId },
    select: { id: true, entityType: true, entityId: true, readState: true, eventType: true, metadataJson: true },
  });
  if (!notification) throw new AccessError("NOT_FOUND");

  if (notification.readState === "UNREAD") {
    await prisma.notification.update({ where: { id: notification.id }, data: { readState: "READ", readAt: new Date() } });
  }

  if (!notification.entityType || !notification.entityId) return { unavailable: true };
  const record = await loadRecord(context, normaliseEntityType(notification.entityType), notification.entityId);
  if (!record) return { unavailable: true };
  // An approval opens in the Approvals Center's review drawer first, with the
  // record one link away (PRD #41 §42); the Center re-checks access itself.
  if (APPROVAL_EVENTS.has(notification.eventType) && can(context, "approvals.view")) {
    const providerKey = (notification.metadataJson as { providerKey?: unknown } | null)?.providerKey;
    return { href: approvalLink(record.type, record.id, typeof providerKey === "string" ? providerKey : null) };
  }
  // A mention lands on its comment; the record page scrolls to it (Activity Center §43).
  const commentId = (notification.metadataJson as { commentId?: unknown } | null)?.commentId;
  return { href: typeof commentId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(commentId) ? `${record.href}#comment-${commentId}` : record.href };
}

/** Notifications about an approval, which open in the Approvals Center. */
const APPROVAL_EVENTS = new Set<string>([
  "APPROVAL_REQUESTED",
  "APPROVAL_OVERDUE",
  "APPROVAL_REASSIGNED",
  "PO_APPROVAL_REQUIRED",
  "DOCUMENT_REVIEW_REQUESTED",
]);

/**
 * The Center's link for a record. `providerKey` names the source where one
 * record type has two (a unit's publishing and its sale, AUD-10 §4, A7); the
 * Center validates it and otherwise ranks the cycles itself.
 */
export function approvalLink(recordType: string, recordId: string, providerKey?: string | null): string {
  const base = `/approvals?record=${encodeURIComponent(`${recordType}:${recordId}`)}`;
  return providerKey ? `${base}&provider=${encodeURIComponent(providerKey)}` : base;
}

/**
 * The badge counts (PRD #25 §148, PRD #47 §26, §77, §175).
 *
 * Notification counts stay indexed counts, narrowed to modules the reader can
 * open right now: a module the company switched off stops counting the moment
 * it is off, not when somebody clears its rows. Following any notification
 * still re-reads its record (§74). Attention counts come from the readable
 * set, because an attention item is a live claim that something waits on this
 * person.
 */
export async function getUnreadCount(context: UserContext): Promise<UnreadCountDTO> {
  const unreadWhere: Prisma.NotificationWhereInput = {
    companyId: context.companyId,
    recipientMemberId: context.membershipId,
    readState: "UNREAD",
    archivedAt: null,
    moduleKey: { in: openModuleKeys(context) },
  };
  const [unread, criticalUnread, attention] = await Promise.all([
    prisma.notification.count({ where: unreadWhere }),
    prisma.notification.count({ where: { ...unreadWhere, priority: "CRITICAL" } }),
    countReadableAttention(context),
  ]);

  return { unread, criticalUnread, activeAttention: attention.active, criticalAttention: attention.critical };
}

/** Modules enabled for the company and not NONE for this reader's role. */
function openModuleKeys(context: UserContext): string[] {
  return Object.entries(context.moduleAccess)
    .filter(([, access]) => access.enabled && access.accessLevel !== "NONE")
    .map(([key]) => key);
}

/**
 * The one place a read state is written. Read state is the recipient's own
 * marker, not a domain state machine: it moves either way from either value, so
 * the `where` scopes it to rows that are theirs and never to the state it is in.
 */
async function writeReadState(where: Prisma.NotificationWhereInput, read: boolean): Promise<void> {
  const result = await prisma.notification.updateMany({
    where,
    data: { readState: read ? "READ" : "UNREAD", readAt: read ? new Date() : null },
  });
  // Somebody else's notification is simply not found (PRD #25 §165).
  if (result.count === 0) throw new AccessError("NOT_FOUND");
}

/** Only the recipient may change their own read state (PRD #25 §157, §165). */
export async function markRead(context: UserContext, id: string, read: boolean): Promise<void> {
  return writeReadState({ id, companyId: context.companyId, recipientMemberId: context.membershipId }, read);
}

export async function markAllRead(context: UserContext): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { companyId: context.companyId, recipientMemberId: context.membershipId, readState: "UNREAD" },
    data: { readState: "READ", readAt: new Date() },
  });
  return result.count;
}

/* -------------------------------------------------------------------------- */
/* The active workspace (Workspace Context §45)                                */
/* -------------------------------------------------------------------------- */

/** Where a notification leads, and — in the Group workspace — the company whose workspace is entered first. */
export type OpenedInWorkspace = OpenedNotification & { company?: { id: string; name: string } };

/**
 * Follows a notification from the Group workspace: the notification is found
 * among the person's own rows in any company they may use, and its record is
 * read again in *that company's* own context — never the anchor's. The answer
 * names the company, so the page enters its workspace before going on (§31); a
 * notification that is not the person's is not found, whichever company it
 * would belong to.
 */
export async function openNotificationForWorkspace(session: UserContext, id: string): Promise<OpenedInWorkspace> {
  const contexts = await resolvePersonalContexts(session);
  const owner = await prisma.notification.findFirst({ where: { AND: [{ id }, ownRows(contexts)] }, select: { companyId: true } });
  const context = contexts.find((candidate) => candidate.companyId === owner?.companyId);
  if (!context) throw new AccessError("NOT_FOUND");
  const opened = await openNotification(context, id);
  // Already working in that company: open in place (Fast Re-entry §127 — the same rule).
  if (session.workspace.scopeType === "COMPANY" && session.companyId === context.companyId) return opened;
  return { ...opened, company: { id: context.companyId, name: context.company.name } };
}

/**
 * The badge in the active workspace: the sum, over the companies the person may
 * use, of what each company's own count says — so a module one company switched
 * off does not count, and one they may open elsewhere does.
 */
export async function getUnreadCountForWorkspace(session: UserContext): Promise<UnreadCountDTO> {
  const contexts = await resolvePersonalContexts(session);
  const unreadWhere: Prisma.NotificationWhereInput = { AND: [readableRows(contexts), { readState: "UNREAD" }] };
  const [unread, criticalUnread, attention] = await Promise.all([
    prisma.notification.count({ where: unreadWhere }),
    prisma.notification.count({ where: { AND: [unreadWhere, { priority: "CRITICAL" }] } }),
    Promise.all(contexts.map((context) => countReadableAttention(context))),
  ]);
  return {
    unread,
    criticalUnread,
    activeAttention: attention.reduce((sum, count) => sum + count.active, 0),
    criticalAttention: attention.reduce((sum, count) => sum + count.critical, 0),
  };
}

/** Marks one of the person's own notifications read or unread, in whichever of their companies it was sent (PRD #25 §157, §165). */
export async function markReadForWorkspace(session: UserContext, id: string, read: boolean): Promise<void> {
  return writeReadState({ AND: [{ id }, ownRows(await resolvePersonalContexts(session))] }, read);
}

/** "All" is the person's own unread rows across the companies the Group workspace reads, and nobody else's. */
export async function markAllReadForWorkspace(session: UserContext): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { AND: [ownRows(await resolvePersonalContexts(session)), { readState: "UNREAD" }] },
    data: { readState: "READ", readAt: new Date() },
  });
  return result.count;
}

/**
 * Reads the person's own notifications about these records — used when the
 * record itself was seen elsewhere, as an announcement is in the Activity
 * Center (Activity Center §60, §61). Only the person's own rows move.
 */
export async function markRecordNotificationsRead(contexts: UserContext[], entityType: string, entityIds: string[]): Promise<number> {
  if (entityIds.length === 0 || contexts.length === 0) return 0;
  const result = await prisma.notification.updateMany({ where: { AND: [ownRows(contexts), { entityType, entityId: { in: entityIds }, readState: "UNREAD" }] }, data: { readState: "READ", readAt: new Date() } });
  return result.count;
}

/**
 * Moves one of the person's own notifications out of the inbox (MOB-10 §126).
 * The business record is untouched, and so is the notification row: archiving
 * is reversible bookkeeping, not deletion. Somebody else's is simply not found.
 */
export async function archiveNotificationForWorkspace(session: UserContext, id: string): Promise<void> {
  const result = await prisma.notification.updateMany({
    where: { AND: [{ id }, ownRows(await resolvePersonalContexts(session))] },
    data: { archivedAt: new Date() },
  });
  if (result.count === 0) throw new AccessError("NOT_FOUND");
}
