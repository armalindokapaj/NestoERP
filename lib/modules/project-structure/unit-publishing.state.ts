import { Prisma } from "@prisma/client";

import type { UnitTypeCategory } from "@/config/unit-types";
import { prisma } from "@/lib/database/prisma";
import { fullName } from "@/lib/utils/format";
import { AREA_FIELDS, type AreaField, type UnitAttributes } from "./structure.types";
import { evaluateReadiness, hasUnpublishedChanges, isPdf, isUnitImage, type LiveUnitFacts } from "./unit-publishing.rules";
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
 * Brings the stored "unpublished changes" flag in line with the data (§27-§30),
 * for units that have been published. Called inside the transaction of every
 * change that can move a unit away from its published version: an edit, a move,
 * a floor moved to another building, a new Sales Plan version, a new primary
 * image. The unit list filters on the flag; the unit page recomputes it.
 */
export async function refreshUnpublishedChanges(tx: Prisma.TransactionClient, companyId: string, unitIds: string[]): Promise<void> {
  const published = await tx.projectUnit.findMany({ where: { companyId, id: { in: unitIds }, currentPublicationId: { not: null } }, select: { id: true } });
  if (published.length === 0) return;
  const states = await loadPublishStates(tx, companyId, published.map((unit) => unit.id));
  const changed = [...states.values()].filter((state) => state.drift).map((state) => state.row.id);
  const unchanged = [...states.values()].filter((state) => !state.drift).map((state) => state.row.id);
  if (changed.length) await tx.projectUnit.updateMany({ where: { companyId, id: { in: changed }, hasUnpublishedChanges: false }, data: { hasUnpublishedChanges: true } });
  if (unchanged.length) await tx.projectUnit.updateMany({ where: { companyId, id: { in: unchanged }, hasUnpublishedChanges: true }, data: { hasUnpublishedChanges: false } });
}

/** Display names for the members a publishing record names. */
export async function memberDisplayNames(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: wanted } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, fullName(row.user.firstName, row.user.lastName)]));
}
