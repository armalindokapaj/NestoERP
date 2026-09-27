import type { Prisma, Project3DValidationStatus } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import type { PlatformContext } from "@/lib/context/platform-context";
import { MAX_MODEL_BYTES } from "@/lib/3d/platform/model-upload";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction, recordSystemAction } from "@/lib/core/audit/audit.service";
import { liveWorkers } from "@/lib/core/jobs/worker.process";
import { getMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { optimizeGlbForDeliveryDetailed } from "./processing/glb.optimize";
import { validateGlb } from "./processing/glb.validate";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";
import type { Project3DSlotCreate, Project3DUploadCreate } from "./project-3d.schema";
import { assertProject3DStorageKey, buildProject3DStorageKey } from "./project-3d.storage";

const UPLOAD_TTL_SECONDS = 15 * 60;
const GLB_CONTENT_TYPE = "model/gltf-binary";
const NOT_A_FIXTURE = { company: { parentGroup: { isTestFixture: false } } } as const;

/**
 * How long a version may sit in PROCESSING before whatever was preparing it
 * counts as gone: longer than a request may run (300 s), and than a normal
 * worker pass takes. After this the author can put it back in line.
 */
export const PROJECT_3D_PROCESSING_STALE_MS = 6 * 60 * 1000;

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * The largest GLB this deployment takes: the product ceiling, or the object
 * store's own per-file limit when that is lower (a Supabase Free project allows
 * 50 MB). The editor shows it and refuses a bigger file before any upload.
 */
export async function project3DUploadLimitBytes(): Promise<number> {
  const storeLimit = (await storageProvider().maxObjectBytes?.().catch(() => null)) ?? null;
  return storeLimit ? Math.min(MAX_MODEL_BYTES, storeLimit) : MAX_MODEL_BYTES;
}

/**
 * Whether the request that completed an upload also prepares it.
 *
 * Wherever a worker runs, its `project-3d.process-models` job does (PRD #51).
 * A serverless deployment has no worker process — on Vercel a completed upload
 * would wait in PROCESSING for ever — so there the completing request prepares
 * its own version once its response is sent. That is the author's upload
 * finishing, not a scheduled job started over HTTP (§216), and it stays safe
 * beside a worker: only a PROCESSING row moves on, and the runtime key is the
 * version's own id, so a second run writes the same object.
 *
 * `PROJECT_3D_PROCESSING=worker|inline` decides it; by default the request
 * does it unless a live worker runs the documents group.
 */
export async function project3DProcessingInRequest(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.PROJECT_3D_PROCESSING === "worker") return false;
  if (env.PROJECT_3D_PROCESSING === "inline") return true;
  try {
    return !(await liveWorkers()).some((worker) => worker.groups.includes("documents"));
  } catch {
    return true;
  }
}

/** The editor's processing poll: statuses only — nothing is signed and no manifest or unit is read. */
export async function getProject3DModelStatuses(context: PlatformContext, projectId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  assertFound(await prisma.project3DConfig.findFirst({ where: { projectId, project: NOT_A_FIXTURE }, select: { id: true } }));
  const versions = await prisma.project3DModelVersion.findMany({
    where: { projectId, deletedAt: null, slot: { isActive: true } },
    select: { id: true, status: true, validationStatus: true, updatedAt: true },
  });
  const now = Date.now();
  return versions.map((version) => ({
    id: version.id,
    status: version.status,
    validationStatus: version.validationStatus,
    stalled: version.status === "PROCESSING" && now - version.updatedAt.getTime() > PROJECT_3D_PROCESSING_STALE_MS,
  }));
}

/**
 * Puts a version back in line when whatever was preparing it is gone: a
 * request cut off at its time limit, or a worker that crashed. Refused while
 * the preparation may still be running, so two never overlap on purpose.
 */
export async function retryProject3DModelProcessing(context: PlatformContext, projectId: string, versionId: string, reason: string) {
  assertProject3DPlatformPermission(context, "platform.3d.model.manage");
  if ((await getMaintenanceState()).disable3DProcessing) throw new AccessError("CONFLICT", "3D processing is disabled by platform maintenance policy.");
  const version = assertFound(await prisma.project3DModelVersion.findFirst({
    where: { id: versionId, projectId, deletedAt: null, project: NOT_A_FIXTURE },
    select: { id: true, slotId: true, version: true, originalFileName: true, status: true, validationStatus: true, updatedAt: true, slot: { select: { displayName: true } }, project: { select: { company: { select: { parentGroupId: true } } } } },
  }));
  if (version.status !== "PROCESSING") throw new AccessError("CONFLICT", "Only a model that is still being prepared can be retried.", { code: "MODEL_NOT_PROCESSING" });
  if (Date.now() - version.updatedAt.getTime() < PROJECT_3D_PROCESSING_STALE_MS) {
    throw new AccessError("CONFLICT", "This model is still being prepared. Try again in a few minutes.", { code: "MODEL_STILL_PROCESSING" });
  }
  const snapshot = { projectId, slotId: version.slotId, versionId: version.id, version: version.version, status: version.status, validationStatus: version.validationStatus, fileName: version.originalFileName };
  await prisma.$transaction(async (tx) => {
    const changed = await tx.project3DModelVersion.updateMany({
      where: { id: version.id, status: "PROCESSING", updatedAt: version.updatedAt },
      data: { processingDiagnostics: { stage: "queued", retriedAt: new Date().toISOString() } },
    });
    if (changed.count !== 1) throw new AccessError("CONFLICT", "This model changed while it was being retried. Refresh and try again.");
    await recordPlatformAction(context, version.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_MODEL_CHANGED,
      entity: { type: "Project3DModelVersion", id: version.id, label: `${version.slot.displayName} v${version.version}` },
      projectId,
      before: snapshot,
      after: snapshot,
      reason,
    }, { tx });
  });
  return { id: version.id, status: "PROCESSING" as const };
}

/**
 * Takes a model out of the Experience. Its versions stay (a published release
 * keeps showing it until the next release), but it no longer asks for a
 * version when publishing — so an abandoned or mistaken model cannot block
 * every future release. Models that followed its transform stop following it.
 */
export async function deactivateProject3DModelSlot(context: PlatformContext, projectId: string, slotId: string, reason: string) {
  assertProject3DPlatformPermission(context, "platform.3d.model.manage");
  const slot = assertFound(await prisma.project3DModelSlot.findFirst({
    where: { id: slotId, projectId, isActive: true, project: NOT_A_FIXTURE },
    select: { id: true, companyId: true, slotKey: true, displayName: true, kind: true, role: true, project: { select: { company: { select: { parentGroupId: true } } } } },
  }));
  return prisma.$transaction(async (tx) => {
    const changed = await tx.project3DModelSlot.updateMany({ where: { id: slot.id, projectId, isActive: true }, data: { isActive: false } });
    if (changed.count !== 1) throw new AccessError("CONFLICT", "This model changed while it was being removed. Refresh and try again.");
    await tx.project3DModelSlot.updateMany({ where: { projectId, transformParentSlotId: slot.id }, data: { transformParentSlotId: null } });
    const before = { projectId, slotId: slot.id, slotKey: slot.slotKey, displayName: slot.displayName, kind: slot.kind, role: slot.role, isActive: true };
    await recordPlatformAction(context, slot.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_MODEL_CHANGED,
      entity: { type: "Project3DModelSlot", id: slot.id, label: slot.displayName },
      projectId,
      before,
      after: { ...before, isActive: false },
      reason,
    }, { tx });
    return { id: slot.id, isActive: false };
  });
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isGlbHeader(bytes: Uint8Array, expectedLength: number): boolean {
  if (bytes.byteLength < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return new TextDecoder().decode(bytes.slice(0, 4)) === "glTF" && view.getUint32(4, true) === 2 && view.getUint32(8, true) === expectedLength;
}

export async function createProject3DModelSlot(context: PlatformContext, projectId: string, input: Project3DSlotCreate) {
  assertProject3DPlatformPermission(context, "platform.3d.model.manage");
  const config = assertFound(await prisma.project3DConfig.findFirst({
    where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { id: true, projectId: true, companyId: true, project: { select: { name: true, company: { select: { parentGroupId: true } } } } },
  }));
  if (input.transformParentSlotId) {
    const parent = await prisma.project3DModelSlot.findFirst({ where: { id: input.transformParentSlotId, projectId, companyId: config.companyId, isActive: true }, select: { id: true } });
    if (!parent) throw new AccessError("VALIDATION_ERROR", "The transform parent is not an active slot in this Project.", { field: "transformParentSlotId" });
  }
  return prisma.$transaction(async (tx) => {
    const slot = await tx.project3DModelSlot.create({ data: {
      companyId: config.companyId,
      projectId,
      configId: config.id,
      kind: input.kind,
      role: input.role,
      slotKey: input.slotKey,
      displayName: input.displayName,
      sortOrder: input.sortOrder,
      transformParentSlotId: input.transformParentSlotId ?? null,
    } });
    await recordPlatformAction(context, config.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_MODEL_CHANGED,
      entity: { type: "Project3DModelSlot", id: slot.id, label: slot.displayName },
      projectId,
      after: { projectId, slotId: slot.id, slotKey: slot.slotKey, displayName: slot.displayName, kind: slot.kind, role: slot.role },
      reason: input.reason,
    }, { tx });
    return slot;
  });
}

export async function createProject3DModelUpload(context: PlatformContext, projectId: string, slotId: string, input: Project3DUploadCreate) {
  assertProject3DPlatformPermission(context, "platform.3d.model.manage");
  if ((await getMaintenanceState()).disable3DProcessing) throw new AccessError("CONFLICT", "3D processing is disabled by platform maintenance policy.");
  const limit = await project3DUploadLimitBytes();
  if (input.sizeBytes > limit) {
    throw new AccessError("VALIDATION_ERROR", `The model is larger than this deployment accepts (${mb(limit)}). Compress it (Draco or Meshopt) or split it into several models.`, { field: "sizeBytes", limitBytes: limit });
  }
  const slot = assertFound(await prisma.project3DModelSlot.findFirst({
    where: { id: slotId, projectId, isActive: true, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { id: true, projectId: true, companyId: true, displayName: true, project: { select: { name: true, company: { select: { parentGroupId: true } } } }, versions: { take: 1, orderBy: { version: "desc" }, select: { version: true } } },
  }));
  const sourceStorageKey = buildProject3DStorageKey({ companyId: slot.companyId, projectId, kind: "source", extension: "glb" });
  const created = await prisma.$transaction(async (tx) => {
    const version = await tx.project3DModelVersion.create({ data: {
      companyId: slot.companyId,
      projectId,
      slotId: slot.id,
      version: (slot.versions[0]?.version ?? 0) + 1,
      originalFileName: input.fileName,
      sourceStorageKey,
      storageProvider: storageProvider().key,
      sourceSizeBytes: BigInt(input.sizeBytes),
      sourceContentType: GLB_CONTENT_TYPE,
      scale: input.scale,
      rotationDeg: input.rotationDeg,
      altitudeOffset: input.altitudeOffset,
      positionX: input.positionX,
      positionZ: input.positionZ,
      rotationXDeg: input.rotationXDeg,
      rotationZDeg: input.rotationZDeg,
      status: "UPLOADED",
      processingDiagnostics: { stage: "awaiting_upload", uploadExpiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString() },
      uploadedByUserId: context.userId,
    } });
    await recordPlatformAction(context, slot.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_MODEL_CHANGED,
      entity: { type: "Project3DModelVersion", id: version.id, label: `${slot.displayName} v${version.version}` },
      projectId,
      after: { projectId, slotId: slot.id, versionId: version.id, version: version.version, status: version.status, validationStatus: version.validationStatus, fileName: version.originalFileName },
      reason: input.reason,
    }, { tx });
    return version;
  });
  try {
    const upload = await storageProvider().createUploadUrl({ storageKey: sourceStorageKey, contentType: GLB_CONTENT_TYPE, maxBytes: input.sizeBytes, expiresInSeconds: UPLOAD_TTL_SECONDS });
    return { versionId: created.id, version: created.version, upload: { method: upload.method, url: upload.url, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() } };
  } catch (error) {
    await prisma.project3DModelVersion.updateMany({ where: { id: created.id, status: "UPLOADED" }, data: { status: "FAILED", processingDiagnostics: { stage: "upload_grant_failed" } } });
    throw error;
  }
}

export async function completeProject3DModelUpload(context: PlatformContext, projectId: string, versionId: string, reason: string) {
  assertProject3DPlatformPermission(context, "platform.3d.model.manage");
  const version = assertFound(await prisma.project3DModelVersion.findFirst({
    where: { id: versionId, projectId, deletedAt: null, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { id: true, projectId: true, companyId: true, slotId: true, version: true, originalFileName: true, sourceStorageKey: true, sourceSizeBytes: true, sourceContentType: true, status: true, createdAt: true, slot: { select: { displayName: true } }, project: { select: { company: { select: { parentGroupId: true } } } } },
  }));
  if (version.status === "PROCESSING" || version.status === "READY") return { id: version.id, status: version.status };
  if (version.status !== "UPLOADED") throw new AccessError("CONFLICT", "This model upload cannot be completed.");
  if (Date.now() - version.createdAt.getTime() > UPLOAD_TTL_SECONDS * 1000) throw new AccessError("CONFLICT", "This upload grant expired. Start a new model version.");
  assertProject3DStorageKey(version.sourceStorageKey, version.companyId, version.projectId, "source");
  const provider = storageProvider();
  const metadata = await provider.headObject(version.sourceStorageKey);
  if (!metadata) throw new AccessError("CONFLICT", "The uploaded model did not arrive. Try the upload again.");
  if (metadata.sizeBytes <= 0 || metadata.sizeBytes > MAX_MODEL_BYTES || BigInt(metadata.sizeBytes) !== version.sourceSizeBytes) {
    await provider.deleteObject(version.sourceStorageKey).catch(() => undefined);
    await prisma.project3DModelVersion.updateMany({ where: { id: version.id, status: "UPLOADED" }, data: { status: "FAILED", validationStatus: "BLOCKED", processingDiagnostics: { stage: "verification_failed", reason: "size_mismatch", actualSizeBytes: metadata.sizeBytes } } });
    throw new AccessError("VALIDATION_ERROR", "The uploaded model size does not match the selected file.");
  }
  const head = await provider.getObjectHead(version.sourceStorageKey, 12);
  if (!head || !isGlbHeader(head, metadata.sizeBytes)) {
    await provider.deleteObject(version.sourceStorageKey).catch(() => undefined);
    await prisma.project3DModelVersion.updateMany({ where: { id: version.id, status: "UPLOADED" }, data: { status: "FAILED", validationStatus: "BLOCKED", processingDiagnostics: { stage: "verification_failed", reason: "invalid_glb" } } });
    throw new AccessError("VALIDATION_ERROR", "The file contents are not a valid binary GLB artifact.");
  }
  await prisma.$transaction(async (tx) => {
    const changed = await tx.project3DModelVersion.updateMany({ where: { id: version.id, status: "UPLOADED" }, data: { status: "PROCESSING", sourceChecksum: metadata.checksumSha256 ?? metadata.etag, processingDiagnostics: { stage: "queued", verifiedAt: new Date().toISOString() } } });
    if (changed.count !== 1) throw new AccessError("CONFLICT", "This model upload changed while it was being completed.");
    await recordPlatformAction(context, version.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_MODEL_CHANGED,
      entity: { type: "Project3DModelVersion", id: version.id, label: `${version.slot.displayName} v${version.version}` },
      projectId,
      before: { projectId, slotId: version.slotId, versionId: version.id, version: version.version, status: "UPLOADED", validationStatus: "PENDING", fileName: version.originalFileName },
      after: { projectId, slotId: version.slotId, versionId: version.id, version: version.version, status: "PROCESSING", validationStatus: "PENDING", fileName: version.originalFileName },
      reason,
    }, { tx });
  });
  return { id: version.id, status: "PROCESSING" as const };
}

async function failProcessing(version: { id: string; companyId: string; projectId: string; slotId: string; version: number; originalFileName: string }, message: string, issues: string[] = []) {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.project3DModelVersion.updateMany({ where: { id: version.id, status: "PROCESSING" }, data: { status: "FAILED", validationStatus: "BLOCKED", validationIssues: issues, processingDiagnostics: { stage: "failed", message } } });
    if (changed.count !== 1) return;
    await recordSystemAction(version.companyId, {
      actionKey: AuditAction.PLATFORM_THREE_D_MODEL_CHANGED,
      entity: { type: "Project3DModelVersion", id: version.id, label: `3D model v${version.version}` },
      projectId: version.projectId,
      before: { projectId: version.projectId, slotId: version.slotId, versionId: version.id, version: version.version, status: "PROCESSING", validationStatus: "PENDING", fileName: version.originalFileName },
      after: { projectId: version.projectId, slotId: version.slotId, versionId: version.id, version: version.version, status: "FAILED", validationStatus: "BLOCKED", fileName: version.originalFileName },
    }, { tx });
  });
}

export async function processProject3DModelVersion(versionId: string): Promise<"READY" | "FAILED" | "SKIPPED"> {
  const version = await prisma.project3DModelVersion.findFirst({ where: { id: versionId, status: "PROCESSING", deletedAt: null }, include: { slot: { select: { kind: true, role: true } } } });
  if (!version) return "SKIPPED";
  // Marks the start, so the stalled-preparation clock runs from real activity, not from the queue.
  await prisma.project3DModelVersion.updateMany({ where: { id: version.id, status: "PROCESSING" }, data: { processingDiagnostics: { stage: "processing", startedAt: new Date().toISOString() } } });
  try {
    assertProject3DStorageKey(version.sourceStorageKey, version.companyId, version.projectId, "source");
    const source = await storageProvider().getObject(version.sourceStorageKey);
    if (!source) {
      await failProcessing(version, "The verified source object is missing.");
      return "FAILED";
    }
    const validation = await validateGlb(asArrayBuffer(source), version.slot.kind === "MAP" ? "mapModel" : "detailModel", version.slot.role);
    if (validation.status === "blocked") {
      await failProcessing(version, "GLB validation blocked this version.", validation.issues);
      return "FAILED";
    }
    const optimized = await optimizeGlbForDeliveryDetailed(asArrayBuffer(source));
    const runtimeStorageKey = buildProject3DStorageKey({ companyId: version.companyId, projectId: version.projectId, kind: "runtime", extension: "glb", objectId: version.id });
    const runtime = await storageProvider().putObject(runtimeStorageKey, optimized.bytes, GLB_CONTENT_TYPE);
    const validationStatus: Project3DValidationStatus = validation.status === "warning" ? "WARNING" : "READY";
    await prisma.$transaction(async (tx) => {
      const changed = await tx.project3DModelVersion.updateMany({ where: { id: version.id, status: "PROCESSING" }, data: {
        status: "READY",
        validationStatus,
        validationIssues: validation.issues,
        triangleCount: validation.triangleCount,
        meshCount: validation.meshCount,
        materialCount: validation.materialCount,
        textureCount: validation.textureCount,
        unitNodeNames: validation.unitNodeNames,
        sceneManifest: validation.sceneManifest as unknown as Prisma.InputJsonValue,
        runtimeStorageKey,
        runtimeSizeBytes: BigInt(runtime.sizeBytes),
        runtimeContentType: GLB_CONTENT_TYPE,
        runtimeChecksum: runtime.checksumSha256 ?? runtime.etag,
        processingDiagnostics: { stage: "ready", optimized: { ...optimized.report }, processedAt: new Date().toISOString() },
      } });
      if (changed.count !== 1) return;
      await recordSystemAction(version.companyId, {
        actionKey: AuditAction.PLATFORM_THREE_D_MODEL_CHANGED,
        entity: { type: "Project3DModelVersion", id: version.id, label: `3D model v${version.version}` },
        projectId: version.projectId,
        before: { projectId: version.projectId, slotId: version.slotId, versionId: version.id, version: version.version, status: "PROCESSING", validationStatus: "PENDING", fileName: version.originalFileName },
        after: { projectId: version.projectId, slotId: version.slotId, versionId: version.id, version: version.version, status: "READY", validationStatus, fileName: version.originalFileName },
      }, { tx });
    });
    return "READY";
  } catch {
    await failProcessing(version, "Model processing failed. Review the source GLB and retry with a new version.");
    return "FAILED";
  }
}

export async function processPendingProject3DModels(input: { limit?: number; signal?: AbortSignal } = {}) {
  const versions = await prisma.project3DModelVersion.findMany({ where: { status: "PROCESSING", deletedAt: null }, orderBy: { createdAt: "asc" }, take: input.limit ?? 2, select: { id: true } });
  let ready = 0;
  let failed = 0;
  for (const version of versions) {
    if (input.signal?.aborted) break;
    const result = await processProject3DModelVersion(version.id);
    if (result === "READY") ready += 1;
    if (result === "FAILED") failed += 1;
  }
  return { processed: ready + failed, ready, failed };
}
