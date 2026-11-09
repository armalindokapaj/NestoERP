import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { setFileScanner } from "@/lib/core/storage";
import type { FileScanner } from "@/lib/core/storage";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { decideApproval, listApprovals } from "@/lib/modules/approvals/approvals.service";
import { reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import { runScanForVersion } from "@/lib/modules/documents/storage/scan.service";
import { attachDocumentFromBytes, completeUpload, createVersionUploadSession } from "@/lib/modules/documents/storage/upload.service";
import { createBuilding } from "@/lib/modules/project-structure/structure.buildings";
import { createFloor, moveFloor } from "@/lib/modules/project-structure/structure.floors";
import { bulkUnitsSchema, copyUnitsSchema, createBuildingSchema, createFloorSchema, createUnitSchema, parseUnitListQuery, updateUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import { getUnitDetail, listProjectUnits, listUnitActivity } from "@/lib/modules/project-structure/structure.service";
import { bulkCreateUnits, copyUnits, createUnit, deleteUnit, moveUnit, updateUnit } from "@/lib/modules/project-structure/structure.units";
import { addUnitMedia, attachUnitDocument, detachUnitDocument, listAttachableDocuments, listUnitFiles, removeUnitMedia, reorderUnitMedia, setUnitSalesPlan, updateUnitMedia } from "@/lib/modules/project-structure/unit-files.service";
import { archiveUnit, getUnitPublication, getUnitPublishing, listUnitPublications, publishingCapabilities, restoreUnit } from "@/lib/modules/project-structure/unit-publishing.service";
import { loadPublishState } from "@/lib/modules/project-structure/unit-publishing.state";
import type { UnitSnapshot } from "@/lib/modules/project-structure/unit-publishing.types";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * The unit page and its publishing, against the real database (E-05D §107-§115;
 * units publish on create, 2026-11): a unit is published when it is created,
 * whatever its completeness, and every change to what it publishes goes out as
 * its next version in the same transaction. There is no submit, publish,
 * revision or unpublish; archive is the only way out of use.
 *
 * Everything happens on a building this suite adds to a second Aurelia project
 * it builds for itself (each demo company runs one) and removes at the end: the
 * Architect is on its team, the Owner manages it, and the Architecture Manager
 * reads every project of the company. Files go through the real upload
 * pipeline into a temporary storage root, without a scanner. Each test removes
 * what it made — requests, media, links, publications, documents, units,
 * floors, buildings, audit, activity and notifications.
 */

const MARINA = "t05d_marina";
const SITE = PROJECT.a;
const T = "E05D";

let owner: UserContext;
let ceo: UserContext;
let pm: UserContext;
let architect: UserContext;
let manager: UserContext;
let engineer: UserContext;
let sales: UserContext;
let finance: UserContext;
let ownerB: UserContext;
let apartmentType: string;
let parkingType: string;
let storageRoot: string;
let floorId: string;

const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.4\n${label}\n%%EOF\n`);
const png = async (shade: number) => new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 3, background: { r: shade, g: 120, b: 160 } } }).png().toBuffer());

async function cleanup() {
  const buildings = await prisma.projectBuilding.findMany({ where: { projectId: { in: [MARINA, SITE] }, nameKey: { startsWith: T } }, select: { id: true } });
  const buildingIds = buildings.map((row) => row.id);
  const floors = await prisma.projectFloor.findMany({ where: { buildingId: { in: buildingIds } }, select: { id: true } });
  const floorIds = floors.map((row) => row.id);
  const units = await prisma.projectUnit.findMany({ where: { floorId: { in: floorIds } }, select: { id: true } });
  const unitIds = units.map((row) => row.id);
  if (unitIds.length) {
    const requests = await prisma.unitPublicationApproval.findMany({ where: { recordId: { in: unitIds } }, select: { id: true } });
    await prisma.unitPublicationApproval.deleteMany({ where: { recordId: { in: unitIds } } });
    await prisma.unitMedia.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.unitDocumentLink.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.projectUnit.updateMany({ where: { id: { in: unitIds } }, data: { currentPublicationId: null, salesPlanDocumentId: null } });
    await prisma.unitPublication.deleteMany({ where: { unitId: { in: unitIds } } });
    const documents = await prisma.document.findMany({ where: { OR: [{ entityType: "project_unit", entityId: { in: unitIds } }, { name: { startsWith: T } }] }, select: { id: true } });
    const documentIds = documents.map((row) => row.id);
    const trail = [...unitIds, ...documentIds, ...requests.map((row) => row.id)];
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: trail } } });
    await prisma.notification.deleteMany({ where: { entityId: { in: trail } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
    await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: documentIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: trail } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: trail } } });
  }
  const leftover = await prisma.document.findMany({ where: { name: { startsWith: T } }, select: { id: true } });
  if (leftover.length) {
    const ids = leftover.map((row) => row.id);
    await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.document.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.projectUnit.deleteMany({ where: { id: { in: unitIds } } });
  await prisma.projectFloor.deleteMany({ where: { id: { in: floorIds } } });
  await prisma.projectBuilding.deleteMany({ where: { id: { in: buildingIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...buildingIds, ...floorIds] } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [...buildingIds, ...floorIds] } } });
}

async function refused(promise: Promise<unknown>, code: string, detail?: string): Promise<AccessError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `expected ${code}${detail ? ` / ${detail}` : ""}, but it succeeded`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code, (error as Error).message).toBe(code);
  if (detail) expect((error as AccessError).details).toMatchObject({ code: detail });
  return error as AccessError;
}

const COMPLETE = { saleableArea: "113.00", internalArea: "92.40", bedrooms: 2, bathrooms: 2, rooms: 3, orientation: "SW", position: "CORNER" } as const;

async function newUnit(code: string, extra: Record<string, unknown> = COMPLETE, typeId = apartmentType) {
  const result = await createUnit(owner, floorId, createUnitSchema.parse({ unitCode: `${T}-${code}`, unitTypeId: typeId, ...extra }));
  return result.id;
}

async function version(unitId: string): Promise<number> {
  return (await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId }, select: { version: true } })).version;
}

async function uploadToUnit(context: UserContext, unitId: string, name: string, fileName: string, mimeType: string, bytes: Uint8Array) {
  const result = await attachDocumentFromBytes(context, { name: `${T} ${name}`, context: "record", entityType: "project_unit", entityId: unitId, fileName, mimeType } as Parameters<typeof attachDocumentFromBytes>[1], bytes);
  expect(result.status).toBe("AVAILABLE");
  return result.documentId;
}

async function newVersion(context: UserContext, documentId: string, bytes: Uint8Array) {
  const session = await createVersionUploadSession(context, documentId, { fileName: "Sales plan rev.pdf", mimeType: "application/pdf", sizeBytes: bytes.byteLength });
  const row = await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: session.uploadSessionId }, select: { storageKey: true } });
  await storageProvider().putObject(row.storageKey, bytes, "application/pdf");
  return completeUpload(context, session.uploadSessionId);
}

/** A unit with its Sales Plan and a primary image: v1 at creation, v2 with the Sales Plan, v3 with the image. */
async function readyUnit(code: string) {
  const unitId = await newUnit(code);
  const plan = await uploadToUnit(architect, unitId, `${code} sales plan`, "Sales plan.pdf", "application/pdf", pdf(code));
  await setUnitSalesPlan(architect, unitId, { documentId: plan });
  const image = await uploadToUnit(architect, unitId, `${code} render`, "Render.png", "image/png", await png(40));
  await addUnitMedia(architect, unitId, { documentId: image, category: "INTERIOR_RENDER", caption: null });
  return { unitId, plan, image };
}

/** The unit's versions, oldest first: number, who published it, and the snapshot. */
async function versions(unitId: string) {
  return prisma.unitPublication.findMany({ where: { unitId }, orderBy: { versionNumber: "asc" }, select: { id: true, versionNumber: true, publishedByMemberId: true, snapshot: true, salesPlanDocumentVersionId: true, primaryMediaDocumentVersionId: true } });
}

/** The unit points at its latest version, and that version is what the unit now is. */
async function expectLive(unitId: string) {
  const state = (await loadPublishState(prisma, COMPANY.a, unitId))!;
  const latest = (await versions(unitId)).at(-1)!;
  expect(state.row.publicationStatus).toBe("PUBLISHED");
  expect(state.row.currentPublicationId).toBe(latest.id);
  expect(state.drift).toBe(false);
  expect(state.row.hasUnpublishedChanges).toBe(false);
  return latest;
}

async function editUnit(context: UserContext, unitId: string, patch: Record<string, unknown>) {
  const detail = await getUnitDetail(context, unitId);
  // A partial update: what is left out keeps its saved value (AUD-09 §4).
  return updateUnit(context, unitId, updateUnitSchema.parse({ unitCode: detail.unitCode, unitTypeId: detail.unitType.id, isActive: detail.isActive, expectedVersion: detail.version, ...patch }));
}

async function removeMarina() {
  await prisma.auditEvent.deleteMany({ where: { entityId: MARINA } });
  await prisma.activity.deleteMany({ where: { entityId: MARINA } });
  await prisma.projectMember.deleteMany({ where: { projectId: MARINA } });
  await prisma.project.deleteMany({ where: { id: MARINA } });
}

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-unit-publishing-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
  [owner, ceo, pm, architect, engineer, sales, finance] = await Promise.all(
    (["OWNER", "CEO", "PROJECT_MANAGER", "ARCHITECT", "ENGINEER", "SALES", "FINANCE"] as const).map((role) => loginAs(role)),
  );
  manager = await loginAsEmail(DEMO_EMAIL.architectureHead);
  ownerB = await loginAsMembership("member_owner_b");
  const types = await prisma.projectUnitType.findMany({ where: { companyId: COMPANY.a, code: { in: ["APARTMENT", "PARKING"] } }, select: { id: true, code: true } });
  apartmentType = types.find((row) => row.code === "APARTMENT")!.id;
  parkingType = types.find((row) => row.code === "PARKING")!.id;
  await cleanup();
  await removeMarina();
  await prisma.project.create({ data: { id: MARINA, companyId: COMPANY.a, code: "T05D-MARINA", name: "Harbour Marina Apartments", status: "ACTIVE", projectManagerMemberId: owner.membershipId, createdBy: "test" } });
  await prisma.projectMember.createMany({ data: [owner.membershipId, architect.membershipId].map((companyMemberId) => ({ companyId: COMPANY.a, projectId: MARINA, companyMemberId, status: "ACTIVE" as const })) });
});

beforeEach(async () => {
  setFileScanner(null);
  const building = await createBuilding(owner, MARINA, createBuildingSchema.parse({ name: `${T} Block` }));
  const floor = await createFloor(owner, building.id, createFloorSchema.parse({ number: 3, name: "Floor 3", levelType: "STANDARD" }));
  floorId = floor.id;
});

afterEach(async () => {
  setFileScanner(undefined);
  await cleanup();
});

afterAll(async () => {
  setStorageProvider(null);
  await rm(storageRoot, { recursive: true, force: true });
  await reconcileStorageUsage();
  await removeMarina();
  await cleanupSessions();
  await prisma.$disconnect();
});

/* Publishing on create ---------------------------------------------------------- */

describe("a unit is published the moment it is created (2026-11)", () => {
  it("publishes version 1 of an incomplete unit, in the creator's name, and the checklist only informs", async () => {
    const unitId = await newUnit("101", { ...COMPLETE, saleableArea: null });
    const publishing = await getUnitPublishing(architect, unitId);
    expect(publishing).toMatchObject({ status: "PUBLISHED", currentPublication: { versionNumber: 1, publishedByMemberId: owner.membershipId } });
    expect(publishing.currentPublication?.publishedBy).toBeTruthy();
    expect(publishing.statusChangedAt).not.toBeNull();
    // Information only: what a complete listing still lacks, and nothing refused for it.
    expect(publishing.readiness.items.filter((item) => !item.ok).map((item) => item.key)).toEqual(["primaryArea", "salesPlan", "primaryImage"]);
    expect(publishing).not.toHaveProperty("pendingRequest");
    expect(publishing).not.toHaveProperty("hasUnpublishedChanges");

    const v1 = await expectLive(unitId);
    expect(v1).toMatchObject({ versionNumber: 1, publishedByMemberId: owner.membershipId, salesPlanDocumentVersionId: null, primaryMediaDocumentVersionId: null });
    expect(v1.snapshot as UnitSnapshot).toMatchObject({ unitCode: `${T}-101`, areas: { saleableArea: null, internalArea: "92.40" }, bedrooms: 2, salesPlan: null, primaryImage: null });
    expect(await prisma.auditEvent.count({ where: { entityId: unitId, actionKey: "PROJECT_UNIT_PUBLISHED", actorMemberId: owner.membershipId } })).toBe(1);
    expect((await listUnitActivity(sales, unitId)).items.map((item) => item.action)).toEqual(expect.arrayContaining(["UNIT_CREATED", "UNIT_PUBLISHED"]));
    expect(await prisma.unitPublicationApproval.count({ where: { recordId: unitId } })).toBe(0);
  });

  it("holds a parking space to its own fields in the checklist: any area, no bedrooms or orientation", async () => {
    const unitId = await newUnit("P1", { internalArea: "12.50" }, parkingType);
    const { readiness, status } = await getUnitPublishing(architect, unitId);
    expect(status).toBe("PUBLISHED");
    expect(readiness.items.map((item) => item.key)).not.toContain("bedrooms");
    expect(readiness.items.find((item) => item.key === "primaryArea")).toMatchObject({ ok: true, label: "Saleable, internal or gross area" });
  });

  it("publishes every unit a bulk creation or a copy makes, each its own version 1", async () => {
    const bulk = await bulkCreateUnits(architect, floorId, bulkUnitsSchema.parse({ units: [{ unitCode: `${T}-B1`, name: null }, { unitCode: `${T}-B2`, name: null }, { unitCode: `${T}-B3`, name: null }], defaults: { unitTypeId: apartmentType, saleableArea: "80.00", bedrooms: 1 }, dryRun: false }));
    expect(bulk.created).toHaveLength(3);
    for (const unitId of bulk.created) expect(await expectLive(unitId)).toMatchObject({ versionNumber: 1, publishedByMemberId: architect.membershipId });

    const building = (await prisma.projectFloor.findUniqueOrThrow({ where: { id: floorId } })).buildingId;
    const target = await createFloor(owner, building, createFloorSchema.parse({ number: 5, name: "Floor 5", levelType: "STANDARD" }));
    const copied = await copyUnits(owner, target.id, copyUnitsSchema.parse({ sourceFloorId: floorId, units: bulk.created.map((sourceUnitId, index) => ({ sourceUnitId, unitCode: `${T}-C${index + 1}`, name: null })), dryRun: false }));
    expect(copied.created).toHaveLength(3);
    for (const unitId of copied.created) {
      const v1 = await expectLive(unitId);
      expect(v1).toMatchObject({ versionNumber: 1, publishedByMemberId: owner.membershipId });
      expect((v1.snapshot as UnitSnapshot).floor.id).toBe(target.id);
    }
    expect(await prisma.auditEvent.count({ where: { entityId: { in: [...bulk.created, ...copied.created] }, actionKey: "PROJECT_UNIT_PUBLISHED" } })).toBe(6);
  });

  it("lets a unit that nothing else points at be deleted, with its own versions", async () => {
    const unitId = await newUnit("102");
    await editUnit(architect, unitId, { saleableArea: "114.00" });
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(2);
    await deleteUnit(owner, unitId);
    expect(await prisma.projectUnit.count({ where: { id: unitId } })).toBe(0);
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(0);

    const { unitId: withFiles } = await readyUnit("103");
    await refused(deleteUnit(owner, withFiles), "CONFLICT", "UNIT_REFERENCED");
  });
});

/* Every change goes out at once ---------------------------------------------------- */

describe("every change is published at once, with no review (§24-§30, §72-§74)", () => {
  it("writes version 2 on an edit, keeps version 1 as it was, and writes nothing for a save that changes nothing", async () => {
    const unitId = await newUnit("201");
    const v1 = (await versions(unitId))[0]!;

    const saved = await editUnit(architect, unitId, { saleableArea: "120.00" });
    const v2 = await expectLive(unitId);
    expect(v2).toMatchObject({ versionNumber: 2, publishedByMemberId: architect.membershipId });
    expect((v2.snapshot as UnitSnapshot).areas.saleableArea).toBe("120.00");
    expect((await prisma.unitPublication.findUniqueOrThrow({ where: { id: v1.id } })).snapshot).toEqual(v1.snapshot);
    expect(((await getUnitPublication(architect, unitId, v1.id)).snapshot.areas.saleableArea)).toBe("113.00");

    // The version the edit returned is the one the next save sends: publishing did not move it.
    expect(saved.version).toBe(await version(unitId));
    await editUnit(architect, unitId, { saleableArea: "120.00", expectedVersion: saved.version });
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(2);
    // Deactivating is not a publish fact either.
    await editUnit(architect, unitId, { isActive: false });
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(2);

    // Putting the value back is a change from version 2, and goes out as version 3.
    await editUnit(architect, unitId, { saleableArea: "113.00", isActive: true });
    expect(await expectLive(unitId)).toMatchObject({ versionNumber: 3 });
    expect((await listUnitPublications(sales, unitId)).map((row) => [row.versionNumber, row.isCurrent])).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);
    expect((await listUnitActivity(sales, unitId)).items.filter((item) => item.action === "UNIT_PUBLISHED")).toHaveLength(3);
  });

  it("publishes a move to another floor, and a floor moved to another building, for every unit on it", async () => {
    const unitId = await newUnit("202");
    const building = (await prisma.projectFloor.findUniqueOrThrow({ where: { id: floorId } })).buildingId;
    const other = await createFloor(owner, building, createFloorSchema.parse({ number: 4, name: "Floor 4", levelType: "STANDARD" }));
    const moved = await moveUnit(owner, unitId, { floorId: other.id, expectedVersion: await version(unitId) });
    expect(moved.version).toBe(await version(unitId));
    expect((await expectLive(unitId)).snapshot as UnitSnapshot).toMatchObject({ floor: { id: other.id } });
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(2);

    const second = await newUnit("203");
    await moveUnit(owner, second, { floorId: other.id, expectedVersion: await version(second) });
    const east = await createBuilding(owner, MARINA, createBuildingSchema.parse({ name: `${T} East` }));
    const floorRow = await prisma.projectFloor.findUniqueOrThrow({ where: { id: other.id } });
    await moveFloor(owner, other.id, { buildingId: east.id, expectedVersion: floorRow.version });
    for (const id of [unitId, second]) expect(((await expectLive(id)).snapshot as UnitSnapshot).building.id).toBe(east.id);
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(3);
  });

  it("publishes the Sales Plan and a new primary image with their exact file versions", async () => {
    const { unitId, plan, image } = await readyUnit("204");
    const all = await versions(unitId);
    const planVersion = (await prisma.document.findUniqueOrThrow({ where: { id: plan }, select: { currentVersionId: true } })).currentVersionId;
    const imageVersion = (await prisma.document.findUniqueOrThrow({ where: { id: image }, select: { currentVersionId: true } })).currentVersionId;
    expect(all.map((row) => [row.versionNumber, row.salesPlanDocumentVersionId, row.primaryMediaDocumentVersionId])).toEqual([
      [1, null, null],
      [2, planVersion, null],
      [3, planVersion, imageVersion],
    ]);
    expect(all[2]!.snapshot as UnitSnapshot).toMatchObject({ salesPlan: { documentId: plan, versionNumber: 1 }, primaryImage: { documentId: image, category: "INTERIOR_RENDER" } });
    expect(await getUnitPublication(sales, unitId, all[2]!.id)).toMatchObject({ versionNumber: 3, isCurrent: true, salesPlanVersionNumber: 1 });

    // A second image is not the primary one, so the unit has nothing new to publish; making it primary does.
    const second = await uploadToUnit(architect, unitId, "view", "View.png", "image/png", await png(200));
    const added = await addUnitMedia(architect, unitId, { documentId: second, category: "VIEW", caption: null });
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(3);
    await updateUnitMedia(architect, unitId, added.id, { isPrimary: true });
    expect(((await expectLive(unitId)).snapshot as UnitSnapshot).primaryImage?.documentId).toBe(second);
    await removeUnitMedia(architect, unitId, added.id);
    expect(await expectLive(unitId)).toMatchObject({ versionNumber: 5 });
    expect(((await versions(unitId)).at(-1)!.snapshot as UnitSnapshot).primaryImage).toBeNull();
  });

  it("publishes a new Sales Plan version when the scanner makes it current, with nobody's change behind it", async () => {
    const { unitId, plan } = await readyUnit("205");
    const scanner: FileScanner = { provider: "test-clean", scan: async () => ({ verdict: "CLEAN" }) };
    setFileScanner(scanner);
    await newVersion(architect, plan, pdf("revision two"));
    const latest = await expectLive(unitId);
    expect(latest).toMatchObject({ versionNumber: 4, publishedByMemberId: null });
    expect((latest.snapshot as UnitSnapshot).salesPlan?.versionNumber).toBe(2);
    expect(await prisma.auditEvent.findFirst({ where: { entityId: unitId, actionKey: "PROJECT_UNIT_PUBLISHED", actorType: "SYSTEM" } })).not.toBeNull();
    // The Documents section records the version afterwards; there is nothing left to publish.
    expect(await setUnitSalesPlan(architect, unitId, { documentId: plan })).toMatchObject({ versionNumber: 2, changed: true });
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(4);
    expect((await getUnitPublishing(sales, unitId)).currentPublication).toMatchObject({ versionNumber: 4, publishedBy: null, publishedByMemberId: null });
    // A version scanned and promoted later is the same door: run the scan again and nothing moves.
    const pending = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: plan, versionNumber: 2 }, select: { id: true } });
    expect(await runScanForVersion(pending.id)).toBe("NOT_CLAIMED");
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(4);
  });

  it("gives two changes made at the same moment their own version numbers", async () => {
    const { unitId } = await readyUnit("206");
    const second = await uploadToUnit(architect, unitId, "view", "View.png", "image/png", await png(120));
    const added = await addUnitMedia(architect, unitId, { documentId: second, category: "VIEW", caption: null });
    const outcomes = await Promise.allSettled([editUnit(architect, unitId, { saleableArea: "130.00" }), updateUnitMedia(manager, unitId, added.id, { isPrimary: true })]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await versions(unitId)).map((row) => row.versionNumber)).toEqual([1, 2, 3, 4, 5]);
    const latest = await expectLive(unitId);
    expect(latest.snapshot as UnitSnapshot).toMatchObject({ areas: { saleableArea: "130.00" }, primaryImage: { documentId: second } });
  });

  it("publishes an incomplete unit's changes too: the checklist never blocks", async () => {
    const { unitId, image } = await readyUnit("207");
    await prisma.document.update({ where: { id: image }, data: { status: "ARCHIVED" } });
    expect((await getUnitPublishing(architect, unitId)).readiness.items.find((item) => item.key === "primaryImage")?.ok).toBe(false);
    await editUnit(architect, unitId, { bedrooms: null, saleableArea: null });
    const latest = await expectLive(unitId);
    expect(latest.snapshot as UnitSnapshot).toMatchObject({ bedrooms: null, areas: { saleableArea: null }, primaryImage: null });
  });
});

/* Archive and restore --------------------------------------------------------------- */

describe("archive is the only way out of use; restore brings the unit back published (§32)", () => {
  it("archives, publishes nothing while archived, and restores Published with what changed as the next version", async () => {
    const unitId = await newUnit("301");
    await refused(archiveUnit(architect, unitId, { expectedVersion: await version(unitId) }), "FORBIDDEN");
    const archived = await archiveUnit(manager, unitId, { expectedVersion: await version(unitId) });
    expect(archived.status).toBe("ARCHIVED");
    await refused(archiveUnit(manager, unitId, { expectedVersion: archived.version }), "CONFLICT");

    await editUnit(owner, unitId, { saleableArea: "99.00" });
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(1);
    expect((await getUnitPublishing(sales, unitId)).status).toBe("ARCHIVED");

    await refused(restoreUnit(manager, unitId, { expectedVersion: archived.version }), "CONFLICT", "STRUCTURE_STALE");
    const restored = await restoreUnit(manager, unitId, { expectedVersion: await version(unitId) });
    expect(restored).toEqual({ status: "PUBLISHED", version: await version(unitId) });
    const latest = await expectLive(unitId);
    expect(latest).toMatchObject({ versionNumber: 2, publishedByMemberId: manager.membershipId });
    expect((latest.snapshot as UnitSnapshot).areas.saleableArea).toBe("99.00");
    expect((await listUnitActivity(sales, unitId)).items.map((item) => item.action)).toEqual(expect.arrayContaining(["UNIT_ARCHIVED", "UNIT_RESTORED"]));
  });

  it("restores an unchanged unit Published with its version intact", async () => {
    const unitId = await newUnit("302");
    const archived = await archiveUnit(owner, unitId, { expectedVersion: await version(unitId) });
    const restored = await restoreUnit(owner, unitId, { expectedVersion: archived.version });
    expect(restored.status).toBe("PUBLISHED");
    expect(await expectLive(unitId)).toMatchObject({ versionNumber: 1 });
  });

  it("restores a unit archived in a retired review state Published, with a version", async () => {
    const unitId = await newUnit("303");
    // Old data: a draft archived before units published on create, with no version of its own.
    await prisma.projectUnit.update({ where: { id: unitId }, data: { publicationStatus: "ARCHIVED", preArchivePublicationStatus: "DRAFT", currentPublicationId: null } });
    await prisma.unitPublication.deleteMany({ where: { unitId } });
    const restored = await restoreUnit(owner, unitId, { expectedVersion: await version(unitId) });
    expect(restored.status).toBe("PUBLISHED");
    expect(await expectLive(unitId)).toMatchObject({ versionNumber: 1, publishedByMemberId: owner.membershipId });
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId } })).preArchivePublicationStatus).toBeNull();
  });
});

/* The Sales Plan and documents ----------------------------------------------------- */

describe("the Sales Plan and documents (§33-§39, §78, §112, §117)", () => {
  it("keeps one logical Sales Plan: a new upload is a version of it, each publication keeps its own", async () => {
    const { unitId, plan } = await readyUnit("401");
    const v1 = (await prisma.document.findUniqueOrThrow({ where: { id: plan } })).currentVersionId;
    const before = (await versions(unitId)).at(-1)!;

    const other = await uploadToUnit(architect, unitId, "second plan", "Another plan.pdf", "application/pdf", pdf("other"));
    await refused(setUnitSalesPlan(architect, unitId, { documentId: other }), "CONFLICT", "UNIT_SALES_PLAN_EXISTS");

    await newVersion(architect, plan, pdf("revision two"));
    const recorded = await setUnitSalesPlan(architect, unitId, { documentId: plan });
    expect(recorded).toMatchObject({ versionNumber: 2, changed: true });
    expect(await setUnitSalesPlan(architect, unitId, { documentId: plan })).toMatchObject({ changed: false });
    expect((await prisma.unitPublication.findUniqueOrThrow({ where: { id: before.id } })).salesPlanDocumentVersionId).toBe(v1);
    const latest = await expectLive(unitId);
    expect(latest.versionNumber).toBe(before.versionNumber + 1);
    expect((await getUnitPublication(architect, unitId, latest.id)).snapshot.salesPlan?.versionNumber).toBe(2);
    expect(await prisma.document.count({ where: { entityType: "project_unit", entityId: unitId, name: { contains: "sales plan" } } })).toBe(1);
  });

  it("takes only a PDF uploaded to the unit itself as its Sales Plan", async () => {
    const unitId = await newUnit("402");
    const image = await uploadToUnit(architect, unitId, "not a plan", "Plan.png", "image/png", await png(90));
    await refused(setUnitSalesPlan(architect, unitId, { documentId: image }), "VALIDATION_ERROR");
    const projectFile = await attachDocumentFromBytes(owner, { name: `${T} project plan`, context: "project", projectId: MARINA, fileName: "Plan.pdf", mimeType: "application/pdf" } as Parameters<typeof attachDocumentFromBytes>[1], pdf("project"));
    await refused(setUnitSalesPlan(architect, unitId, { documentId: projectFile.documentId }), "VALIDATION_ERROR");
  });

  it("attaches one project drawing to many units without copying it, and refuses another project's", async () => {
    const first = await newUnit("403");
    const second = await newUnit("404");
    const drawing = await attachDocumentFromBytes(owner, { name: `${T} typical floor plan`, context: "project", projectId: MARINA, fileName: "Typical.pdf", mimeType: "application/pdf" } as Parameters<typeof attachDocumentFromBytes>[1], pdf("typical"));
    await attachUnitDocument(architect, first, { documentId: drawing.documentId, category: "TECHNICAL_DRAWING" });
    await attachUnitDocument(architect, second, { documentId: drawing.documentId, category: "TECHNICAL_DRAWING" });
    await refused(attachUnitDocument(architect, first, { documentId: drawing.documentId, category: "OTHER" }), "CONFLICT", "UNIT_DOCUMENT_ALREADY_ATTACHED");
    expect(await prisma.document.count({ where: { name: `${T} typical floor plan` } })).toBe(1);
    expect((await listUnitFiles(sales, second)).documents.map((link) => link.document.documentId)).toEqual([drawing.documentId]);
    expect((await listAttachableDocuments(architect, first, { kind: "document" })).map((row) => row.id)).not.toContain(drawing.documentId);
    // An attached drawing is not a publish fact.
    expect(await prisma.unitPublication.count({ where: { unitId: first } })).toBe(1);

    const elsewhere = await attachDocumentFromBytes(owner, { name: `${T} riverside drawing`, context: "project", projectId: PROJECT.a, fileName: "Riverside.pdf", mimeType: "application/pdf" } as Parameters<typeof attachDocumentFromBytes>[1], pdf("riverside"));
    const error = await refused(attachUnitDocument(architect, first, { documentId: elsewhere.documentId, category: "OTHER" }), "VALIDATION_ERROR");
    expect(error.reason).toBe("CROSS_PROJECT_REFERENCE");

    const link = (await listUnitFiles(architect, first)).documents[0];
    await detachUnitDocument(architect, first, link.id);
    expect(await prisma.document.count({ where: { id: drawing.documentId } })).toBe(1);
    await refused(attachUnitDocument(sales, first, { documentId: drawing.documentId, category: "OTHER" }), "FORBIDDEN");
  });

  it("flags an archived attachment in the checklist (§17: no broken references), and publishes regardless", async () => {
    const { unitId } = await readyUnit("405");
    const drawing = await uploadToUnit(architect, unitId, "old drawing", "Old.pdf", "application/pdf", pdf("old"));
    await attachUnitDocument(architect, unitId, { documentId: drawing, category: "TECHNICAL_DRAWING" });
    expect((await getUnitPublishing(architect, unitId)).readiness.ready).toBe(true);
    await prisma.document.update({ where: { id: drawing }, data: { status: "ARCHIVED" } });
    expect((await getUnitPublishing(architect, unitId)).readiness.missing).toEqual(["Attached files available"]);
    await editUnit(architect, unitId, { bathrooms: 3 });
    expect(await expectLive(unitId)).toMatchObject({ versionNumber: 4 });
  });
});

/* Media ------------------------------------------------------------------------ */

describe("media (§40-§44, §76, §113)", () => {
  it("makes the first image primary, swaps the primary in one step, orders, and removes", async () => {
    const { unitId } = await readyUnit("501");
    const second = await uploadToUnit(architect, unitId, "view", "View.png", "image/png", await png(200));
    const added = await addUnitMedia(architect, unitId, { documentId: second, category: "VIEW", caption: "From the balcony" });
    expect(added.isPrimary).toBe(false);

    await updateUnitMedia(architect, unitId, added.id, { isPrimary: true });
    const media = (await listUnitFiles(architect, unitId)).media;
    expect(media.filter((item) => item.isPrimary).map((item) => item.id)).toEqual([added.id]);
    expect(media[0].thumbnailHref).toMatch(/\/api\/project-units\/.+\/media\/.+\/thumbnail$/);

    // The database holds the rule on its own: a second primary is refused.
    const other = media.find((item) => !item.isPrimary)!;
    await expect(prisma.unitMedia.update({ where: { id: other.id }, data: { isPrimary: true } })).rejects.toThrow();

    await reorderUnitMedia(architect, unitId, [added.id, other.id]);
    expect((await listUnitFiles(architect, unitId)).media.map((item) => item.id)).toEqual([added.id, other.id]);

    await removeUnitMedia(architect, unitId, added.id);
    expect((await getUnitPublishing(architect, unitId)).readiness.items.find((item) => item.key === "primaryImage")).toMatchObject({ ok: false, required: false });
    expect(await prisma.document.count({ where: { id: second } })).toBe(1);
  });

  it("takes only images as media", async () => {
    const unitId = await newUnit("502");
    const file = await uploadToUnit(architect, unitId, "spec", "Spec.pdf", "application/pdf", pdf("spec"));
    await refused(addUnitMedia(architect, unitId, { documentId: file, category: "OTHER", caption: null }), "VALIDATION_ERROR");
    await refused(addUnitMedia(engineer, unitId, { documentId: file, category: "OTHER", caption: null }), "NOT_FOUND");
  });
});

/* Access ----------------------------------------------------------------------- */

describe("access (§18-§20, §85-§89, §114, §120, §122)", () => {
  it("lets the Architect prepare a unit and the Architecture Manager, the Owner and the CEO archive it", async () => {
    const { unitId } = await readyUnit("601");
    expect((await getUnitPublishing(architect, unitId)).capabilities).toEqual({ canArchive: false, canRestore: false, canViewHistory: true, canManageDocuments: true, canManageMedia: true });
    expect((await getUnitPublishing(manager, unitId)).capabilities).toMatchObject({ canArchive: true, canRestore: true });
    expect((await getUnitPublishing(owner, unitId)).capabilities.canArchive).toBe(true);
    // The CEO runs the company's units end to end (user, 2026-09-29).
    expect((await getUnitPublishing(ceo, unitId)).capabilities).toMatchObject({ canArchive: true, canManageDocuments: true, canManageMedia: true });
    // The Project Manager prepares units on their own projects; this is not one of them.
    await refused(getUnitPublishing(pm, unitId), "NOT_FOUND");
    expect(publishingCapabilities(pm)).toMatchObject({ canManageDocuments: true, canArchive: false });
  });

  it("gives Sales and Finance the page and the published history, and nothing to change", async () => {
    const { unitId, image } = await readyUnit("602");
    const ids = (await versions(unitId)).map((row) => row.id).reverse();
    for (const reader of [sales, finance]) {
      const publishing = await getUnitPublishing(reader, unitId);
      expect(publishing.capabilities).toEqual({ canArchive: false, canRestore: false, canManageDocuments: false, canManageMedia: false, canViewHistory: true });
      expect((await listUnitPublications(reader, unitId)).map((row) => row.id)).toEqual(ids);
      await refused(addUnitMedia(reader, unitId, { documentId: image, category: "OTHER", caption: null }), "FORBIDDEN");
      await refused(archiveUnit(reader, unitId, { expectedVersion: await version(unitId) }), "FORBIDDEN");
    }
  });

  it("finds nothing for a reader outside the project or the company, whatever id they hold", async () => {
    const { unitId } = await readyUnit("603");
    const publication = (await versions(unitId))[0]!;
    for (const outsider of [engineer, ownerB]) {
      await refused(getUnitPublishing(outsider, unitId), "NOT_FOUND");
      await refused(archiveUnit(outsider, unitId, { expectedVersion: await version(unitId) }), "NOT_FOUND");
      await refused(listUnitFiles(outsider, unitId), "NOT_FOUND");
      await refused(getUnitPublication(outsider, unitId, publication.id), "NOT_FOUND");
    }
    await refused(getUnitPublication(architect, unitId, "unit_publication_elsewhere"), "NOT_FOUND");
    await refused(getUnitDetail(architect, unitId, SITE), "NOT_FOUND");
  });

  it("shows the unit's history and filters the unit list by Published or Archived, ignoring old filters", async () => {
    const { unitId } = await readyUnit("604");
    const archivedId = await newUnit("605");
    await archiveUnit(owner, archivedId, { expectedVersion: await version(archivedId) });
    const actions = (await listUnitActivity(sales, unitId)).items.map((item) => item.action);
    expect(actions).toEqual(expect.arrayContaining(["UNIT_CREATED", "UNIT_SALES_PLAN_UPLOADED", "UNIT_MEDIA_ADDED", "UNIT_PUBLISHED"]));
    expect(actions).not.toContain("UNIT_SUBMITTED_FOR_PUBLISHING");

    const published = await listProjectUnits(architect, MARINA, parseUnitListQuery({ publicationStatus: "PUBLISHED", q: T }));
    expect(published.items.map((item) => item.id)).toEqual([unitId]);
    expect(published.items[0].publication).toEqual({ status: "PUBLISHED", versionNumber: 3 });
    expect((await listProjectUnits(architect, MARINA, parseUnitListQuery({ publicationStatus: "ARCHIVED", q: T }))).items.map((item) => item.id)).toEqual([archivedId]);
    // An old link's retired filters are ignored, not refused.
    for (const old of [{ unpublishedChanges: "true" }, { publicationStatus: "DRAFT" }, { publicationStatus: "READY_FOR_PUBLISHING" }]) {
      const query = parseUnitListQuery({ ...old, q: T });
      expect(query).not.toHaveProperty("unpublishedChanges");
      expect((await listProjectUnits(architect, MARINA, query)).items.map((item) => item.id).sort()).toEqual([unitId, archivedId].sort());
    }
  });
});

/* The Approvals Center ------------------------------------------------------------ */

describe("the Approvals Center has no unit publishing (2026-11)", () => {
  it("offers no publishing source and refuses its old key", async () => {
    const unitId = await newUnit("701");
    const waiting = await listApprovals(manager, approvalQuerySchema.parse({ tab: "waiting", limit: 100 }));
    expect(waiting.items.some((entry) => entry.sourceId === unitId || entry.providerKey === "projects")).toBe(false);
    await refused(decideApproval(manager, "projects", "unit_publication_approval_old", "APPROVE", { note: null }), "NOT_FOUND");
  });
});
