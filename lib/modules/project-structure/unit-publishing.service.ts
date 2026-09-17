import { Prisma, type UnitPublicationStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertPermission } from "@/lib/access/guards";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { applyTransition } from "@/lib/core/state/transition";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { MODULE, structureOpen, UNIT_ENTITY } from "./structure.permissions";
import { fail, findReadableUnit } from "./structure.service";
import { buildSnapshot, notReadyMessage } from "./unit-publishing.rules";
import { cancelRequests, decideRequest, openRequest, pendingRequest, requestForDecision } from "./unit-publishing.requests";
import { loadPublishState, lockUnit, memberDisplayNames, type PublishState } from "./unit-publishing.state";
import { REVISION_REASON_MAX, type PublicationDetailDTO, type PublicationSummaryDTO, type UnitPublishingCapabilities, type UnitPublishingDTO, type UnitSnapshot } from "./unit-publishing.types";
import { unitPublicationMachine } from "./unit-publication.machine";

/**
 * Publishing a unit (E-05D §13-§32, §47, §65-§70, §82).
 *
 * Every move reads the unit through its project's door, then locks the row and
 * reads it again inside the transaction: readiness, the version the person saw,
 * the open request and the next version number are all decided under that lock,
 * so two reviewers publishing at once produce one version, and a unit edited a
 * moment before publishing is published as it now is — or refused, if it is no
 * longer complete (§17, §82). The state itself moves only by the machine.
 */

type Tx = Prisma.TransactionClient;

const stale = () => fail("STRUCTURE_STALE", "This unit was updated by another user. Refresh before continuing.", "CONFLICT");

export function publishingCapabilities(context: UserContext): UnitPublishingCapabilities {
  const open = structureOpen(context);
  const has = (permission: Parameters<typeof can>[1]) => open && can(context, permission);
  return {
    canSubmit: has("project.unit.submit_for_publish"),
    canPublish: has("project.unit.publish"),
    canRequestRevision: has("project.unit.revision_request"),
    canUnpublish: has("project.unit.unpublish"),
    canArchive: has("project.unit.archive"),
    canRestore: has("project.unit.archive"),
    canViewHistory: has("project.unit.publication_history.view"),
    canManageDocuments: has("project.unit.documents.manage"),
    canManageMedia: has("project.unit.media.manage"),
  };
}

/* Reads --------------------------------------------------------------------- */

async function stateFor(client: Tx | typeof prisma, context: UserContext, unitId: string): Promise<PublishState> {
  const state = await loadPublishState(client, context.companyId, unitId);
  if (!state) throw fail("UNIT_NOT_FOUND", "That unit could not be found.", "NOT_FOUND");
  return state;
}

/** The unit's publishing panel: state, current version, readiness, the open request and what the reader may do (§45-§47, §60). */
export async function getUnitPublishing(context: UserContext, unitId: string): Promise<UnitPublishingDTO> {
  const unit = await findReadableUnit(context, unitId);
  const [state, pending] = await Promise.all([stateFor(prisma, context, unit.id), pendingRequest(prisma, context.companyId, unit.id)]);
  const current = state.row.currentPublication;
  const names = await memberDisplayNames(context.companyId, [pending?.submittedByMemberId, current?.publishedByMemberId]);
  return {
    status: state.row.publicationStatus,
    statusChangedAt: state.row.publicationStatusChangedAt?.toISOString() ?? null,
    currentPublication: current ? { id: current.id, versionNumber: current.versionNumber, publishedAt: current.publishedAt.toISOString(), publishedBy: names.get(current.publishedByMemberId) ?? null } : null,
    hasUnpublishedChanges: state.drift,
    revisionReason: state.row.revisionReason,
    pendingRequest: pending ? { id: pending.id, submittedAt: pending.submittedAt.toISOString(), submittedBy: names.get(pending.submittedByMemberId) ?? null, submittedByMemberId: pending.submittedByMemberId } : null,
    readiness: state.readiness,
    capabilities: publishingCapabilities(context),
  };
}

function assertHistory(context: UserContext) {
  assertPermission(context, "project.unit.publication_history.view");
}

/** Every published version, newest first (§50). */
export async function listUnitPublications(context: UserContext, unitId: string): Promise<PublicationSummaryDTO[]> {
  const unit = await findReadableUnit(context, unitId);
  assertHistory(context);
  const [rows, current] = await Promise.all([
    prisma.unitPublication.findMany({
      where: { companyId: context.companyId, unitId: unit.id },
      orderBy: { versionNumber: "desc" },
      select: { id: true, versionNumber: true, publishedAt: true, publishedByMemberId: true, snapshot: true },
    }),
    prisma.projectUnit.findFirst({ where: { companyId: context.companyId, id: unit.id }, select: { currentPublicationId: true } }),
  ]);
  const names = await memberDisplayNames(context.companyId, rows.map((row) => row.publishedByMemberId));
  return rows.map((row) => ({
    id: row.id,
    versionNumber: row.versionNumber,
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: names.get(row.publishedByMemberId) ?? null,
    isCurrent: row.id === current?.currentPublicationId,
    salesPlanVersionNumber: (row.snapshot as UnitSnapshot).salesPlan?.versionNumber ?? null,
  }));
}

/** One published version as it was approved: its snapshot, Sales Plan version and primary image (§51). */
export async function getUnitPublication(context: UserContext, unitId: string, publicationId: string): Promise<PublicationDetailDTO> {
  const unit = await findReadableUnit(context, unitId);
  assertHistory(context);
  const row = await prisma.unitPublication.findFirst({
    where: { companyId: context.companyId, unitId: unit.id, id: publicationId },
    select: { id: true, versionNumber: true, publishedAt: true, publishedByMemberId: true, snapshot: true, unit: { select: { currentPublicationId: true } } },
  });
  if (!row) throw fail("PUBLICATION_NOT_FOUND", "That published version could not be found.", "NOT_FOUND");
  const names = await memberDisplayNames(context.companyId, [row.publishedByMemberId]);
  const snapshot = row.snapshot as UnitSnapshot;
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: names.get(row.publishedByMemberId) ?? null,
    isCurrent: row.unit.currentPublicationId === row.id,
    salesPlanVersionNumber: snapshot.salesPlan?.versionNumber ?? null,
    snapshot,
  };
}

/* Transitions ---------------------------------------------------------------- */

type Outcome = { status: UnitPublicationStatus; version: number };

function checkVersion(state: PublishState, expectedVersion: number | undefined) {
  if (expectedVersion !== undefined && state.row.version !== expectedVersion) throw stale();
}

function assertReady(state: PublishState, action: "published" | "submitted") {
  if (!state.readiness.ready) {
    throw fail("UNIT_NOT_READY", notReadyMessage(state.readiness, action), "VALIDATION_ERROR", { missing: state.readiness.missing });
  }
}

/**
 * A unit Sales is offering, holding, has reserved or has sold stays in use (E-05E
 * §6): unpublishing, archiving or pulling it for revision would take away what a
 * client is relying on. Sales takes it off sale first.
 */
async function assertNotOnSale(tx: Tx, companyId: string, unitId: string) {
  const profile = await tx.unitCommercialProfile.findFirst({ where: { companyId, unitId }, select: { status: true } });
  if (profile && profile.status !== "NOT_FOR_SALE") {
    const words = { FOR_SALE: "for sale", ON_HOLD: "on hold for Sales", RESERVED: "reserved", SOLD: "sold" } as const;
    throw fail("UNIT_ON_SALE", `This unit is ${words[profile.status]}. Sales must take it off sale before it is taken out of use.`, "CONFLICT");
  }
}

function assertReason(reason: string | null | undefined): string {
  const value = reason?.trim() ?? "";
  if (!value) throw new AccessError("VALIDATION_ERROR", "Give a reason.", { field: "reason", reason: ["Give a reason."] });
  if (value.length > REVISION_REASON_MAX) throw new AccessError("VALIDATION_ERROR", `Keep the reason under ${REVISION_REASON_MAX.toLocaleString("en")} characters.`, { field: "reason" });
  return value;
}

async function statusEvidence(tx: Tx, context: UserContext, state: PublishState, from: UnitPublicationStatus, to: UnitPublicationStatus, extra: { revisionReason?: string | null; action: string }) {
  await recordUserAction(
    context,
    {
      actionKey: AuditAction.PROJECT_UNIT_PUBLICATION_STATUS_CHANGED,
      entity: { type: UNIT_ENTITY, id: state.row.id, label: state.row.unitCode },
      projectId: state.row.projectId,
      before: { publicationStatus: from, revisionReason: state.row.revisionReason },
      after: { publicationStatus: to, revisionReason: extra.revisionReason === undefined ? state.row.revisionReason : extra.revisionReason },
      metadata: { action: extra.action },
    },
    { tx },
  );
}

/**
 * Submit for publishing (§21, §65). A draft or a unit sent back for revision
 * becomes Ready for Publishing; a published unit with unpublished changes stays
 * Published and asks for its changes to be reviewed. Either way, only a unit that
 * is complete can ask (§16).
 */
export async function submitUnitForPublishing(context: UserContext, unitId: string, input: { expectedVersion: number }): Promise<Outcome & { requestId: string }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.submit_for_publish");

  return runInTransaction("structure.unit.submit_for_publishing", async (tx) => {
    await lockUnit(tx, unit.id);
    const state = await stateFor(tx, context, unit.id);
    checkVersion(state, input.expectedVersion);
    const from = state.row.publicationStatus;
    if (from === "READY_FOR_PUBLISHING") throw fail("UNIT_ALREADY_SUBMITTED", "This unit is already waiting for review.", "CONFLICT");
    if (from === "ARCHIVED") throw fail("UNIT_ARCHIVED", "This unit is archived. Restore it before submitting it.", "CONFLICT");
    if (from === "PUBLISHED") {
      if (!state.drift) throw fail("UNIT_NO_UNPUBLISHED_CHANGES", `Nothing has changed since version ${state.row.currentPublication?.versionNumber}.`, "CONFLICT");
      if (await pendingRequest(tx, context.companyId, unit.id)) throw fail("UNIT_ALREADY_SUBMITTED", "These changes are already waiting for review.", "CONFLICT");
    }
    assertReady(state, "submitted");

    let version = state.row.version;
    if (from !== "PUBLISHED") {
      await applyTransition(tx, {
        machine: unitPublicationMachine,
        action: "submit",
        id: unit.id,
        context,
        from,
        expectedVersion: state.row.version,
        data: { publicationStatusChangedAt: new Date(), updatedBy: context.userId },
      });
      version += 1;
      await statusEvidence(tx, context, state, from, "READY_FOR_PUBLISHING", { action: "submit" });
    }
    const requestId = await openRequest(tx, context, state.row);
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: UNIT_ENTITY,
      entityId: unit.id,
      action: "UNIT_SUBMITTED_FOR_PUBLISHING",
      message: from === "PUBLISHED" ? `submitted the changes to ${state.row.unitCode} for publishing` : `submitted ${state.row.unitCode} for publishing`,
      metadata: { projectId: state.row.projectId, requestId },
    });
    return { status: from === "PUBLISHED" ? "PUBLISHED" : "READY_FOR_PUBLISHING", version, requestId };
  });
}

/**
 * Publish (§23, §66, §82): validate again, write the next immutable version with
 * the exact Sales Plan version and primary image, point the unit at it, clear the
 * unpublished-changes flag and close the open request — all or nothing.
 */
export async function publishUnit(
  context: UserContext,
  unitId: string,
  input: { expectedVersion?: number; note?: string | null },
  guard?: ApprovalGuard,
): Promise<Outcome & { publicationId: string; versionNumber: number; alreadyPublished: boolean }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.publish");

  return runInTransaction("structure.unit.publish", async (tx) => {
    await lockUnit(tx, unit.id);
    const state = await stateFor(tx, context, unit.id);
    checkVersion(state, input.expectedVersion);
    const from = state.row.publicationStatus;
    const request = await requestForDecision(tx, context.companyId, unit.id, guard);
    const note = input.note?.trim() || null;

    // Changes reverted since they were submitted leave nothing new to publish: the
    // request is settled against the version that is already live.
    if (from === "PUBLISHED" && !state.drift) {
      const current = state.row.currentPublication!;
      if (!request) throw fail("UNIT_NO_UNPUBLISHED_CHANGES", `Nothing has changed since version ${current.versionNumber}.`, "CONFLICT");
      await decideRequest(tx, context, request, unit.id, "APPROVED", note);
      return { status: from, version: state.row.version, publicationId: current.id, versionNumber: current.versionNumber, alreadyPublished: true };
    }
    if (from === "ARCHIVED") throw fail("UNIT_ARCHIVED", "This unit is archived. Restore it before publishing it.", "CONFLICT");
    assertReady(state, "published");

    const last = await tx.unitPublication.aggregate({ where: { companyId: context.companyId, unitId: unit.id }, _max: { versionNumber: true } });
    const versionNumber = (last._max.versionNumber ?? 0) + 1;
    const snapshot = buildSnapshot(state.facts);
    const publication = await tx.unitPublication.create({
      data: {
        companyId: context.companyId,
        projectId: state.row.projectId,
        unitId: unit.id,
        versionNumber,
        publishedByMemberId: context.membershipId,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        salesPlanDocumentId: snapshot.salesPlan?.documentId ?? null,
        salesPlanDocumentVersionId: snapshot.salesPlan?.documentVersionId ?? null,
        primaryMediaDocumentId: snapshot.primaryImage?.documentId ?? null,
        primaryMediaDocumentVersionId: snapshot.primaryImage?.documentVersionId ?? null,
      },
      select: { id: true },
    });

    await applyTransition(tx, {
      machine: unitPublicationMachine,
      action: "publish",
      id: unit.id,
      context,
      from,
      expectedVersion: state.row.version,
      data: { currentPublicationId: publication.id, hasUnpublishedChanges: false, revisionReason: null, publicationStatusChangedAt: from === "PUBLISHED" ? undefined : new Date(), updatedBy: context.userId },
    });
    if (request) await decideRequest(tx, context, request, unit.id, "APPROVED", note);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: UNIT_ENTITY,
      entityId: unit.id,
      action: "UNIT_PUBLISHED",
      message: versionNumber === 1 ? `published ${state.row.unitCode}` : `published ${state.row.unitCode} as version ${versionNumber}`,
      metadata: { projectId: state.row.projectId, publicationId: publication.id, versionNumber },
    });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_UNIT_PUBLISHED,
        entity: { type: UNIT_ENTITY, id: unit.id, label: state.row.unitCode },
        projectId: state.row.projectId,
        before: { publicationStatus: from, versionNumber: state.row.currentPublication?.versionNumber ?? null },
        after: {
          publicationStatus: "PUBLISHED",
          versionNumber,
          publicationId: publication.id,
          salesPlanDocumentVersionId: snapshot.salesPlan?.documentVersionId ?? null,
          primaryMediaDocumentVersionId: snapshot.primaryImage?.documentVersionId ?? null,
        },
      },
      { tx },
    );
    return { status: "PUBLISHED", version: state.row.version + 1, publicationId: publication.id, versionNumber, alreadyPublished: false };
  });
}

/**
 * Revision required (§22, §67). A unit waiting for review goes back with a
 * reason. A published unit whose *changes* are waiting keeps its live version:
 * the changes are returned, not the unit. A published unit with nothing waiting
 * comes out of use until it is corrected and published again.
 */
export async function requestUnitRevision(
  context: UserContext,
  unitId: string,
  input: { reason: string; expectedVersion?: number },
  guard?: ApprovalGuard,
): Promise<Outcome & { returnedChangesOnly: boolean }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.revision_request");
  const reason = assertReason(input.reason);

  return runInTransaction("structure.unit.revision_required", async (tx) => {
    await lockUnit(tx, unit.id);
    const state = await stateFor(tx, context, unit.id);
    checkVersion(state, input.expectedVersion);
    const from = state.row.publicationStatus;
    const request = await requestForDecision(tx, context.companyId, unit.id, guard);

    if (from === "PUBLISHED" && request) {
      const moved = await tx.projectUnit.updateMany({
        where: { companyId: context.companyId, id: unit.id, publicationStatus: "PUBLISHED", version: state.row.version },
        data: { revisionReason: reason, version: { increment: 1 }, updatedBy: context.userId },
      });
      if (!moved.count) throw stale();
      await decideRequest(tx, context, request, unit.id, "RETURNED", reason);
      await statusEvidence(tx, context, state, from, from, { revisionReason: reason, action: "return_changes" });
      await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_CHANGES_RETURNED", message: `returned the unpublished changes to ${state.row.unitCode} for revision`, metadata: { projectId: state.row.projectId, requestId: request.id } });
      return { status: from, version: state.row.version + 1, returnedChangesOnly: true };
    }

    if (from === "PUBLISHED") await assertNotOnSale(tx, context.companyId, unit.id);
    await applyTransition(tx, {
      machine: unitPublicationMachine,
      action: "request_revision",
      id: unit.id,
      context,
      from,
      expectedVersion: state.row.version,
      reason,
      data: { revisionReason: reason, publicationStatusChangedAt: new Date(), updatedBy: context.userId },
    });
    if (request) await decideRequest(tx, context, request, unit.id, "RETURNED", reason);
    await statusEvidence(tx, context, state, from, "REVISION_REQUIRED", { revisionReason: reason, action: "request_revision" });
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_REVISION_REQUIRED", message: `asked for a revision of ${state.row.unitCode}`, metadata: { projectId: state.row.projectId } });
    return { status: "REVISION_REQUIRED", version: state.row.version + 1, returnedChangesOnly: false };
  });
}

/**
 * Unpublish (§31, §68): back to Ready for Publishing, with a reason, and a request
 * open so the unit is visibly waiting for somebody to publish it again. Every
 * published version stays in the history.
 */
export async function unpublishUnit(context: UserContext, unitId: string, input: { reason: string; expectedVersion: number }): Promise<Outcome> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.unpublish");
  const reason = assertReason(input.reason);

  return runInTransaction("structure.unit.unpublish", async (tx) => {
    await lockUnit(tx, unit.id);
    const state = await stateFor(tx, context, unit.id);
    checkVersion(state, input.expectedVersion);
    const from = state.row.publicationStatus;
    await assertNotOnSale(tx, context.companyId, unit.id);
    await applyTransition(tx, {
      machine: unitPublicationMachine,
      action: "unpublish",
      id: unit.id,
      context,
      from,
      expectedVersion: state.row.version,
      reason,
      data: { publicationStatusChangedAt: new Date(), updatedBy: context.userId },
    });
    // A request already open for the unit's changes becomes the request to publish it again.
    if (!(await pendingRequest(tx, context.companyId, unit.id))) await openRequest(tx, context, state.row);
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_UNPUBLISHED", message: `unpublished ${state.row.unitCode}`, metadata: { projectId: state.row.projectId } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_UNIT_UNPUBLISHED,
        entity: { type: UNIT_ENTITY, id: unit.id, label: state.row.unitCode },
        projectId: state.row.projectId,
        before: { publicationStatus: from, versionNumber: state.row.currentPublication?.versionNumber ?? null },
        after: { publicationStatus: "READY_FOR_PUBLISHING", reason },
      },
      { tx },
    );
    return { status: "READY_FOR_PUBLISHING", version: state.row.version + 1 };
  });
}

/** Archive (§32): out of every normal workflow, nothing deleted, any open request cancelled. */
export async function archiveUnit(context: UserContext, unitId: string, input: { expectedVersion: number }): Promise<Outcome> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.archive");

  return runInTransaction("structure.unit.archive", async (tx) => {
    await lockUnit(tx, unit.id);
    const state = await stateFor(tx, context, unit.id);
    checkVersion(state, input.expectedVersion);
    const from = state.row.publicationStatus;
    await assertNotOnSale(tx, context.companyId, unit.id);
    await applyTransition(tx, {
      machine: unitPublicationMachine,
      action: "archive",
      id: unit.id,
      context,
      from,
      expectedVersion: state.row.version,
      data: { preArchivePublicationStatus: from, publicationStatusChangedAt: new Date(), updatedBy: context.userId },
    });
    await cancelRequests(tx, context, unit.id);
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_ARCHIVED", message: `archived ${state.row.unitCode}`, metadata: { projectId: state.row.projectId } });
    await recordUserAction(
      context,
      { actionKey: AuditAction.PROJECT_UNIT_ARCHIVED, entity: { type: UNIT_ENTITY, id: unit.id, label: state.row.unitCode }, projectId: state.row.projectId, before: { publicationStatus: from }, after: { publicationStatus: "ARCHIVED" } },
      { tx },
    );
    return { status: "ARCHIVED", version: state.row.version + 1 };
  });
}

/**
 * Restore: back to what the unit held before it was archived. A unit archived
 * while waiting for review comes back as a Draft — its request was cancelled —
 * and a published unit comes back published only if it still has a version.
 */
export async function restoreUnit(context: UserContext, unitId: string, input: { expectedVersion: number }): Promise<Outcome> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.archive");

  return runInTransaction("structure.unit.restore", async (tx) => {
    await lockUnit(tx, unit.id);
    const state = await stateFor(tx, context, unit.id);
    checkVersion(state, input.expectedVersion);
    const previous = state.row.preArchivePublicationStatus;
    const to: UnitPublicationStatus = previous === "PUBLISHED" && state.row.currentPublicationId ? "PUBLISHED" : previous === "REVISION_REQUIRED" ? "REVISION_REQUIRED" : "DRAFT";
    await applyTransition(tx, {
      machine: unitPublicationMachine,
      action: "restore",
      id: unit.id,
      context,
      from: state.row.publicationStatus,
      to,
      expectedVersion: state.row.version,
      data: { preArchivePublicationStatus: null, publicationStatusChangedAt: new Date(), updatedBy: context.userId },
    });
    await statusEvidence(tx, context, state, state.row.publicationStatus, to, { action: "restore" });
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_RESTORED", message: `restored ${state.row.unitCode}`, metadata: { projectId: state.row.projectId } });
    return { status: to, version: state.row.version + 1 };
  });
}
