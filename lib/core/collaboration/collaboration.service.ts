import { Prisma, type SubscriptionSource } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import type { RecordDefinition, RecordSummary } from "@/lib/core/records/record.types";
import { DB_NOW } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import type { CreateCommentInput, ThreadQuery } from "./collaboration.schema";
import { MAX_MENTIONS_PER_COMMENT, parseMentionIds, plainText, segmentComment, type CommentSegment } from "./mention";

/**
 * Contextual collaboration (PRD #38 M2, §22-§40).
 *
 * The rule every function here follows, in this order:
 *
 *   current company + read access to the parent record, *now*
 *   + the collaboration permission for the action
 *   = allowed
 *
 * The parent is re-read through the record registry on every call — reading a
 * thread, posting, editing, archiving, watching — so a person whose access to
 * the record was revoked yesterday can do none of those today, whatever
 * subscription or old link they still hold. An unknown parent type, another
 * company's record and a record out of scope all answer NOT_FOUND
 * (PRD #38 §30, §32, §39).
 */

export type CollaborationParentDTO = {
  type: string;
  id: string;
  noun: string;
  label: string;
  href: string;
  archived: boolean;
};

export type CommentAuthorDTO = { memberId: string; fullName: string; avatarUrl: string | null; active: boolean };

export type CommentDTO = {
  id: string;
  author: CommentAuthorDTO;
  /** Null when archived: the row stays, the text does not (PRD #38 §34). */
  segments: CommentSegment[] | null;
  replyToId: string | null;
  createdAt: string;
  editedAt: string | null;
  archived: boolean;
  capabilities: { canEdit: boolean; canArchive: boolean };
};

export type ThreadDTO = {
  parent: CollaborationParentDTO;
  comments: CommentDTO[];
  /** Pass as `before` to load the page of older comments. */
  nextBefore: string | null;
  commentCount: number;
  watching: boolean;
  watcherCount: number;
  capabilities: { canComment: boolean; canWatch: boolean };
};

export type MentionableMemberDTO = { memberId: string; fullName: string; avatarUrl: string | null; jobTitle: string | null };

/* -------------------------------------------------------------------------- */
/* Parent resolution                                                           */
/* -------------------------------------------------------------------------- */

type ResolvedParent = { definition: RecordDefinition; record: RecordSummary };

/** Whether this context may take part in discussion on this record at all. */
async function readableParent(context: UserContext, parentType: string, parentId: string): Promise<ResolvedParent | null> {
  const definition = recordDefinition(parentType);
  if (!definition?.collaboration) return null;
  if (!definition.collaboration.requires.every((permission) => can(context, permission))) return null;
  const record = await loadRecord(context, parentType, parentId);
  return record ? { definition, record } : null;
}

async function requireParent(context: UserContext, parentType: string, parentId: string): Promise<ResolvedParent> {
  const parent = await readableParent(context, parentType, parentId);
  if (!parent) throw new AccessError("NOT_FOUND", "That record does not exist.");
  return parent;
}

function parentDTO(parent: ResolvedParent): CollaborationParentDTO {
  return {
    type: parent.definition.type,
    id: parent.record.id,
    noun: parent.definition.noun,
    label: parent.record.label,
    href: parent.record.href,
    archived: parent.record.archived,
  };
}

/**
 * Which of these members could read the record right now — the same question
 * `readableParent` answers for the caller, asked for each of them through their
 * own context (PRD #38 §31, §32).
 */
export async function membersWhoCanRead(
  companyId: string,
  parentType: string,
  parentId: string,
  memberIds: readonly string[],
): Promise<string[]> {
  const contexts = await buildMemberContexts(companyId, memberIds);
  const allowed: string[] = [];
  for (const [memberId, memberContext] of contexts) {
    if (await readableParent(memberContext, parentType, parentId)) allowed.push(memberId);
  }
  return allowed;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const COMMENT_SELECT = {
  id: true,
  authorMemberId: true,
  body: true,
  replyToId: true,
  createdAt: true,
  editedAt: true,
  archivedAt: true,
  author: { select: { id: true, status: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
  mentions: { select: { mentionedMemberId: true, member: { select: { user: { select: { firstName: true, lastName: true } } } } } },
} satisfies Prisma.CommentSelect;

type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;

function toCommentDTO(context: UserContext, row: CommentRow, parentArchived: boolean): CommentDTO {
  const names = new Map(
    row.mentions.map((mention) => [mention.mentionedMemberId, `${mention.member.user.firstName} ${mention.member.user.lastName}`]),
  );
  const archived = row.archivedAt !== null;
  const mine = row.authorMemberId === context.membershipId;
  return {
    id: row.id,
    author: {
      memberId: row.author.id,
      fullName: `${row.author.user.firstName} ${row.author.user.lastName}`,
      avatarUrl: row.author.user.avatarUrl,
      active: row.author.status === "ACTIVE",
    },
    segments: archived ? null : segmentComment(row.body, names),
    replyToId: row.replyToId,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    archived,
    capabilities: {
      canEdit: mine && !archived && !parentArchived && can(context, "collaboration.comment.edit_own"),
      canArchive: mine && !archived && can(context, "collaboration.comment.archive_own"),
    },
  };
}

export async function getThread(
  context: UserContext,
  parentType: string,
  parentId: string,
  query: ThreadQuery,
): Promise<ThreadDTO> {
  const parent = await requireParent(context, parentType, parentId);

  const thread = await prisma.collaborationThread.findUnique({
    where: { companyId_parentType_parentId: { companyId: context.companyId, parentType: parent.definition.type, parentId: parent.record.id } },
    select: { id: true, commentCount: true },
  });

  const capabilities = {
    canComment: !parent.record.archived && can(context, "collaboration.comment.create"),
    canWatch: can(context, "collaboration.watch"),
  };

  if (!thread) {
    return { parent: parentDTO(parent), comments: [], nextBefore: null, commentCount: 0, watching: false, watcherCount: 0, capabilities };
  }

  let beforeDate: Date | null = null;
  if (query.before) {
    const anchor = await prisma.comment.findFirst({
      where: { id: query.before, threadId: thread.id, companyId: context.companyId },
      select: { createdAt: true },
    });
    beforeDate = anchor?.createdAt ?? null;
  }

  // Newest page first, cursor by creation time then id, shown oldest to newest.
  const rows = await prisma.comment.findMany({
    where: {
      threadId: thread.id,
      companyId: context.companyId,
      ...(beforeDate && query.before
        ? { OR: [{ createdAt: { lt: beforeDate } }, { createdAt: beforeDate, id: { lt: query.before } }] }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: COMMENT_SELECT,
  });

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit).reverse();

  const [subscription, watcherCount] = await Promise.all([
    prisma.subscription.findUnique({
      where: { threadId_memberId: { threadId: thread.id, memberId: context.membershipId } },
      select: { active: true },
    }),
    prisma.subscription.count({ where: { threadId: thread.id, active: true } }),
  ]);

  return {
    parent: parentDTO(parent),
    comments: page.map((row) => toCommentDTO(context, row, parent.record.archived)),
    nextBefore: hasMore ? (page[0]?.id ?? null) : null,
    commentCount: thread.commentCount,
    watching: subscription?.active ?? false,
    watcherCount,
    capabilities,
  };
}

/* -------------------------------------------------------------------------- */
/* Threads and subscriptions                                                   */
/* -------------------------------------------------------------------------- */

/** The one thread of a record, created on first use. Safe under concurrent first comments. */
async function ensureThread(
  tx: Prisma.TransactionClient,
  companyId: string,
  parentType: string,
  parentId: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.collaborationThread.findUnique({
    where: { companyId_parentType_parentId: { companyId, parentType, parentId } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  // ON CONFLICT DO NOTHING, then read: two first comments racing each other
  // end up in one thread, not a unique-violation error for one of them.
  await tx.$executeRaw`
    INSERT INTO "collaboration_threads" ("id", "companyId", "parentType", "parentId", "createdAt", "updatedAt")
    VALUES (${`thr_${crypto.randomUUID().replace(/-/g, "")}`}, ${companyId}, ${parentType}, ${parentId}, ${DB_NOW}, ${DB_NOW})
    ON CONFLICT ("companyId", "parentType", "parentId") DO NOTHING`;
  const thread = await tx.collaborationThread.findUniqueOrThrow({
    where: { companyId_parentType_parentId: { companyId, parentType, parentId } },
    select: { id: true },
  });
  return { id: thread.id, created: true };
}

/**
 * Subscribes members to a record's discussion without changing anybody who
 * already chose. An explicit unwatch is respected: an automatic source never
 * re-activates a subscription the member turned off (PRD #38 §33).
 */
async function subscribe(
  tx: Prisma.TransactionClient,
  input: { companyId: string; threadId: string; memberIds: readonly string[]; source: SubscriptionSource },
): Promise<void> {
  const ids = [...new Set(input.memberIds)].filter(Boolean);
  if (ids.length === 0) return;
  await tx.subscription.createMany({
    data: ids.map((memberId) => ({ companyId: input.companyId, threadId: input.threadId, memberId, source: input.source })),
    skipDuplicates: true,
  });
}

/**
 * Auto-subscription for module code (PRD #38 §33): a task's assignee and
 * creator, a record's owner. Only members who can read the record are
 * subscribed — the caller's word is not taken for it.
 */
export async function subscribeStakeholders(input: {
  companyId: string;
  parentType: string;
  parentId: string;
  memberIds: readonly string[];
}): Promise<void> {
  const definition = recordDefinition(input.parentType);
  if (!definition?.collaboration) return;
  const readers = await membersWhoCanRead(input.companyId, input.parentType, input.parentId, input.memberIds);
  if (readers.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const thread = await ensureThread(tx, input.companyId, definition.type, input.parentId);
    await subscribe(tx, { companyId: input.companyId, threadId: thread.id, memberIds: readers, source: "STAKEHOLDER" });
  });
}

export async function setWatching(
  context: UserContext,
  parentType: string,
  parentId: string,
  watching: boolean,
): Promise<{ watching: boolean }> {
  const parent = await requireParent(context, parentType, parentId);
  if (!can(context, "collaboration.watch")) throw new AccessError("FORBIDDEN", "You cannot watch records.");

  await prisma.$transaction(async (tx) => {
    const thread = await ensureThread(tx, context.companyId, parent.definition.type, parent.record.id);
    await tx.subscription.upsert({
      where: { threadId_memberId: { threadId: thread.id, memberId: context.membershipId } },
      update: { active: watching, source: "MANUAL" },
      create: { companyId: context.companyId, threadId: thread.id, memberId: context.membershipId, source: "MANUAL", active: watching },
    });
    if (watching && !parent.definition.collaboration?.requires.length) {
      await recordActivity(tx, context, {
        module: parent.definition.moduleKey,
        entityType: parent.definition.activityEntityType,
        entityId: parent.record.id,
        action: "WATCH_STARTED",
        message: "started watching",
      });
    }
  });

  return { watching };
}

/** Members watching a record's discussion — not a grant, just a list to re-check (PRD #38 §32). */
export async function activeWatcherIds(companyId: string, parentType: string, parentId: string): Promise<string[]> {
  const rows = await prisma.subscription.findMany({
    where: { companyId, active: true, thread: { companyId, parentType, parentId } },
    select: { memberId: true },
  });
  return rows.map((row) => row.memberId);
}

/* -------------------------------------------------------------------------- */
/* Mentions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Validates every mentioned id: same company, active membership, and able to
 * read this record now. Anything else refuses the comment — a mention is never
 * silently dropped, and never delivered to somebody it should not reach
 * (PRD #38 §31, §39).
 */
async function validateMentions(context: UserContext, parent: ResolvedParent, body: string): Promise<string[]> {
  const ids = parseMentionIds(body).filter((id) => id !== context.membershipId);
  if (ids.length === 0) return [];
  if (ids.length > MAX_MENTIONS_PER_COMMENT) throw new AccessError("VALIDATION_ERROR", "TOO_MANY_MENTIONS");

  const readers = await membersWhoCanRead(context.companyId, parent.definition.type, parent.record.id, ids);
  if (readers.length !== ids.length) throw new AccessError("VALIDATION_ERROR", "MENTION_NOT_ALLOWED");
  return ids;
}

export async function listMentionableMembers(
  context: UserContext,
  parentType: string,
  parentId: string,
  search: string | undefined,
): Promise<MentionableMemberDTO[]> {
  const parent = await requireParent(context, parentType, parentId);
  if (!can(context, "collaboration.comment.create")) return [];

  const term = search?.trim().slice(0, 80);
  const candidates = await prisma.companyMember.findMany({
    where: {
      companyId: context.companyId,
      status: "ACTIVE",
      id: { not: context.membershipId },
      user: {
        status: "ACTIVE",
        ...(term
          ? {
              OR: [
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
                { email: { startsWith: term, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    take: 40,
    select: { id: true, jobTitle: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
  });

  // Only people who could open the record are offered — the picker never
  // suggests a mention the server would refuse.
  const readers = new Set(
    await membersWhoCanRead(context.companyId, parent.definition.type, parent.record.id, candidates.map((row) => row.id)),
  );

  return candidates
    .filter((row) => readers.has(row.id))
    .slice(0, 8)
    .map((row) => ({
      memberId: row.id,
      fullName: `${row.user.firstName} ${row.user.lastName}`,
      avatarUrl: row.user.avatarUrl,
      jobTitle: row.jobTitle,
    }));
}

/* -------------------------------------------------------------------------- */
/* Comments                                                                    */
/* -------------------------------------------------------------------------- */

export async function createComment(
  context: UserContext,
  parentType: string,
  parentId: string,
  input: CreateCommentInput,
): Promise<CommentDTO> {
  const parent = await requireParent(context, parentType, parentId);
  if (!can(context, "collaboration.comment.create")) throw new AccessError("FORBIDDEN", "You cannot comment.");
  if (parent.record.archived) throw new AccessError("CONFLICT", "PARENT_ARCHIVED");

  const mentionedIds = await validateMentions(context, parent, input.body);
  const { definition, record } = parent;

  // Resolved before the transaction: checking each stakeholder's access is a
  // handful of queries, and none of them belongs inside the write.
  const threadExists = await prisma.collaborationThread.findUnique({
    where: { companyId_parentType_parentId: { companyId: context.companyId, parentType: definition.type, parentId: record.id } },
    select: { id: true },
  });
  const stakeholders = record.stakeholderMemberIds.filter((id) => id !== context.membershipId);
  const stakeholderReaders =
    threadExists || stakeholders.length === 0
      ? []
      : await membersWhoCanRead(context.companyId, definition.type, record.id, stakeholders);

  const created = await prisma.$transaction(async (tx) => {
    const thread = await ensureThread(tx, context.companyId, definition.type, record.id);

    let replyTarget: { id: string; authorMemberId: string } | null = null;
    if (input.replyToId) {
      replyTarget = await tx.comment.findFirst({
        where: { id: input.replyToId, threadId: thread.id, companyId: context.companyId, archivedAt: null },
        select: { id: true, authorMemberId: true },
      });
      if (!replyTarget) throw new AccessError("VALIDATION_ERROR", "REPLY_TARGET_NOT_FOUND");
    }

    const comment = await tx.comment.create({
      data: {
        companyId: context.companyId,
        threadId: thread.id,
        authorMemberId: context.membershipId,
        body: input.body,
        replyToId: replyTarget?.id ?? null,
      },
      select: { id: true },
    });

    if (mentionedIds.length > 0) {
      await tx.mention.createMany({
        data: mentionedIds.map((memberId) => ({ companyId: context.companyId, commentId: comment.id, mentionedMemberId: memberId })),
        skipDuplicates: true,
      });
    }

    await tx.collaborationThread.update({
      where: { id: thread.id },
      data: { commentCount: { increment: 1 }, lastCommentAt: new Date() },
    });

    await subscribe(tx, { companyId: context.companyId, threadId: thread.id, memberIds: [context.membershipId], source: "AUTHOR" });
    await subscribe(tx, { companyId: context.companyId, threadId: thread.id, memberIds: mentionedIds, source: "MENTION" });
    if (thread.created) {
      // The record's own people start watching when its discussion starts.
      // Checked readers only: a stakeholder field is not proof of access.
      await subscribe(tx, { companyId: context.companyId, threadId: thread.id, memberIds: stakeholderReaders, source: "STAKEHOLDER" });
    }

    // Confidential discussions (an HR record) stay out of the record's activity
    // feed, which has a wider audience than the thread.
    if (!definition.collaboration?.requires.length) {
      await recordActivity(tx, context, {
        module: definition.moduleKey,
        entityType: definition.activityEntityType,
        entityId: record.id,
        action: mentionedIds.length > 0 ? "COMMENTED_WITH_MENTION" : "COMMENTED",
        message: mentionedIds.length > 0 ? `commented and mentioned ${mentionedIds.length} ${mentionedIds.length === 1 ? "person" : "people"}` : "commented",
        metadata: { commentId: comment.id, mentionCount: mentionedIds.length } as Prisma.InputJsonValue,
      });
    }

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.COMMENT_CREATED,
        entity: { type: "Comment", id: comment.id },
        projectId: record.projectId,
        after: { parentType: definition.type, parentId: record.id, mentionCount: mentionedIds.length, length: input.body.length },
      },
      { tx },
    );

    const base = {
      companyId: context.companyId,
      moduleKey: definition.moduleKey,
      entityType: definition.type,
      entityId: record.id,
      actorMemberId: context.membershipId,
      projectId: record.projectId,
    };
    const payload = {
      commentId: comment.id,
      recordLabel: record.label,
      actorName: context.fullName,
      preview: plainText(input.body).slice(0, 140),
    };

    if (mentionedIds.length > 0) {
      await enqueueNotificationEvent(tx, {
        ...base,
        eventType: "COMMENT_MENTIONED",
        payload: { ...payload, mentionedMemberIds: mentionedIds },
      });
    }
    if (replyTarget && replyTarget.authorMemberId !== context.membershipId && !mentionedIds.includes(replyTarget.authorMemberId)) {
      await enqueueNotificationEvent(tx, {
        ...base,
        eventType: "COMMENT_REPLY",
        payload: { ...payload, replyToAuthorMemberId: replyTarget.authorMemberId },
      });
    }
    await enqueueNotificationEvent(tx, {
      ...base,
      eventType: "COMMENT_ADDED",
      payload: {
        ...payload,
        excludeMemberIds: [...mentionedIds, ...(replyTarget ? [replyTarget.authorMemberId] : [])],
      },
    });

    return comment;
  });

  const row = await prisma.comment.findUniqueOrThrow({ where: { id: created.id }, select: COMMENT_SELECT });
  return toCommentDTO(context, row, record.archived);
}

/** The comment and its parent, re-read for this caller — a comment id alone opens nothing (PRD #38 §39). */
async function requireComment(context: UserContext, commentId: string) {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, companyId: context.companyId },
    select: { ...COMMENT_SELECT, thread: { select: { id: true, parentType: true, parentId: true } } },
  });
  if (!comment) throw new AccessError("NOT_FOUND", "That comment does not exist.");
  const parent = await readableParent(context, comment.thread.parentType, comment.thread.parentId);
  if (!parent) throw new AccessError("NOT_FOUND", "That comment does not exist.");
  return { comment, parent };
}

export async function editComment(context: UserContext, commentId: string, body: string): Promise<CommentDTO> {
  const { comment, parent } = await requireComment(context, commentId);
  // Somebody else's comment is refused as not yours, not as missing: the
  // caller can already read it.
  if (comment.authorMemberId !== context.membershipId || !can(context, "collaboration.comment.edit_own")) {
    throw new AccessError("FORBIDDEN", "Only the author can edit a comment.");
  }
  if (comment.archivedAt) throw new AccessError("CONFLICT", "COMMENT_ARCHIVED");
  if (parent.record.archived) throw new AccessError("CONFLICT", "PARENT_ARCHIVED");

  const mentionedIds = await validateMentions(context, parent, body);
  const known = new Set(comment.mentions.map((mention) => mention.mentionedMemberId));
  const added = mentionedIds.filter((id) => !known.has(id));

  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: comment.id }, data: { body, editedAt: new Date() } });
    if (added.length > 0) {
      await tx.mention.createMany({
        data: added.map((memberId) => ({ companyId: context.companyId, commentId: comment.id, mentionedMemberId: memberId })),
        skipDuplicates: true,
      });
      await subscribe(tx, { companyId: context.companyId, threadId: comment.thread.id, memberIds: added, source: "MENTION" });
      // Only the newly mentioned hear about it; an edit does not re-notify.
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: "COMMENT_MENTIONED",
        moduleKey: parent.definition.moduleKey,
        entityType: parent.definition.type,
        entityId: parent.record.id,
        actorMemberId: context.membershipId,
        projectId: parent.record.projectId,
        payload: {
          commentId: comment.id,
          recordLabel: parent.record.label,
          actorName: context.fullName,
          preview: plainText(body).slice(0, 140),
          mentionedMemberIds: added,
        },
      });
    }
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.COMMENT_EDITED,
        entity: { type: "Comment", id: comment.id },
        projectId: parent.record.projectId,
        after: { parentType: parent.definition.type, parentId: parent.record.id, length: body.length },
      },
      { tx },
    );
  });

  const row = await prisma.comment.findUniqueOrThrow({ where: { id: comment.id }, select: COMMENT_SELECT });
  return toCommentDTO(context, row, parent.record.archived);
}

/** Deleting a comment archives it: the row, its author and its mentions stay (PRD #38 §34, §163). */
export async function archiveComment(context: UserContext, commentId: string): Promise<void> {
  const { comment, parent } = await requireComment(context, commentId);
  if (comment.authorMemberId !== context.membershipId || !can(context, "collaboration.comment.archive_own")) {
    throw new AccessError("FORBIDDEN", "Only the author can delete a comment.");
  }
  if (comment.archivedAt) return;

  const archivedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.comment.updateMany({
      where: { id: comment.id, archivedAt: null },
      data: { archivedAt, archivedByMemberId: context.membershipId },
    });
    if (updated.count === 0) return;
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.COMMENT_ARCHIVED,
        entity: { type: "Comment", id: comment.id },
        projectId: parent.record.projectId,
        after: { parentType: parent.definition.type, parentId: parent.record.id, archivedAt: archivedAt.toISOString() },
      },
      { tx },
    );
  });
}
