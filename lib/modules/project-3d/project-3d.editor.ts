import { assignedCompany } from "@/lib/access/project-ownership";
import type { Prisma } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import type { Project3DSceneNode } from "@/lib/3d/shared/contracts";
import { parseProject3DExperience } from "@/lib/3d/shared/experience";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { StorageError } from "@/lib/core/storage/storage.errors";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { changedConfigKeys, countedSave, countSummary, project3DAuditMetadata } from "./project-3d.audit";
import { PROJECT_3D_PROCESSING_STALE_MS, project3DProcessingCrashed, project3DUploadLimitBytes } from "./project-3d.ingestion";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";
import type { Project3DExperienceUpdate, Project3DModelSettingsUpdate } from "./project-3d.schema";
import { assertProject3DStorageKey } from "./project-3d.storage";
import { assertProject3DExperienceLive } from "./project-3d.lifecycle";

const PREVIEW_TTL_SECONDS = 5 * 60;

function sceneNodes(value: Prisma.JsonValue | null): Project3DSceneNode[] {
  return Array.isArray(value) ? value.filter((node): node is Project3DSceneNode => Boolean(node) && typeof node === "object" && !Array.isArray(node) && typeof (node as { nodeId?: unknown }).nodeId === "string") : [];
}

function experience(value: Prisma.JsonValue) {
  try {
    return parseProject3DExperience(value);
  } catch {
    throw new AccessError("CONFLICT", "The saved 3D Experience is invalid. Restore a valid revision before editing.", { code: "INVALID_EXPERIENCE" });
  }
}

/**
 * What this Platform session may do inside the Experience Editor. The editor
 * greys out what is missing; every save still re-checks on the server.
 */
export function project3DEditorPermissions(context: PlatformContext) {
  return {
    configure: canPlatform(context, "platform.3d.configure"),
    manageModels: canPlatform(context, "platform.3d.model.manage"),
    manageBindings: canPlatform(context, "platform.3d.binding.manage"),
  };
}

/** The 3D Studio authoring right: seeing Experiences and changing them. */
export function canOpenProject3DEditor(context: PlatformContext): boolean {
  return canPlatform(context, "platform.3d.view") && canPlatform(context, "platform.3d.configure");
}

/**
 * The editor tab's own check, never trusted from the link that opened it. The
 * permission is refused before the Experience is looked up, so an address
 * cannot be used to probe which Experiences exist. Cheap on purpose: the tab
 * runs it before anything streams, so a refusal keeps its status.
 */
export async function authorizeProject3DEditor(context: PlatformContext, projectId: string): Promise<void> {
  if (!canOpenProject3DEditor(context)) throw new AccessError("FORBIDDEN");
  // A deleted experience has no editor: it is restored first (ADM-04A §9).
  assertFound(await prisma.project3DConfig.findFirst({
    where: { projectId, deletedAt: null, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { id: true },
  }));
}

/** The dedicated editor tab's payload, behind the same permission. */
export async function openProject3DEditor(context: PlatformContext, projectId: string) {
  if (!canOpenProject3DEditor(context)) throw new AccessError("FORBIDDEN");
  return getProject3DEditorWorkspace(context, projectId);
}

/**
 * The saved draft's revision, read by an open editor when its tab regains
 * focus: a newer revision means another session saved, and a refusal means
 * the session or the access behind it has ended.
 */
export async function getProject3DExperienceState(context: PlatformContext, projectId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const config = assertFound(await prisma.project3DConfig.findFirst({
    where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { authoringDocument: true, updatedAt: true, activeReleaseId: true },
  }));
  return { revision: experience(config.authoringDocument).revision, updatedAt: config.updatedAt.toISOString(), activeReleaseId: config.activeReleaseId };
}

export async function getProject3DEditorWorkspace(context: PlatformContext, projectId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const project = assertFound(await prisma.project.findFirst({
    where: { id: projectId, company: { parentGroup: { isTestFixture: false } } },
    select: {
      id: true, code: true, name: true, companyId: true,
      company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } },
      project3DEntitlement: true,
      project3DConfig: {
        include: {
          activeRelease: { select: { id: true, releaseNumber: true } },
          slots: {
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: {
              versions: {
                where: { deletedAt: null },
                orderBy: { version: "desc" },
                include: { unitBindings: { include: { projectUnit: { select: { id: true, unitCode: true } } }, orderBy: { meshName: "asc" } } },
              },
            },
          },
        },
      },
      units: {
        where: { isActive: true },
        orderBy: [{ floor: { building: { sortOrder: "asc" } } }, { floor: { sortOrder: "asc" } }, { sortOrder: "asc" }],
        select: { id: true, unitCode: true, name: true, publicationStatus: true, commercialProfile: { select: { status: true } }, floor: { select: { name: true, number: true, building: { select: { name: true } } } } },
      },
    },
  }));
  const config = assertFound(project.project3DConfig);
  const provider = storageProvider();
  const slots = await Promise.all(config.slots.map(async (slot) => ({
    id: slot.id,
    kind: slot.kind,
    role: slot.role,
    slotKey: slot.slotKey,
    displayName: slot.displayName,
    sortOrder: slot.sortOrder,
    transformParentSlotId: slot.transformParentSlotId,
    versions: await Promise.all(slot.versions.map(async (version) => {
      let asset: { url: string; expiresAt: string; fileName: string; contentType: "model/gltf-binary" } | null = null;
      let assetMissing = false;
      if (version.runtimeStorageKey && (version.status === "READY" || version.status === "PUBLISHED")) {
        assertProject3DStorageKey(version.runtimeStorageKey, version.companyId, version.projectId, "runtime");
        try {
          const signed = await provider.createDownloadUrl({
            storageKey: version.runtimeStorageKey,
            expiresInSeconds: PREVIEW_TTL_SECONDS,
            disposition: "inline",
            fileName: version.originalFileName,
            contentType: "model/gltf-binary",
          });
          asset = { url: signed.url, expiresAt: signed.expiresAt.toISOString(), fileName: version.originalFileName, contentType: "model/gltf-binary" };
        } catch (error) {
          // One lost object (a store that was switched, a manual delete) must not close the editor.
          if (!(error instanceof StorageError && error.storageCode === "STORAGE_OBJECT_MISSING")) throw error;
          assetMissing = true;
        }
      }
      return {
        id: version.id,
        version: version.version,
        originalFileName: version.originalFileName,
        status: version.status,
        validationStatus: version.validationStatus,
        validationIssues: version.validationIssues,
        triangleCount: version.triangleCount,
        meshCount: version.meshCount,
        materialCount: version.materialCount,
        textureCount: version.textureCount,
        scale: version.scale,
        rotationDeg: version.rotationDeg,
        altitudeOffset: version.altitudeOffset,
        positionX: version.positionX,
        positionZ: version.positionZ,
        rotationXDeg: version.rotationXDeg,
        rotationZDeg: version.rotationZDeg,
        visible: version.visible,
        castShadow: version.castShadow,
        receiveShadow: version.receiveShadow,
        selectable: version.selectable,
        transformLocked: version.transformLocked,
        sceneManifest: version.sceneManifest,
        nodeOverrides: version.nodeOverrides,
        unitBindings: version.unitBindings.map((binding) => ({
          meshName: binding.meshName,
          unitId: binding.projectUnitId,
          unitCode: binding.projectUnit.unitCode,
          poiYawDeg: binding.poiYawDeg,
          poiEnabled: binding.poiEnabled,
          poiDistanceOverride: binding.poiDistanceOverride,
          poiHeightOverride: binding.poiHeightOverride,
        })),
        updatedAt: version.updatedAt.toISOString(),
        // Nothing has touched it for longer than any preparation takes: it can be put back in line.
        stalled: version.status === "PROCESSING" && Date.now() - version.updatedAt.getTime() > PROJECT_3D_PROCESSING_STALE_MS,
        // Failed on the server, not refused by validation: the same file can be prepared again.
        retryable: project3DProcessingCrashed(version),
        assetMissing,
        asset,
      };
    })),
  })));

  return {
    project: { id: project.id, code: project.code, name: project.name, company: project.company },
    entitlement: project.project3DEntitlement,
    config: {
      id: config.id,
      experienceName: config.experienceName || `${project.name} 3D Experience`,
      activeReleaseId: config.activeReleaseId,
      activeRelease: config.activeRelease,
      updatedAt: config.updatedAt.toISOString(),
      document: experience(config.authoringDocument),
    },
    permissions: project3DEditorPermissions(context),
    uploadLimitBytes: await project3DUploadLimitBytes(),
    slots,
    units: project.units,
  };
}

export async function updateProject3DExperience(
  context: PlatformContext,
  projectId: string,
  input: Project3DExperienceUpdate,
) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  await assertProject3DExperienceLive(prisma, projectId);
  const config = assertFound(await prisma.project3DConfig.findFirst({
    where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { id: true, projectId: true, companyId: true, authoringDocument: true, project: { select: { name: true, company: { select: { parentGroupId: true } } } } },
  }));
  const before = experience(config.authoringDocument);
  if (before.revision !== input.expectedRevision) throw new AccessError("CONFLICT", "The 3D Experience changed while you were editing it. Reload and try again.", { code: "EXPERIENCE_RACED" });
  let parsed;
  try {
    parsed = parseProject3DExperience({ schemaVersion: 1, revision: before.revision + 1, config: input.config });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The 3D Experience is invalid.";
    throw new AccessError("VALIDATION_ERROR", message, { config: [message] });
  }
  parsed.config.updatedAt = new Date().toISOString();

  return countedSave(prisma.$transaction(async (tx) => {
    const current = await tx.project3DConfig.findFirstOrThrow({ where: { id: config.id, companyId: config.companyId, projectId }, select: { authoringDocument: true } });
    if (experience(current.authoringDocument).revision !== input.expectedRevision) throw new AccessError("CONFLICT", "The 3D Experience changed while you were editing it. Reload and try again.", { code: "EXPERIENCE_RACED" });
    const changed = await tx.project3DConfig.updateMany({ where: { id: config.id, companyId: config.companyId, projectId }, data: { authoringDocument: parsed as unknown as Prisma.InputJsonValue, schemaVersion: parsed.schemaVersion, updatedByUserId: context.userId } });
    if (changed.count !== 1) throw new AccessError("NOT_FOUND");
    const updated = await tx.project3DConfig.findFirstOrThrow({ where: { id: config.id, companyId: config.companyId, projectId }, select: { updatedAt: true } });
    await recordPlatformAction(context, assignedCompany(config.project).parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_EXPERIENCE_CHANGED,
      entity: { type: "Project3DConfig", id: config.id, label: config.project.name },
      projectId,
      before: { projectId, configurationId: config.id, schemaVersion: before.schemaVersion, revision: before.revision },
      after: { projectId, configurationId: config.id, schemaVersion: parsed.schemaVersion, revision: parsed.revision },
      reason: input.reason,
      metadata: configSaveMetadata(before.config as unknown as Record<string, unknown>, parsed.config as unknown as Record<string, unknown>, parsed.revision, input.resetToDefaults === true),
    }, { tx });
    return { document: parsed, updatedAt: updated.updatedAt.toISOString() };
  }));
}

export async function updateProject3DModelSettings(
  context: PlatformContext,
  projectId: string,
  versionId: string,
  input: Project3DModelSettingsUpdate,
) {
  assertProject3DPlatformPermission(context, "platform.3d.model.manage");
  await assertProject3DExperienceLive(prisma, projectId);
  const version = assertFound(await prisma.project3DModelVersion.findFirst({
    where: { id: versionId, projectId, deletedAt: null, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { id: true, companyId: true, slotId: true, version: true, originalFileName: true, status: true, validationStatus: true, sceneManifest: true, updatedAt: true, scale: true, rotationDeg: true, altitudeOffset: true, positionX: true, positionZ: true, rotationXDeg: true, rotationZDeg: true, visible: true, castShadow: true, receiveShadow: true, selectable: true, transformLocked: true, nodeOverrides: true, project: { select: { name: true, company: { select: { parentGroupId: true } } } } },
  }));
  if (!(["READY", "PUBLISHED"] as string[]).includes(version.status)) throw new AccessError("CONFLICT", "Finish processing this model before editing it.", { code: "MODEL_NOT_READY" });
  const nodeIds = input.nodeOverrides.map((override) => override.nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) throw new AccessError("VALIDATION_ERROR", "Each scene node can have one override.", { nodeOverrides: ["Remove duplicate scene nodes."] });
  const allowedNodeIds = new Set(sceneNodes(version.sceneManifest).map((node) => node.nodeId));
  if (nodeIds.some((nodeId) => !allowedNodeIds.has(nodeId))) throw new AccessError("VALIDATION_ERROR", "Choose nodes from this model's scene manifest.", { nodeOverrides: ["An override references an unknown node."] });
  const before = { projectId, slotId: version.slotId, versionId: version.id, version: version.version, status: version.status, validationStatus: version.validationStatus, fileName: version.originalFileName, scale: version.scale, rotationDeg: version.rotationDeg, altitudeOffset: version.altitudeOffset, positionX: version.positionX, positionZ: version.positionZ, rotationXDeg: version.rotationXDeg, rotationZDeg: version.rotationZDeg, visible: version.visible, castShadow: version.castShadow, receiveShadow: version.receiveShadow, selectable: version.selectable, transformLocked: version.transformLocked, nodeOverrideCount: Array.isArray(version.nodeOverrides) ? version.nodeOverrides.length : 0 };
  return countedSave(prisma.$transaction(async (tx) => {
    const changed = await tx.project3DModelVersion.updateMany({
      where: { id: version.id, updatedAt: new Date(input.expectedUpdatedAt) },
      data: { scale: input.scale, rotationDeg: input.rotationDeg, altitudeOffset: input.altitudeOffset, positionX: input.positionX, positionZ: input.positionZ, rotationXDeg: input.rotationXDeg, rotationZDeg: input.rotationZDeg, visible: input.visible, castShadow: input.castShadow, receiveShadow: input.receiveShadow, selectable: input.selectable, transformLocked: input.transformLocked, nodeOverrides: input.nodeOverrides as unknown as Prisma.InputJsonValue },
    });
    if (changed.count !== 1) throw new AccessError("CONFLICT", "The model changed while you were editing it. Reload and try again.", { code: "MODEL_RACED" });
    const updated = await tx.project3DModelVersion.findFirstOrThrow({ where: { id: version.id, companyId: version.companyId, projectId } });
    await recordPlatformAction(context, assignedCompany(version.project).parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_MODEL_CHANGED,
      entity: { type: "Project3DModelVersion", id: version.id, label: `${version.project.name} v${version.version}` },
      projectId,
      before,
      after: { ...before, scale: updated.scale, rotationDeg: updated.rotationDeg, altitudeOffset: updated.altitudeOffset, positionX: updated.positionX, positionZ: updated.positionZ, rotationXDeg: updated.rotationXDeg, rotationZDeg: updated.rotationZDeg, visible: updated.visible, castShadow: updated.castShadow, receiveShadow: updated.receiveShadow, selectable: updated.selectable, transformLocked: updated.transformLocked, nodeOverrideCount: input.nodeOverrides.length },
      reason: input.reason,
      metadata: modelSettingsMetadata(version, updated, version.nodeOverrides, input.nodeOverrides),
    }, { tx });
    return { id: updated.id, updatedAt: updated.updatedAt.toISOString() };
  }));
}

function configSaveMetadata(before: Record<string, unknown>, after: Record<string, unknown>, revision: number, reset: boolean) {
  const changedKeys = changedConfigKeys(before, after);
  return project3DAuditMetadata(
    reset ? "EXPERIENCE_DEFAULTS_RESET" : "EXPERIENCE_CONFIGURATION_SAVED",
    reset ? "Editor settings reset to defaults" : countSummary(changedKeys.length, "Experience setting"),
    { revision, changedKeys: changedKeys.slice(0, 40) },
  );
}

const MODEL_PROPERTIES = ["scale", "rotationDeg", "altitudeOffset", "positionX", "positionZ", "rotationXDeg", "rotationZDeg", "visible", "castShadow", "receiveShadow", "selectable", "transformLocked"] as const;

function modelSettingsMetadata(
  before: Record<(typeof MODEL_PROPERTIES)[number], unknown>,
  after: Record<(typeof MODEL_PROPERTIES)[number], unknown>,
  overridesBefore: unknown,
  overridesAfter: ReadonlyArray<{ nodeId: string }>,
) {
  const properties = MODEL_PROPERTIES.filter((key) => before[key] !== after[key]);
  const previous = new Map((Array.isArray(overridesBefore) ? overridesBefore as Array<{ nodeId?: unknown }> : []).map((override) => [String(override.nodeId), JSON.stringify(override)]));
  const next = new Map(overridesAfter.map((override) => [override.nodeId, JSON.stringify(override)]));
  const nodes = new Set([...previous.keys(), ...next.keys()]);
  const materials = [...nodes].filter((nodeId) => previous.get(nodeId) !== next.get(nodeId)).length;
  const parts = [properties.length ? countSummary(properties.length, "model property", "model properties") : null, materials ? countSummary(materials, "scene node") : null].filter(Boolean);
  return project3DAuditMetadata("MODEL_SETTINGS_UPDATED", parts.length ? parts.join(", ") : "Model settings saved unchanged", { changedProperties: properties, changedNodeCount: materials });
}
