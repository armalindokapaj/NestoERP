import type { Prisma } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import type { PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { logger } from "@/lib/core/observability/logger";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { countProject3DOperation, project3DAuditMetadata } from "./project-3d.audit";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";
import { assertProject3DStorageKey } from "./project-3d.storage";

/**
 * Permanent deletion from the Model Library (Experience Editor no-reason PRD
 * §13-§15, §26, §43). Distinct from removing a model from an Experience, which
 * only detaches it and keeps every file.
 *
 * A model version belongs to one Experience; it is never shared with another.
 * What can still depend on it is checked first, and anything that would break
 * blocks the delete rather than cascading (§14):
 *
 *   - a published release (active or not) serves its runtime file, and an older
 *     release must stay restorable, so a released version is never deleted;
 *   - the version the Experience currently shows must be removed from the
 *     Experience (or replaced) first;
 *   - a version still uploading or being prepared would race its own files.
 *
 * Unit bindings belong to the version and go with it; the dialog says how many.
 * The row is kept, marked deleted, so the audit trail and history still name
 * it; the stored files are removed.
 */

const NOT_A_FIXTURE = { company: { parentGroup: { isTestFixture: false } } } as const;
const USABLE = ["READY", "PUBLISHED"] as const;

export type Project3DModelUsageBlocker = "RELEASED" | "SHOWN_IN_EXPERIENCE" | "IN_PROGRESS";

export type Project3DModelUsage = {
  versionId: string;
  version: number;
  fileName: string;
  experience: { projectId: string; name: string };
  model: { slotId: string; name: string; inExperience: boolean };
  releases: number[];
  shownInExperience: boolean;
  bindingCount: number;
  blockers: Project3DModelUsageBlocker[];
};

async function loadVersion(versionId: string) {
  return assertFound(await prisma.project3DModelVersion.findFirst({
    where: { id: versionId, deletedAt: null, project: NOT_A_FIXTURE },
    select: {
      id: true, companyId: true, projectId: true, slotId: true, version: true, originalFileName: true, status: true, validationStatus: true,
      sourceStorageKey: true, runtimeStorageKey: true,
      slot: { select: { id: true, displayName: true, isActive: true, versions: { where: { deletedAt: null, status: { in: [...USABLE] }, runtimeStorageKey: { not: null } }, orderBy: { version: "desc" }, take: 1, select: { id: true } } } },
      project: { select: { name: true, company: { select: { parentGroupId: true } } } },
      _count: { select: { unitBindings: true } },
    },
  }));
}

function referencesVersion(manifest: Prisma.JsonValue, versionId: string): boolean {
  const models = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? (manifest as { models?: unknown }).models : null;
  return Array.isArray(models) && models.some((model) => model && typeof model === "object" && (model as { versionId?: unknown }).versionId === versionId);
}

async function usageOf(version: Awaited<ReturnType<typeof loadVersion>>, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<Project3DModelUsage> {
  const releases = await client.project3DRelease.findMany({ where: { projectId: version.projectId, companyId: version.companyId }, orderBy: { releaseNumber: "asc" }, select: { releaseNumber: true, manifest: true } });
  const inReleases = releases.filter((release) => referencesVersion(release.manifest, version.id)).map((release) => release.releaseNumber);
  const shownInExperience = version.slot.isActive && version.slot.versions[0]?.id === version.id;
  const blockers: Project3DModelUsageBlocker[] = [];
  if (inReleases.length > 0 || version.status === "PUBLISHED") blockers.push("RELEASED");
  if (shownInExperience) blockers.push("SHOWN_IN_EXPERIENCE");
  if (version.status === "UPLOADED" || version.status === "PROCESSING") blockers.push("IN_PROGRESS");
  return {
    versionId: version.id,
    version: version.version,
    fileName: version.originalFileName,
    experience: { projectId: version.projectId, name: version.project.name },
    model: { slotId: version.slot.id, name: version.slot.displayName, inExperience: version.slot.isActive },
    releases: inReleases,
    shownInExperience,
    bindingCount: version._count.unitBindings,
    blockers,
  };
}

/** Where a model version is still used, and whether that blocks deleting it. */
export async function getProject3DModelVersionUsage(context: PlatformContext, versionId: string): Promise<Project3DModelUsage> {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  return usageOf(await loadVersion(versionId));
}

export async function deleteProject3DModelVersion(context: PlatformContext, versionId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.model.delete");
  const version = await loadVersion(versionId);
  const now = new Date();
  const deleted = await prisma.$transaction(async (tx) => {
    const usage = await usageOf(version, tx);
    if (usage.blockers.length > 0) {
      countProject3DOperation("delete_blocked");
      throw new AccessError("CONFLICT", blockedMessage(usage), { code: "MODEL_IN_USE", blockers: usage.blockers, releases: usage.releases });
    }
    // Guarded on the status read above, so a release or an upload that lands meanwhile wins.
    const changed = await tx.project3DModelVersion.updateMany({
      where: { id: version.id, deletedAt: null, status: version.status },
      data: { deletedAt: now, deletedByUserId: context.userId },
    });
    if (changed.count !== 1) throw new AccessError("CONFLICT", "This model changed while it was being deleted. Refresh and try again.", { code: "MODEL_RACED" });
    const bindings = await tx.project3DUnitMeshBinding.deleteMany({ where: { modelVersionId: version.id, projectId: version.projectId, companyId: version.companyId } });
    const snapshot = { projectId: version.projectId, slotId: version.slotId, versionId: version.id, version: version.version, status: version.status, validationStatus: version.validationStatus, fileName: version.originalFileName };
    await recordPlatformAction(context, version.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_MODEL_CHANGED,
      entity: { type: "Project3DModelVersion", id: version.id, label: `${version.slot.displayName} v${version.version}` },
      projectId: version.projectId,
      before: snapshot,
      after: { ...snapshot, deletedAt: now.toISOString() },
      metadata: project3DAuditMetadata("MODEL_FILE_DELETED", `${version.originalFileName} deleted permanently`, { unitBindingsRemoved: bindings.count }),
    }, { tx });
    return { id: version.id, unitBindingsRemoved: bindings.count };
  });
  countProject3DOperation("delete");

  // The record is already gone from every list; a file that fails to delete is an orphan to sweep, never a live reference.
  const provider = storageProvider();
  for (const [key, kind] of [[version.sourceStorageKey, "source"], [version.runtimeStorageKey, "runtime"]] as const) {
    if (!key) continue;
    try {
      assertProject3DStorageKey(key, version.companyId, version.projectId, kind);
      await provider.deleteObject(key);
    } catch (error) {
      logger.warn("project3d.model.file_delete_failed", { versionId: version.id, kind, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return deleted;
}

function blockedMessage(usage: Project3DModelUsage): string {
  if (usage.blockers.includes("RELEASED")) {
    const releases = usage.releases.length ? ` (release ${usage.releases.join(", ")})` : "";
    return `This model is part of a published release${releases}, so its file stays. Remove it from the Experience instead.`;
  }
  if (usage.blockers.includes("SHOWN_IN_EXPERIENCE")) return "This model is still shown in its 3D Experience. Remove it from the Experience first.";
  return "This model is still uploading or being prepared. Try again when it has finished.";
}
