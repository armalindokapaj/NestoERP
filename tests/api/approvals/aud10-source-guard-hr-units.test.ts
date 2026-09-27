import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AccessError } from "@/lib/access/guards";
import * as hrActions from "@/lib/actions/hr";
import type { UserContext } from "@/lib/context/types";
import { setFileScanner } from "@/lib/core/storage";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider } from "@/lib/core/storage/storage-provider.factory";
import { decideApproval, getApprovalDetail } from "@/lib/modules/approvals/approvals.service";
import { attachDocumentFromBytes } from "@/lib/modules/documents/storage/upload.service";
import { createLeaveSchema, updateLeaveSchema } from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { createBuilding } from "@/lib/modules/project-structure/structure.buildings";
import { createFloor } from "@/lib/modules/project-structure/structure.floors";
import { createBuildingSchema, createFloorSchema, createUnitSchema, updateUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import { createUnit, updateUnit } from "@/lib/modules/project-structure/structure.units";
import { addUnitMedia, setUnitSalesPlan } from "@/lib/modules/project-structure/unit-files.service";
import { submitUnitForPublishing } from "@/lib/modules/project-structure/unit-publishing.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";
import { routeHandlers } from "../../security/harness/mutations";
import { callRoute } from "../../security/harness/routes";
import { disconnectLocker, raceOnRow, refusalCode } from "./aud10-cycles";
import { asPerson, fromAction } from "./aud10-scenarios";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * HR leave decisions carry a real precondition (AUD-10 §4, A2, CW-05) and the
 * Center publishes the unit the reviewer saw (A4, A5).
 *
 * Leave keeps no cycle table: a request is its own approval and each
 * submission stamps `submittedAt`. The HR page, the API and the Center all
 * name that stamp, and HR checks it under the request's row lock inside the
 * deciding transaction — so reject → edit → resubmit (PENDING again: the ABA a
 * status check cannot see) cannot be approved from a page opened before it.
 */

const PREFIX = "aud10a_";
const createdLeave = new Set<string>();

afterEach(async () => {
  if (createdLeave.size === 0) return;
  const ids = [...createdLeave];
  await prisma.attendanceRecord.deleteMany({ where: { sourceEntityId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.approvalDecisionReceipt.deleteMany({ where: { approvalId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.leaveRequest.deleteMany({ where: { id: { in: ids } } });
  createdLeave.clear();
});

const engineer = () => loginAs("ENGINEER");
const hr = () => loginAs("HR");

/** A Monday-to-Wednesday range well clear of any seeded or other test leave. */
let weeksAhead = 80;
function range() {
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + weeksAhead * 7);
  weeksAhead += 2;
  while (start.getUTCDay() !== 1) start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);
  return { startDate: start, endDate: end };
}

/** Unpaid leave: no balance to draw down, so nothing but the request itself changes. */
async function submittedLeave(): Promise<string> {
  const context = await engineer();
  const created = await leave.createLeave(context, createLeaveSchema.parse({ leaveType: "UNPAID", ...range(), reason: `${PREFIX}family` }));
  createdLeave.add(created.id);
  await leave.submitLeave(context, created.id);
  return created.id;
}

async function stamp(id: string): Promise<string> {
  return (await prisma.leaveRequest.findUniqueOrThrow({ where: { id }, select: { submittedAt: true } })).submittedAt!.toISOString();
}

/** Everything a refused leave decision must leave untouched. */
async function leaveSnapshot(id: string) {
  const [row, activity, outbox, attendance] = await Promise.all([
    prisma.leaveRequest.findUniqueOrThrow({ where: { id } }),
    prisma.activity.count({ where: { entityId: id } }),
    prisma.notificationEventOutbox.count({ where: { entityId: id } }),
    prisma.attendanceRecord.count({ where: { sourceEntityId: id } }),
  ]);
  return JSON.parse(JSON.stringify({ row, activity, outbox, attendance })) as unknown;
}

describe("HR leave: the submission decided is the one on screen (AUD-10 §4, A2)", () => {
  it("CW-02 HR approves from the leave page, naming the submission it shows", async () => {
    const approver = await hr();
    const id = await submittedLeave();
    const shown = await stamp(id);
    const outcome = fromAction(await asPerson(approver, () => hrActions.leaveLifecycleAction(id, "approve", undefined, shown)));
    expect(outcome).toEqual({ ok: true });
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "APPROVED", approvedByMemberId: approver.membershipId });
    expect(await prisma.activity.count({ where: { entityId: id, action: "HR_LEAVE_APPROVED" } })).toBe(1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "LEAVE_DECIDED" } })).toBe(1);
  });

  it("CW-05 HR leave ABA: rejected, edited and resubmitted, the old page cannot approve the new dates", async () => {
    const approver = await hr();
    const id = await submittedLeave();
    const first = await stamp(id);
    const centerFirst = (await getApprovalDetail(approver, "hr", id)).item.version;
    expect(centerFirst).toBe(Date.parse(first));

    // Rejected from the page that showed the first submission.
    expect(fromAction(await asPerson(approver, () => hrActions.rejectLeaveAction(id, `${PREFIX}handover week`, first)))).toEqual({ ok: true });
    // The engineer moves the dates and sends it again: PENDING once more.
    const context = await engineer();
    await leave.updateLeave(context, id, updateLeaveSchema.parse({ leaveType: "UNPAID", ...range() }));
    await leave.submitLeave(context, id);
    const second = await stamp(id);
    expect(second).not.toBe(first);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");

    const before = await leaveSnapshot(id);
    // The page and the Center drawer, both still showing the first submission.
    const stalePage = fromAction(await asPerson(approver, () => hrActions.leaveLifecycleAction(id, "approve", undefined, first)));
    expect(stalePage).toMatchObject({ ok: false, code: "APPROVAL_SOURCE_CHANGED" });
    expect((stalePage as { error?: string }).error).toMatch(/reload/i);
    const staleReject = fromAction(await asPerson(approver, () => hrActions.rejectLeaveAction(id, `${PREFIX}still no`, first)));
    expect(staleReject).toMatchObject({ ok: false, code: "APPROVAL_SOURCE_CHANGED" });
    const staleCenter = await decideApproval(approver, "hr", id, "APPROVE", { note: null, expectedVersion: centerFirst }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusalCode(staleCenter)).toBe("APPROVAL_SOURCE_CHANGED");
    expect(await leaveSnapshot(id)).toEqual(before);

    // Reloaded, the page names the second submission and it is approved.
    expect(fromAction(await asPerson(approver, () => hrActions.leaveLifecycleAction(id, "approve", undefined, second)))).toEqual({ ok: true });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
    // History keeps both: submitted, rejected, resubmitted, approved.
    const trail = await prisma.activity.findMany({ where: { entityId: id, action: { in: ["HR_LEAVE_SUBMITTED", "HR_LEAVE_REJECTED", "HR_LEAVE_APPROVED"] } }, orderBy: { createdAt: "asc" }, select: { action: true } });
    expect(trail.map((row) => row.action)).toEqual(["HR_LEAVE_SUBMITTED", "HR_LEAVE_REJECTED", "HR_LEAVE_SUBMITTED", "HR_LEAVE_APPROVED"]);
  });

  it("CW-05 the check is inside the transaction: a resubmission landing while the approval waits is not approved", async () => {
    const approver = await hr();
    const id = await submittedLeave();
    const shown = await stamp(id);
    const before = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });

    // The approval has read the request (PENDING, the stamp it was shown) and
    // queued for the row. The lock holder, meanwhile, commits what a
    // reject + resubmit leaves: PENDING again, with a new stamp.
    const later = new Date(Date.parse(shown) + 60_000);
    const [outcome] = await raceOnRow("leave_requests", id, [() => leave.approveLeave(approver, id, null, { submittedAt: shown })], {
      whileHeld: async (tx) => {
        await tx.leaveRequest.update({ where: { id }, data: { submittedAt: later } });
      },
    });
    expect(outcome.ok).toBe(false);
    expect(refusalCode((outcome as { error: unknown }).error)).toBe("APPROVAL_SOURCE_CHANGED");
    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ status: "PENDING", approvedByMemberId: null, approvedAt: null });
    expect(after.submittedAt?.getTime()).toBe(later.getTime());
    expect(before.status).toBe("PENDING");
    expect(await prisma.activity.count({ where: { entityId: id, action: "HR_LEAVE_APPROVED" } })).toBe(0);
    expect(await prisma.attendanceRecord.count({ where: { sourceEntityId: id } })).toBe(0);
  });

  it("CW-05 a decision that names no submission is refused from the page and the API (428)", async () => {
    const approver = await hr();
    const id = await submittedLeave();
    const before = await leaveSnapshot(id);
    expect(fromAction(await asPerson(approver, () => hrActions.leaveLifecycleAction(id, "approve")))).toMatchObject({ ok: false, code: "APPROVAL_CYCLE_REQUIRED" });
    expect(fromAction(await asPerson(approver, () => hrActions.rejectLeaveAction(id, `${PREFIX}no stamp`)))).toMatchObject({ ok: false, code: "APPROVAL_CYCLE_REQUIRED" });

    const approve = await routeHandlers("/api/hr/leave/[leaveId]/approve");
    const routePath = `/api/hr/leave/${id}/approve`;
    actAs(approver);
    try {
      const missing = await callRoute(approve.POST!, "POST", routePath, { leaveId: id }, {});
      expect(missing.status).toBe(428);
      expect(missing.body).toMatchObject({ error: { code: "PRECONDITION_REQUIRED", details: { code: "APPROVAL_CYCLE_REQUIRED" } } });
      expect(await leaveSnapshot(id)).toEqual(before);
      const named = await callRoute(approve.POST!, "POST", routePath, { leaveId: id }, { submittedAt: await stamp(id) });
      expect(named.status).toBe(204);
    } finally {
      actAs(null);
    }
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
  });

  it("CW-04 the Center and the leave page approving at once make one transition", async () => {
    const approver = await hr();
    const id = await submittedLeave();
    const shown = await stamp(id);
    const item = (await getApprovalDetail(approver, "hr", id)).item;

    const [center, page] = await raceOnRow<unknown>("leave_requests", id, [
      () => decideApproval(approver, "hr", id, "APPROVE", { note: null, expectedVersion: item.version }),
      () => asPerson(approver, () => hrActions.leaveLifecycleAction(id, "approve", undefined, shown)),
    ]);
    const pageOk = page.ok && (page.value as { ok: boolean }).ok;
    const centerApplied = center.ok && !(center.value as { alreadyApplied?: boolean }).alreadyApplied;
    expect([pageOk, centerApplied].filter(Boolean)).toHaveLength(1);
    if (!pageOk) expect((page as { value: { code?: string } }).value.code).toMatch(/ALREADY_DECIDED|^CONFLICT$/);
    else if (!center.ok) expect(refusalCode(center.error)).toMatch(/ALREADY_DECIDED|SOURCE_CONFLICT/);
    else expect(center.value).toMatchObject({ alreadyApplied: true });

    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
    expect(await prisma.activity.count({ where: { entityId: id, action: "HR_LEAVE_APPROVED" } })).toBe(1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "LEAVE_DECIDED" } })).toBe(1);
  });

  it("A13 refuses a leave rejection with a blank reason at the service", async () => {
    const id = await submittedLeave();
    await expect(leave.rejectLeave(await hr(), id, "  ", { submittedAt: await stamp(id) })).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "APPROVAL_REASON_REQUIRED" } });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
  });
});

/* -------------------------------------------------------------------------- */
/* Unit publishing from the Center (A4, A5)                                    */
/* -------------------------------------------------------------------------- */

const MARINA = "aud10a_marina";
const UNIT_PREFIX = "AUD10A";
let storageRoot: string;

async function removeMarina() {
  const buildings = await prisma.projectBuilding.findMany({ where: { projectId: MARINA }, select: { id: true } });
  const floors = await prisma.projectFloor.findMany({ where: { buildingId: { in: buildings.map((row) => row.id) } }, select: { id: true } });
  const units = await prisma.projectUnit.findMany({ where: { floorId: { in: floors.map((row) => row.id) } }, select: { id: true } });
  const unitIds = units.map((row) => row.id);
  const requests = await prisma.unitPublicationApproval.findMany({ where: { recordId: { in: unitIds } }, select: { id: true } });
  await prisma.approvalDecisionReceipt.deleteMany({ where: { approvalId: { in: requests.map((row) => row.id) } } });
  await prisma.unitPublicationApproval.deleteMany({ where: { recordId: { in: unitIds } } });
  await prisma.unitMedia.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitDocumentLink.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.projectUnit.updateMany({ where: { id: { in: unitIds } }, data: { currentPublicationId: null, salesPlanDocumentId: null } });
  await prisma.unitPublication.deleteMany({ where: { unitId: { in: unitIds } } });
  const documents = await prisma.document.findMany({ where: { OR: [{ entityType: "project_unit", entityId: { in: unitIds } }, { name: { startsWith: UNIT_PREFIX } }] }, select: { id: true } });
  const documentIds = documents.map((row) => row.id);
  const trail = [...unitIds, ...documentIds, ...requests.map((row) => row.id), ...buildings.map((row) => row.id), ...floors.map((row) => row.id), MARINA];
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: documentIds } } });
  await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  await prisma.projectUnit.deleteMany({ where: { id: { in: unitIds } } });
  await prisma.projectFloor.deleteMany({ where: { id: { in: floors.map((row) => row.id) } } });
  await prisma.projectBuilding.deleteMany({ where: { id: { in: buildings.map((row) => row.id) } } });
  await prisma.projectMember.deleteMany({ where: { projectId: MARINA } });
  await prisma.project.deleteMany({ where: { id: MARINA } });
}

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-aud10a-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
});

afterAll(async () => {
  setFileScanner(undefined);
  await removeMarina();
  setStorageProvider(null);
  await rm(storageRoot, { recursive: true, force: true });
  await disconnectLocker();
  await cleanupSessions();
  await prisma.$disconnect();
});

async function upload(context: UserContext, unitId: string, name: string, fileName: string, mimeType: string, bytes: Uint8Array) {
  const result = await attachDocumentFromBytes(context, { name: `${UNIT_PREFIX} ${name}`, context: "record", entityType: "project_unit", entityId: unitId, fileName, mimeType } as Parameters<typeof attachDocumentFromBytes>[1], bytes);
  return result.documentId;
}

/** A complete unit the Architect has submitted for publishing, on a project of this file's own. */
async function submittedUnit() {
  setFileScanner(null);
  const [owner, architect] = await Promise.all([loginAs("OWNER"), loginAs("ARCHITECT")]);
  await removeMarina();
  await prisma.project.create({ data: { id: MARINA, companyId: COMPANY.a, code: "AUD10A-MARINA", name: "AUD10A Marina", status: "ACTIVE", projectManagerMemberId: owner.membershipId, createdBy: "test" } });
  await prisma.projectMember.createMany({ data: [owner.membershipId, architect.membershipId].map((companyMemberId) => ({ companyId: COMPANY.a, projectId: MARINA, companyMemberId, status: "ACTIVE" as const })) });
  const building = await createBuilding(owner, MARINA, createBuildingSchema.parse({ name: `${UNIT_PREFIX} Block` }));
  const floor = await createFloor(owner, building.id, createFloorSchema.parse({ number: 3, name: "Floor 3", levelType: "STANDARD" }));
  const apartment = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY.a, code: "APARTMENT" }, select: { id: true } })).id;
  const unitId = (await createUnit(owner, floor.id, createUnitSchema.parse({ unitCode: `${UNIT_PREFIX}-101`, unitTypeId: apartment, saleableArea: "113.00", internalArea: "92.40", bedrooms: 2, bathrooms: 2, rooms: 3, orientation: "SW", position: "CORNER" }))).id;
  const plan = await upload(architect, unitId, "sales plan", "Sales plan.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.4\naud10a\n%%EOF\n"));
  await setUnitSalesPlan(architect, unitId, { documentId: plan });
  const png = new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 3, background: { r: 40, g: 120, b: 160 } } }).png().toBuffer());
  const image = await upload(architect, unitId, "render", "Render.png", "image/png", png);
  await addUnitMedia(architect, unitId, { documentId: image, category: "INTERIOR_RENDER", caption: null });
  const version = (await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId }, select: { version: true } })).version;
  await submitUnitForPublishing(architect, unitId, { expectedVersion: version });
  const request = await prisma.unitPublicationApproval.findFirstOrThrow({ where: { recordId: unitId, status: "PENDING" } });
  return { unitId, requestId: request.id, architect };
}

describe("the Center publishes the unit the reviewer saw (AUD-10 §4, A4, A5)", () => {
  it("A4 a unit edited while its request waited is not published from the stale drawer; the reloaded one publishes", async () => {
    const { unitId, requestId, architect } = await submittedUnit();
    const head = await loginAsEmail(DEMO_EMAIL.architectureHead);
    const seen = (await getApprovalDetail(head, "projects", requestId)).item;
    const unitBefore = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId }, select: { version: true } });
    // The drawer's version is the unit's own row version, not the request's step count.
    expect(seen.version).toBe(unitBefore.version);

    // The Architect corrects the area while the request is still open.
    const current = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId } });
    await updateUnit(architect, unitId, updateUnitSchema.parse({ unitCode: current.unitCode, unitTypeId: current.unitTypeId, saleableArea: "121.50", internalArea: "92.40", bedrooms: 2, bathrooms: 2, rooms: 3, orientation: "SW", position: "CORNER", isActive: true, expectedVersion: current.version }));
    const edited = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId }, select: { version: true, publicationStatus: true } });
    expect(edited.version).toBeGreaterThan(unitBefore.version);
    expect(await prisma.unitPublicationApproval.count({ where: { id: requestId, status: "PENDING" } })).toBe(1);

    const stale = await decideApproval(head, "projects", requestId, "APPROVE", { note: null, expectedVersion: seen.version }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(stale).toBeInstanceOf(AccessError);
    expect((stale as AccessError).code).toBe("CONFLICT");
    // The unit service's own stale-version answer, checked under its lock.
    expect(refusalCode(stale)).toBe("STRUCTURE_STALE");
    expect(await prisma.unitPublication.count({ where: { unitId } })).toBe(0);
    expect(await prisma.unitPublicationApproval.count({ where: { id: requestId, status: "PENDING" } })).toBe(1);

    const reloaded = (await getApprovalDetail(head, "projects", requestId)).item;
    expect(reloaded.version).toBe(edited.version);
    await decideApproval(head, "projects", requestId, "APPROVE", { note: null, expectedVersion: reloaded.version });
    const published = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId }, select: { publicationStatus: true } });
    expect(published.publicationStatus).toBe("PUBLISHED");
    const publication = await prisma.unitPublication.findFirstOrThrow({ where: { unitId } });
    // What was published is what the reviewer saw after reloading: the corrected area.
    expect(JSON.stringify(publication.snapshot)).toContain("121.5");
  });
});
