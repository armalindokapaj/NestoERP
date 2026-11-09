import { Prisma, type UnitPublicationStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { applyTransition } from "@/lib/core/state/transition";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { MODULE, structureOpen, UNIT_ENTITY } from "./structure.permissions";
import { fail, findReadableUnit } from "./structure.service";
import { loadPublishState, lockUnit, memberDisplayNames, publishLiveUnits, type PublishState } from "./unit-publishing.state";
import type { PublicationDetailDTO, PublicationSummaryDTO, UnitPublishingCapabilities, UnitPublishingDTO, UnitSnapshot } from "./unit-publishing.types";
import { unitPublicationMachine } from "./unit-publication.machine";

/**
 * A unit's publication (E-05D §13-§32, §50, §51; units publish on create,
 * 2026-11).
 *
 * There is nothing to submit, approve or send back: a unit is published when it
 * is created, and every change to what it publishes writes the next version in
 * the change's own transaction (`publishLiveUnits`). What is left here is
 * reading where a unit stands and its history, and the one way out of use —
 * archive — with restore, which brings the unit back Published. The readiness
 * checklist is information only: it never blocks anything.
 */

type Tx = Prisma.TransactionClient;

const stale = () => fail("STRUCTURE_STALE", "This unit was updated by another user. Refresh before continuing.", "CONFLICT");

export function publishingCapabilities(context: UserContext): UnitPublishingCapabilities {
  const open = structureOpen(context);
  const has = (permission: Parameters<typeof can>[1]) => open && can(context, permission);
  return {
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

/** The unit's publishing panel: state, current version, readiness (information only) and what the reader may do (§45, §60). */
export async function getUnitPublishing(context: UserContext, unitId: string): Promise<UnitPublishingDTO> {
  const unit = await findReadableUnit(context, unitId);
  const state = await stateFor(prisma, context, unit.id);
  const current = state.row.currentPublication;
  const names = await memberDisplayNames(context.companyId, [current?.publishedByMemberId]);
  return {
    status: state.row.publicationStatus,
    statusChangedAt: state.row.publicationStatusChangedAt?.toISOString() ?? null,
    currentPublication: current
      ? { id: current.id, versionNumber: current.versionNumber, publishedAt: current.publishedAt.toISOString(), publishedBy: current.publishedByMemberId ? (names.get(current.publishedByMemberId) ?? null) : null, publishedByMemberId: current.publishedByMemberId }
      : null,
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
    publishedBy: row.publishedByMemberId ? (names.get(row.publishedByMemberId) ?? null) : null,
    publishedByMemberId: row.publishedByMemberId,
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
    publishedBy: row.publishedByMemberId ? (names.get(row.publishedByMemberId) ?? null) : null,
    publishedByMemberId: row.publishedByMemberId,
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

/**
 * A unit Sales is offering, holding, has reserved or has sold stays in use (E-05E
 * §6): archiving it would take away what a client is relying on. Sales takes it
 * off sale first.
 */
async function assertNotOnSale(tx: Tx, companyId: string, unitId: string) {
  const profile = await tx.unitCommercialProfile.findFirst({ where: { companyId, unitId }, select: { status: true } });
  if (profile && profile.status !== "NOT_FOR_SALE") {
    const words = { FOR_SALE: "for sale", ON_HOLD: "on hold for Sales", RESERVED: "reserved", SOLD: "sold" } as const;
    throw fail("UNIT_ON_SALE", `This unit is ${words[profile.status]}. Sales must take it off sale before it is taken out of use.`, "CONFLICT");
  }
}

/** Archive (§32): out of every normal workflow, nothing deleted. The only way a unit leaves use. */
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
 * Restore: the unit comes back Published, whatever it held before it was
 * archived, and what it now is goes out as its next version if it changed while
 * archived — or as its first, if it never had one.
 */
export async function restoreUnit(context: UserContext, unitId: string, input: { expectedVersion: number }): Promise<Outcome> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.archive");

  return runInTransaction("structure.unit.restore", async (tx) => {
    await lockUnit(tx, unit.id);
    const state = await stateFor(tx, context, unit.id);
    checkVersion(state, input.expectedVersion);
    const from = state.row.publicationStatus;
    await applyTransition(tx, {
      machine: unitPublicationMachine,
      action: "restore",
      id: unit.id,
      context,
      from,
      expectedVersion: state.row.version,
      data: { preArchivePublicationStatus: null, revisionReason: null, publicationStatusChangedAt: new Date(), updatedBy: context.userId },
    });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_UNIT_PUBLICATION_STATUS_CHANGED,
        entity: { type: UNIT_ENTITY, id: unit.id, label: state.row.unitCode },
        projectId: state.row.projectId,
        before: { publicationStatus: from },
        after: { publicationStatus: "PUBLISHED" },
        metadata: { action: "restore" },
      },
      { tx },
    );
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_RESTORED", message: `restored ${state.row.unitCode}`, metadata: { projectId: state.row.projectId } });
    await publishLiveUnits(tx, { kind: "member", context }, context.companyId, [unit.id]);
    return { status: "PUBLISHED", version: state.row.version + 1 };
  });
}
