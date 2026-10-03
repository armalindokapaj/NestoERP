import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import { correctiveActionSchema, defectSchema, requestSchema } from "@/lib/modules/qaqc/qaqc.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * AUD-09 (Forms & Validation) for the quality forms (FV-04, FV-05, FV-09):
 * every id a form names — the delivery line, the inspection a defect was found
 * in, each parent of a corrective action — is this company's and belongs
 * under what it is named with, or the save is refused on that field and
 * nothing is written. An edit keeps a link its form never carries, and
 * reassigning through an edit still needs the assign grant.
 */

const PREFIX = "aud09c2_";
const FOREIGN_ITEM = "armaar_grn_tl_membrane_0068_item_1"; // a delivery line that is not in this company
const created = { requests: [] as string[], defects: [] as string[], actions: [] as string[] };
let qaqc: UserContext;

beforeAll(async () => {
  qaqc = await loginAs("QAQC");
});

afterAll(async () => {
  const ids = [...created.requests, ...created.defects, ...created.actions];
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.correctiveAction.deleteMany({ where: { id: { in: created.actions } } });
  await prisma.qualityDefect.deleteMany({ where: { id: { in: created.defects } } });
  await prisma.inspectionRequest.deleteMany({ where: { id: { in: created.requests } } });
  await cleanupSessions();
});

const materialRequest = (overrides: Record<string, unknown> = {}) =>
  requestSchema.parse({ title: `${PREFIX}rebar delivery`, inspectionType: "MATERIAL", goodsReceiptId: "receipt_001", requestedDate: "2026-09-20", ...overrides });

describe("delivery lines (FV-09, FV-05)", () => {
  it("refuses another company's delivery line on its field and writes nothing", async () => {
    const before = await prisma.inspectionRequest.count({ where: { title: { startsWith: PREFIX } } });
    await expect(requests.createRequest(qaqc, materialRequest({ goodsReceiptItemId: FOREIGN_ITEM }))).rejects.toMatchObject({ details: { field: "goodsReceiptItemId", code: "INVALID_RECEIPT_ITEM" } });
    // A line of this company's other delivery is just as incompatible with the delivery named.
    await expect(requests.createRequest(qaqc, materialRequest({ goodsReceiptItemId: "receipt_002_item_1" }))).rejects.toMatchObject({ details: { code: "INVALID_RECEIPT_ITEM" } });
    expect(await prisma.inspectionRequest.count({ where: { title: { startsWith: PREFIX } } })).toBe(before);
  });

  it("keeps the line an edit does not carry while the delivery stays, and drops it when the delivery changes", async () => {
    const request = await requests.createRequest(qaqc, materialRequest({ goodsReceiptItemId: "receipt_001_item_1" }));
    created.requests.push(request.id);
    expect((await prisma.inspectionRequest.findUniqueOrThrow({ where: { id: request.id }, select: { goodsReceiptItemId: true } })).goodsReceiptItemId).toBe("receipt_001_item_1");

    // The edit form has no delivery-line field: the key is absent.
    await requests.updateRequest(qaqc, request.id, materialRequest({ title: `${PREFIX}rebar delivery (edited)` }));
    let row = await prisma.inspectionRequest.findUniqueOrThrow({ where: { id: request.id }, select: { title: true, goodsReceiptItemId: true } });
    expect(row).toEqual({ title: `${PREFIX}rebar delivery (edited)`, goodsReceiptItemId: "receipt_001_item_1" });

    await requests.updateRequest(qaqc, request.id, materialRequest({ goodsReceiptId: "receipt_002" }));
    row = await prisma.inspectionRequest.findUniqueOrThrow({ where: { id: request.id }, select: { title: true, goodsReceiptItemId: true } });
    expect(row.goodsReceiptItemId).toBeNull();
  });
});

describe("defects (FV-09, FV-04)", () => {
  const defect = (overrides: Record<string, unknown> = {}) =>
    defectSchema.parse({ title: `${PREFIX}honeycombing`, description: "Honeycombing at column C4 base.", projectId: "project_a", severity: "MEDIUM", ...overrides });

  it("refuses an inspection of another company, named in the hidden input, and creates nothing", async () => {
    await expect(defects.createDefect(qaqc, defect({ inspectionId: "ins_b_001" }))).rejects.toMatchObject({ details: { field: "inspectionId", code: "INVALID_INSPECTION" } });
    expect(await prisma.qualityDefect.count({ where: { title: { startsWith: PREFIX } } })).toBe(0);
    const ok = await defects.createDefect(qaqc, defect({ inspectionId: "ins_009" }));
    created.defects.push(ok.id);
    expect((await prisma.qualityDefect.findUniqueOrThrow({ where: { id: ok.id }, select: { inspectionId: true } })).inspectionId).toBe("ins_009");
  });

  it("reassigning through the edit needs the assign grant; an unchanged assignee does not", async () => {
    const row = await defects.createDefect(qaqc, defect({ assignedToMemberId: "member_engineer" }));
    created.defects.push(row.id);
    const noAssign: UserContext = { ...qaqc, permissions: qaqc.permissions.filter((permission) => permission !== "qaqc.defect.assign") };

    await expect(defects.updateDefect(noAssign, row.id, defect({ assignedToMemberId: "member_pm" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.qualityDefect.findUniqueOrThrow({ where: { id: row.id }, select: { assignedToMemberId: true } })).assignedToMemberId).toBe("member_engineer");

    await defects.updateDefect(noAssign, row.id, defect({ title: `${PREFIX}honeycombing (typo fixed)`, assignedToMemberId: "member_engineer" }));
    expect(await prisma.qualityDefect.findUniqueOrThrow({ where: { id: row.id }, select: { title: true, assignedToMemberId: true } })).toEqual({ title: `${PREFIX}honeycombing (typo fixed)`, assignedToMemberId: "member_engineer" });
  });
});

describe("corrective action parents (FV-09)", () => {
  it("resolves every parent it stores, not only the first", async () => {
    const input = (overrides: Record<string, unknown>) => correctiveActionSchema.parse({ title: `${PREFIX}re-pour`, description: "Break out and re-pour the base.", assignedToMemberId: "member_engineer", ...overrides });
    await expect(actions.createAction(qaqc, input({ ncrId: "ncr_003", defectId: "def_missing_elsewhere" }))).rejects.toMatchObject({ details: { field: "defectId", code: "INVALID_PARENT" } });
    await expect(actions.createAction(qaqc, input({ ncrId: "ncr_003", inspectionId: "ins_b_001" }))).rejects.toMatchObject({ details: { field: "inspectionId", code: "INVALID_PARENT" } });
    expect(await prisma.correctiveAction.count({ where: { title: { startsWith: PREFIX } } })).toBe(0);

    const ok = await actions.createAction(qaqc, input({ ncrId: "ncr_003" }));
    created.actions.push(ok.id);
    expect(await prisma.correctiveAction.findUniqueOrThrow({ where: { id: ok.id }, select: { ncrId: true, defectId: true, projectId: true } })).toEqual({ ncrId: "ncr_003", defectId: null, projectId: "project_a" });
  });
});
