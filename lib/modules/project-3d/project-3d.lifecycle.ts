import { createHash, randomBytes } from "node:crypto";
import { Prisma, type Project3DVisibility } from "@prisma/client";

import { AccessError, assertFound, stateDenied } from "@/lib/access/guards";
import type { PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { project3DAuditMetadata } from "./project-3d.audit";
import { isProject3DEntitlementActive, type Project3DEntitlementGate } from "./project-3d.entitlement";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";

/**
 * A 3D experience's audience and lifecycle (ADM-04A §3, §6, §9).
 *
 * Visibility is what the Platform Admin decided; availability is whether
 * anyone can actually view right now. The two are kept apart everywhere a
 * person reads them, so "Company login only" is never mistaken for "working".
 *
 * Every decision here is guarded by the config's controlVersion (a stale
 * decision is a 409, never silently rebased) and bumps accessEpoch, which the
 * gated asset delivery binds each handle to (§8).
 */

export const PROJECT_3D_RESTORE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** An opaque share identifier: public, stable, never derived from a company or project. */
export function newProject3DPublicId(): string {
  return randomBytes(12).toString("base64url");
}

export type Project3DAvailabilityBlocker =
  | "DELETED"
  | "OFFLINE"
  | "ORGANIZATION_INACTIVE"
  | "PROJECT_INELIGIBLE"
  | "ENTITLEMENT_INACTIVE"
  | "NO_RELEASE"
  | "PUBLIC_PROJECTION_MISSING";

export const PROJECT_3D_BLOCKER_TEXT: Record<Project3DAvailabilityBlocker, string> = {
  DELETED: "Deleted",
  OFFLINE: "Offline",
  ORGANIZATION_INACTIVE: "Company or group is not active",
  PROJECT_INELIGIBLE: "Project is archived",
  ENTITLEMENT_INACTIVE: "3D entitlement is not active",
  NO_RELEASE: "No published release",
  PUBLIC_PROJECTION_MISSING: "Public projection not approved for the active release",
};

export type Project3DAvailabilityInput = {
  visibility: Project3DVisibility;
  deletedAt: Date | null;
  activeRelease: { status: string; publicManifestHash: string | null } | null;
  entitlement: Project3DEntitlementGate | null;
  project: { archivedAt: Date | null; status: string };
  companyStatus: string;
  groupStatus: string;
};

const LIVE_GROUP_STATUSES = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"];

/**
 * What stands between this experience and a viewer, in order of cause. Empty
 * means the audience it is set to can view it now. Completed (FINISHED)
 * Projects stay eligible; only archival takes a Project out (§3).
 */
export function project3DAvailability(input: Project3DAvailabilityInput, now = new Date()): { available: boolean; blockers: Project3DAvailabilityBlocker[] } {
  const blockers: Project3DAvailabilityBlocker[] = [];
  if (input.deletedAt) blockers.push("DELETED");
  if (input.visibility === "OFFLINE") blockers.push("OFFLINE");
  if (input.companyStatus !== "ACTIVE" || !LIVE_GROUP_STATUSES.includes(input.groupStatus)) blockers.push("ORGANIZATION_INACTIVE");
  if (input.project.archivedAt || input.project.status === "ARCHIVED") blockers.push("PROJECT_INELIGIBLE");
  if (!isProject3DEntitlementActive(input.entitlement, now)) blockers.push("ENTITLEMENT_INACTIVE");
  if (!input.activeRelease || input.activeRelease.status !== "PUBLISHED") blockers.push("NO_RELEASE");
  else if (input.visibility === "PUBLIC" && !input.activeRelease.publicManifestHash) blockers.push("PUBLIC_PROJECTION_MISSING");
  return { available: blockers.length === 0, blockers };
}

/** The select every availability check reads, so all audiences decide from the same facts. */
export const PROJECT_3D_AVAILABILITY_SELECT = {
  id: true,
  projectId: true,
  companyId: true,
  visibility: true,
  deletedAt: true,
  accessEpoch: true,
  controlVersion: true,
  publicId: true,
  activeReleaseId: true,
  activeRelease: { select: { id: true, status: true, releaseNumber: true, publicManifestHash: true } },
  project: {
    select: {
      archivedAt: true,
      status: true,
      project3DEntitlement: { select: { status: true, viewerEnabled: true, activatedAt: true, expiresAt: true } },
      company: { select: { status: true, parentGroup: { select: { status: true } } } },
    },
  },
} satisfies Prisma.Project3DConfigSelect;

export type Project3DAvailabilityRow = Prisma.Project3DConfigGetPayload<{ select: typeof PROJECT_3D_AVAILABILITY_SELECT }>;

export function availabilityOf(row: Project3DAvailabilityRow, now = new Date()) {
  return project3DAvailability({
    visibility: row.visibility,
    deletedAt: row.deletedAt,
    activeRelease: row.activeRelease,
    entitlement: row.project.project3DEntitlement,
    project: row.project,
    companyStatus: row.project.company.status,
    groupStatus: row.project.company.parentGroup.status,
  }, now);
}

/* -------------------------------------------------------------------------- */
/* Idempotent requests (§10)                                                   */
/* -------------------------------------------------------------------------- */

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/**
 * Runs a state-changing 3D operation once per client request id. A retry after
 * a lost response returns the first outcome — after authorization is checked
 * again by the caller, which runs before this — and the same id sent with a
 * different payload is refused. Without a request id the operation simply runs.
 */
export async function withProject3DRequest<T extends Prisma.InputJsonValue>(
  context: PlatformContext,
  operation: string,
  projectId: string,
  requestId: string | null | undefined,
  payload: unknown,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!requestId) return prisma.$transaction((tx) => run(tx));
  const payloadHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  const key = { actorUserId: context.userId, operation, projectId, requestId };
  const prior = await prisma.project3DMutationRequest.findUnique({ where: { actorUserId_operation_projectId_requestId: key } });
  if (prior) {
    if (prior.payloadHash !== payloadHash) throw new AccessError("CONFLICT", "This request id was already used for a different change.", { code: "REQUEST_ID_REUSED" });
    return prior.outcome as T;
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const outcome = await run(tx);
      await tx.project3DMutationRequest.create({ data: { ...key, payloadHash, outcome } });
      return outcome;
    });
  } catch (error) {
    // Two deliveries of one request raced: the first committed, so answer with it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.project3DMutationRequest.findUnique({ where: { actorUserId_operation_projectId_requestId: key } });
      if (winner && winner.payloadHash === payloadHash) return winner.outcome as T;
      if (winner) throw new AccessError("CONFLICT", "This request id was already used for a different change.", { code: "REQUEST_ID_REUSED" });
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Guards shared by every authoring path                                      */
/* -------------------------------------------------------------------------- */

const NOT_A_FIXTURE = { company: { parentGroup: { isTestFixture: false } } } as const;

/** The config of a live (not deleted) experience, for authoring paths that want a readable refusal before the trigger's. */
export async function assertProject3DExperienceLive(db: Prisma.TransactionClient | typeof prisma, projectId: string): Promise<void> {
  const config = assertFound(await db.project3DConfig.findFirst({ where: { projectId, project: NOT_A_FIXTURE }, select: { deletedAt: true } }));
  if (config.deletedAt) throw new AccessError("CONFLICT", "This 3D experience has been deleted. Restore it before changing it.", { code: "EXPERIENCE_DELETED" });
}

function staleVersion(): AccessError {
  return new AccessError("CONFLICT", "Someone else changed this 3D experience. Reload to see the latest decision, then try again.", { code: "STALE_CONTROL_VERSION" });
}

/** The guarded control write moved nothing: a concurrent decision got there first. */
function assertAdvanced(moved: { count: number }): void {
  if (moved.count !== 1) throw staleVersion();
}

/** Every control decision bumps both counters: stale decisions fail, and old delivery grants die (§8, §10). */
const ADVANCE = { controlVersion: { increment: 1 }, accessEpoch: { increment: 1 } } as const;

async function loadControl(tx: Prisma.TransactionClient, projectId: string) {
  return assertFound(await tx.project3DConfig.findFirst({
    where: { projectId, project: NOT_A_FIXTURE },
    select: {
      ...PROJECT_3D_AVAILABILITY_SELECT,
      experienceName: true,
      previousVisibility: true,
      purgeAfter: true,
      purgeStatus: true,
      project: { select: { ...PROJECT_3D_AVAILABILITY_SELECT.project.select, name: true, company: { select: { status: true, name: true, parentGroupId: true, parentGroup: { select: { status: true } } } } } },
    },
  }));
}

export function project3DExperienceLabel(row: { experienceName: string; project: { name: string } }): string {
  return row.experienceName || `${row.project.name} 3D Experience`;
}

/* -------------------------------------------------------------------------- */
/* Visibility (§6)                                                            */
/* -------------------------------------------------------------------------- */

export type Project3DVisibilityChange = {
  visibility: Project3DVisibility;
  expectedControlVersion: number;
  /** Required when opening PUBLIC: the release and public projection the admin reviewed. */
  releaseId?: string | null;
  publicManifestHash?: string | null;
  reason: string;
  requestId?: string | null;
};

export type Project3DControlOutcome = {
  projectId: string;
  visibility: Project3DVisibility;
  controlVersion: number;
  accessEpoch: number;
  available: boolean;
  blockers: Project3DAvailabilityBlocker[];
};

async function controlOutcome(tx: Prisma.TransactionClient, projectId: string): Promise<Project3DControlOutcome> {
  const row = await loadControl(tx, projectId);
  const { available, blockers } = availabilityOf(row);
  return { projectId, visibility: row.visibility, controlVersion: row.controlVersion, accessEpoch: row.accessEpoch, available, blockers };
}

/**
 * Sets who may view (§6). Offline is always allowed, whatever is broken.
 * Company login only needs nothing beyond the record being live: availability
 * is reported, not required. Public requires an eligible experience whose
 * active release carries an approved public projection — and it must be the
 * exact release and projection the admin reviewed.
 */
export async function setProject3DVisibility(context: PlatformContext, projectId: string, input: Project3DVisibilityChange): Promise<Project3DControlOutcome> {
  assertProject3DPlatformPermission(context, "platform.3d.visibility.manage");
  return withProject3DRequest(context, "visibility", projectId, input.requestId, { ...input, requestId: undefined }, async (tx) => {
    const row = await loadControl(tx, projectId);
    if (row.deletedAt) throw new AccessError("CONFLICT", "This 3D experience has been deleted. Restore it before changing who can view it.", { code: "EXPERIENCE_DELETED" });
    if (row.controlVersion !== input.expectedControlVersion) throw staleVersion();
    if (row.visibility === input.visibility) return await controlOutcome(tx, projectId) as unknown as Prisma.InputJsonObject & Project3DControlOutcome;

    if (input.visibility === "PUBLIC") {
      const probe = availabilityOf({ ...row, visibility: "PUBLIC" });
      if (!probe.available) throw stateDenied(`Not ready to make public: ${probe.blockers.map((blocker) => PROJECT_3D_BLOCKER_TEXT[blocker].toLowerCase()).join("; ")}.`, { code: "PUBLIC_NOT_READY", blockers: probe.blockers });
      if (!input.releaseId || input.releaseId !== row.activeReleaseId || !input.publicManifestHash || input.publicManifestHash !== row.activeRelease?.publicManifestHash) {
        throw new AccessError("CONFLICT", "The active release or its public projection changed since you reviewed it. Review the public preview again.", { code: "PUBLIC_REVIEW_STALE" });
      }
    }

    assertAdvanced(await tx.project3DConfig.updateMany({
      // The WHERE is the lock: the version and audience this decision was made against.
      where: { id: row.id, controlVersion: input.expectedControlVersion, visibility: row.visibility, purgeStatus: row.purgeStatus },
      data: { visibility: input.visibility, updatedByUserId: context.userId, controlVersion: ADVANCE.controlVersion, accessEpoch: ADVANCE.accessEpoch },
    }));
    const after = await controlOutcome(tx, projectId);
    await recordPlatformAction(context, row.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_VISIBILITY_CHANGED,
      entity: { type: "Project3DConfig", id: row.id, label: project3DExperienceLabel(row) }, projectId,
      before: { projectId, configurationId: row.id, visibility: row.visibility, releaseId: row.activeReleaseId, controlVersion: row.controlVersion, accessEpoch: row.accessEpoch },
      after: { projectId, configurationId: row.id, visibility: input.visibility, releaseId: row.activeReleaseId, publicManifestHash: input.visibility === "PUBLIC" ? input.publicManifestHash ?? null : null, controlVersion: after.controlVersion, accessEpoch: after.accessEpoch },
      reason: input.reason,
      metadata: project3DAuditMetadata("VISIBILITY_CHANGED", `Audience set to ${input.visibility}`, { requestId: input.requestId ?? null, available: after.available, blockers: after.blockers }),
    }, { tx });
    return after as unknown as Prisma.InputJsonObject & Project3DControlOutcome;
  });
}

/* -------------------------------------------------------------------------- */
/* Delete and restore (§9)                                                    */
/* -------------------------------------------------------------------------- */

export type Project3DDeleteInput = { expectedControlVersion: number; confirmationName: string; reason: string; requestId?: string | null };

/**
 * Soft-deletes the experience: viewing stops, authoring freezes (the trigger
 * refuses every write under it), and 3D files become eligible for cleanup after
 * the restoration window. The canonical Project, its Units, contracts, Clients,
 * finance records and Documents are not touched — nothing here writes them.
 */
export async function deleteProject3DExperience(context: PlatformContext, projectId: string, input: Project3DDeleteInput): Promise<Project3DControlOutcome & { purgeAfter: string }> {
  assertProject3DPlatformPermission(context, "platform.3d.experience.delete");
  return withProject3DRequest(context, "delete", projectId, input.requestId, { ...input, requestId: undefined }, async (tx) => {
    const row = await loadControl(tx, projectId);
    if (row.deletedAt) throw new AccessError("CONFLICT", "This 3D experience is already deleted.", { code: "EXPERIENCE_DELETED" });
    if (row.controlVersion !== input.expectedControlVersion) throw staleVersion();
    const label = project3DExperienceLabel(row);
    if (input.confirmationName.trim() !== label.trim()) throw new AccessError("VALIDATION_ERROR", "Type the experience name exactly to confirm.", { confirmationName: ["Type the experience name exactly as shown."] });

    const now = new Date();
    const purgeAfter = new Date(now.getTime() + PROJECT_3D_RESTORE_WINDOW_DAYS * DAY_MS);
    assertAdvanced(await tx.project3DConfig.updateMany({
      // The WHERE is the lock: the version and audience this decision was made against.
      where: { id: row.id, controlVersion: input.expectedControlVersion, visibility: row.visibility, purgeStatus: row.purgeStatus },
      data: { deletedAt: now, deletedByUserId: context.userId, deleteReason: input.reason, previousVisibility: row.visibility, visibility: "OFFLINE",
      purgeAfter, purgeStatus: "SCHEDULED", purgeClaimedAt: null, purgeError: null, updatedByUserId: context.userId, controlVersion: ADVANCE.controlVersion, accessEpoch: ADVANCE.accessEpoch },
    }));
    const after = await controlOutcome(tx, projectId);
    await recordPlatformAction(context, row.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_EXPERIENCE_DELETED,
      entity: { type: "Project3DConfig", id: row.id, label }, projectId,
      before: { projectId, configurationId: row.id, visibility: row.visibility, deletedAt: null, controlVersion: row.controlVersion, accessEpoch: row.accessEpoch, activeReleaseId: row.activeReleaseId },
      after: { projectId, configurationId: row.id, visibility: "OFFLINE", deletedAt: now.toISOString(), purgeAfter: purgeAfter.toISOString(), controlVersion: after.controlVersion, accessEpoch: after.accessEpoch, activeReleaseId: row.activeReleaseId },
      reason: input.reason,
      metadata: project3DAuditMetadata("EXPERIENCE_DELETED", `${label} deleted; restorable until ${purgeAfter.toISOString().slice(0, 10)}`, { requestId: input.requestId ?? null }),
    }, { tx });
    return { ...after, purgeAfter: purgeAfter.toISOString() } as unknown as Prisma.InputJsonObject & Project3DControlOutcome & { purgeAfter: string };
  });
}

export type Project3DRestoreInput = { expectedControlVersion: number; reason: string; requestId?: string | null };

/**
 * Brings a deleted experience back inside its window, before purge claimed it.
 * It returns OFFLINE with a new public identity, so every old share link stays
 * dead; reopening viewing is a separate, explicit visibility decision.
 */
export async function restoreProject3DExperience(context: PlatformContext, projectId: string, input: Project3DRestoreInput): Promise<Project3DControlOutcome & { publicId: string }> {
  assertProject3DPlatformPermission(context, "platform.3d.experience.restore");
  return withProject3DRequest(context, "restore", projectId, input.requestId, { ...input, requestId: undefined }, async (tx) => {
    const row = await loadControl(tx, projectId);
    if (!row.deletedAt) throw new AccessError("CONFLICT", "This 3D experience is not deleted.", { code: "EXPERIENCE_NOT_DELETED" });
    if (row.controlVersion !== input.expectedControlVersion) throw staleVersion();
    if (row.purgeStatus === "CLAIMED" || row.purgeStatus === "PURGED") throw new AccessError("CONFLICT", "Its files are being or have been permanently removed, so it can no longer be restored.", { code: "EXPERIENCE_PURGED" });
    if (row.purgeAfter && row.purgeAfter <= new Date()) throw new AccessError("CONFLICT", "The restoration window has ended.", { code: "RESTORE_WINDOW_ENDED" });

    const publicId = newProject3DPublicId();
    assertAdvanced(await tx.project3DConfig.updateMany({
      // The WHERE is the lock: the version and audience this decision was made against.
      where: { id: row.id, controlVersion: input.expectedControlVersion, visibility: row.visibility, purgeStatus: row.purgeStatus },
      data: { deletedAt: null, deletedByUserId: null, deleteReason: null, visibility: "OFFLINE", publicId,
      purgeAfter: null, purgeStatus: null, purgeClaimedAt: null, purgeError: null, updatedByUserId: context.userId, controlVersion: ADVANCE.controlVersion, accessEpoch: ADVANCE.accessEpoch },
    }));
    const after = await controlOutcome(tx, projectId);
    await recordPlatformAction(context, row.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_EXPERIENCE_RESTORED,
      entity: { type: "Project3DConfig", id: row.id, label: project3DExperienceLabel(row) }, projectId,
      before: { projectId, configurationId: row.id, visibility: row.visibility, deletedAt: row.deletedAt.toISOString(), controlVersion: row.controlVersion, accessEpoch: row.accessEpoch },
      after: { projectId, configurationId: row.id, visibility: "OFFLINE", deletedAt: null, publicIdRotated: true, controlVersion: after.controlVersion, accessEpoch: after.accessEpoch },
      reason: input.reason,
      metadata: project3DAuditMetadata("EXPERIENCE_RESTORED", "Restored offline with a new public link", { requestId: input.requestId ?? null, previousVisibility: row.previousVisibility }),
    }, { tx });
    return { ...after, publicId } as unknown as Prisma.InputJsonObject & Project3DControlOutcome & { publicId: string };
  });
}

/** A new share address; the old one stops answering at once (§8). */
export async function rotateProject3DPublicLink(context: PlatformContext, projectId: string, input: { expectedControlVersion: number; reason: string; requestId?: string | null }): Promise<Project3DControlOutcome & { publicId: string }> {
  assertProject3DPlatformPermission(context, "platform.3d.visibility.manage");
  return withProject3DRequest(context, "rotate-link", projectId, input.requestId, { ...input, requestId: undefined }, async (tx) => {
    const row = await loadControl(tx, projectId);
    if (row.deletedAt) throw new AccessError("CONFLICT", "This 3D experience has been deleted.", { code: "EXPERIENCE_DELETED" });
    if (row.controlVersion !== input.expectedControlVersion) throw staleVersion();
    const publicId = newProject3DPublicId();
    assertAdvanced(await tx.project3DConfig.updateMany({
      // The WHERE is the lock: the version and audience this decision was made against.
      where: { id: row.id, controlVersion: input.expectedControlVersion, visibility: row.visibility, purgeStatus: row.purgeStatus },
      data: { publicId, updatedByUserId: context.userId, controlVersion: ADVANCE.controlVersion, accessEpoch: ADVANCE.accessEpoch },
    }));
    const after = await controlOutcome(tx, projectId);
    await recordPlatformAction(context, row.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_PUBLIC_LINK_ROTATED,
      entity: { type: "Project3DConfig", id: row.id, label: project3DExperienceLabel(row) }, projectId,
      before: { projectId, configurationId: row.id, controlVersion: row.controlVersion, accessEpoch: row.accessEpoch },
      after: { projectId, configurationId: row.id, controlVersion: after.controlVersion, accessEpoch: after.accessEpoch },
      reason: input.reason,
      metadata: project3DAuditMetadata("PUBLIC_LINK_ROTATED", "Public link replaced; the old link no longer works", { requestId: input.requestId ?? null }),
    }, { tx });
    return { ...after, publicId } as unknown as Prisma.InputJsonObject & Project3DControlOutcome & { publicId: string };
  });
}

/** Bumps the delivery epoch inside a release change, so handles for the old release stop working (§8). */
export async function bumpProject3DAccessEpoch(tx: Prisma.TransactionClient, configId: string): Promise<void> {
  await tx.project3DConfig.update({ where: { id: configId }, data: { accessEpoch: { increment: 1 } } });
}
