import { Prisma } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import type { PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { defaultProject3DExperience } from "@/lib/3d/shared/experience";
import { readAuthorizedDocumentThumbnail, type Thumbnail } from "@/lib/modules/documents/storage/thumbnail.service";
import { project3DAuditMetadata } from "./project-3d.audit";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";
import type { Project3DEntitlementUpdate, Project3DExperienceCreate, Project3DExperienceListQuery, Project3DExperienceMetadata } from "./project-3d.schema";

const EMPTY_EXPERIENCE = defaultProject3DExperience() as unknown as Prisma.InputJsonObject;

function modelReadiness(slots: Array<{ versions: Array<{ status: string; validationStatus: string; runtimeStorageKey: string | null }> }>): "READY" | "PROCESSING" | "NEEDS_MODEL" | "FAILED" {
  const versions = slots.flatMap((slot) => slot.versions);
  if (versions.some((version) => version.status === "FAILED" || version.validationStatus === "BLOCKED")) return "FAILED";
  if (versions.some((version) => ["UPLOADED", "PROCESSING"].includes(version.status))) return "PROCESSING";
  if (slots.length > 0 && slots.every((slot) => slot.versions.some((version) => ["READY", "PUBLISHED"].includes(version.status) && Boolean(version.runtimeStorageKey)))) return "READY";
  return "NEEDS_MODEL";
}

/** Canonical Group → Company → Project choices for Experience provisioning. */
export async function listProject3DProvisioningOptions(context: PlatformContext) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  return prisma.parentGroup.findMany({
    where: { isTestFixture: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      companies: {
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          projects: {
            where: { archivedAt: null },
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              code: true,
              coverImageDocumentId: true,
              project3DConfig: { select: { id: true } },
              _count: { select: { buildings: true, floors: true, units: true } },
            },
          },
        },
      },
    },
  });
}

/** Only provisioned Experiences. Non-provisioned ERP Projects stay in the creation flow. */
export async function listProject3DExperiences(context: PlatformContext, query: Project3DExperienceListQuery = {}) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const q = query.q?.trim();
  const projectWhere: Prisma.ProjectWhereInput = {
    company: {
      parentGroup: { isTestFixture: false, ...(query.group ? { id: query.group } : {}) },
      ...(query.company ? { id: query.company } : {}),
    },
    ...(query.entitlement ? { project3DEntitlement: { is: { status: query.entitlement } } } : {}),
  };
  const rows = await prisma.project3DConfig.findMany({
    where: {
      project: projectWhere,
      ...(q ? { OR: [{ experienceName: { contains: q, mode: "insensitive" } }, { project: { name: { contains: q, mode: "insensitive" } } }, { project: { code: { contains: q, mode: "insensitive" } } }] } : {}),
      ...(query.publication === "PUBLISHED" ? { activeReleaseId: { not: null } } : query.publication === "DRAFT" ? { activeReleaseId: null } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { project: { name: "asc" } }],
    select: {
      id: true,
      projectId: true,
      experienceName: true,
      internalNotes: true,
      activeReleaseId: true,
      updatedAt: true,
      activeRelease: { select: { id: true, releaseNumber: true, publishedAt: true } },
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          coverImageDocumentId: true,
          coverImage: { select: { status: true, storageStatus: true, detectedMimeType: true, mimeType: true } },
          company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } },
          project3DEntitlement: { select: { status: true, viewerEnabled: true, expiresAt: true } },
          _count: { select: { buildings: true, floors: true, units: true } },
        },
      },
      slots: {
        where: { isActive: true },
        select: { versions: { where: { deletedAt: null }, orderBy: { version: "desc" }, select: { status: true, validationStatus: true, runtimeStorageKey: true } } },
      },
      _count: { select: { releases: true, slots: true } },
    },
  });
  return rows
    .map((row) => {
      const readiness = modelReadiness(row.slots);
      const publishedAt = row.activeRelease?.publishedAt ?? null;
      const publicationState = row.activeReleaseId ? (publishedAt && row.updatedAt > publishedAt ? "DRAFT_CHANGES" : "PUBLISHED") : "DRAFT";
      const cover = row.project.coverImage;
      return {
        id: row.id,
        projectId: row.projectId,
        experienceName: row.experienceName || `${row.project.name} 3D Experience`,
        internalNotes: row.internalNotes,
        project: { id: row.project.id, code: row.project.code, name: row.project.name, status: row.project.status, company: row.project.company },
        structure: row.project._count,
        models: { slots: row._count.slots, readiness },
        releases: row._count.releases,
        publicationState,
        activeRelease: row.activeRelease ? { ...row.activeRelease, publishedAt: row.activeRelease.publishedAt.toISOString() } : null,
        entitlement: row.project.project3DEntitlement ? { ...row.project.project3DEntitlement, expiresAt: row.project.project3DEntitlement.expiresAt?.toISOString() ?? null } : null,
        coverUrl: row.project.coverImageDocumentId && cover?.status === "ACTIVE" && cover.storageStatus === "AVAILABLE" ? `/api/platform/3d/projects/${row.projectId}/cover` : null,
        updatedAt: row.updatedAt.toISOString(),
      };
    })
    .filter((row) => !query.state || row.models.readiness === query.state);
}

export async function createProject3DExperience(context: PlatformContext, input: Project3DExperienceCreate) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  const project = assertFound(await prisma.project.findFirst({
    where: {
      id: input.projectId,
      companyId: input.companyId,
      company: { id: input.companyId, parentGroupId: input.parentGroupId, parentGroup: { id: input.parentGroupId, isTestFixture: false } },
      archivedAt: null,
    },
    select: { id: true, name: true, companyId: true, project3DConfig: { select: { id: true } }, project3DEntitlement: { select: { id: true, status: true } }, _count: { select: { buildings: true, floors: true, units: true } } },
  }));
  if (project.project3DConfig) throw new AccessError("CONFLICT", "This Project already has a 3D Experience.", { code: "EXPERIENCE_EXISTS" });
  if (input.structureMode === "USE_EXISTING" && project._count.buildings + project._count.floors + project._count.units === 0) {
    throw new AccessError("VALIDATION_ERROR", "This Project has no structure to reuse.", { structureMode: ["Choose Create now or Create later."] });
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const entitlement = project.project3DEntitlement
        ? await tx.project3DEntitlement.update({ where: { id: project.project3DEntitlement.id, status: project.project3DEntitlement.status }, data: { status: "ACTIVE", viewerEnabled: true, activatedAt: new Date(), provisionedByUserId: context.userId } })
        : await tx.project3DEntitlement.create({ data: { companyId: project.companyId, projectId: project.id, status: "ACTIVE", viewerEnabled: true, activatedAt: new Date(), provisionedByUserId: context.userId, planKey: "PREMIUM_3D" } });
      const config = await tx.project3DConfig.create({
        data: { companyId: project.companyId, projectId: project.id, experienceName: input.experienceName, internalNotes: input.internalNotes?.trim() || null, schemaVersion: 1, authoringDocument: EMPTY_EXPERIENCE, updatedByUserId: context.userId },
        select: { id: true },
      });
      await recordPlatformAction(context, input.parentGroupId, {
        actionKey: AuditAction.PLATFORM_THREE_D_EXPERIENCE_CHANGED,
        entity: { type: "Project3DConfig", id: config.id, label: input.experienceName },
        projectId: project.id,
        before: null,
        after: { projectId: project.id, configurationId: config.id, schemaVersion: 1, experienceName: input.experienceName, internalNotes: input.internalNotes?.trim() || null, entitlementStatus: entitlement.status },
        reason: input.reason,
        metadata: project3DAuditMetadata("EXPERIENCE_CREATED", `${input.experienceName} provisioned`, { structureMode: input.structureMode, existingStructure: project._count }),
      }, { tx });
      return { id: config.id, projectId: project.id, openPath: input.structureMode === "CREATE_NOW" ? `/platform-admin/3d/projects/${project.id}/structure` : `/platform-admin/3d/projects/${project.id}` };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AccessError("CONFLICT", "This Project already has a 3D Experience.", { code: "EXPERIENCE_EXISTS" });
    throw error;
  }
}

export async function updateProject3DExperienceMetadata(context: PlatformContext, projectId: string, input: Project3DExperienceMetadata) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  const config = assertFound(await prisma.project3DConfig.findFirst({
    where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { id: true, experienceName: true, internalNotes: true, project: { select: { name: true, company: { select: { parentGroupId: true } } } } },
  }));
  return prisma.$transaction(async (tx) => {
    const updated = await tx.project3DConfig.update({ where: { id: config.id }, data: { experienceName: input.experienceName, internalNotes: input.internalNotes?.trim() || null, updatedByUserId: context.userId } });
    await recordPlatformAction(context, config.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_EXPERIENCE_CHANGED,
      entity: { type: "Project3DConfig", id: config.id, label: input.experienceName }, projectId,
      before: { projectId, configurationId: config.id, experienceName: config.experienceName || `${config.project.name} 3D Experience`, internalNotes: config.internalNotes },
      after: { projectId, configurationId: config.id, experienceName: updated.experienceName, internalNotes: updated.internalNotes }, reason: input.reason,
      metadata: project3DAuditMetadata("EXPERIENCE_DETAILS_UPDATED", "Experience details updated"),
    }, { tx });
    return { id: updated.id, experienceName: updated.experienceName, internalNotes: updated.internalNotes };
  });
}

export async function readProject3DExperienceCover(context: PlatformContext, projectId: string): Promise<Thumbnail> {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const row = assertFound(await prisma.project3DConfig.findFirst({
    where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { companyId: true, project: { select: { coverImage: { select: { id: true, updatedAt: true, storageKey: true, thumbnailStorageKey: true, detectedMimeType: true, mimeType: true, status: true, storageStatus: true } } } } },
  }));
  const document = row.project.coverImage;
  if (!document || document.status !== "ACTIVE" || document.storageStatus !== "AVAILABLE") throw new AccessError("NOT_FOUND");
  return readAuthorizedDocumentThumbnail(row.companyId, document);
}

export async function listProject3DModels(context: PlatformContext) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  return prisma.project3DModelVersion.findMany({
    where: { deletedAt: null, project: { company: { parentGroup: { isTestFixture: false } } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, version: true, originalFileName: true, status: true, validationStatus: true, sourceSizeBytes: true, runtimeSizeBytes: true, triangleCount: true, meshCount: true, createdAt: true, slot: { select: { id: true, displayName: true, role: true } }, project: { select: { id: true, name: true, company: { select: { name: true, parentGroup: { select: { name: true } } } } } } },
  });
}

function entitlementSnapshot(value: {
  status: string;
  planKey: string | null;
  viewerEnabled: boolean;
  activatedAt: Date | null;
  expiresAt: Date | null;
}) {
  return {
    status: value.status,
    planKey: value.planKey,
    viewerEnabled: value.viewerEnabled,
    activatedAt: value.activatedAt?.toISOString() ?? null,
    expiresAt: value.expiresAt?.toISOString() ?? null,
  };
}

export async function listProject3DWorkspaces(context: PlatformContext) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const rows = await prisma.project.findMany({
    where: { company: { parentGroup: { isTestFixture: false } } },
    orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } },
      project3DEntitlement: { select: { status: true, viewerEnabled: true, activatedAt: true, expiresAt: true } },
      project3DConfig: { select: { id: true, schemaVersion: true, activeReleaseId: true, updatedAt: true, _count: { select: { slots: true, releases: true } } } },
      _count: { select: { units: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    company: row.company,
    entitlement: row.project3DEntitlement
      ? { ...row.project3DEntitlement, activatedAt: row.project3DEntitlement.activatedAt?.toISOString() ?? null, expiresAt: row.project3DEntitlement.expiresAt?.toISOString() ?? null }
      : null,
    workspace: row.project3DConfig
      ? { id: row.project3DConfig.id, schemaVersion: row.project3DConfig.schemaVersion, activeReleaseId: row.project3DConfig.activeReleaseId, updatedAt: row.project3DConfig.updatedAt.toISOString(), slots: row.project3DConfig._count.slots, releases: row.project3DConfig._count.releases }
      : null,
    units: row._count.units,
  }));
}

export async function listProject3DDiagnostics(context: PlatformContext) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const rows = await prisma.project3DConfig.findMany({
    where: { project: { company: { parentGroup: { isTestFixture: false } } } },
    orderBy: [{ project: { company: { name: "asc" } } }, { project: { name: "asc" } }],
    select: {
      id: true,
      projectId: true,
      activeReleaseId: true,
      project: { select: { name: true, company: { select: { name: true } }, project3DEntitlement: { select: { status: true } } } },
      slots: {
        where: { isActive: true },
        select: {
          id: true,
          displayName: true,
          versions: {
            where: { deletedAt: null },
            orderBy: { version: "desc" },
            select: { id: true, version: true, status: true, validationStatus: true },
          },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    companyName: row.project.company.name,
    entitlementStatus: row.project.project3DEntitlement?.status ?? null,
    activeReleaseId: row.activeReleaseId,
    slots: row.slots,
  }));
}

export async function getProject3DWorkspace(context: PlatformContext, projectId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const project = assertFound(await prisma.project.findFirst({
    where: { id: projectId, company: { parentGroup: { isTestFixture: false } } },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      companyId: true,
      company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } },
      project3DEntitlement: true,
      project3DConfig: {
        include: {
          slots: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { versions: { where: { deletedAt: null }, orderBy: { version: "desc" }, include: { _count: { select: { unitBindings: true } } } } } },
          releases: { orderBy: { releaseNumber: "desc" } },
        },
      },
      _count: { select: { buildings: true, floors: true, units: true } },
    },
  }));
  return project;
}

export async function updateProject3DEntitlement(context: PlatformContext, projectId: string, input: Project3DEntitlementUpdate) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  const project = assertFound(await prisma.project.findFirst({
    where: { id: projectId, company: { parentGroup: { isTestFixture: false } } },
    select: {
      id: true,
      name: true,
      companyId: true,
      company: { select: { parentGroupId: true } },
      project3DEntitlement: { select: { id: true, status: true, planKey: true, viewerEnabled: true, activatedAt: true, expiresAt: true } },
    },
  }));

  const existingEntitlement = project.project3DEntitlement;
  const activatedAt = input.status === "ACTIVE" ? input.activatedAt ?? existingEntitlement?.activatedAt ?? new Date() : input.activatedAt ?? existingEntitlement?.activatedAt ?? null;
  const after = {
    status: input.status,
    planKey: input.planKey?.trim() || null,
    viewerEnabled: input.viewerEnabled,
    activatedAt,
    expiresAt: input.expiresAt ?? null,
  };

  return prisma.$transaction(async (tx) => {
    const entitlement = existingEntitlement
      ? await (async () => {
          const changed = await tx.project3DEntitlement.updateMany({
            where: { id: existingEntitlement.id, status: existingEntitlement.status },
            data: { status: after.status, planKey: after.planKey, viewerEnabled: after.viewerEnabled, activatedAt: after.activatedAt, expiresAt: after.expiresAt },
          });
          if (changed.count !== 1) throw new AccessError("CONFLICT", "The 3D entitlement changed while you were editing it.");
          return tx.project3DEntitlement.findFirstOrThrow({ where: { id: existingEntitlement.id, companyId: project.companyId, projectId: project.id } });
        })()
      : await tx.project3DEntitlement.create({
          data: { companyId: project.companyId, projectId: project.id, provisionedByUserId: context.userId, status: after.status, planKey: after.planKey, viewerEnabled: after.viewerEnabled, activatedAt: after.activatedAt, expiresAt: after.expiresAt },
        });
    await tx.project3DConfig.upsert({
      where: { projectId: project.id },
      update: { updatedByUserId: context.userId },
      create: { companyId: project.companyId, projectId: project.id, experienceName: `${project.name} 3D Experience`, schemaVersion: 1, authoringDocument: EMPTY_EXPERIENCE, updatedByUserId: context.userId },
    });
    await recordPlatformAction(context, project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_ENTITLEMENT_CHANGED,
      entity: { type: "Project3DEntitlement", id: entitlement.id, label: project.name },
      projectId: project.id,
      before: existingEntitlement ? { projectId: project.id, ...entitlementSnapshot(existingEntitlement) } : null,
      after: { projectId: project.id, ...entitlementSnapshot(entitlement) },
      reason: input.reason,
    }, { tx });
    return entitlement;
  });
}

export async function requireProject3DWorkspace(context: PlatformContext, projectId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const workspace = await prisma.project3DConfig.findFirst({ where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } } });
  if (!workspace) throw new AccessError("NOT_FOUND");
  return workspace;
}
