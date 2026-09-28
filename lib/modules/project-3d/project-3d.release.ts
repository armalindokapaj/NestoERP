import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { AccessError, assertFound, stateDenied } from "@/lib/access/guards";
import type { Project3DNodeOverride, Project3DReleaseManifest, Project3DSceneNode } from "@/lib/3d/shared/contracts";
import { PROJECT_3D_SCHEMA_VERSION } from "@/lib/3d/shared/contracts";
import { parseProject3DExperience } from "@/lib/3d/shared/experience";
import type { PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { project3DAuditMetadata } from "./project-3d.audit";
import { isProject3DEntitlementActive } from "./project-3d.entitlement";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";
import type { Project3DReleasePublish } from "./project-3d.schema";
import { assertProject3DStorageKey } from "./project-3d.storage";
import { assertProject3DExperienceLive } from "./project-3d.lifecycle";

function jsonArray<T>(value: Prisma.JsonValue | null): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function manifestHash(manifest: Project3DReleaseManifest): string {
  return createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}

export async function listProject3DReleases(context: PlatformContext, projectId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const config = assertFound(await prisma.project3DConfig.findFirst({
    where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: {
      activeReleaseId: true,
      releases: { orderBy: { releaseNumber: "desc" }, select: { id: true, releaseNumber: true, schemaVersion: true, manifestHash: true, status: true, publishedByUserId: true, publishedAt: true, activatedAt: true, supersededAt: true, manifest: true } },
    },
  }));
  return { activeReleaseId: config.activeReleaseId, releases: config.releases };
}

export async function publishProject3DRelease(
  context: PlatformContext,
  projectId: string,
  input: Project3DReleasePublish,
) {
  assertProject3DPlatformPermission(context, "platform.3d.publish");
  await assertProject3DExperienceLive(prisma, projectId);
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const config = assertFound(await tx.project3DConfig.findFirst({
        where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } },
        select: {
          id: true, projectId: true, companyId: true, activeReleaseId: true, authoringDocument: true, visibility: true,
          project: { select: { name: true, project3DEntitlement: true, company: { select: { parentGroupId: true } } } },
          slots: {
            where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true, displayName: true, role: true, transformParentSlotId: true,
              versions: {
                where: { id: { in: input.versionIds }, deletedAt: null },
                select: {
                  id: true, companyId: true, projectId: true, slotId: true, version: true, originalFileName: true,
                  runtimeStorageKey: true, runtimeContentType: true, status: true, validationStatus: true,
                  scale: true, rotationDeg: true, altitudeOffset: true, positionX: true, positionZ: true,
                  rotationXDeg: true, rotationZDeg: true, visible: true, castShadow: true, receiveShadow: true,
                  selectable: true, sceneManifest: true, nodeOverrides: true, unitNodeNames: true,
                  unitBindings: { select: { meshName: true, mappingStatus: true, poiYawDeg: true, poiEnabled: true, poiDistanceOverride: true, poiHeightOverride: true, projectUnit: { select: { id: true, unitCode: true, isActive: true } } } },
                },
              },
            },
          },
          releases: { orderBy: { releaseNumber: "desc" }, take: 1, select: { releaseNumber: true } },
        },
      }));
      if (!isProject3DEntitlementActive(config.project.project3DEntitlement, now)) throw stateDenied("Activate this Project's 3D entitlement before publishing.", { code: "ENTITLEMENT_INACTIVE" });
      if (config.slots.length === 0) throw stateDenied("Add and process at least one model before publishing.", { code: "NO_MODELS" });
      const selected = config.slots.flatMap((slot) => slot.versions.map((version) => ({ slot, version })));
      if (selected.length !== input.versionIds.length || config.slots.some((slot) => slot.versions.length !== 1)) {
        throw new AccessError("VALIDATION_ERROR", "Choose exactly one model version for every active slot.", { versionIds: ["Every active slot needs one selected version."] });
      }

      let experience;
      try { experience = parseProject3DExperience(config.authoringDocument); }
      catch { throw stateDenied("The authored 3D Experience is invalid and cannot be published.", { code: "INVALID_EXPERIENCE" }); }

      for (const { slot, version } of selected) {
        if (!(["READY", "PUBLISHED"] as string[]).includes(version.status) || !(["READY", "WARNING"] as string[]).includes(version.validationStatus) || !version.runtimeStorageKey) {
          throw stateDenied(`${slot.displayName} does not have a publishable runtime model.`, { code: "MODEL_NOT_READY", slotId: slot.id });
        }
        assertProject3DStorageKey(version.runtimeStorageKey, config.companyId, projectId, "runtime");
        if (version.runtimeContentType !== "model/gltf-binary") throw stateDenied(`${slot.displayName} has an invalid runtime artifact.`, { code: "INVALID_RUNTIME_ASSET" });
        if (slot.role === "UNITS") {
          const requiredNames = jsonArray<string>(version.unitNodeNames);
          const bindings = new Map(version.unitBindings.map((binding) => [binding.meshName, binding]));
          const unresolved = requiredNames.filter((name) => {
            const binding = bindings.get(name);
            return !binding || binding.mappingStatus === "NEEDS_REVIEW" || !binding.projectUnit.isActive;
          });
          if (unresolved.length > 0) throw stateDenied(`${slot.displayName} has ${unresolved.length} unresolved unit ${unresolved.length === 1 ? "mapping" : "mappings"}.`, { code: "UNIT_BINDINGS_UNRESOLVED", meshNames: unresolved.slice(0, 20) });
        }
      }

      const releaseId = randomUUID();
      const releaseNumber = (config.releases[0]?.releaseNumber ?? 0) + 1;
      const manifest: Project3DReleaseManifest = {
        schemaVersion: PROJECT_3D_SCHEMA_VERSION,
        projectId,
        companyId: config.companyId,
        releaseId,
        releaseNumber,
        createdAt: now.toISOString(),
        experience: experience.config as unknown as Record<string, unknown>,
        models: selected.map(({ slot, version }) => ({
          slotId: slot.id,
          slotName: slot.displayName,
          slotRole: slot.role,
          transformParentSlotId: slot.transformParentSlotId,
          versionId: version.id,
          versionNumber: version.version,
          runtimeStorageKey: version.runtimeStorageKey!,
          runtimeFileName: version.originalFileName,
          runtimeContentType: "model/gltf-binary",
          transform: { scale: version.scale, rotationDeg: version.rotationDeg, altitudeOffset: version.altitudeOffset, positionX: version.positionX, positionZ: version.positionZ, rotationXDeg: version.rotationXDeg, rotationZDeg: version.rotationZDeg },
          visible: version.visible,
          castShadow: version.castShadow,
          receiveShadow: version.receiveShadow,
          selectable: version.selectable,
          sceneManifest: jsonArray<Project3DSceneNode>(version.sceneManifest),
          nodeOverrides: jsonArray<Project3DNodeOverride>(version.nodeOverrides),
          unitBindings: version.unitBindings.map((binding) => ({ meshName: binding.meshName, unitId: binding.projectUnit.id, unitCode: binding.projectUnit.unitCode, poiYawDeg: binding.poiYawDeg, poiEnabled: binding.poiEnabled, poiDistanceOverride: binding.poiDistanceOverride, poiHeightOverride: binding.poiHeightOverride })),
        })),
      };
      const hash = manifestHash(manifest);
      // Public viewers only ever receive an approved public projection. While
      // the experience is PUBLIC a new release is staged, not activated: it
      // goes live after its projection is prepared and approved (ADM-04A §5),
      // and the current public release keeps serving until then.
      if (config.visibility === "PUBLIC") {
        const staged = await tx.project3DRelease.create({ data: { id: releaseId, companyId: config.companyId, projectId, configId: config.id, releaseNumber, schemaVersion: PROJECT_3D_SCHEMA_VERSION, experienceSnapshot: experience as unknown as Prisma.InputJsonValue, manifest: manifest as unknown as Prisma.InputJsonValue, manifestHash: hash, status: "PUBLISHED", publishedByUserId: context.userId, publishedAt: now, activatedAt: now, supersededAt: now } });
        await tx.project3DModelVersion.updateMany({ where: { id: { in: input.versionIds }, status: { in: ["READY", "PUBLISHED"] } }, data: { status: "PUBLISHED", publishedByUserId: context.userId, publishedAt: now } });
        await recordPlatformAction(context, config.project.company.parentGroupId, {
          actionKey: AuditAction.PLATFORM_THREE_D_RELEASE_PUBLISHED,
          entity: { type: "Project3DRelease", id: staged.id, label: `${config.project.name} release ${releaseNumber}` }, projectId,
          before: config.activeReleaseId ? { projectId, configurationId: config.id, releaseId: config.activeReleaseId } : null,
          after: { projectId, configurationId: config.id, releaseId: staged.id, releaseNumber, manifestHash: hash }, reason: input.reason,
          metadata: project3DAuditMetadata("RELEASE_PUBLISHED", `Release ${releaseNumber} staged; it goes live once its public projection is approved`, { versionIds: input.versionIds, staged: true }),
        }, { tx });
        return { id: staged.id, releaseNumber, manifestHash: hash, active: false, needsPublicReview: true };
      }
      if (config.activeReleaseId) await tx.project3DRelease.updateMany({ where: { id: config.activeReleaseId, companyId: config.companyId, projectId, configId: config.id }, data: { supersededAt: now } });
      const release = await tx.project3DRelease.create({ data: { id: releaseId, companyId: config.companyId, projectId, configId: config.id, releaseNumber, schemaVersion: PROJECT_3D_SCHEMA_VERSION, experienceSnapshot: experience as unknown as Prisma.InputJsonValue, manifest: manifest as unknown as Prisma.InputJsonValue, manifestHash: hash, status: "PUBLISHED", publishedByUserId: context.userId, publishedAt: now, activatedAt: now } });
      // accessEpoch: delivery handles of the previous release stop working (§8).
      const moved = await tx.project3DConfig.updateMany({ where: { id: config.id, activeReleaseId: config.activeReleaseId, deletedAt: null }, data: { activeReleaseId: release.id, updatedByUserId: context.userId, accessEpoch: { increment: 1 } } });
      if (moved.count !== 1) throw new AccessError("CONFLICT", "Another release became active while publishing. Reload and try again.", { code: "RELEASE_RACED" });
      await tx.project3DModelVersion.updateMany({ where: { id: { in: input.versionIds }, status: { in: ["READY", "PUBLISHED"] } }, data: { status: "PUBLISHED", publishedByUserId: context.userId, publishedAt: now } });
      await recordPlatformAction(context, config.project.company.parentGroupId, {
        actionKey: AuditAction.PLATFORM_THREE_D_RELEASE_PUBLISHED,
        entity: { type: "Project3DRelease", id: release.id, label: `${config.project.name} release ${releaseNumber}` }, projectId,
        before: config.activeReleaseId ? { projectId, configurationId: config.id, releaseId: config.activeReleaseId } : null,
        after: { projectId, configurationId: config.id, releaseId: release.id, releaseNumber, manifestHash: hash }, reason: input.reason,
        metadata: project3DAuditMetadata("RELEASE_PUBLISHED", `Release ${releaseNumber} published with ${input.versionIds.length} model${input.versionIds.length === 1 ? "" : "s"}`, { versionIds: input.versionIds }),
      }, { tx });
      await recordPlatformAction(context, config.project.company.parentGroupId, {
        actionKey: AuditAction.PLATFORM_THREE_D_RELEASE_ACTIVATED,
        entity: { type: "Project3DRelease", id: release.id, label: `${config.project.name} release ${releaseNumber}` }, projectId,
        before: config.activeReleaseId ? { projectId, configurationId: config.id, releaseId: config.activeReleaseId } : null,
        after: { projectId, configurationId: config.id, releaseId: release.id, releaseNumber }, reason: input.reason,
        metadata: project3DAuditMetadata("RELEASE_ACTIVATED", `Release ${releaseNumber} is live`),
      }, { tx });
      return { id: release.id, releaseNumber, manifestHash: hash, active: true, needsPublicReview: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new AccessError("CONFLICT", "Another release was published at the same moment. Reload and try again.", { code: "RELEASE_RACED" });
    throw error;
  }
}

export async function activateProject3DRelease(context: PlatformContext, projectId: string, releaseId: string, reason: string | null = null) {
  assertProject3DPlatformPermission(context, "platform.3d.publish");
  await assertProject3DExperienceLive(prisma, projectId);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const config = assertFound(await tx.project3DConfig.findFirst({ where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } }, select: { id: true, projectId: true, companyId: true, activeReleaseId: true, visibility: true, project: { select: { name: true, project3DEntitlement: true, company: { select: { parentGroupId: true } } } } } }));
    if (!isProject3DEntitlementActive(config.project.project3DEntitlement, now)) throw stateDenied("Activate this Project's 3D entitlement before changing its release.", { code: "ENTITLEMENT_INACTIVE" });
    if (config.activeReleaseId === releaseId) throw new AccessError("CONFLICT", "This release is already active.", { code: "RELEASE_ALREADY_ACTIVE" });
    const target = assertFound(await tx.project3DRelease.findFirst({ where: { id: releaseId, projectId, companyId: config.companyId, configId: config.id, status: "PUBLISHED" }, select: { id: true, releaseNumber: true, publicManifestHash: true, publicApprovedAt: true } }));
    // Rollback never changes the audience; while PUBLIC it may only move to a
    // release whose public projection was approved (§5).
    if (config.visibility === "PUBLIC" && (!target.publicManifestHash || !target.publicApprovedAt)) {
      throw stateDenied(`Release ${target.releaseNumber} has no approved public projection. Prepare and approve it before making it live while this experience is public.`, { code: "PUBLIC_PROJECTION_REQUIRED" });
    }
    if (config.activeReleaseId) await tx.project3DRelease.updateMany({ where: { id: config.activeReleaseId, companyId: config.companyId, projectId, configId: config.id }, data: { supersededAt: now } });
    const activated = await tx.project3DRelease.updateMany({ where: { id: target.id, companyId: config.companyId, projectId, configId: config.id }, data: { activatedAt: now, supersededAt: null } });
    if (activated.count !== 1) throw new AccessError("NOT_FOUND");
    const moved = await tx.project3DConfig.updateMany({ where: { id: config.id, activeReleaseId: config.activeReleaseId, deletedAt: null }, data: { activeReleaseId: target.id, updatedByUserId: context.userId, accessEpoch: { increment: 1 } } });
    if (moved.count !== 1) throw new AccessError("CONFLICT", "The active release changed. Reload and try again.", { code: "RELEASE_RACED" });
    await recordPlatformAction(context, config.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_RELEASE_ACTIVATED,
      entity: { type: "Project3DRelease", id: target.id, label: `${config.project.name} release ${target.releaseNumber}` }, projectId,
      before: { projectId, configurationId: config.id, releaseId: config.activeReleaseId },
      after: { projectId, configurationId: config.id, releaseId: target.id, releaseNumber: target.releaseNumber }, reason,
      metadata: project3DAuditMetadata("RELEASE_ACTIVATED", `Release ${target.releaseNumber} is live`),
    }, { tx });
    return { id: target.id, releaseNumber: target.releaseNumber, active: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
