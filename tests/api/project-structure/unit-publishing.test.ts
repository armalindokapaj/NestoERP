import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { setFileScanner } from "@/lib/core/storage";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { decideApproval, listApprovals } from "@/lib/modules/approvals/approvals.service";
import { reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import { attachDocumentFromBytes, completeUpload, createVersionUploadSession } from "@/lib/modules/documents/storage/upload.service";
import { createBuilding } from "@/lib/modules/project-structure/structure.buildings";
import { createFloor } from "@/lib/modules/project-structure/structure.floors";
import { createBuildingSchema, createFloorSchema, createUnitSchema, parseUnitListQuery, updateUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import { getUnitDetail, listProjectUnits, listUnitActivity } from "@/lib/modules/project-structure/structure.service";
import { createUnit, deleteUnit, moveUnit, updateUnit } from "@/lib/modules/project-structure/structure.units";
import { addUnitMedia, attachUnitDocument, detachUnitDocument, listAttachableDocuments, listUnitFiles, removeUnitMedia, reorderUnitMedia, setUnitSalesPlan, updateUnitMedia } from "@/lib/modules/project-structure/unit-files.service";
import {
  archiveUnit,
  getUnitPublication,
  getUnitPublishing,
  listUnitPublications,
  publishingCapabilities,
  publishUnit,
  requestUnitRevision,
  restoreUnit,
  submitUnitForPublishing,
  unpublishUnit,
} from "@/lib/modules/project-structure/unit-publishing.service";
import type { UnitSnapshot } from "@/lib/modules/project-structure/unit-publishing.types";
import { cleanupSessions, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * The unit page and its publishing, against the real database (E-05D §107-§115).
 *
 * Everything happens on a building this suite adds to Marina Apartments
 * (project_c): the Architect is on its team, the Owner manages it, and the
 * Architecture Manager reads every project of the company. Files go through the
 * real upload pipeline into a temporary storage root, without a scanner. Each
 * test removes what it made — requests, media, links, publications, documents,
 * units, floors, buildings, audit, activity and notifications.
 */

const MARINA = PROJECT.c;
const SITE = PROJECT.b;
const T = "E05D";

let owner: UserContext;
let admin: UserContext;
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
let lastActivityAt: Date | null = null;

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

/** A unit with its Sales Plan and a primary image: ready to submit. */
async function readyUnit(code: string) {
  const unitId = await newUnit(code);
  const plan = await uploadToUnit(architect, unitId, `${code} sales plan`, "Sales plan.pdf", "application/pdf", pdf(code));
  await setUnitSalesPlan(architect, unitId, { documentId: plan });
  const image = await uploadToUnit(architect, unitId, `${code} render`, "Render.png", "image/png", await png(40));
  await addUnitMedia(architect, unitId, { documentId: image, category: "INTERIOR_RENDER", caption: null });
  return { unitId, plan, image };
}

beforeAll(async () => {
  // The unit activity this suite records moves the project's marker (E-05A §15); it is put back after.
  lastActivityAt = (await prisma.project.findUnique({ where: { id: MARINA }, select: { lastActivityAt: true } }))?.lastActivityAt ?? null;
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-unit-publishing-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
  [owner, admin, pm, architect, manager, engineer, sales, finance] = await Promise.all(
    (["OWNER", "ADMIN", "PROJECT_MANAGER", "ARCHITECT", "ARCHITECTURE_MANAGER", "ENGINEER", "SALES", "FINANCE"] as const).map((role) => loginAs(role)),
  );
  ownerB = await loginAsMembership("member_owner_b");
  const types = await prisma.projectUnitType.findMany({ where: { companyId: "company_demo_a", code: { in: ["APARTMENT", "PARKING"] } }, select: { id: true, code: true } });
  apartmentType = types.find((row) => row.code === "APARTMENT")!.id;
  parkingType = types.find((row) => row.code === "PARKING")!.id;
  await cleanup();
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
  if (lastActivityAt) await prisma.project.update({ where: { id: MARINA }, data: { lastActivityAt } });
  await cleanupSessions();
  await prisma.$disconnect();
});

/* Readiness and submission ---------------------------------------------------- */

describe("readiness (§16, §17, §45, §46, §81)", () => {
  it("starts every unit as a Draft with nothing published, and lists exactly what is missing", async () => {
    const unitId = await newUnit("101", { ...COMPLETE, saleableArea: null });
    const publishing = await getUnitPublishing(architect, unitId);
    expect(publishing).toMatchObject({ status: "DRAFT", currentPublication: null, hasUnpublishedChanges: false, pendingRequest: null });
    expect(publishing.readiness.ready).toBe(false);
    expect(publishing.readiness.missing).toEqual(["Saleable area", "Sales Plan", "Primary image"]);
    expect(publishing.readiness.complete).toBe(publishing.readiness.required - 3);

    const error = await refused(submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) }), "VALIDATION_ERROR", "UNIT_NOT_READY");
    expect(error.message).toBe("This unit cannot be submitted. Missing: Saleable area, Sales Plan, Primary image.");
    expect((error.details as { missing: string[] }).missing).toHaveLength(3);
  });

  it("holds a parking space to its own fields: any area, no bedrooms or orientation", async () => {
    const unitId = await newUnit("P1", { internalArea: "12.50" }, parkingType);
    const { readiness } = await getUnitPublishing(architect, unitId);
    expect(readiness.items.map((item) => item.key)).not.toContain("bedrooms");
    expect(readiness.items.find((item) => item.key === "primaryArea")).toMatchObject({ ok: true, label: "Saleable, internal or gross area" });
  });

  it("submits a complete unit: Ready for Publishing, one open request, the publishers asked", async () => {
    const { unitId } = await readyUnit("102");
    const result = await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });
    expect(result.status).toBe("READY_FOR_PUBLISHING");
    const requests = await prisma.unitPublicationApproval.findMany({ where: { recordId: unitId } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ status: "PENDING", submittedByMemberId: architect.membershipId, projectId: MARINA });
    const outbox = await prisma.notificationEventOutbox.findFirst({ where: { entityId: unitId, eventType: "APPROVAL_REQUESTED" } });
    expect(outbox).not.toBeNull();

    await refused(submitUnitForPublishing(architect, unitId, { expectedVersion: result.version }), "CONFLICT", "UNIT_ALREADY_SUBMITTED");
    await refused(submitUnitForPublishing(architect, unitId, { expectedVersion: 1 }), "CONFLICT", "STRUCTURE_STALE");
  });

  it("lets two people submitting at once leave one request (§82)", async () => {
    const { unitId } = await readyUnit("103");
    const expected = await version(unitId);
    const outcomes = await Promise.allSettled([submitUnitForPublishing(architect, unitId, { expectedVersion: expected }), submitUnitForPublishing(manager, unitId, { expectedVersion: expected })]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    // The loser was refused as a conflict, not for some other reason.
    const loser = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect((loser.reason as AccessError).code).toBe("CONFLICT");
    expect(await prisma.unitPublicationApproval.count({ where: { recordId: unitId, status: "PENDING" } })).toBe(1);
  });
});

/* Publishing ------------------------------------------------------------------ */

describe("publishing (§23-§26, §66, §72-§74, §82, §109)", () => {
  it("publishes version 1 as an immutable snapshot with the exact Sales Plan version and primary image", async () => {
    const { unitId, plan, image } = await readyUnit("201");
    const submitted = await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });

    await refused(publishUnit(architect, unitId, {}), "FORBIDDEN");
    const published = await publishUnit(manager, unitId, { expectedVersion: submitted.version });
    expect(published).toMatchObject({ status: "PUBLISHED", versionNumber: 1, alreadyPublished: false });

    const unit = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId }, select: { publicationStatus: true, currentPublicationId: true, hasUnpublishedChanges: true } });
    expect(unit).toEqual({ publicationStatus: "PUBLISHED", currentPublicationId: published.publicationId, hasUnpublishedChanges: false });
    const planVersion = (await prisma.document.findUniqueOrThrow({ where: { id: plan }, select: { currentVersionId: true } })).currentVersionId;
    const imageVersion = (await prisma.document.findUniqueOrThrow({ where: { id: image }, select: { currentVersionId: true } })).currentVersionId;
    const row = await prisma.unitPublication.findUniqueOrThrow({ where: { id: published.publicationId } });
    expect(row).toMatchObject({ versionNumber: 1, publishedByMemberId: manager.membershipId, salesPlanDocumentVersionId: planVersion, primaryMediaDocumentVersionId: imageVersion });
    const snapshot = row.snapshot as UnitSnapshot;
    expect(snapshot).toMatchObject({ unitCode: `${T}-201`, areas: { saleableArea: "113.00" }, bedrooms: 2, orientation: "SW", salesPlan: { documentId: plan, versionNumber: 1 }, primaryImage: { documentId: image, category: "INTERIOR_RENDER" } });

    expect(await prisma.unitPublicationApproval.findFirst({ where: { recordId: unitId } })).toMatchObject({ status: "APPROVED", decidedByMemberId: manager.membershipId });
    expect(await prisma.auditEvent.findFirst({ where: { entityId: unitId, actionKey: "PROJECT_UNIT_PUBLISHED" } })).not.toBeNull();
    const detail = await getUnitPublication(sales, unitId, published.publicationId);
    expect(detail).toMatchObject({ versionNumber: 1, isCurrent: true, salesPlanVersionNumber: 1 });
  });

  it("marks later changes as unpublished without touching the published version, and republishes as version 2", async () => {
    const { unitId } = await readyUnit("202");
    const first = await publishUnit(manager, unitId, {});
    const before = await prisma.unitPublication.findUniqueOrThrow({ where: { id: first.publicationId }, select: { snapshot: true } });

    const detail = await getUnitDetail(architect, unitId);
    const input = updateUnitSchema.parse({ ...COMPLETE, unitCode: detail.unitCode, unitTypeId: apartmentType, saleableArea: "120.00", isActive: true, expectedVersion: detail.version });
    const saved = await updateUnit(architect, unitId, input);
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId } })).hasUnpublishedChanges).toBe(true);
    expect((await getUnitPublishing(architect, unitId)).hasUnpublishedChanges).toBe(true);
    expect((await prisma.unitPublication.findUniqueOrThrow({ where: { id: first.publicationId }, select: { snapshot: true } })).snapshot).toEqual(before.snapshot);

    // Putting the value back is no change at all (§27).
    await updateUnit(architect, unitId, { ...input, saleableArea: "113.00", expectedVersion: saved.version });
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId } })).hasUnpublishedChanges).toBe(false);
    await refused(publishUnit(manager, unitId, {}), "CONFLICT", "UNIT_NO_UNPUBLISHED_CHANGES");

    await updateUnit(architect, unitId, { ...input, saleableArea: "121.50", expectedVersion: saved.version + 1 });
    const second = await publishUnit(manager, unitId, {});
    expect(second.versionNumber).toBe(2);
    const history = await listUnitPublications(architect, unitId);
    expect(history.map((row) => [row.versionNumber, row.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(((await getUnitPublication(architect, unitId, first.publicationId)).snapshot.areas.saleableArea)).toBe("113.00");
    expect((await getUnitPublishing(architect, unitId)).hasUnpublishedChanges).toBe(false);
  });

  it("counts a move to another floor as a change, and keeps the unit's id and published versions", async () => {
    const { unitId } = await readyUnit("203");
    await publishUnit(manager, unitId, {});
    const other = await createFloor(owner, (await prisma.projectFloor.findUniqueOrThrow({ where: { id: floorId } })).buildingId, createFloorSchema.parse({ number: 4, name: "Floor 4", levelType: "STANDARD" }));
    await moveUnit(owner, unitId, { floorId: other.id, expectedVersion: await version(unitId) });
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId } })).hasUnpublishedChanges).toBe(true);
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(1);
  });

  it("publishes once when two reviewers publish at the same moment (§82)", async () => {
    const { unitId } = await readyUnit("204");
    const expected = (await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) })).version;
    const outcomes = await Promise.allSettled([publishUnit(manager, unitId, { expectedVersion: expected }), publishUnit(owner, unitId, { expectedVersion: expected })]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(((outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult).reason as AccessError).code).toBe("CONFLICT");
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(1);
  });

  it("refuses to publish a unit that is no longer complete, however it got there (§17)", async () => {
    const { unitId, image } = await readyUnit("205");
    await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });
    await prisma.document.update({ where: { id: image }, data: { status: "ARCHIVED" } });
    const error = await refused(publishUnit(manager, unitId, {}), "VALIDATION_ERROR", "UNIT_NOT_READY");
    expect(error.message).toContain("Primary image");
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(0);
  });
});

/* Revision, unpublish, archive --------------------------------------------------- */

describe("revision, unpublishing and archiving (§22, §31, §32, §110)", () => {
  it("sends a waiting unit back with a mandatory reason, and publishes it after resubmission", async () => {
    const { unitId } = await readyUnit("301");
    await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });
    await refused(requestUnitRevision(manager, unitId, { reason: "  " }), "VALIDATION_ERROR");
    await refused(requestUnitRevision(architect, unitId, { reason: "Wrong plan" }), "FORBIDDEN");

    const revised = await requestUnitRevision(manager, unitId, { reason: "Sales Plan dimensions do not match the saleable area." });
    expect(revised).toMatchObject({ status: "REVISION_REQUIRED", returnedChangesOnly: false });
    const publishing = await getUnitPublishing(architect, unitId);
    expect(publishing).toMatchObject({ status: "REVISION_REQUIRED", revisionReason: "Sales Plan dimensions do not match the saleable area.", pendingRequest: null });
    expect(await prisma.unitPublicationApproval.findFirst({ where: { recordId: unitId } })).toMatchObject({ status: "RETURNED", decisionNote: "Sales Plan dimensions do not match the saleable area." });

    await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });
    const published = await publishUnit(manager, unitId, {});
    expect(published.versionNumber).toBe(1);
    expect((await getUnitPublishing(architect, unitId)).revisionReason).toBeNull();
  });

  it("returns a published unit's changes without taking the unit out of use", async () => {
    const { unitId } = await readyUnit("302");
    await publishUnit(manager, unitId, {});
    const detail = await getUnitDetail(architect, unitId);
    await updateUnit(architect, unitId, updateUnitSchema.parse({ ...COMPLETE, unitCode: detail.unitCode, unitTypeId: apartmentType, bedrooms: 3, isActive: true, expectedVersion: detail.version }));

    const submitted = await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });
    expect(submitted.status).toBe("PUBLISHED");
    expect((await getUnitPublishing(manager, unitId)).pendingRequest).not.toBeNull();

    const returned = await requestUnitRevision(manager, unitId, { reason: "Three bedrooms is not what was built." });
    expect(returned).toMatchObject({ status: "PUBLISHED", returnedChangesOnly: true });
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(1);

    // With nothing waiting, the same action takes the published unit out of use.
    const pulled = await requestUnitRevision(manager, unitId, { reason: "Hold for correction." });
    expect(pulled).toMatchObject({ status: "REVISION_REQUIRED", returnedChangesOnly: false });
  });

  it("unpublishes to Ready for Publishing with a reason, archives, and restores without resurrecting a request", async () => {
    const { unitId } = await readyUnit("303");
    await publishUnit(manager, unitId, {});
    await refused(unpublishUnit(architect, unitId, { reason: "x", expectedVersion: await version(unitId) }), "FORBIDDEN");
    const unpublished = await unpublishUnit(manager, unitId, { reason: "Price list withdrawn.", expectedVersion: await version(unitId) });
    expect(unpublished.status).toBe("READY_FOR_PUBLISHING");
    expect(await prisma.unitPublicationApproval.count({ where: { recordId: unitId, status: "PENDING" } })).toBe(1);
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(1);

    const archived = await archiveUnit(manager, unitId, { expectedVersion: unpublished.version });
    expect(archived.status).toBe("ARCHIVED");
    expect(await prisma.unitPublicationApproval.count({ where: { recordId: unitId, status: "PENDING" } })).toBe(0);
    await refused(submitUnitForPublishing(architect, unitId, { expectedVersion: archived.version }), "CONFLICT", "UNIT_ARCHIVED");

    const restored = await restoreUnit(manager, unitId, { expectedVersion: archived.version });
    expect(restored.status).toBe("DRAFT");
    await refused(deleteUnit(owner, unitId), "CONFLICT", "UNIT_REFERENCED");
  });

  it("restores a published unit to Published, its version intact", async () => {
    const { unitId } = await readyUnit("304");
    await publishUnit(manager, unitId, {});
    const archived = await archiveUnit(owner, unitId, { expectedVersion: await version(unitId) });
    const restored = await restoreUnit(owner, unitId, { expectedVersion: archived.version });
    expect(restored.status).toBe("PUBLISHED");
    expect((await getUnitPublishing(sales, unitId)).currentPublication?.versionNumber).toBe(1);
  });
});

/* The Sales Plan and documents ----------------------------------------------------- */

describe("the Sales Plan and documents (§33-§39, §78, §112, §117)", () => {
  it("keeps one logical Sales Plan: a new upload is a version, the publication keeps the old one", async () => {
    const { unitId, plan } = await readyUnit("401");
    const published = await publishUnit(manager, unitId, {});
    const v1 = (await prisma.document.findUniqueOrThrow({ where: { id: plan } })).currentVersionId;

    const other = await uploadToUnit(architect, unitId, "second plan", "Another plan.pdf", "application/pdf", pdf("other"));
    await refused(setUnitSalesPlan(architect, unitId, { documentId: other }), "CONFLICT", "UNIT_SALES_PLAN_EXISTS");

    await newVersion(architect, plan, pdf("revision two"));
    expect((await getUnitPublishing(architect, unitId)).hasUnpublishedChanges).toBe(true);
    const recorded = await setUnitSalesPlan(architect, unitId, { documentId: plan });
    expect(recorded).toMatchObject({ versionNumber: 2, changed: true });
    expect(await setUnitSalesPlan(architect, unitId, { documentId: plan })).toMatchObject({ changed: false });
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId } })).hasUnpublishedChanges).toBe(true);

    expect((await prisma.unitPublication.findUniqueOrThrow({ where: { id: published.publicationId } })).salesPlanDocumentVersionId).toBe(v1);
    const next = await publishUnit(manager, unitId, {});
    expect((await getUnitPublication(architect, unitId, next.publicationId)).snapshot.salesPlan?.versionNumber).toBe(2);
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

    const elsewhere = await attachDocumentFromBytes(owner, { name: `${T} riverside drawing`, context: "project", projectId: PROJECT.a, fileName: "Riverside.pdf", mimeType: "application/pdf" } as Parameters<typeof attachDocumentFromBytes>[1], pdf("riverside"));
    const error = await refused(attachUnitDocument(architect, first, { documentId: elsewhere.documentId, category: "OTHER" }), "VALIDATION_ERROR");
    expect(error.reason).toBe("CROSS_PROJECT_REFERENCE");

    const link = (await listUnitFiles(architect, first)).documents[0];
    await detachUnitDocument(architect, first, link.id);
    expect(await prisma.document.count({ where: { id: drawing.documentId } })).toBe(1);
    await refused(attachUnitDocument(sales, first, { documentId: drawing.documentId, category: "OTHER" }), "FORBIDDEN");
  });

  it("flags an archived attachment in readiness (§17: no broken references)", async () => {
    const { unitId } = await readyUnit("405");
    const drawing = await uploadToUnit(architect, unitId, "old drawing", "Old.pdf", "application/pdf", pdf("old"));
    await attachUnitDocument(architect, unitId, { documentId: drawing, category: "TECHNICAL_DRAWING" });
    expect((await getUnitPublishing(architect, unitId)).readiness.ready).toBe(true);
    await prisma.document.update({ where: { id: drawing }, data: { status: "ARCHIVED" } });
    expect((await getUnitPublishing(architect, unitId)).readiness.missing).toEqual(["Attached files available"]);
  });
});

/* Media ------------------------------------------------------------------------ */

describe("media (§40-§44, §76, §113)", () => {
  it("makes the first image primary, swaps the primary in one step, orders, and counts a new primary as a change", async () => {
    const { unitId } = await readyUnit("501");
    await publishUnit(manager, unitId, {});
    const second = await uploadToUnit(architect, unitId, "view", "View.png", "image/png", await png(200));
    const added = await addUnitMedia(architect, unitId, { documentId: second, category: "VIEW", caption: "From the balcony" });
    expect(added.isPrimary).toBe(false);

    await updateUnitMedia(architect, unitId, added.id, { isPrimary: true });
    const media = (await listUnitFiles(architect, unitId)).media;
    expect(media.filter((item) => item.isPrimary).map((item) => item.id)).toEqual([added.id]);
    expect(media[0].thumbnailHref).toMatch(/\/api\/project-units\/.+\/media\/.+\/thumbnail$/);
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId } })).hasUnpublishedChanges).toBe(true);

    // The database holds the rule on its own: a second primary is refused.
    const other = media.find((item) => !item.isPrimary)!;
    await expect(prisma.unitMedia.update({ where: { id: other.id }, data: { isPrimary: true } })).rejects.toThrow();

    await reorderUnitMedia(architect, unitId, [added.id, other.id]);
    expect((await listUnitFiles(architect, unitId)).media.map((item) => item.id)).toEqual([added.id, other.id]);

    await removeUnitMedia(architect, unitId, added.id);
    expect((await getUnitPublishing(architect, unitId)).readiness.missing).toEqual(["Primary image"]);
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
  it("lets the Architect prepare and submit but not publish; the Architecture Manager, Owner and Admin publish", async () => {
    const { unitId } = await readyUnit("601");
    expect((await getUnitPublishing(architect, unitId)).capabilities).toMatchObject({ canSubmit: true, canPublish: false, canManageDocuments: true, canManageMedia: true, canUnpublish: false });
    expect((await getUnitPublishing(manager, unitId)).capabilities).toMatchObject({ canSubmit: true, canPublish: true, canRequestRevision: true, canUnpublish: true, canArchive: true });
    expect((await getUnitPublishing(owner, unitId)).capabilities.canPublish).toBe(true);
    expect((await getUnitPublishing(admin, unitId)).capabilities.canPublish).toBe(true);
    // The Project Manager prepares and submits on their own projects; Marina is not one of them.
    await refused(getUnitPublishing(pm, unitId), "NOT_FOUND");
    expect(publishingCapabilities(pm)).toMatchObject({ canSubmit: true, canManageDocuments: true, canPublish: false, canRequestRevision: false });
  });

  it("gives Sales and Finance the page and the published history, and nothing to change", async () => {
    const { unitId, image } = await readyUnit("602");
    const published = await publishUnit(manager, unitId, {});
    for (const reader of [sales, finance]) {
      const publishing = await getUnitPublishing(reader, unitId);
      expect(publishing.capabilities).toMatchObject({ canSubmit: false, canPublish: false, canManageDocuments: false, canManageMedia: false, canViewHistory: true });
      expect((await listUnitPublications(reader, unitId)).map((row) => row.id)).toEqual([published.publicationId]);
      await refused(addUnitMedia(reader, unitId, { documentId: image, category: "OTHER", caption: null }), "FORBIDDEN");
      await refused(submitUnitForPublishing(reader, unitId, { expectedVersion: await version(unitId) }), "FORBIDDEN");
    }
  });

  it("finds nothing for a reader outside the project or the company, whatever id they hold", async () => {
    const { unitId } = await readyUnit("603");
    const request = await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });
    for (const outsider of [engineer, ownerB]) {
      await refused(getUnitPublishing(outsider, unitId), "NOT_FOUND");
      await refused(publishUnit(outsider, unitId, {}), outsider === ownerB ? "NOT_FOUND" : "NOT_FOUND");
      await refused(listUnitFiles(outsider, unitId), "NOT_FOUND");
    }
    await refused(getUnitPublication(architect, unitId, request.requestId), "NOT_FOUND");
    await refused(getUnitDetail(architect, unitId, SITE), "NOT_FOUND");
  });

  it("shows the unit's history and filters the unit list by publication", async () => {
    const { unitId } = await readyUnit("604");
    await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });
    await publishUnit(manager, unitId, {});
    const actions = (await listUnitActivity(sales, unitId)).items.map((item) => item.action);
    expect(actions).toEqual(expect.arrayContaining(["UNIT_CREATED", "UNIT_SALES_PLAN_UPLOADED", "UNIT_MEDIA_ADDED", "UNIT_SUBMITTED_FOR_PUBLISHING", "UNIT_PUBLISHED"]));
    const list = await listProjectUnits(architect, MARINA, parseUnitListQuery({ publicationStatus: "PUBLISHED", q: T }));
    expect(list.items.map((item) => item.id)).toEqual([unitId]);
    expect(list.items[0].publication).toEqual({ status: "PUBLISHED", versionNumber: 1, hasUnpublishedChanges: false });
  });
});

/* The Approvals Center ------------------------------------------------------------ */

describe("the Approvals Center (§21, §47; PRD #41)", () => {
  it("puts a submitted unit in the publisher's inbox and publishes it from there", async () => {
    const { unitId } = await readyUnit("701");
    await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });
    const waiting = await listApprovals(manager, approvalQuerySchema.parse({ tab: "waiting", provider: "projects", limit: 100 }));
    const item = waiting.items.find((entry) => entry.sourceId === unitId);
    expect(item).toMatchObject({ providerKey: "projects", canApprove: true, canReturn: true, canReject: false, href: `/projects/${MARINA}/units/${unitId}/publishing` });
    expect((await listApprovals(architect, approvalQuerySchema.parse({ tab: "waiting", limit: 100 }))).items.some((entry) => entry.sourceId === unitId)).toBe(false);

    const result = await decideApproval(manager, "projects", item!.approvalId, "APPROVE", { note: null });
    expect(result.outcome).toBe("APPROVED");
    expect((await getUnitPublishing(architect, unitId)).status).toBe("PUBLISHED");
  });

  it("returns a unit for revision from the Center with the reviewer's reason", async () => {
    const { unitId } = await readyUnit("702");
    await submitUnitForPublishing(architect, unitId, { expectedVersion: await version(unitId) });
    const request = await prisma.unitPublicationApproval.findFirstOrThrow({ where: { recordId: unitId, status: "PENDING" } });
    await decideApproval(manager, "projects", request.id, "RETURN", { note: "Add the terrace area." });
    expect(await getUnitPublishing(architect, unitId)).toMatchObject({ status: "REVISION_REQUIRED", revisionReason: "Add the terrace area." });
  });
});
