import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { dateString, loadMemberRef, loadMembers, toProjectRef } from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import { buildHseMemberWhere, buildHseProjectWhere, buildToolboxScopeWhere } from "../hse.scope";
import type { ToolboxInput, ToolboxListQuery } from "../hse.schema";
import {
  isToolboxCancellable,
  isToolboxCompletable,
  isToolboxEditable,
} from "../hse.status";
import type { ToolboxDetailDTO, ToolboxParticipantDTO, ToolboxSummaryDTO } from "../hse.types";

/**
 * Toolbox talks (PRD #22 §129–§139).
 *
 * A short safety briefing and who was there. Two things this is not.
 *
 * **Not a training record** (PRD #22 §139). No course, no progress, no
 * certification, no compliance percentage. A toolbox talk is a note that a
 * subject was covered with a group of people on a date.
 *
 * **Not employees-only** (PRD #22 §133). Subcontractors attend toolbox talks,
 * so a participant is either a company member or a name. A talk that could only
 * record employees would record half the people who were actually briefed.
 *
 * Signature is a boolean, never a captured image (PRD #22 §135): the paper
 * sheet is filed through Documents.
 */

const MODULE = "hse" as const;
const ENTITY = "ToolboxTalk";

const LIST_SELECT = {
  id: true,
  talkNumber: true,
  title: true,
  topic: true,
  status: true,
  conductedByMemberId: true,
  talkDate: true,
  locationText: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  participants: { select: { attendanceStatus: true } },
} satisfies Prisma.ToolboxTalkSelect;

const DETAIL_SELECT = {
  id: true,
  talkNumber: true,
  title: true,
  topic: true,
  status: true,
  conductedByMemberId: true,
  talkDate: true,
  locationText: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  notes: true,
  completedAt: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
  participants: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      companyMemberId: true,
      externalName: true,
      attendanceStatus: true,
      signatureRecorded: true,
    },
  },
} satisfies Prisma.ToolboxTalkSelect;

type ListRow = Prisma.ToolboxTalkGetPayload<{ select: typeof LIST_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listToolboxTalks(context: UserContext, query: ToolboxListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.toolbox.view");

  const filters: Prisma.ToolboxTalkWhereInput[] = [buildToolboxScopeWhere(context)];

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.projectId) filters.push({ projectId: query.projectId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { talkNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { topic: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.ToolboxTalkWhereInput = { AND: filters };

  const orderBy: Prisma.ToolboxTalkOrderByWithRelationInput[] =
    query.sort === "date-desc"
      ? [{ talkDate: "desc" }]
      : query.sort === "number-asc"
        ? [{ talkNumber: "asc" }]
        : [{ updatedAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.toolboxTalk.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.toolboxTalk.count({ where }),
  ]);

  const members = await loadMembers(rows.map((row) => row.conductedByMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getToolboxTalk(
  context: UserContext,
  talkId: string,
): Promise<ToolboxDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.toolbox.view");

  const row = assertFound(
    await prisma.toolboxTalk.findFirst({
      where: { AND: [buildToolboxScopeWhere(context), { id: talkId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy] = await Promise.all([
    loadMembers([
      row.conductedByMemberId,
      ...row.participants.map((participant) => participant.companyMemberId),
    ]),
    loadMemberRef(row.createdByMemberId),
  ]);

  const participants: ToolboxParticipantDTO[] = row.participants.map((participant) => ({
    id: participant.id,
    member: participant.companyMemberId
      ? (members.get(participant.companyMemberId) ?? null)
      : null,
    externalName: participant.externalName,
    attendanceStatus: participant.attendanceStatus,
    signatureRecorded: participant.signatureRecorded,
  }));

  return {
    ...toSummaryDTO(
      { ...row, participants: row.participants.map((p) => ({ attendanceStatus: p.attendanceStatus })) },
      members,
    ),
    notes: row.notes,
    participants,
    completedAt: dateString(row.completedAt),
    cancelledAt: dateString(row.cancelledAt),
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: {
      canEdit: isToolboxEditable(row.status) && can(context, "hse.toolbox.update"),
      canComplete: isToolboxCompletable(row.status) && can(context, "hse.toolbox.complete"),
      canCancel: isToolboxCancellable(row.status) && can(context, "hse.toolbox.cancel"),
      canViewDocuments: can(context, "hse.document.view") && can(context, "document.view"),
      canViewActivity: can(context, "hse.activity.view"),
    },
  };
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<ToolboxSummaryDTO[]> {
  if (!can(context, "hse.toolbox.view")) return [];

  const rows = await prisma.toolboxTalk.findMany({
    where: { AND: [buildToolboxScopeWhere(context), { projectId }] },
    orderBy: [{ talkDate: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.conductedByMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function toolboxFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.toolbox.view");

  const scope = buildToolboxScopeWhere(context);

  const projects = await prisma.project.findMany({
    where: { AND: [buildHseProjectWhere(context), { toolboxTalks: { some: scope } }] },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { projects };
}

export async function toolboxFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: buildHseProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: buildHseMemberWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, members };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createToolboxTalk(
  context: UserContext,
  input: ToolboxInput,
): Promise<ToolboxDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.toolbox.create");

  if (input.projectId) await requireProject(context, input.projectId);
  await requireMember(context, input.conductedByMemberId);
  await assertParticipantsAreMembers(context, input.participants);

  const id = await prisma.$transaction(async (tx) => {
    const talkNumber = await nextHseNumber(tx, "toolboxTalk", context.companyId);

    const talk = await tx.toolboxTalk.create({
      data: {
        companyId: context.companyId,
        talkNumber,
        title: input.title,
        topic: input.topic,
        projectId: input.projectId ?? null,
        talkDate: input.talkDate,
        locationText: input.locationText ?? null,
        conductedByMemberId: input.conductedByMemberId,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        participants: { create: input.participants.map(toParticipantData) },
      },
      select: { id: true, talkNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: talk.id,
      action: "HSE_TOOLBOX_CREATED",
      message: `recorded toolbox talk ${talk.talkNumber}`,
    });

    return talk.id;
  });

  return getToolboxTalk(context, id);
}

export async function updateToolboxTalk(
  context: UserContext,
  talkId: string,
  input: ToolboxInput,
): Promise<ToolboxDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.toolbox.update");

  const existing = await requireTalk(context, talkId);

  if (!isToolboxEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A completed toolbox talk cannot be edited.", {
      code: "TALK_COMPLETED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  if (input.projectId) await requireProject(context, input.projectId);
  await requireMember(context, input.conductedByMemberId);
  await assertParticipantsAreMembers(context, input.participants);

  await prisma.$transaction(async (tx) => {
    await tx.toolboxTalkParticipant.deleteMany({ where: { toolboxTalkId: talkId } });
    await tx.toolboxTalk.update({
      where: { id: talkId },
      data: {
        title: input.title,
        topic: input.topic,
        projectId: input.projectId ?? null,
        talkDate: input.talkDate,
        locationText: input.locationText ?? null,
        conductedByMemberId: input.conductedByMemberId,
        notes: input.notes ?? null,
        updatedByMemberId: context.membershipId,
        participants: { create: input.participants.map(toParticipantData) },
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: talkId,
      action: "HSE_TOOLBOX_CREATED",
      message: `updated toolbox talk ${existing.talkNumber}`,
    });
  });

  return getToolboxTalk(context, talkId);
}

export async function completeToolboxTalk(
  context: UserContext,
  talkId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.toolbox.complete");

  const existing = assertFound(
    await prisma.toolboxTalk.findFirst({
      where: { AND: [buildToolboxScopeWhere(context), { id: talkId }] },
      select: {
        id: true,
        talkNumber: true,
        status: true,
        _count: { select: { participants: true } },
      },
    }),
  );

  if (!isToolboxCompletable(existing.status)) {
    throw new AccessError("CONFLICT", "This toolbox talk is already finished.", {
      code: "NOT_DRAFT",
    });
  }

  if (existing._count.participants === 0) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Record who attended before completing the talk.",
      { code: "NO_PARTICIPANTS" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.toolboxTalk.update({
      where: { id: talkId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: talkId,
      action: "HSE_TOOLBOX_COMPLETED",
      message: `completed toolbox talk ${existing.talkNumber}`,
    });
  });
}

export async function cancelToolboxTalk(
  context: UserContext,
  talkId: string,
  reason: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.toolbox.cancel");

  const existing = await requireTalk(context, talkId);

  if (!isToolboxCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This toolbox talk is already cancelled.", {
      code: "NOT_CANCELLABLE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.toolboxTalk.update({
      where: { id: talkId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: talkId,
      action: "HSE_TOOLBOX_CANCELLED",
      message: `cancelled toolbox talk ${existing.talkNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function toParticipantData(participant: ToolboxInput["participants"][number]) {
  return {
    companyMemberId: participant.companyMemberId ?? null,
    externalName: participant.externalName ?? null,
    attendanceStatus: participant.attendanceStatus,
    signatureRecorded: participant.signatureRecorded,
  };
}

async function requireTalk(context: UserContext, talkId: string) {
  return assertFound(
    await prisma.toolboxTalk.findFirst({
      where: { AND: [buildToolboxScopeWhere(context), { id: talkId }] },
      select: { id: true, talkNumber: true, status: true, updatedAt: true },
    }),
  );
}

async function requireProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildHseProjectWhere(context), { id: projectId }] },
    select: { id: true },
  });

  if (!project) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
      code: "INVALID_PROJECT",
    });
  }

  return project;
}

async function requireMember(context: UserContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildHseMemberWhere(context), { id: memberId }] },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That person is not an active member.", {
      code: "INVALID_MEMBER",
    });
  }

  return member;
}

/**
 * Every named colleague really is one (PRD #22 §132).
 *
 * Checked in a single query rather than one per participant: a talk with thirty
 * people on it would otherwise fire thirty round-trips before it saved.
 */
async function assertParticipantsAreMembers(
  context: UserContext,
  participants: ToolboxInput["participants"],
): Promise<void> {
  const ids = [
    ...new Set(
      participants
        .map((participant) => participant.companyMemberId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ids.length === 0) return;

  const found = await prisma.companyMember.count({
    where: { companyId: context.companyId, id: { in: ids } },
  });

  if (found !== ids.length) {
    throw new AccessError("VALIDATION_ERROR", "One of those people is not a member.", {
      code: "INVALID_MEMBER",
    });
  }
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this talk while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): ToolboxSummaryDTO {
  return {
    id: row.id,
    talkNumber: row.talkNumber,
    title: row.title,
    topic: row.topic,
    status: row.status,
    project: toProjectRef(row.project),
    conductedBy: members.get(row.conductedByMemberId) ?? null,
    talkDate: row.talkDate.toISOString(),
    locationText: row.locationText,
    attendedCount: row.participants.filter((p) => p.attendanceStatus === "ATTENDED").length,
    participantCount: row.participants.length,
    updatedAt: row.updatedAt.toISOString(),
  };
}
