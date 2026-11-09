import { Prisma } from "@prisma/client";

import type { UnitTypeCategory } from "@/config/unit-types";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { auditContextFromUser, platformAuditContext, recordAuditEvents } from "@/lib/core/audit/audit.service";
import type { RecordAuditInput } from "@/lib/core/audit/audit.types";
import { prisma } from "@/lib/database/prisma";
import { recordActivities } from "@/lib/modules/shared/activity";
import { fullName } from "@/lib/utils/format";
import { MODULE, UNIT_ENTITY } from "./structure.permissions";
import { AREA_FIELDS, type AreaField, type UnitAttributes } from "./structure.types";
import { buildSnapshot, evaluateReadiness, hasUnpublishedChanges, isPdf, isUnitImage, type LiveUnitFacts } from "./unit-publishing.rules";
import type { Readiness, UnitMediaCategory, UnitSnapshot } from "./unit-publishing.types";

/**
 * What publishing needs to know about a unit, read in one batched query (E-05D
 * §16, §17, §27, §102): its technical data, its Sales Plan and primary image and
 * their current versions, the files it points at, and the version it last
 * published. The readiness panel, the drift flag and the publish transaction
 * all read this one shape, so they cannot disagree about what a unit is.
 */

type Client = Prisma.TransactionClient | typeof prisma;

const FILE_SELECT = {
  id: true,
  name: true,
  status: true,
  storageStatus: true,
  mimeType: true,
  extension: true,
  originalFileName: true,
  currentVersionId: true,
} satisfies Prisma.DocumentSelect;

export const PUBLISH_STATE_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  unitCode: true,
  name: true,
  position: true,
  orientation: true,
  internalArea: true,
  grossArea: true,
  saleableArea: true,
  outdoorArea: true,
  balconyArea: true,
  terraceArea: true,
  gardenArea: true,
  commonAreaAllocation: true,
  rooms: true,
  bedrooms: true,
  bathrooms: true,
  attributes: true,
  description: true,
  isActive: true,
  version: true,
  publicationStatus: true,
  preArchivePublicationStatus: true,
  publicationStatusChangedAt: true,
  currentPublicationId: true,
  hasUnpublishedChanges: true,
  revisionReason: true,
  salesPlanDocumentId: true,
  unitType: { select: { id: true, name: true, category: true } },
  floor: { select: { id: true, name: true, number: true, levelType: true, building: { select: { id: true, name: true, code: true } } } },
  currentPublication: { select: { id: true, versionNumber: true, publishedAt: true, publishedByMemberId: true, snapshot: true } },
  salesPlanDocument: { select: FILE_SELECT },
  media: { where: { isPrimary: true }, select: { id: true, category: true, caption: true, document: { select: FILE_SELECT } } },
} satisfies Prisma.ProjectUnitSelect;

export type PublishStateRow = Prisma.ProjectUnitGetPayload<{ select: typeof PUBLISH_STATE_SELECT }>;

/** Every media item's file state, for the "attached files available" check — primary or not. */
async function unavailableCounts(client: Client, companyId: string, unitIds: string[]): Promise<Map<string, number>> {
  if (unitIds.length === 0) return new Map();
  const unavailable: Prisma.DocumentWhereInput = { OR: [{ status: "ARCHIVED" }, { storageStatus: { not: "AVAILABLE" } }] };
  const [links, media] = await Promise.all([
    client.unitDocumentLink.groupBy({ by: ["unitId"], where: { companyId, unitId: { in: unitIds }, document: { is: unavailable } }, _count: { _all: true } }),
    client.unitMedia.groupBy({ by: ["unitId"], where: { companyId, unitId: { in: unitIds }, document: { is: unavailable } }, _count: { _all: true } }),
  ]);
  const counts = new Map<string, number>();
  for (const row of [...links, ...media]) counts.set(row.unitId, (counts.get(row.unitId) ?? 0) + row._count._all);
  return counts;
}

export type PublishState = {
  row: PublishStateRow;
  facts: LiveUnitFacts;
  published: UnitSnapshot | null;
  readiness: Readiness;
  /** Computed from the data, not read from the stored flag — a Sales Plan version promoted by the scanner counts at once. */
  drift: boolean;
};

const fileAvailable = (file: { status: string; storageStatus: string } | null | undefined) => Boolean(file && file.status === "ACTIVE" && file.storageStatus === "AVAILABLE");

function decimals(row: PublishStateRow): Record<AreaField, string | null> {
  return Object.fromEntries(AREA_FIELDS.map((field) => [field, row[field]?.toFixed(2) ?? null])) as Record<AreaField, string | null>;
}

function attributesOf(value: Prisma.JsonValue): UnitAttributes {
  return (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as UnitAttributes;
}

function toState(row: PublishStateRow, unavailable: number, versionNumbers: Map<string, number>): PublishState {
  const salesPlanFile = row.salesPlanDocument;
  const salesPlanOk = fileAvailable(salesPlanFile) && isPdf(salesPlanFile?.mimeType, salesPlanFile?.extension) && Boolean(salesPlanFile?.currentVersionId);
  const primary = row.media[0] ?? null;
  const primaryOk = Boolean(primary && fileAvailable(primary.document) && isUnitImage(primary.document.mimeType) && primary.document.currentVersionId);

  const facts: LiveUnitFacts = {
    unitCode: row.unitCode,
    name: row.name,
    unitType: { id: row.unitType.id, name: row.unitType.name, category: row.unitType.category as UnitTypeCategory },
    building: row.floor.building,
    floor: { id: row.floor.id, name: row.floor.name, number: row.floor.number, levelType: row.floor.levelType },
    position: row.position,
    orientation: row.orientation,
    areas: decimals(row),
    rooms: row.rooms,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    attributes: attributesOf(row.attributes),
    description: row.description,
    // Only a version that is really there is what would be published.
    salesPlan: salesPlanOk && salesPlanFile ? { documentId: salesPlanFile.id, documentVersionId: salesPlanFile.currentVersionId!, versionNumber: versionNumbers.get(salesPlanFile.currentVersionId!) ?? null, fileName: salesPlanFile.originalFileName } : null,
    primaryImage: primaryOk && primary ? { documentId: primary.document.id, documentVersionId: primary.document.currentVersionId!, category: primary.category as UnitMediaCategory, caption: primary.caption } : null,
  };

  const published = (row.currentPublication?.snapshot ?? null) as UnitSnapshot | null;
  const readiness = evaluateReadiness({
    unitCode: row.unitCode,
    unitType: row.unitType ? { name: row.unitType.name, category: row.unitType.category as UnitTypeCategory } : null,
    building: row.floor.building,
    floor: row.floor,
    areas: facts.areas,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    orientation: row.orientation,
    isActive: row.isActive,
    salesPlan: salesPlanFile ? { available: salesPlanOk } : null,
    primaryImage: primary ? { available: primaryOk } : null,
    unavailableReferences: unavailable,
  });
  return { row, facts, published, readiness, drift: hasUnpublishedChanges(facts, published) };
}

export async function loadPublishStates(client: Client, companyId: string, unitIds: string[]): Promise<Map<string, PublishState>> {
  if (unitIds.length === 0) return new Map();
  const [rows, unavailable] = await Promise.all([
    client.projectUnit.findMany({ where: { companyId, id: { in: unitIds } }, select: PUBLISH_STATE_SELECT }),
    unavailableCounts(client, companyId, unitIds),
  ]);
  const versionIds = rows.map((row) => row.salesPlanDocument?.currentVersionId).filter((id): id is string => Boolean(id));
  const versions = versionIds.length ? await client.documentVersion.findMany({ where: { companyId, id: { in: versionIds } }, select: { id: true, versionNumber: true } }) : [];
  const versionNumbers = new Map(versions.map((version) => [version.id, version.versionNumber]));
  return new Map(rows.map((row) => [row.id, toState(row, unavailable.get(row.id) ?? 0, versionNumbers)]));
}

export async function loadPublishState(client: Client, companyId: string, unitId: string): Promise<PublishState | null> {
  return (await loadPublishStates(client, companyId, [unitId])).get(unitId) ?? null;
}

/** Holds the unit row for the rest of the transaction: publishing, media order and the Sales Plan queue behind it (§82). */
export async function lockUnit(tx: Prisma.TransactionClient, unitId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "project_units" WHERE "id" = ${unitId} FOR UPDATE`;
}

/**
 * Who a version is published by (units publish on create, 2026-11). A member's
 * change publishes in their name, with the unit's activity and the member's
 * audit. A Platform Admin building the structure in the 3D tool is no member of
 * the company, and the scan worker promoting a file version is nobody: both
 * publish "automatically" — no member on the version, no activity row (the
 * business log never holds an anonymous change), and the audit names the
 * platform user or the system.
 */
export type PublishActor =
  | { kind: "member"; context: UserContext }
  | { kind: "platform"; context: { userId: string; fullName: string; roleKey: string }; parentGroupId: string }
  | { kind: "system" };

export type AutoPublication = { unitId: string; publicationId: string; versionNumber: number };

/**
 * Publishes what the units now are (units publish on create, 2026-11). Called
 * in the transaction of every write that can change a unit's publish facts —
 * creating it, an edit, a move, its floor moved to another building, a new
 * Sales Plan version, a new primary image, a restore, a file version promoted
 * by the scanner — so the published version is always the live unit.
 *
 * A unit is written a version when it is Published and has none yet, or when
 * its fingerprint (`publishFingerprint`) differs from its current version; a
 * change that puts a value back, or that touches nothing a version keeps,
 * writes nothing. An archived unit is out of use and is not published; neither
 * is a unit still in a retired review state (none exist after the 2026-11
 * migration; archive and restore bring one back Published).
 *
 * The version is the same snapshot a reviewer's publish used to write. Only
 * `currentPublicationId` and the retired flag are written on the unit — never
 * its state or its row `version`, so the version an edit returns to its page
 * stays the one the next save must send. The rows are locked first, in id
 * order, so two changes to one unit cannot both take the same version number.
 */
export async function publishLiveUnits(tx: Prisma.TransactionClient, actor: PublishActor, companyId: string, unitIds: string[]): Promise<AutoPublication[]> {
  const ids = [...new Set(unitIds)].sort();
  if (ids.length === 0) return [];
  await tx.$queryRaw`SELECT "id" FROM "project_units" WHERE "id" = ANY(${ids}::text[]) AND "companyId" = ${companyId} ORDER BY "id" FOR UPDATE`;
  const states = await loadPublishStates(tx, companyId, ids);
  const due = ids.map((id) => states.get(id)).filter((state): state is PublishState => Boolean(state && state.row.publicationStatus === "PUBLISHED" && (!state.row.currentPublicationId || state.drift)));
  if (due.length === 0) return [];

  const maxima = await tx.unitPublication.groupBy({ by: ["unitId"], where: { companyId, unitId: { in: due.map((state) => state.row.id) } }, _max: { versionNumber: true } });
  const last = new Map(maxima.map((row) => [row.unitId, row._max.versionNumber ?? 0]));
  const publishedByMemberId = actor.kind === "member" ? actor.context.membershipId : null;
  const drafts = due.map((state) => ({ state, versionNumber: (last.get(state.row.id) ?? 0) + 1, snapshot: buildSnapshot(state.facts) }));

  // One INSERT for the versions, one UPDATE for the pointers, one each for the evidence: a bulk creation of hundreds of units stays one short transaction.
  const created = await tx.unitPublication.createManyAndReturn({
    data: drafts.map(({ state, versionNumber, snapshot }) => ({
      companyId,
      projectId: state.row.projectId,
      unitId: state.row.id,
      versionNumber,
      publishedByMemberId,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      salesPlanDocumentId: snapshot.salesPlan?.documentId ?? null,
      salesPlanDocumentVersionId: snapshot.salesPlan?.documentVersionId ?? null,
      primaryMediaDocumentId: snapshot.primaryImage?.documentId ?? null,
      primaryMediaDocumentVersionId: snapshot.primaryImage?.documentVersionId ?? null,
    })),
    select: { id: true, unitId: true },
  });
  const publicationOf = new Map(created.map((row) => [row.unitId, row.id]));

  // The unit stays Published and keeps its row version; only its pointer moves, from the version it was read with.
  const pointers = drafts.map(({ state }) => Prisma.sql`(${state.row.id}::text, ${publicationOf.get(state.row.id)!}::text, ${state.row.currentPublicationId}::text)`);
  const pointed = await tx.$executeRaw`
    UPDATE "project_units" AS u
    SET "currentPublicationId" = v."publicationId", "hasUnpublishedChanges" = false
    FROM (VALUES ${Prisma.join(pointers)}) AS v("unitId", "publicationId", "previousId")
    WHERE u."id" = v."unitId" AND u."companyId" = ${companyId} AND u."publicationStatus" = 'PUBLISHED'
      AND u."currentPublicationId" IS NOT DISTINCT FROM v."previousId"`;
  // The rows are locked above, so a miss means the unit moved under this transaction: refuse the whole change.
  if (pointed !== drafts.length) throw new AccessError("CONFLICT", "This unit was updated by another user. Refresh before continuing.", { code: "STRUCTURE_STALE" });

  const published = drafts.map(({ state, versionNumber }) => ({ unitId: state.row.id, publicationId: publicationOf.get(state.row.id)!, versionNumber }));
  const audits: RecordAuditInput[] = drafts.map(({ state, versionNumber, snapshot }) => ({
    actionKey: AuditAction.PROJECT_UNIT_PUBLISHED,
    entity: { type: UNIT_ENTITY, id: state.row.id, label: state.row.unitCode },
    projectId: state.row.projectId,
    before: { publicationStatus: state.row.publicationStatus, versionNumber: state.row.currentPublication?.versionNumber ?? null },
    after: {
      publicationStatus: "PUBLISHED",
      versionNumber,
      publicationId: publicationOf.get(state.row.id)!,
      salesPlanDocumentVersionId: snapshot.salesPlan?.documentVersionId ?? null,
      primaryMediaDocumentVersionId: snapshot.primaryImage?.documentVersionId ?? null,
    },
    metadata: { automatic: true },
  }));

  if (actor.kind === "member") {
    await recordActivities(
      tx,
      actor.context,
      drafts.map(({ state, versionNumber }) => ({
        module: MODULE,
        entityType: UNIT_ENTITY,
        entityId: state.row.id,
        action: "UNIT_PUBLISHED",
        message: versionNumber === 1 ? `published ${state.row.unitCode}` : `published ${state.row.unitCode} as version ${versionNumber}`,
        metadata: { projectId: state.row.projectId, publicationId: publicationOf.get(state.row.id)!, versionNumber },
      })),
    );
    await recordAuditEvents(auditContextFromUser(actor.context), audits, { tx });
  } else if (actor.kind === "platform") {
    await recordAuditEvents(platformAuditContext(actor.context, actor.parentGroupId, companyId), audits, { tx });
  } else {
    await recordAuditEvents({ companyId, actor: { type: "SYSTEM" } }, audits, { tx });
  }
  return published;
}

/**
 * The door the Documents module opens when a file version becomes current
 * (`promoteVersion`): every unit whose Sales Plan or primary image is that
 * document publishes what it now is. The scan worker promotes a version long
 * after the upload's request ended, so nobody is acting — the version is
 * published automatically.
 */
export async function publishUnitsUsingDocument(tx: Prisma.TransactionClient, documentId: string): Promise<AutoPublication[]> {
  const units = await tx.projectUnit.findMany({
    where: { publicationStatus: "PUBLISHED", OR: [{ salesPlanDocumentId: documentId }, { media: { some: { documentId, isPrimary: true } } }] },
    select: { id: true, companyId: true },
  });
  const byCompany = new Map<string, string[]>();
  for (const unit of units) byCompany.set(unit.companyId, [...(byCompany.get(unit.companyId) ?? []), unit.id]);
  const published: AutoPublication[] = [];
  for (const [companyId, ids] of byCompany) published.push(...(await publishLiveUnits(tx, { kind: "system" }, companyId, ids)));
  return published;
}

/**
 * A unit deleted while nothing else points at it takes its own versions with it
 * (E-05B §56). Since a unit publishes on create, every unit has at least one;
 * they are a mirror of the unit, written by nobody's decision, and are not what
 * keeps a unit from being deleted — a file, an image, a sale or a contract is.
 * The caller has already refused a unit anything else points at.
 */
export async function deleteOwnPublications(tx: Prisma.TransactionClient, companyId: string, unitId: string): Promise<void> {
  await tx.projectUnit.updateMany({ where: { companyId, id: unitId }, data: { currentPublicationId: null } });
  await tx.unitPublication.deleteMany({ where: { companyId, unitId } });
}

/** Display names for the members a publishing record names. */
export async function memberDisplayNames(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: wanted } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, fullName(row.user.firstName, row.user.lastName)]));
}
