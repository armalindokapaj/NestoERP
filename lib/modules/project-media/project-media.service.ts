import { Prisma, type ProjectMediaType } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere, canAttachToDocumentParent } from "@/lib/modules/documents/document.parent-access";
import { readAuthorizedDocumentThumbnail, type Thumbnail } from "@/lib/modules/documents/storage/thumbnail.service";
import * as projects from "@/lib/modules/projects/project.repository";
import { recordActivity } from "@/lib/modules/shared/activity";
import type { CreateProjectMediaInput, UpdateProjectMediaInput } from "./project-media.schema";
import type { ProjectMediaCollection, ProjectMediaDTO } from "./project-media.types";

const MODULE = "projects" as const;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const MEDIA_SELECT = {
  id: true,
  type: true,
  title: true,
  description: true,
  durationSeconds: true,
  sortOrder: true,
  isCover: true,
  isFeatured: true,
  thumbnailDocumentId: true,
  createdAt: true,
  document: {
    select: {
      id: true,
      name: true,
      mimeType: true,
      detectedMimeType: true,
      status: true,
      storageStatus: true,
      storageKey: true,
      thumbnailStorageKey: true,
      updatedAt: true,
      originalFileName: true,
    },
  },
  thumbnailDocument: {
    select: {
      id: true,
      mimeType: true,
      detectedMimeType: true,
      status: true,
      storageStatus: true,
      storageKey: true,
      thumbnailStorageKey: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ProjectMediaSelect;

type MediaRow = Prisma.ProjectMediaGetPayload<{ select: typeof MEDIA_SELECT }>;

function mimeOf(document: { detectedMimeType: string | null; mimeType: string | null }): string {
  return (document.detectedMimeType ?? document.mimeType ?? "").toLowerCase();
}

function assertTypeMatches(type: ProjectMediaType, document: { detectedMimeType: string | null; mimeType: string | null }) {
  const mime = mimeOf(document);
  const valid = type === "RENDER" ? IMAGE_MIME.has(mime) : VIDEO_MIME.has(mime);
  if (!valid) {
    throw new AccessError(
      "VALIDATION_ERROR",
      type === "RENDER" ? "A project render must be a JPEG, PNG or WebP image." : "A project animation must be an MP4, WebM or QuickTime video.",
      { documentId: ["The file type does not match the selected media type."] },
    );
  }
}

async function projectInScope(context: UserContext, projectId: string) {
  assertModule(context, MODULE);
  assertPermission(context, "project.view");
  return assertFound(await projects.findProjectInScope(context, projectId));
}

function toDTO(projectId: string, row: MediaRow): ProjectMediaDTO {
  const poster = row.type === "RENDER" || row.thumbnailDocumentId !== null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    durationSeconds: row.durationSeconds,
    sortOrder: row.sortOrder,
    isCover: row.isCover,
    isFeatured: row.isFeatured,
    thumbnailDocumentId: row.thumbnailDocumentId,
    document: { id: row.document.id, name: row.document.name, mimeType: mimeOf(row.document) || null },
    thumbnailUrl: poster ? `/api/projects/${projectId}/media/${row.id}/thumbnail` : null,
    contentUrl: `/api/projects/${projectId}/media/${row.id}/content`,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProjectMedia(context: UserContext, projectId: string): Promise<ProjectMediaCollection> {
  await projectInScope(context, projectId);
  const canView = can(context, "project.media.view");
  if (!canView) return { renders: [], animations: [], counts: { renders: 0, animations: 0 }, cover: null, capabilities: { canView: false, canManage: false, canUpload: false } };

  const rows = await prisma.projectMedia.findMany({
    where: {
      companyId: context.companyId,
      projectId,
      visibility: "PROJECT",
      document: { status: "ACTIVE", storageStatus: "AVAILABLE" },
    },
    orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: MEDIA_SELECT,
  });
  const items = rows.map((row) => toDTO(projectId, row));
  const renders = items.filter((item) => item.type === "RENDER");
  const animations = items.filter((item) => item.type === "ANIMATION");
  const canManage = can(context, "project.media.manage");
  const canUpload = canManage && canAccessModule(context, "documents") && can(context, "document.create")
    && await canAttachToDocumentParent(context, { projectId, clientId: null, module: null, entityType: null, entityId: null });
  return {
    renders,
    animations,
    counts: { renders: renders.length, animations: animations.length },
    cover: renders.find((item) => item.isCover) ?? null,
    capabilities: { canView, canManage, canUpload },
  };
}

async function eligibleDocument(context: UserContext, projectId: string, documentId: string) {
  if (!canAccessModule(context, "documents") || !can(context, "document.view") || !can(context, "document.download")) {
    throw new AccessError("FORBIDDEN", "You cannot use that project file.");
  }
  const access = await buildDocumentAccessWhere(context);
  const document = await prisma.document.findFirst({
    where: { AND: [access, { id: documentId, companyId: context.companyId, projectId, entityType: null, status: "ACTIVE", storageStatus: "AVAILABLE" }] },
    select: { id: true, name: true, mimeType: true, detectedMimeType: true },
  });
  if (!document) throw new AccessError("VALIDATION_ERROR", "Choose an available file from this project.", { documentId: ["Choose an available file from this project."] });
  return document;
}

async function eligiblePoster(context: UserContext, projectId: string, documentId: string | null | undefined) {
  if (!documentId) return null;
  const document = await eligibleDocument(context, projectId, documentId);
  if (!IMAGE_MIME.has(mimeOf(document))) throw new AccessError("VALIDATION_ERROR", "An animation poster must be a JPEG, PNG or WebP image.", { thumbnailDocumentId: ["Choose an image."] });
  return document.id;
}

async function mediaEvidence(
  tx: Prisma.TransactionClient,
  context: UserContext,
  project: { id: string; name: string },
  input: { action: string; message: string; before?: Record<string, unknown>; after?: Record<string, unknown> },
) {
  await recordActivity(tx, context, { module: MODULE, entityType: "Project", entityId: project.id, action: input.action, message: input.message, metadata: { projectId: project.id } });
  await recordUserAction(context, {
    actionKey: AuditAction.PROJECT_MEDIA_CHANGED,
    entity: { type: "Project", id: project.id, label: project.name },
    projectId: project.id,
    before: input.before,
    after: input.after,
  }, { tx });
}

export async function addProjectMedia(context: UserContext, projectId: string, input: CreateProjectMediaInput) {
  const project = await projectInScope(context, projectId);
  assertPermission(context, "project.media.manage");
  const document = await eligibleDocument(context, projectId, input.documentId);
  assertTypeMatches(input.type, document);
  const mediaTitle = input.title ?? document.name;
  if (input.isCover && input.type !== "RENDER") throw new AccessError("VALIDATION_ERROR", "Only a render can be the project cover.");
  const thumbnailDocumentId = await eligiblePoster(context, projectId, input.thumbnailDocumentId);

  try {
    return await prisma.$transaction(async (tx) => {
      const last = await tx.projectMedia.aggregate({ where: { companyId: context.companyId, projectId, type: input.type }, _max: { sortOrder: true } });
      if (input.isCover) await tx.projectMedia.updateMany({ where: { companyId: context.companyId, projectId, isCover: true }, data: { isCover: false } });
      const media = await tx.projectMedia.create({
        data: {
          companyId: context.companyId,
          projectId,
          documentId: document.id,
          type: input.type,
          title: mediaTitle,
          description: input.description,
          thumbnailDocumentId,
          durationSeconds: input.type === "ANIMATION" ? input.durationSeconds : null,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
          isCover: input.isCover,
          isFeatured: input.isFeatured,
          createdByMemberId: context.membershipId,
        },
        select: { id: true },
      });
      if (input.isCover) await tx.project.updateMany({ where: { id: projectId, companyId: context.companyId }, data: { coverImageDocumentId: document.id, updatedBy: context.userId } });
      await mediaEvidence(tx, context, project, { action: "PROJECT_MEDIA_ADDED", message: `added “${mediaTitle}” to project media`, after: { change: "added", mediaId: media.id, documentId: document.id, type: input.type, title: mediaTitle, isCover: input.isCover, isFeatured: input.isFeatured } });
      return media;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AccessError("CONFLICT", "That file is already in project media.");
    throw error;
  }
}

async function findMedia(context: UserContext, projectId: string, mediaId: string) {
  await projectInScope(context, projectId);
  return assertFound(await prisma.projectMedia.findFirst({
    where: { id: mediaId, projectId, companyId: context.companyId },
    select: { ...MEDIA_SELECT, project: { select: { id: true, name: true } } },
  }));
}

export async function updateProjectMedia(context: UserContext, projectId: string, mediaId: string, input: UpdateProjectMediaInput) {
  const media = await findMedia(context, projectId, mediaId);
  assertPermission(context, "project.media.manage");
  const nextType = input.type ?? media.type;
  assertTypeMatches(nextType, media.document);
  const nextCover = input.isCover ?? media.isCover;
  if (nextCover && nextType !== "RENDER") throw new AccessError("VALIDATION_ERROR", "Only a render can be the project cover.");
  const thumbnailDocumentId = input.thumbnailDocumentId === undefined ? undefined : await eligiblePoster(context, projectId, input.thumbnailDocumentId);

  await prisma.$transaction(async (tx) => {
    if (input.isCover === true) await tx.projectMedia.updateMany({ where: { companyId: context.companyId, projectId, isCover: true, id: { not: media.id } }, data: { isCover: false } });
    const changed = await tx.projectMedia.updateMany({
      where: { id: media.id, companyId: context.companyId, projectId },
      data: {
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(thumbnailDocumentId === undefined ? {} : { thumbnailDocumentId }),
        ...(input.durationSeconds === undefined ? {} : { durationSeconds: nextType === "ANIMATION" ? input.durationSeconds : null }),
        ...(input.isCover === undefined ? {} : { isCover: input.isCover }),
        ...(input.isFeatured === undefined ? {} : { isFeatured: input.isFeatured }),
      },
    });
    if (changed.count !== 1) throw new AccessError("NOT_FOUND");
    if (input.isCover === true) await tx.project.updateMany({ where: { id: projectId, companyId: context.companyId }, data: { coverImageDocumentId: media.document.id, updatedBy: context.userId } });
    if (input.isCover === false && media.isCover) await tx.project.updateMany({ where: { id: projectId, coverImageDocumentId: media.document.id }, data: { coverImageDocumentId: null, updatedBy: context.userId } });
    await mediaEvidence(tx, context, media.project, { action: "PROJECT_MEDIA_UPDATED", message: `updated project media “${input.title ?? media.title}”`, before: { mediaId: media.id, type: media.type, title: media.title, isCover: media.isCover, isFeatured: media.isFeatured }, after: { mediaId: media.id, type: nextType, title: input.title ?? media.title, isCover: nextCover, isFeatured: input.isFeatured ?? media.isFeatured } });
  });
}

export async function removeProjectMedia(context: UserContext, projectId: string, mediaId: string) {
  const media = await findMedia(context, projectId, mediaId);
  assertPermission(context, "project.media.manage");
  await prisma.$transaction(async (tx) => {
    const removed = await tx.projectMedia.deleteMany({ where: { id: media.id, companyId: context.companyId, projectId } });
    if (removed.count !== 1) throw new AccessError("NOT_FOUND");
    if (media.isCover) await tx.project.updateMany({ where: { id: projectId, coverImageDocumentId: media.document.id }, data: { coverImageDocumentId: null, updatedBy: context.userId } });
    await mediaEvidence(tx, context, media.project, { action: "PROJECT_MEDIA_REMOVED", message: `removed “${media.title}” from project media`, before: { change: "removed", mediaId: media.id, documentId: media.document.id, type: media.type, title: media.title, isCover: media.isCover } });
  });
}

export async function reorderProjectMedia(context: UserContext, projectId: string, ids: string[]) {
  const project = await projectInScope(context, projectId);
  assertPermission(context, "project.media.manage");
  const rows = await prisma.projectMedia.findMany({ where: { companyId: context.companyId, projectId }, select: { id: true } });
  const existing = new Set(rows.map((row) => row.id));
  if (ids.length !== existing.size || ids.some((id) => !existing.has(id))) throw new AccessError("VALIDATION_ERROR", "The order must include every media item once.");
  await prisma.$transaction(async (tx) => {
    const changed = await Promise.all(ids.map((id, sortOrder) => tx.projectMedia.updateMany({ where: { id, companyId: context.companyId, projectId }, data: { sortOrder } })));
    if (changed.some((result) => result.count !== 1)) throw new AccessError("NOT_FOUND");
    await mediaEvidence(tx, context, project, { action: "PROJECT_MEDIA_REORDERED", message: "reordered project media", after: { change: "reordered", order: ids } });
  });
}

async function readableMedia(context: UserContext, projectId: string, mediaId: string) {
  const media = await findMedia(context, projectId, mediaId);
  assertPermission(context, "project.media.view");
  if (media.document.status !== "ACTIVE" || media.document.storageStatus !== "AVAILABLE" || !media.document.storageKey) throw new AccessError("NOT_FOUND");
  return media;
}

export async function readProjectMediaThumbnail(context: UserContext, projectId: string, mediaId: string): Promise<Thumbnail> {
  const media = await readableMedia(context, projectId, mediaId);
  const document = media.type === "ANIMATION" ? media.thumbnailDocument : media.document;
  if (!document || document.status !== "ACTIVE" || document.storageStatus !== "AVAILABLE" || !document.storageKey) throw new AccessError("NOT_FOUND");
  return readAuthorizedDocumentThumbnail(context.companyId, document);
}

export async function projectMediaContentGrant(context: UserContext, projectId: string, mediaId: string) {
  const media = await readableMedia(context, projectId, mediaId);
  return storageProvider().createDownloadUrl({
    storageKey: media.document.storageKey!,
    expiresInSeconds: 5 * 60,
    disposition: "inline",
    fileName: media.document.originalFileName ?? media.document.name,
    contentType: mimeOf(media.document) || "application/octet-stream",
  });
}
