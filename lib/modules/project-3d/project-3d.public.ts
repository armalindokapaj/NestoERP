import { createHash } from "node:crypto";
import { Prisma, type UnitCommercialStatus } from "@prisma/client";

import { AccessError, assertFound, stateDenied } from "@/lib/access/guards";
import {
  PUBLIC_3D_SCHEMA_VERSION,
  public3DBootstrapSchema,
  public3DManifestSchema,
  type Public3DBootstrap,
  type Public3DManifest,
  type Public3DOptionalField,
  type Public3DStatus,
} from "@/lib/3d/public/public-manifest";
import { project3DReleaseManifestSchema } from "@/lib/3d/shared/release.schema";
import type { PlatformContext } from "@/lib/context/platform-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { logger } from "@/lib/core/observability/logger";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { readAuthorizedDocumentThumbnail } from "@/lib/modules/documents/storage/thumbnail.service";
import { project3DAuditMetadata } from "./project-3d.audit";
import { project3DViewerToken, readPublicArtifacts, signProject3DAssetHandle, type Project3DPublicArtifacts } from "./project-3d.delivery";
import { availabilityOf, PROJECT_3D_AVAILABILITY_SELECT, project3DExperienceLabel, withProject3DRequest } from "./project-3d.lifecycle";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";
import { buildProject3DStorageKey } from "./project-3d.storage";
import { hasActiveProject3DViewer } from "./project-3d.viewer";
import { PublicSanitizeError, sanitizeGlbForPublic, stripImageMetadata } from "./processing/glb.public";
import { projectPublicExperience } from "./public/public-experience";

/**
 * The public projection of a release (ADM-04A §5, §7): prepared, previewed and
 * approved by a Platform Admin before any anonymous visitor can receive it.
 *
 * Preparing compiles a strict Public3DManifest and sanitized delivery artifacts
 * outside any transaction, then records them on the release unapproved. Only an
 * approval that names the exact manifest hash the admin previewed makes it
 * deliverable — and, for a PUBLIC experience, moves a newer staged release live.
 */

const NOT_A_FIXTURE = { company: { parentGroup: { isTestFixture: false } } } as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function publicManifestHash(manifest: Public3DManifest): string {
  return createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}

function publicUnitStatus(status: UnitCommercialStatus | null): "available" | "reserved" | "sold" {
  if (status === "SOLD") return "sold";
  if (status === "RESERVED" || status === "ON_HOLD") return "reserved";
  return "available";
}

function publicUnitType(category: string | undefined): "residential" | "commercial" | "parking" | "storage" {
  if (category === "COMMERCIAL") return "commercial";
  if (category === "PARKING") return "parking";
  if (category === "STORAGE") return "storage";
  return "residential";
}

/** The public unit list of a release, read from the canonical Units now — the snapshot an approval freezes. */
async function publicUnits(release: { projectId: string; companyId: string; unitIds: string[] }, fields: ReadonlySet<Public3DOptionalField>) {
  const rows = release.unitIds.length === 0 ? [] : await prisma.projectUnit.findMany({
    where: { id: { in: release.unitIds }, projectId: release.projectId, companyId: release.companyId },
    select: { id: true, unitCode: true, saleableArea: true, internalArea: true, unitType: { select: { category: true } }, floor: { select: { number: true } }, commercialProfile: { select: { status: true } } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return release.unitIds.map((unitId, index) => {
    const unit = byId.get(unitId);
    const area = unit?.saleableArea ?? unit?.internalArea ?? null;
    return {
      ref: `u${index + 1}`,
      label: fields.has("unitCode") && unit ? unit.unitCode : `Unit ${index + 1}`,
      code: fields.has("unitCode") && unit ? unit.unitCode : null,
      floor: fields.has("unitFloor") ? unit?.floor.number ?? null : null,
      type: fields.has("unitType") ? publicUnitType(unit?.unitType?.category) : null,
      area: fields.has("unitArea") && area ? Number(area.toFixed(2)) : null,
      status: fields.has("availability") ? publicUnitStatus(unit?.commercialProfile?.status ?? null) : null,
    };
  });
}

async function loadRelease(projectId: string, releaseId: string) {
  const config = assertFound(await prisma.project3DConfig.findFirst({
    where: { projectId, project: NOT_A_FIXTURE },
    select: {
      ...PROJECT_3D_AVAILABILITY_SELECT,
      experienceName: true,
      project: { select: { ...PROJECT_3D_AVAILABILITY_SELECT.project.select, name: true, city: true, coverImage: { select: { id: true, updatedAt: true, storageKey: true, thumbnailStorageKey: true, detectedMimeType: true, mimeType: true, status: true, storageStatus: true } }, company: { select: { status: true, parentGroupId: true, parentGroup: { select: { status: true } } } } } },
    },
  }));
  if (config.deletedAt) throw new AccessError("CONFLICT", "This 3D experience has been deleted.", { code: "EXPERIENCE_DELETED" });
  const release = assertFound(await prisma.project3DRelease.findFirst({
    where: { id: releaseId, configId: config.id, projectId, companyId: config.companyId, status: "PUBLISHED" },
    select: { id: true, releaseNumber: true, manifest: true, publicManifest: true, publicManifestHash: true, publicApprovedAt: true, publicArtifactKeys: true },
  }));
  return { config, release };
}

export type Project3DPublicPrepare = {
  releaseId: string;
  title: string;
  description?: string | null;
  fields: Public3DOptionalField[];
};

/**
 * Builds the public projection of one release. A failure — an unsupported
 * model, a texture that cannot be cleaned — changes nothing already public:
 * the release keeps whatever it had, and the active release keeps serving.
 */
export async function prepareProject3DPublicProjection(context: PlatformContext, projectId: string, input: Project3DPublicPrepare) {
  assertProject3DPlatformPermission(context, "platform.3d.visibility.manage");
  const { config, release } = await loadRelease(projectId, input.releaseId);
  if (release.publicApprovedAt && config.activeReleaseId === release.id && config.visibility === "PUBLIC") {
    throw stateDenied("This release's public projection is live. Publish a new release to change what the public sees.", { code: "PUBLIC_PROJECTION_LIVE" });
  }
  const internal = project3DReleaseManifestSchema.safeParse(release.manifest);
  if (!internal.success) throw stateDenied("This release cannot be read.", { code: "INVALID_RELEASE" });
  const fields = new Set(input.fields);

  const provider = storageProvider();
  const written: string[] = [];
  const artifacts: Project3DPublicArtifacts = {};
  try {
    const models: Public3DManifest["models"] = [];
    const unitIds: string[] = [];
    const unitRef = (unitId: string) => {
      let index = unitIds.indexOf(unitId);
      if (index < 0) index = unitIds.push(unitId) - 1;
      return `u${index + 1}`;
    };
    const assetOfSlot = new Map(internal.data.models.map((model, index) => [model.slotId, `m${index + 1}`]));

    for (const [index, model] of internal.data.models.entries()) {
      const source = await provider.getObject(model.runtimeStorageKey);
      if (!source) throw new PublicSanitizeError(`${model.slotName}'s model file is missing.`);
      let clean;
      try {
        clean = await sanitizeGlbForPublic(source);
      } catch (error) {
        throw new PublicSanitizeError(`${model.slotName}: ${error instanceof Error ? error.message : "could not be sanitized"}`);
      }
      const assetId = `m${index + 1}`;
      const key = buildProject3DStorageKey({ companyId: config.companyId, projectId, kind: "derived", extension: "glb" });
      await provider.putObject(key, clean.bytes, "model/gltf-binary");
      written.push(key);
      artifacts[assetId] = { key, contentType: "model/gltf-binary" };

      const bindings = model.unitBindings.map((binding) => {
        const meshName = clean.names.get(binding.meshName);
        if (!meshName) throw new PublicSanitizeError(`${model.slotName}: unit ${binding.unitCode} is bound to a part of the model that could not be found.`);
        return { meshName, unitRef: unitRef(binding.unitId), poiYawDeg: binding.poiYawDeg, poiEnabled: binding.poiEnabled, poiDistanceOverride: binding.poiDistanceOverride, poiHeightOverride: binding.poiHeightOverride };
      });
      models.push({
        assetId,
        role: model.slotRole,
        parentAssetId: model.transformParentSlotId ? assetOfSlot.get(model.transformParentSlotId) ?? null : null,
        transform: model.transform,
        visible: model.visible,
        castShadow: model.castShadow,
        receiveShadow: model.receiveShadow,
        selectable: model.selectable,
        sceneManifest: clean.sceneManifest,
        nodeOverrides: model.nodeOverrides.flatMap((override) => {
          const nodeId = clean.nodeIds.get(override.nodeId);
          return nodeId ? [{ ...override, nodeId }] : [];
        }),
        unitBindings: bindings,
      });
    }

    let cover: Public3DManifest["cover"] = null;
    const document = config.project.coverImage;
    if (fields.has("cover") && document && document.status === "ACTIVE" && document.storageStatus === "AVAILABLE") {
      // A dedicated public rendition of the cover; the Document itself stays private.
      const thumbnail = await readAuthorizedDocumentThumbnail(config.companyId, document);
      const type = thumbnail.contentType === "image/png" || thumbnail.contentType === "image/jpeg" ? thumbnail.contentType : "image/webp";
      const bytes = stripImageMetadata(thumbnail.body, type);
      const key = buildProject3DStorageKey({ companyId: config.companyId, projectId, kind: "derived", extension: type.split("/")[1] });
      await provider.putObject(key, bytes, type);
      written.push(key);
      artifacts.c1 = { key, contentType: type };
      cover = { assetId: "c1", contentType: type };
    }

    const manifest = public3DManifestSchema.parse({
      schemaVersion: PUBLIC_3D_SCHEMA_VERSION,
      releaseNumber: release.releaseNumber,
      title: input.title.trim(),
      description: fields.has("description") ? (input.description?.trim() || null) : null,
      city: fields.has("city") ? config.project.city ?? null : null,
      cover,
      experience: projectPublicExperience(internal.data.experience, { availability: fields.has("availability") }),
      models,
      units: await publicUnits({ projectId, companyId: config.companyId, unitIds }, fields),
      fields: [...fields].filter((field) => field !== "cover" || cover !== null),
    } satisfies Public3DManifest);
    const hash = publicManifestHash(manifest);

    const previous = readPublicArtifacts(release.publicArtifactKeys);
    const saved = await prisma.project3DRelease.updateMany({
      // Guarded on what was read: a concurrent preparation or approval wins.
      where: { id: release.id, publicManifestHash: release.publicManifestHash, publicApprovedAt: release.publicApprovedAt },
      data: { publicManifest: manifest as unknown as Prisma.InputJsonValue, publicManifestHash: hash, publicSchemaVersion: PUBLIC_3D_SCHEMA_VERSION, publicApprovedAt: null, publicApprovedByUserId: null, publicArtifactKeys: artifacts as unknown as Prisma.InputJsonValue },
    });
    if (saved.count !== 1) throw new AccessError("CONFLICT", "This release's public projection changed while it was being prepared. Reload and try again.", { code: "PUBLIC_PROJECTION_RACED" });
    written.length = 0;
    // The unapproved projection this replaces owned its artifacts alone.
    for (const artifact of Object.values(previous)) await provider.deleteObject(artifact.key).catch(() => undefined);

    await recordPlatformAction(context, config.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_PUBLIC_PREPARED,
      entity: { type: "Project3DRelease", id: release.id, label: `${project3DExperienceLabel(config)} release ${release.releaseNumber}` }, projectId,
      before: { projectId, configurationId: config.id, releaseId: release.id, releaseNumber: release.releaseNumber, publicManifestHash: release.publicManifestHash },
      after: { projectId, configurationId: config.id, releaseId: release.id, releaseNumber: release.releaseNumber, publicManifestHash: hash, publicSchemaVersion: PUBLIC_3D_SCHEMA_VERSION, fields: manifest.fields },
      metadata: project3DAuditMetadata("PUBLIC_PROJECTION_PREPARED", `Public projection prepared for release ${release.releaseNumber}; not yet approved`),
    });
    return { releaseId: release.id, publicManifestHash: hash, manifest };
  } catch (error) {
    for (const key of written) await provider.deleteObject(key).catch(() => undefined);
    if (error instanceof PublicSanitizeError) throw stateDenied(`Not ready for public delivery: ${error.message}`, { code: "PUBLIC_SANITIZATION_FAILED" });
    throw error;
  }
}

export type Project3DPublicApprove = { releaseId: string; publicManifestHash: string; confirmPublicDistribution: true; reason: string; requestId?: string | null };

/**
 * Approves exactly the projection the admin previewed. For a PUBLIC experience
 * whose approved release is newer than the live one, the release goes live in
 * the same transaction and every older delivery handle stops working.
 */
export async function approveProject3DPublicProjection(context: PlatformContext, projectId: string, input: Project3DPublicApprove) {
  assertProject3DPlatformPermission(context, "platform.3d.visibility.manage");
  assertProject3DPlatformPermission(context, "platform.3d.publish");
  return withProject3DRequest(context, "approve-public", projectId, input.requestId, { ...input, requestId: undefined }, async (tx) => {
    const config = assertFound(await tx.project3DConfig.findFirst({ where: { projectId, project: NOT_A_FIXTURE }, select: { id: true, companyId: true, deletedAt: true, visibility: true, activeReleaseId: true, experienceName: true, activeRelease: { select: { releaseNumber: true } }, project: { select: { name: true, company: { select: { parentGroupId: true } } } } } }));
    if (config.deletedAt) throw new AccessError("CONFLICT", "This 3D experience has been deleted.", { code: "EXPERIENCE_DELETED" });
    const release = assertFound(await tx.project3DRelease.findFirst({ where: { id: input.releaseId, configId: config.id, projectId, status: "PUBLISHED" }, select: { id: true, releaseNumber: true, publicManifestHash: true, publicApprovedAt: true } }));
    if (!release.publicManifestHash || release.publicManifestHash !== input.publicManifestHash) {
      throw new AccessError("CONFLICT", "The public projection changed since you previewed it. Preview it again before approving.", { code: "PUBLIC_REVIEW_STALE" });
    }
    const now = new Date();
    if (!release.publicApprovedAt) {
      const approved = await tx.project3DRelease.updateMany({ where: { id: release.id, publicManifestHash: input.publicManifestHash, publicApprovedAt: null }, data: { publicApprovedAt: now, publicApprovedByUserId: context.userId } });
      if (approved.count !== 1) throw new AccessError("CONFLICT", "The public projection changed since you previewed it.", { code: "PUBLIC_REVIEW_STALE" });
    }
    const goesLive = config.visibility === "PUBLIC" && config.activeReleaseId !== release.id && release.releaseNumber > (config.activeRelease?.releaseNumber ?? 0);
    if (goesLive) {
      if (config.activeReleaseId) await tx.project3DRelease.updateMany({ where: { id: config.activeReleaseId, configId: config.id }, data: { supersededAt: now } });
      await tx.project3DRelease.updateMany({ where: { id: release.id, configId: config.id }, data: { activatedAt: now, supersededAt: null } });
      const moved = await tx.project3DConfig.updateMany({ where: { id: config.id, activeReleaseId: config.activeReleaseId, visibility: "PUBLIC", deletedAt: null }, data: { activeReleaseId: release.id, accessEpoch: { increment: 1 }, updatedByUserId: context.userId } });
      if (moved.count !== 1) throw new AccessError("CONFLICT", "The live release or audience changed. Reload and review again.", { code: "RELEASE_RACED" });
    }
    const label = `${config.experienceName || `${config.project.name} 3D Experience`} release ${release.releaseNumber}`;
    await recordPlatformAction(context, config.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_PUBLIC_APPROVED,
      entity: { type: "Project3DRelease", id: release.id, label }, projectId,
      before: { projectId, configurationId: config.id, releaseId: release.id, releaseNumber: release.releaseNumber, publicManifestHash: release.publicManifestHash },
      after: { projectId, configurationId: config.id, releaseId: release.id, releaseNumber: release.releaseNumber, publicManifestHash: input.publicManifestHash },
      reason: input.reason,
      metadata: project3DAuditMetadata("PUBLIC_PROJECTION_APPROVED", goesLive ? `Public projection approved; release ${release.releaseNumber} is live` : "Public projection approved", { requestId: input.requestId ?? null, confirmedPublicDistribution: true, wentLive: goesLive }),
    }, { tx });
    return { releaseId: release.id, approvedAt: now.toISOString(), live: goesLive };
  });
}

/** What a release's public version shows when Platform Admin never chose otherwise. */
const DEFAULT_PUBLIC_FIELDS: Project3DPublicPrepare["fields"] = ["description", "cover", "city", "unitCode", "unitFloor", "unitType", "unitArea", "availability"];

/**
 * Platform Admin decides alone: going Public, or publishing while Public,
 * prepares and approves the release's public version in the same step, with
 * no separate review. An already approved release is left as it is. Returns
 * the approved public version's hash.
 */
export async function ensureProject3DPublicRelease(context: PlatformContext, projectId: string, releaseId: string): Promise<string> {
  const { config, release } = await loadRelease(projectId, releaseId);
  if (release.publicApprovedAt && release.publicManifestHash) return release.publicManifestHash;
  const previous = release.publicManifest ? public3DManifestSchema.safeParse(release.publicManifest) : null;
  const prepared = await prepareProject3DPublicProjection(context, projectId, {
    releaseId,
    title: (previous?.success ? previous.data.title : null) ?? (config.experienceName || `${config.project.name} 3D Experience`),
    description: previous?.success ? previous.data.description : null,
    fields: previous?.success ? previous.data.fields : DEFAULT_PUBLIC_FIELDS,
  });
  await approveProject3DPublicProjection(context, projectId, { releaseId, publicManifestHash: prepared.publicManifestHash, confirmPublicDistribution: true, reason: "Published by Platform Admin" });
  return prepared.publicManifestHash;
}

/* -------------------------------------------------------------------------- */
/* Bootstraps                                                                  */
/* -------------------------------------------------------------------------- */

function bootstrapOf(manifest: Public3DManifest, assetUrl: (assetId: string) => string, token: string, preview: boolean): Public3DBootstrap {
  return public3DBootstrapSchema.parse({
    schemaVersion: manifest.schemaVersion,
    releaseNumber: manifest.releaseNumber,
    title: manifest.title,
    description: manifest.description,
    city: manifest.city,
    coverUrl: manifest.cover ? assetUrl(manifest.cover.assetId) : null,
    experience: manifest.experience,
    models: manifest.models.map((model) => ({ ...model, assetUrl: assetUrl(model.assetId) })),
    units: manifest.units,
    fields: manifest.fields,
    token,
    preview,
  });
}

/**
 * A Platform-only preview of exactly what an anonymous visitor would receive
 * from this release's projection, approved or not, with the list of included
 * fields and whether the canonical Unit facts have moved on since.
 */
export async function getProject3DPublicPreview(context: PlatformContext, projectId: string, releaseId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const { config, release } = await loadRelease(projectId, releaseId);
  if (!release.publicManifest) return { prepared: false as const };
  const manifest = public3DManifestSchema.parse(release.publicManifest);
  const internal = project3DReleaseManifestSchema.safeParse(release.manifest);
  const unitIds: string[] = [];
  if (internal.success) for (const model of internal.data.models) for (const binding of model.unitBindings) if (!unitIds.includes(binding.unitId)) unitIds.push(binding.unitId);
  const current = await publicUnits({ projectId, companyId: config.companyId, unitIds }, new Set(manifest.fields));
  const stale = canonicalJson(current) !== canonicalJson(manifest.units);
  const bootstrap = bootstrapOf(manifest, (assetId) => `/api/platform/3d/projects/${encodeURIComponent(projectId)}/public-preview/assets/${signProject3DAssetHandle({ c: config.id, r: release.id, a: assetId, au: "preview", e: config.accessEpoch })}`, project3DViewerToken(release.id, config.accessEpoch), true);
  return { prepared: true as const, approved: Boolean(release.publicApprovedAt), publicManifestHash: release.publicManifestHash!, stale, bootstrap };
}

async function configByPublicId(publicId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(publicId)) return null;
  return prisma.project3DConfig.findFirst({
    where: { publicId, project: NOT_A_FIXTURE },
    select: { ...PROJECT_3D_AVAILABILITY_SELECT, activeRelease: { select: { ...PROJECT_3D_AVAILABILITY_SELECT.activeRelease.select, publicManifest: true, publicApprovedAt: true } } },
  });
}

/** The anonymous state of a share address. Nothing about the organization behind it, in any state. */
export async function getPublic3DStatus(publicId: string): Promise<Public3DStatus> {
  const row = await configByPublicId(publicId);
  if (!row || row.deletedAt) return { state: "UNAVAILABLE", token: null };
  if (row.visibility === "COMPANY_ONLY" || row.visibility === "PRIVATE") return { state: "LOGIN_REQUIRED", token: null };
  if (row.visibility !== "PUBLIC" || !availabilityOf(row).available || !row.activeRelease?.publicApprovedAt) return { state: "UNAVAILABLE", token: null };
  return { state: "AVAILABLE", token: project3DViewerToken(row.activeReleaseId, row.accessEpoch) };
}

/** The anonymous viewer's bootstrap, or the state that replaces it. */
export async function getPublic3DBootstrap(publicId: string): Promise<{ state: "AVAILABLE"; bootstrap: Public3DBootstrap } | { state: "LOGIN_REQUIRED" | "UNAVAILABLE" }> {
  const status = await getPublic3DStatus(publicId);
  if (status.state !== "AVAILABLE") return { state: status.state };
  const row = (await configByPublicId(publicId))!;
  const parsed = public3DManifestSchema.safeParse(row.activeRelease?.publicManifest);
  if (!parsed.success || !row.activeReleaseId) {
    logger.error("project3d.public.manifest_unreadable", { configId: row.id });
    return { state: "UNAVAILABLE" };
  }
  const bootstrap = bootstrapOf(parsed.data, (assetId) => `/api/public/3d/${encodeURIComponent(publicId)}/assets/${signProject3DAssetHandle({ c: row.id, r: row.activeReleaseId!, a: assetId, au: "public", e: row.accessEpoch })}`, project3DViewerToken(row.activeReleaseId, row.accessEpoch), false);
  return { state: "AVAILABLE", bootstrap };
}

/**
 * After sign-in on a share address: the canonical company viewer, if this
 * person may open it. The address is always built here, never taken from the
 * request, so it cannot send anyone off-site.
 */
export async function resolveCompanyViewerForPublicId(context: UserContext, publicId: string): Promise<string | null> {
  const row = await configByPublicId(publicId);
  if (!row || row.deletedAt || (row.visibility !== "COMPANY_ONLY" && row.visibility !== "PUBLIC" && row.visibility !== "PRIVATE")) return null;
  if (row.companyId !== context.companyId || !await hasActiveProject3DViewer(context, row.projectId)) return null;
  return `/projects/${encodeURIComponent(row.projectId)}/3d`;
}
