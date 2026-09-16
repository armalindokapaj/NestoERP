import { resolveAttentionFor } from "@/lib/core/notifications/attention.service";
import { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { prisma } from "@/lib/database/prisma";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import { listDocuments } from "@/lib/modules/documents/document.service";
import { resolveProductivitySettings } from "@/lib/modules/productivity/productivity.settings";
import { excerpt } from "./announcement.body";
import { announcementsOpen, audienceWhere, canAddress, managedWhere, MODULE, projectDoor, readableAnnouncementWhere, RECORD } from "./announcement.permissions";
import type { CreateAnnouncementInput, FeedQuery, UpdateAnnouncementInput } from "./announcement.schema";
import {
  AUDIENCE_LABELS,
  PINNED_LIMIT,
  type AcknowledgmentRowDTO,
  type AnnouncementCapabilities,
  type AnnouncementCardDTO,
  type AnnouncementDetailDTO,
  type AnnouncementFeedDTO,
  type AnnouncementMetricsDTO,
  type AudienceType,
} from "./announcement.types";

/**
 * Announcements: writing, reading, read state and acknowledgment (PRD #45
 * §11-§16, §20-§32, §48-§50, §59-§61, §145-§160, §166-§178, §212-§214).
 *
 * Every read goes through the audience where-clause; every write checks the
 * author's reach for the audience it names, in this company. Read state and
 * acknowledgments are written for the member making the request — the server
 * never takes a member id from the browser. Publishing, scheduling, pinning,
 * expiry and archive live in announcement.publish.ts.
 */

type Tx = Prisma.TransactionClient;

export function fail(code: string, message: string, status: "VALIDATION_ERROR" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" = "VALIDATION_ERROR", extra: Record<string, unknown> = {}): AccessError {
  return new AccessError(status, message, { code, ...extra });
}

export const ROW_SELECT = {
  id: true,
  companyId: true,
  title: true,
  body: true,
  status: true,
  priority: true,
  audienceType: true,
  departmentId: true,
  projectId: true,
  authorMemberId: true,
  publishedByMemberId: true,
  publishAt: true,
  publishedAt: true,
  expiresAt: true,
  expiredAt: true,
  pinned: true,
  requiresAcknowledgment: true,
  eventStartsAt: true,
  eventEndsAt: true,
  editedAt: true,
  archivedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.AnnouncementSelect;

export type AnnouncementRow = Prisma.AnnouncementGetPayload<{ select: typeof ROW_SELECT }>;

async function assertEnabled(companyId: string) {
  if (!(await resolveProductivitySettings(companyId)).announcementsEnabled) throw fail("ANNOUNCEMENTS_DISABLED", "Announcements are switched off for this company.", "FORBIDDEN");
}

export async function findReadableAnnouncement(context: UserContext, announcementId: string): Promise<AnnouncementRow & { managed: boolean }> {
  assertModule(context, MODULE);
  if (!announcementsOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open announcements.");
  const row = await prisma.announcement.findFirst({ where: { AND: [readableAnnouncementWhere(context), { id: announcementId }] }, select: ROW_SELECT });
  if (!row) throw fail("ANNOUNCEMENT_NOT_FOUND", "That announcement could not be found.", "NOT_FOUND");
  const managed = (await prisma.announcement.count({ where: { AND: [{ id: row.id, companyId: context.companyId }, managedWhere(context)] } })) > 0;
  return { ...row, managed };
}

export async function findManageableAnnouncement(context: UserContext, announcementId: string) {
  const row = await findReadableAnnouncement(context, announcementId);
  if (!row.managed) throw new AccessError("FORBIDDEN", "You cannot manage this announcement.", { code: "ANNOUNCEMENT_FORBIDDEN" });
  return row;
}

/* -------------------------------------------------------------------------- */
/* Audience                                                                    */
/* -------------------------------------------------------------------------- */

type AudienceInput = { audienceType: AudienceType; projectId: string | null; departmentId: string | null; selectedMemberIds: string[] };

/** The audience named in a write, checked against this company and this author's reach (§33, §156, §157). */
export async function validateAudience(context: UserContext, input: AudienceInput): Promise<AudienceInput> {
  if (!canAddress(context, input.audienceType)) throw new AccessError("FORBIDDEN", `You cannot address ${AUDIENCE_LABELS[input.audienceType].toLowerCase()} announcements.`, { code: "ANNOUNCEMENT_AUDIENCE_FORBIDDEN", field: "audienceType" });
  const normalized: AudienceInput = { audienceType: input.audienceType, projectId: null, departmentId: null, selectedMemberIds: [] };
  if (input.audienceType === "PROJECT") {
    const door = projectDoor(context);
    const project = door ? await prisma.project.findFirst({ where: { AND: [door, { id: input.projectId ?? "", companyId: context.companyId }] }, select: { id: true } }) : null;
    if (!project) throw fail("ANNOUNCEMENT_PROJECT_INVALID", "That project could not be found.", "VALIDATION_ERROR", { field: "projectId" });
    normalized.projectId = project.id;
  }
  if (input.audienceType === "DEPARTMENT") {
    const department = await prisma.department.findFirst({ where: { id: input.departmentId ?? "", companyId: context.companyId, archivedAt: null }, select: { id: true } });
    if (!department) throw fail("ANNOUNCEMENT_DEPARTMENT_INVALID", "That department could not be found.", "VALIDATION_ERROR", { field: "departmentId" });
    normalized.departmentId = department.id;
  }
  if (input.audienceType === "SELECTED_MEMBERS") {
    const unique = [...new Set(input.selectedMemberIds)];
    // Only active people of this company: an id from elsewhere is refused, not ignored (§31, §320).
    const members = await prisma.companyMember.findMany({ where: { id: { in: unique }, companyId: context.companyId, status: "ACTIVE" }, select: { id: true } });
    if (members.length !== unique.length) throw fail("ANNOUNCEMENT_MEMBERS_INVALID", "Some of those people are not active members of this company.", "VALIDATION_ERROR", { field: "selectedMemberIds" });
    normalized.selectedMemberIds = unique;
  }
  return normalized;
}

/**
 * The members an announcement is addressed to (§135-§140): everyone active in
 * the company, the department's members, the project's manager and members,
 * or the people named. Used for acknowledgment targets and notifications; who
 * may *see* it is always the query above.
 */
export async function audienceMemberIds(tx: Tx | typeof prisma, row: Pick<AnnouncementRow, "id" | "companyId" | "audienceType" | "projectId" | "departmentId">): Promise<string[]> {
  const active = { companyId: row.companyId, status: "ACTIVE" as const, role: { permissions: { some: { permission: { key: "announcement.view" } } } } };
  switch (row.audienceType) {
    case "COMPANY":
      return (await tx.companyMember.findMany({ where: active, select: { id: true } })).map((member) => member.id);
    case "DEPARTMENT":
      return (await tx.companyMember.findMany({ where: { ...active, departmentId: row.departmentId ?? "" }, select: { id: true } })).map((member) => member.id);
    case "PROJECT":
      return (await tx.companyMember.findMany({ where: { ...active, OR: [{ projectMemberships: { some: { projectId: row.projectId ?? "", status: "ACTIVE" } } }, { managedProjects: { some: { id: row.projectId ?? "" } } }] }, select: { id: true } })).map((member) => member.id);
    case "SELECTED_MEMBERS": {
      const selected = await tx.announcementAudienceMember.findMany({ where: { announcementId: row.id }, select: { memberId: true } });
      return (await tx.companyMember.findMany({ where: { ...active, id: { in: selected.map((entry) => entry.memberId) } }, select: { id: true } })).map((member) => member.id);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* DTOs                                                                        */
/* -------------------------------------------------------------------------- */

function audienceOf(row: Pick<AnnouncementRow, "audienceType" | "project" | "department">) {
  const label = row.audienceType === "PROJECT" && row.project ? `Project · ${row.project.name}` : row.audienceType === "DEPARTMENT" && row.department ? `Department · ${row.department.name}` : AUDIENCE_LABELS[row.audienceType];
  return { type: row.audienceType, label, project: row.project, department: row.department };
}

export async function toCards(context: UserContext, rows: AnnouncementRow[]): Promise<AnnouncementCardDTO[]> {
  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];
  const [authors, reads, acks, attachments] = await Promise.all([
    prisma.companyMember.findMany({ where: { companyId: context.companyId, id: { in: [...new Set(rows.map((row) => row.authorMemberId))] } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }),
    prisma.announcementRead.findMany({ where: { memberId: context.membershipId, announcementId: { in: ids } }, select: { announcementId: true } }),
    prisma.announcementAcknowledgment.findMany({ where: { memberId: context.membershipId, announcementId: { in: ids } }, select: { announcementId: true, acknowledgedAt: true } }),
    prisma.document.groupBy({ by: ["entityId"], where: { companyId: context.companyId, entityType: RECORD, entityId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  const author = new Map(authors.map((row) => [row.id, { memberId: row.id, name: `${row.user.firstName} ${row.user.lastName}` }]));
  const read = new Set(reads.map((row) => row.announcementId));
  const acknowledged = new Map(acks.map((row) => [row.announcementId, row.acknowledgedAt.toISOString()]));
  const files = new Map(attachments.map((row) => [row.entityId, row._count._all]));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    excerpt: excerpt(row.body),
    status: row.status,
    priority: row.priority,
    audience: audienceOf(row),
    author: author.get(row.authorMemberId) ?? null,
    publishAt: row.publishAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    eventStartsAt: row.eventStartsAt?.toISOString() ?? null,
    eventEndsAt: row.eventEndsAt?.toISOString() ?? null,
    pinned: row.pinned,
    requiresAcknowledgment: row.requiresAcknowledgment,
    read: read.has(row.id) || acknowledged.has(row.id),
    acknowledgedAt: acknowledged.get(row.id) ?? null,
    attachmentCount: files.get(row.id) ?? 0,
    edited: Boolean(row.editedAt),
    updatedAt: row.updatedAt.toISOString(),
    href: `/announcements/${row.id}`,
  }));
}

export function capabilitiesFor(context: UserContext, row: AnnouncementRow & { managed: boolean }, acknowledgedCount: number, acknowledgedByMe: boolean): AnnouncementCapabilities {
  const manage = row.managed && canAddress(context, row.audienceType);
  const open = row.status === "DRAFT" || row.status === "SCHEDULED";
  const live = row.status === "PUBLISHED" && (!row.expiresAt || row.expiresAt > new Date());
  const editable = manage && can(context, "announcement.edit") && (open || live);
  return {
    canEdit: editable,
    canEditAudience: editable && open,
    // Once people have acknowledged it, what they acknowledged does not change (§149).
    canEditContent: editable && (open || !(row.requiresAcknowledgment && acknowledgedCount > 0)),
    canPublish: manage && can(context, "announcement.publish") && open,
    canSchedule: manage && can(context, "announcement.publish") && row.status === "DRAFT",
    canUnschedule: manage && can(context, "announcement.publish") && row.status === "SCHEDULED",
    canArchive: manage && can(context, "announcement.archive") && row.status !== "ARCHIVED",
    canPin: manage && can(context, "announcement.pin") && (open || live),
    canDuplicate: canAddress(context, row.audienceType) && row.managed,
    // The author wrote it; the people it is addressed to confirm it (§137).
    canAcknowledge: live && row.requiresAcknowledgment && can(context, "announcement.acknowledge") && !acknowledgedByMe && row.authorMemberId !== context.membershipId,
    canViewMetrics: row.managed && row.status !== "DRAFT",
    canUploadDocuments: editable && canAccessModule(context, "documents") && can(context, "document.create"),
  };
}

/* -------------------------------------------------------------------------- */
/* Create, edit, duplicate                                                     */
/* -------------------------------------------------------------------------- */

function dates(input: { expiresAt: Date | null; eventStartsAt: Date | null; eventEndsAt: Date | null }, publishAt: Date | null) {
  if (input.expiresAt && input.expiresAt <= (publishAt ?? new Date())) throw fail("ANNOUNCEMENT_EXPIRY_INVALID", "The expiry must be after the announcement is published.", "VALIDATION_ERROR", { field: "expiresAt" });
}

async function assertPinRoom(tx: Tx, context: UserContext, row: { id?: string; audienceType: AudienceType; projectId: string | null; departmentId: string | null }) {
  const now = new Date();
  const pinned = await tx.announcement.count({
    where: {
      companyId: context.companyId,
      pinned: true,
      status: { in: ["PUBLISHED", "SCHEDULED"] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      audienceType: row.audienceType,
      ...(row.audienceType === "PROJECT" ? { projectId: row.projectId } : {}),
      ...(row.audienceType === "DEPARTMENT" ? { departmentId: row.departmentId } : {}),
      ...(row.id ? { id: { not: row.id } } : {}),
    },
  });
  if (pinned >= PINNED_LIMIT) throw fail("ANNOUNCEMENT_PIN_LIMIT", `At most ${PINNED_LIMIT} announcements stay pinned for one audience. Unpin one first.`, "CONFLICT");
}

export async function createAnnouncement(context: UserContext, input: CreateAnnouncementInput): Promise<{ id: string; version: number }> {
  assertModule(context, MODULE);
  assertPermission(context, "announcement.create");
  await assertEnabled(context.companyId);
  const audience = await validateAudience(context, input);
  dates(input, null);
  if (input.pinned && !can(context, "announcement.pin")) throw new AccessError("FORBIDDEN", "You cannot pin announcements.", { code: "ANNOUNCEMENT_PIN_FORBIDDEN" });
  return prisma.$transaction(async (tx) => {
    const created = await tx.announcement.create({
      data: {
        companyId: context.companyId,
        title: input.title,
        body: input.body,
        priority: input.priority,
        audienceType: audience.audienceType,
        projectId: audience.projectId,
        departmentId: audience.departmentId,
        authorMemberId: context.membershipId,
        expiresAt: input.expiresAt,
        eventStartsAt: input.eventStartsAt,
        eventEndsAt: input.eventEndsAt,
        pinned: input.pinned,
        requiresAcknowledgment: input.requiresAcknowledgment,
        selectedMembers: audience.selectedMemberIds.length ? { create: audience.selectedMemberIds.map((memberId) => ({ memberId })) } : undefined,
      },
      select: { id: true, version: true },
    });
    await recordUserAction(context, { actionKey: AuditAction.ANNOUNCEMENT_CREATED, entity: { type: RECORD, id: created.id, label: input.title }, projectId: audience.projectId, after: { title: input.title, priority: input.priority, audienceType: audience.audienceType, projectId: audience.projectId, departmentId: audience.departmentId, selectedMembers: audience.selectedMemberIds.length, requiresAcknowledgment: input.requiresAcknowledgment, pinned: input.pinned } }, { tx });
    return created;
  });
}

/**
 * Drafts and schedules change freely; a published announcement takes
 * corrections — marked as edited and audited — but not a new audience, and
 * not new content once people have acknowledged it (§145-§153).
 */
export async function updateAnnouncement(context: UserContext, announcementId: string, input: UpdateAnnouncementInput): Promise<{ version: number }> {
  const row = await findManageableAnnouncement(context, announcementId);
  assertPermission(context, "announcement.edit");
  const acknowledged = await prisma.announcementAcknowledgment.count({ where: { announcementId: row.id } });
  const caps = capabilitiesFor(context, row, acknowledged, false);
  if (!caps.canEdit) throw fail("ANNOUNCEMENT_READ_ONLY", row.status === "ARCHIVED" || row.status === "EXPIRED" ? "Expired and archived announcements are kept as they were." : "You cannot edit this announcement.", "CONFLICT");

  const published = row.status === "PUBLISHED";
  let audience: AudienceInput = { audienceType: row.audienceType, projectId: row.projectId, departmentId: row.departmentId, selectedMemberIds: [] };
  const selected = (await prisma.announcementAudienceMember.findMany({ where: { announcementId: row.id }, select: { memberId: true } })).map((entry) => entry.memberId);
  audience.selectedMemberIds = selected;
  const audienceChanged = input.audienceType !== row.audienceType || (input.projectId ?? null) !== row.projectId || (input.departmentId ?? null) !== row.departmentId || (input.audienceType === "SELECTED_MEMBERS" && [...new Set(input.selectedMemberIds)].sort().join() !== [...selected].sort().join());
  if (audienceChanged) {
    if (!caps.canEditAudience) throw fail("ANNOUNCEMENT_AUDIENCE_LOCKED", "A published announcement keeps its audience. Duplicate it to reach other people.", "CONFLICT", { field: "audienceType" });
    audience = await validateAudience(context, input);
  }
  const contentChanged = input.title !== row.title || input.body !== row.body;
  if (contentChanged && !caps.canEditContent) throw fail("ANNOUNCEMENT_ACKNOWLEDGED_LOCKED", "People have already acknowledged this announcement, so its content stays as they read it.", "CONFLICT");
  if (published && input.requiresAcknowledgment !== row.requiresAcknowledgment) throw fail("ANNOUNCEMENT_ACK_LOCKED", "Acknowledgment is decided before publishing.", "CONFLICT", { field: "requiresAcknowledgment" });
  dates(input, row.publishedAt ?? row.publishAt);
  if (input.pinned !== row.pinned && !can(context, "announcement.pin")) throw new AccessError("FORBIDDEN", "You cannot pin announcements.", { code: "ANNOUNCEMENT_PIN_FORBIDDEN" });

  return prisma.$transaction(async (tx) => {
    if (input.pinned && !row.pinned) await assertPinRoom(tx, context, { id: row.id, ...audience });
    const moved = await tx.announcement.updateMany({
      where: { id: row.id, version: input.expectedVersion, status: row.status },
      data: {
        title: input.title,
        body: input.body,
        priority: input.priority,
        audienceType: audience.audienceType,
        projectId: audience.projectId,
        departmentId: audience.departmentId,
        expiresAt: input.expiresAt,
        eventStartsAt: input.eventStartsAt,
        eventEndsAt: input.eventEndsAt,
        pinned: input.pinned,
        requiresAcknowledgment: input.requiresAcknowledgment,
        ...(published && contentChanged ? { editedAt: new Date() } : {}),
        version: { increment: 1 },
      },
    });
    if (!moved.count) throw fail("ANNOUNCEMENT_STALE", "This announcement changed since you opened it. Reload to see the latest.", "CONFLICT");
    if (audienceChanged) {
      await tx.announcementAudienceMember.deleteMany({ where: { announcementId: row.id } });
      if (audience.selectedMemberIds.length) await tx.announcementAudienceMember.createMany({ data: audience.selectedMemberIds.map((memberId) => ({ announcementId: row.id, memberId })) });
    }
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.ANNOUNCEMENT_UPDATED,
        entity: { type: RECORD, id: row.id, label: input.title },
        projectId: audience.projectId,
        before: { title: row.title, priority: row.priority, audienceType: row.audienceType, expiresAt: row.expiresAt?.toISOString() ?? null, material: published && contentChanged },
        after: { title: input.title, priority: input.priority, audienceType: audience.audienceType, expiresAt: input.expiresAt?.toISOString() ?? null, material: published && contentChanged },
      },
      { tx },
    );
    if (input.pinned !== row.pinned) await recordUserAction(context, { actionKey: input.pinned ? AuditAction.ANNOUNCEMENT_PINNED : AuditAction.ANNOUNCEMENT_UNPINNED, entity: { type: RECORD, id: row.id, label: input.title }, after: { pinned: input.pinned } }, { tx });
    if (input.requiresAcknowledgment !== row.requiresAcknowledgment) await recordUserAction(context, { actionKey: AuditAction.ANNOUNCEMENT_ACK_REQUIRED_CHANGED, entity: { type: RECORD, id: row.id, label: input.title }, after: { requiresAcknowledgment: input.requiresAcknowledgment } }, { tx });
    return { version: input.expectedVersion + 1 };
  });
}

/** Content and audience copied into a new draft (§225). */
export async function duplicateAnnouncement(context: UserContext, announcementId: string): Promise<{ id: string }> {
  const row = await findManageableAnnouncement(context, announcementId);
  const selected = (await prisma.announcementAudienceMember.findMany({ where: { announcementId: row.id }, select: { memberId: true } })).map((entry) => entry.memberId);
  const created = await createAnnouncement(context, {
    title: row.title.length > 172 ? row.title.slice(0, 172) : row.title,
    body: row.body,
    priority: row.priority,
    audienceType: row.audienceType,
    projectId: row.projectId,
    departmentId: row.departmentId,
    selectedMemberIds: selected,
    expiresAt: null,
    eventStartsAt: null,
    eventEndsAt: null,
    pinned: false,
    requiresAcknowledgment: row.requiresAcknowledgment,
  });
  return { id: created.id };
}

/* -------------------------------------------------------------------------- */
/* Feed and detail                                                             */
/* -------------------------------------------------------------------------- */

const live = (now: Date): Prisma.AnnouncementWhereInput => ({ status: "PUBLISHED", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

export async function listAnnouncements(context: UserContext, query: FeedQuery): Promise<AnnouncementFeedDTO> {
  assertModule(context, MODULE);
  if (!announcementsOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open announcements.");
  const now = new Date();
  const me = context.membershipId;
  const visible: Prisma.AnnouncementWhereInput = { companyId: context.companyId, AND: [audienceWhere(context)] };
  const tabWhere: Record<FeedQuery["tab"], Prisma.AnnouncementWhereInput> = {
    for_me: { AND: [visible, live(now)] },
    pinned: { AND: [visible, live(now), { pinned: true }] },
    unread: { AND: [visible, live(now), { reads: { none: { memberId: me } } }, { acknowledgments: { none: { memberId: me } } }] },
    acknowledge: { AND: [visible, live(now), { requiresAcknowledgment: true }, { acknowledgments: { none: { memberId: me } } }] },
    history: { AND: [visible, { status: { in: ["PUBLISHED", "EXPIRED"] } }] },
    manage: { AND: [{ companyId: context.companyId }, managedWhere(context), query.status ? { status: query.status } : {}] },
  };
  const term = query.q ? { contains: query.q, mode: "insensitive" as const } : null;
  const where: Prisma.AnnouncementWhereInput = {
    AND: [
      tabWhere[query.tab],
      query.priority ? { priority: query.priority } : {},
      query.audienceType ? { audienceType: query.audienceType } : {},
      query.projectId ? { projectId: query.projectId } : {},
      query.departmentId ? { departmentId: query.departmentId } : {},
      term ? { OR: [{ title: term }, { body: term }] } : {},
    ],
  };
  const orderBy: Prisma.AnnouncementOrderByWithRelationInput[] = query.tab === "manage" ? [{ updatedAt: "desc" }] : query.tab === "history" ? [{ publishedAt: "desc" }] : [{ pinned: "desc" }, { publishedAt: "desc" }];
  const offset = query.cursor ? Number(query.cursor) : 0;
  const [rows, unread, acknowledge] = await Promise.all([
    prisma.announcement.findMany({ where, orderBy: [...orderBy, { id: "desc" }], skip: offset, take: query.limit + 1, select: ROW_SELECT }),
    prisma.announcement.count({ where: tabWhere.unread }),
    prisma.announcement.count({ where: tabWhere.acknowledge }),
  ]);
  const page = rows.slice(0, query.limit);
  const cards = await toCards(context, page);
  return { items: cards, nextCursor: rows.length > query.limit ? String(offset + query.limit) : null, counts: { unread, acknowledge } };
}

export async function getAnnouncement(context: UserContext, announcementId: string): Promise<AnnouncementDetailDTO> {
  const row = await findReadableAnnouncement(context, announcementId);
  const [card] = await toCards(context, [row]);
  const [acknowledgedCount, selected] = await Promise.all([
    prisma.announcementAcknowledgment.count({ where: { announcementId: row.id } }),
    row.managed && row.audienceType === "SELECTED_MEMBERS" ? prisma.announcementAudienceMember.findMany({ where: { announcementId: row.id }, select: { memberId: true } }) : Promise.resolve(null),
  ]);
  const people = selected?.length ? await prisma.companyMember.findMany({ where: { companyId: context.companyId, id: { in: selected.map((entry) => entry.memberId) } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }) : [];
  let documents: AnnouncementDetailDTO["documents"] = null;
  if (canAccessModule(context, "documents") && can(context, "document.view")) {
    const { data } = await listDocuments(context, documentListQuerySchema.parse({ entityType: RECORD, entityId: row.id, limit: 50 })).catch(() => ({ data: [] }));
    documents = data.map((document) => ({ documentId: document.id, name: document.name, extension: document.extension, size: document.sizeBytes === null || document.sizeBytes === undefined ? null : Number(document.sizeBytes), href: `/documents/${document.id}`, previewable: document.storageStatus === "AVAILABLE" }));
  }
  return {
    ...card,
    body: row.body,
    version: row.version,
    selectedMembers: selected ? people.map((person) => ({ memberId: person.id, name: `${person.user.firstName} ${person.user.lastName}` })) : null,
    documents,
    capabilities: capabilitiesFor(context, row, acknowledgedCount, Boolean(card.acknowledgedAt)),
  };
}

/* -------------------------------------------------------------------------- */
/* Read and acknowledge                                                        */
/* -------------------------------------------------------------------------- */

/** Recorded when the detail has loaded, never from a card in a list (§212, §213). Idempotent. */
export async function markRead(context: UserContext, announcementId: string): Promise<{ readAt: string }> {
  const row = await findReadableAnnouncement(context, announcementId);
  const now = new Date();
  if (row.status !== "PUBLISHED" && row.status !== "EXPIRED") return { readAt: now.toISOString() };
  await prisma.announcementRead.upsert({
    where: { announcementId_memberId: { announcementId: row.id, memberId: context.membershipId } },
    create: { announcementId: row.id, memberId: context.membershipId, firstReadAt: now, lastReadAt: now },
    update: { lastReadAt: now },
  });
  return { readAt: now.toISOString() };
}

/** "I have read this" — for the member asking, and only while the announcement is live (§159, §214, §299). */
export async function acknowledgeAnnouncement(context: UserContext, announcementId: string): Promise<{ acknowledgedAt: string }> {
  assertPermission(context, "announcement.acknowledge");
  const row = await findReadableAnnouncement(context, announcementId);
  const now = new Date();
  if (!row.requiresAcknowledgment) throw fail("ANNOUNCEMENT_ACK_NOT_REQUIRED", "This announcement does not ask for acknowledgment.", "CONFLICT");
  if (row.status !== "PUBLISHED" || (row.expiresAt && row.expiresAt <= now)) throw fail("ANNOUNCEMENT_NOT_LIVE", "This announcement is no longer current.", "CONFLICT");
  // The member must be in the audience itself, not only a manager who can see it (§307).
  const inAudience = await prisma.announcement.count({ where: { AND: [{ id: row.id, companyId: context.companyId }, audienceWhere(context)] } });
  if (!inAudience) throw new AccessError("FORBIDDEN", "This announcement is not addressed to you.", { code: "ANNOUNCEMENT_NOT_IN_AUDIENCE" });
  const acknowledgment = await prisma.$transaction(async (tx) => {
    await tx.announcementRead.upsert({
      where: { announcementId_memberId: { announcementId: row.id, memberId: context.membershipId } },
      create: { announcementId: row.id, memberId: context.membershipId, firstReadAt: now, lastReadAt: now },
      update: { lastReadAt: now },
    });
    const existing = await tx.announcementAcknowledgment.findUnique({ where: { announcementId_memberId: { announcementId: row.id, memberId: context.membershipId } }, select: { acknowledgedAt: true } });
    if (existing) return existing;
    return tx.announcementAcknowledgment.create({ data: { announcementId: row.id, memberId: context.membershipId, acknowledgedAt: now }, select: { acknowledgedAt: true } });
  });
  // Their own copy only: everybody else still owes an acknowledgment. A
  // dismissed item closes too — they have now done the thing it asked for.
  await resolveAttentionFor(prisma, { companyId: context.companyId, entityType: RECORD, entityId: row.id, recipientMemberId: context.membershipId, conditionKeys: ["ANNOUNCEMENT_ACK_REQUIRED"], includeDismissed: true });
  return { acknowledgedAt: acknowledgment.acknowledgedAt.toISOString() };
}

/* -------------------------------------------------------------------------- */
/* Metrics and acknowledgments                                                 */
/* -------------------------------------------------------------------------- */

async function audienceFor(row: AnnouncementRow): Promise<string[]> {
  if (row.requiresAcknowledgment) {
    const targets = await prisma.announcementTarget.findMany({ where: { announcementId: row.id }, select: { memberId: true } });
    if (targets.length) return targets.map((target) => target.memberId);
  }
  return audienceMemberIds(prisma, row);
}

/** Counts for the author and the audience's managers; never a ranking of people (§48, §131-§134, §260). */
/**
 * A draft has gone to nobody, so it has no audience to measure (PRD #45 §57,
 * PRD #47 §175): the same rule as `canViewMetrics`, enforced where the figures
 * are read rather than only on the button. Otherwise a draft's "audience" is a
 * live headcount of whoever it would reach.
 */
function assertMeasurable(row: { status: AnnouncementRow["status"] }) {
  if (row.status === "DRAFT") throw fail("ANNOUNCEMENT_NOT_PUBLISHED", "A draft has no readers yet.", "CONFLICT");
}

export async function announcementMetrics(context: UserContext, announcementId: string): Promise<AnnouncementMetricsDTO> {
  const row = await findManageableAnnouncement(context, announcementId);
  assertMeasurable(row);
  const audience = await audienceFor(row);
  const [read, acknowledged] = await Promise.all([
    prisma.announcementRead.count({ where: { announcementId: row.id, memberId: { in: audience } } }),
    prisma.announcementAcknowledgment.count({ where: { announcementId: row.id, memberId: { in: audience } } }),
  ]);
  return {
    audience: audience.length,
    read,
    acknowledged,
    pending: row.requiresAcknowledgment ? audience.length - acknowledged : 0,
    readRate: audience.length ? Math.round((read / audience.length) * 100) : null,
    acknowledgmentRate: row.requiresAcknowledgment && audience.length ? Math.round((acknowledged / audience.length) * 100) : null,
    requiresAcknowledgment: row.requiresAcknowledgment,
  };
}

export async function acknowledgmentList(context: UserContext, announcementId: string): Promise<AcknowledgmentRowDTO[]> {
  const row = await findManageableAnnouncement(context, announcementId);
  assertMeasurable(row);
  const audience = await audienceFor(row);
  const [people, reads, acks] = await Promise.all([
    prisma.companyMember.findMany({ where: { companyId: context.companyId, id: { in: audience } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }),
    prisma.announcementRead.findMany({ where: { announcementId: row.id, memberId: { in: audience } }, select: { memberId: true, firstReadAt: true } }),
    prisma.announcementAcknowledgment.findMany({ where: { announcementId: row.id, memberId: { in: audience } }, select: { memberId: true, acknowledgedAt: true } }),
  ]);
  const readAt = new Map(reads.map((entry) => [entry.memberId, entry.firstReadAt.toISOString()]));
  const ackAt = new Map(acks.map((entry) => [entry.memberId, entry.acknowledgedAt.toISOString()]));
  return people
    .map((person) => ({ memberId: person.id, name: `${person.user.firstName} ${person.user.lastName}`, readAt: readAt.get(person.id) ?? null, acknowledgedAt: ackAt.get(person.id) ?? null }))
    .sort((a, b) => Number(Boolean(a.acknowledgedAt)) - Number(Boolean(b.acknowledgedAt)) || a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------------- */
/* Shell, dashboard                                                            */
/* -------------------------------------------------------------------------- */

export type AnnouncementShellState = { unread: number; banner: { id: string; title: string; requiresAcknowledgment: boolean; href: string } | null };

/**
 * What the app shell shows: how many live announcements this member has not
 * opened, and the one critical announcement still waiting on them — never a
 * stack of banners (§67, §68, §121, §122).
 */
export async function announcementShellState(context: UserContext): Promise<AnnouncementShellState> {
  if (!announcementsOpen(context)) return { unread: 0, banner: null };
  const now = new Date();
  const me = context.membershipId;
  const visible = { companyId: context.companyId, AND: [audienceWhere(context), live(now)] };
  const [unread, critical] = await Promise.all([
    prisma.announcement.count({ where: { ...visible, reads: { none: { memberId: me } }, acknowledgments: { none: { memberId: me } } } }),
    prisma.announcement.findFirst({
      where: { ...visible, priority: "CRITICAL", OR: [{ requiresAcknowledgment: true, acknowledgments: { none: { memberId: me } } }, { requiresAcknowledgment: false, reads: { none: { memberId: me } } }] },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true, requiresAcknowledgment: true },
    }),
  ]);
  return { unread, banner: critical ? { ...critical, href: `/announcements/${critical.id}` } : null };
}

/** Pinned, critical and the latest unread, for the dashboard (§65, §66, §118). */
export async function dashboardAnnouncements(context: UserContext, limit = 5): Promise<AnnouncementCardDTO[]> {
  if (!announcementsOpen(context) || !(await resolveProductivitySettings(context.companyId)).announcementsEnabled) return [];
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: { companyId: context.companyId, AND: [audienceWhere(context), live(now)] },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: 30,
    select: ROW_SELECT,
  });
  const cards = await toCards(context, rows);
  const weight = (card: AnnouncementCardDTO) => (card.priority === "CRITICAL" && !card.acknowledgedAt ? 0 : card.pinned ? 1 : !card.read ? 2 : 3);
  return cards.sort((a, b) => weight(a) - weight(b) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, limit);
}

export async function resolveAnnouncementAttentionFor(companyId: string, announcementId: string) {
  await resolveAttentionForRecord(prisma, companyId, RECORD, announcementId, ["ANNOUNCEMENT_ACK_REQUIRED"]);
}

/* -------------------------------------------------------------------------- */
/* Editor options                                                              */
/* -------------------------------------------------------------------------- */

export type AnnouncementOptionsDTO = {
  audiences: AudienceType[];
  projects: Array<{ id: string; label: string }>;
  departments: Array<{ id: string; label: string }>;
  members: Array<{ id: string; label: string }>;
  canPin: boolean;
  canPublish: boolean;
};

/** Only what this author could address: the server refuses anything else anyway (§35, §36). */
export async function announcementOptions(context: UserContext): Promise<AnnouncementOptionsDTO> {
  assertModule(context, MODULE);
  const audiences = (["COMPANY", "DEPARTMENT", "PROJECT", "SELECTED_MEMBERS"] as const).filter((type) => canAddress(context, type));
  const door = projectDoor(context);
  const [projects, departments, members] = await Promise.all([
    audiences.includes("PROJECT") && door ? prisma.project.findMany({ where: { AND: [door, { archivedAt: null, status: { in: ["ACTIVE", "PENDING"] } }] }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, code: true } }) : [],
    audiences.includes("DEPARTMENT") ? prisma.department.findMany({ where: { companyId: context.companyId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    audiences.includes("SELECTED_MEMBERS") ? prisma.companyMember.findMany({ where: { companyId: context.companyId, status: "ACTIVE" }, orderBy: [{ user: { firstName: "asc" } }], take: 500, select: { id: true, user: { select: { firstName: true, lastName: true } } } }) : [],
  ]);
  return {
    audiences,
    projects: projects.map((project) => ({ id: project.id, label: `${project.code} · ${project.name}` })),
    departments: departments.map((department) => ({ id: department.id, label: department.name })),
    members: members.map((member) => ({ id: member.id, label: `${member.user.firstName} ${member.user.lastName}` })),
    canPin: can(context, "announcement.pin"),
    canPublish: can(context, "announcement.publish"),
  };
}
