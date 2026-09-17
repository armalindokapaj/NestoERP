import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { loadRecord } from "@/lib/core/records/record.registry";
import { globalSearch } from "@/lib/core/search/search.service";
import { addEntry } from "@/lib/modules/daily-logs/daily-log.entries";
import { SECTION_SCHEMAS } from "@/lib/modules/daily-logs/daily-log.schema";
import { createVersionUploadSession } from "@/lib/modules/documents/storage/upload.service";
import { runEngineeringReminders } from "@/lib/modules/engineering/engineering.attention";
import { rfiCalendarProvider } from "@/lib/modules/engineering/engineering.calendar-provider";
import { createEngineeringDocument, getEngineeringDocument, listEngineeringDocuments, retireEngineeringDocument } from "@/lib/modules/engineering/engineering.documents";
import { createTaskFromRecord, linkRecord, listLinks } from "@/lib/modules/engineering/engineering.links";
import { engineeringReport, myEngineeringWork, projectEngineeringOverview } from "@/lib/modules/engineering/engineering.overview";
import { createRevision, decideRevision, frozenDocumentReason, startReview, submitRevision } from "@/lib/modules/engineering/engineering.revisions";
import { addRfiReference, closeRfi, createRfi, getRfi, listRfis, openRfi, requestClarification, respondRfi, updateRfi, voidRfi } from "@/lib/modules/engineering/engineering.rfis";
import {
  createEngineeringDocumentSchema,
  createRfiSchema,
  createSubmittalSchema,
  createTransmittalSchema,
  engineeringDocumentListSchema,
  reviewDecisionSchema,
  rfiListSchema,
  updateRfiSchema,
  updateTransmittalSchema,
} from "@/lib/modules/engineering/engineering.schema";
import { closeSubmittal, createSubmittal, getSubmittal } from "@/lib/modules/engineering/engineering.submittals";
import { createTransmittal, getTransmittal, issueTransmittal, updateTransmittal, voidTransmittal } from "@/lib/modules/engineering/engineering.transmittals";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";
import { code, COMPANY_A, ENGINEERING_SEED as S, HARBOUR, makeFile, makeHarbour, restoreEngineering } from "./fixtures";

/**
 * The engineering record against the real database (PRD #46 §288-§307): the
 * register and revisions, reviews and self-review, RFIs, submittals,
 * transmittals, and the boundaries with tasks, daily logs, procurement, HSE,
 * search, calendar, notifications and attention.
 */

let owner: UserContext;
let pm: UserContext;
let engineer: UserContext;
let architect: UserContext;
let hse: UserContext;
let qaqc: UserContext;
let viewer: UserContext;
let finance: UserContext;
let ownerB: UserContext;

const decision = (value: string, comment: string | null = null) => reviewDecisionSchema.parse({ decision: value, comment });

beforeAll(async () => {
  await restoreEngineering();
  await makeHarbour();
  [owner, pm, engineer, architect, hse, qaqc, viewer, finance] = await Promise.all((["OWNER", "PROJECT_MANAGER", "ENGINEER", "ARCHITECT", "HSE", "QAQC", "VIEWER", "FINANCE"] as const).map((role) => loginAs(role)));
  ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
});

afterAll(async () => {
  await restoreEngineering();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("engineering document register (§59-§65, §76-§81, §288)", () => {
  it("keeps numbers unique per project and every link on the same project (§64, §224, §305)", async () => {
    const input = createEngineeringDocumentSchema.parse({ documentNumber: "STR-GA-900", title: "Test general arrangement", documentType: "DRAWING", discipline: "STRUCTURAL", reviewerMemberId: architect.membershipId });
    const created = await createEngineeringDocument(engineer, "project_a", input);
    await expect(createEngineeringDocument(engineer, "project_a", input)).rejects.toMatchObject(code("ENGINEERING_DOCUMENT_NUMBER_TAKEN"));
    expect((await createEngineeringDocument(pm, HARBOUR.project, { ...input, reviewerMemberId: null })).id).not.toBe(created.id);
    // The Engineer cannot open Harbour, so its work package answers like a missing id; the PM can, and is told why (PRD #47 §51).
    await expect(createEngineeringDocument(engineer, "project_a", { ...input, documentNumber: "X-1", workPackageId: HARBOUR.workPackage })).rejects.toMatchObject(code("ENGINEERING_WORK_PACKAGE_INVALID"));
    await expect(createEngineeringDocument(pm, "project_a", { ...input, documentNumber: "X-1", reviewerMemberId: null, workPackageId: HARBOUR.workPackage })).rejects.toMatchObject(code("ENGINEERING_WORK_PACKAGE_PROJECT_MISMATCH"));
    await expect(createEngineeringDocument(engineer, "project_a", { ...input, documentNumber: "X-2", contractorId: S.contractors.northgate })).rejects.toMatchObject(code("ENGINEERING_CONTRACTOR_NOT_ASSIGNED"));
    await expect(createEngineeringDocument(engineer, "project_a", { ...input, documentNumber: "X-3", reviewerMemberId: finance.membershipId })).rejects.toMatchObject(code("ENGINEERING_MEMBER_INVALID"));
    // A work package lends its contractor (§38).
    const lent = await createEngineeringDocument(engineer, "project_a", { ...input, documentNumber: "X-4", workPackageId: S.workPackages.facade });
    expect((await getEngineeringDocument(engineer, lent.id)).contractor?.id).toBe(S.contractors.brightline);
    await expect(createEngineeringDocument(viewer, "project_a", { ...input, documentNumber: "X-5" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists drawings in the drawing register and hides other projects and companies (§76, §249, §306)", async () => {
    const drawings = await listEngineeringDocuments(engineer, engineeringDocumentListSchema.parse({ projectId: "project_a", drawings: "1" }));
    expect(drawings.items.map((row) => row.documentNumber)).toEqual(expect.arrayContaining(["ARC-SD-023", "FAC-SD-004"]));
    expect(drawings.items.map((row) => row.documentNumber)).not.toContain("STR-CALC-011");
    await expect(listEngineeringDocuments(engineer, engineeringDocumentListSchema.parse({ projectId: HARBOUR.project }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getEngineeringDocument(ownerB, S.documents.floorPlan)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await loadRecord(finance, "engineering_document", S.documents.floorPlan)).toBeNull();
  });
});

describe("revisions and reviews (§66-§75, §171, §172, §289, §311)", () => {
  it("walks a drawing through revisions A, B and C, keeping every revision and superseding the older ones", async () => {
    const doc = await createEngineeringDocument(engineer, "project_a", createEngineeringDocumentSchema.parse({ documentNumber: "ARC-SD-900", title: "Test level 9 plan", documentType: "DRAWING", discipline: "ARCHITECTURE", reviewerMemberId: architect.membershipId }));
    const fileA = await makeFile("rev_a", "engineering_document", doc.id);
    const revA = await createRevision(engineer, "document", doc.id, { revisionCode: "A", documentId: fileA, notes: null, submit: true });
    expect(revA.status).toBe("SUBMITTED");
    expect((await getEngineeringDocument(engineer, doc.id)).reviewDueAt).not.toBeNull();

    // The file of a submitted revision is frozen (§69, §289).
    expect(await frozenDocumentReason(fileA)).toMatch(/submitted revision/);
    await expect(createVersionUploadSession(engineer, fileA, { fileName: "rev_a_v2.pdf", mimeType: "application/pdf", sizeBytes: 1024 })).rejects.toMatchObject(code("ENGINEERING_FILE_FROZEN"));

    await expect(createRevision(engineer, "document", doc.id, { revisionCode: "B", documentId: await makeFile("rev_b_early", "engineering_document", doc.id), notes: null, submit: false })).rejects.toMatchObject(code("REVISION_IN_PROGRESS"));
    // The submitter never reviews their own revision (§74, §251).
    await expect(decideRevision(engineer, "document", revA.id, decision("APPROVED"))).rejects.toMatchObject(code("REVIEW_SELF_FORBIDDEN"));
    await expect(decideRevision(viewer, "document", revA.id, decision("APPROVED"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(decideRevision(architect, "document", revA.id, reviewDecisionSchema.parse({ decision: "REVISION_REQUIRED", comment: "Grid C is off by 50 mm." }))).resolves.toMatchObject({ decision: "REVISION_REQUIRED" });
    expect((await getEngineeringDocument(engineer, doc.id)).status).toBe("REVISION_REQUIRED");

    const revB = await createRevision(engineer, "document", doc.id, { revisionCode: "B", documentId: await makeFile("rev_b", "engineering_document", doc.id), notes: "Grid fixed", submit: true });
    await startReview(architect, "document", revB.id);
    await decideRevision(architect, "document", revB.id, decision("APPROVED_WITH_COMMENTS", "Tidy the door tags."));
    const revC = await createRevision(engineer, "document", doc.id, { revisionCode: "C", documentId: await makeFile("rev_c", "engineering_document", doc.id), notes: null, submit: false });
    await expect(createRevision(engineer, "document", doc.id, { revisionCode: "c", documentId: await makeFile("rev_c_dup", "engineering_document", doc.id), notes: null, submit: false })).rejects.toMatchObject(code("REVISION_IN_PROGRESS"));
    await submitRevision(pm, "document", revC.id);
    await decideRevision(architect, "document", revC.id, decision("APPROVED"));

    const detail = await getEngineeringDocument(engineer, doc.id);
    expect(detail.status).toBe("APPROVED");
    expect(detail.currentRevision?.code).toBe("C");
    expect(detail.revisions.map((revision) => [revision.revisionCode, revision.status, revision.decision])).toEqual([
      ["C", "FINALIZED", "APPROVED"],
      ["B", "SUPERSEDED", "APPROVED_WITH_COMMENTS"],
      ["A", "SUPERSEDED", "REVISION_REQUIRED"],
    ]);
    expect(detail.revisions.find((revision) => revision.revisionCode === "A")?.reviewComment).toBe("Grid C is off by 50 mm.");
    expect(await prisma.notificationEventOutbox.count({ where: { eventType: "ENGINEERING_DOCUMENT_APPROVED", entityId: doc.id } })).toBe(2);
  });

  it("lets only the assigned reviewer or an approver decide, and needs a comment short of approval (§172, §250)", async () => {
    // STR-CALC-011 Rev 01 is with the Engineer; the Architect may approve too, QA/QC may not.
    await expect(decideRevision(qaqc, "document", "engrev_str_calc_011_01", decision("REVISION_REQUIRED", "No."))).rejects.toMatchObject(code("REVIEW_NOT_ASSIGNED"));
    expect(() => reviewDecisionSchema.parse({ decision: "REJECTED", comment: "" })).toThrow();
    await decideRevision(engineer, "document", "engrev_str_calc_011_01", decision("APPROVED"));
    await expect(decideRevision(engineer, "document", "engrev_str_calc_011_01", decision("APPROVED"))).rejects.toMatchObject(code("REVISION_NOT_IN_REVIEW"));
  });

  it("retires a document and keeps it readable (§81)", async () => {
    await retireEngineeringDocument(owner, S.documents.ventilation, { reason: "Replaced by MEP-SPEC-003", status: "SUPERSEDED" });
    const detail = await getEngineeringDocument(engineer, S.documents.ventilation);
    expect(detail.status).toBe("SUPERSEDED");
    expect(detail.capabilities.canAddRevision).toBe(false);
  });
});

describe("RFIs (§82-§97, §290, §309)", () => {
  it("runs draft → open → answered → clarification → answered → closed, with responses kept and the question fixed", async () => {
    const created = await createRfi(engineer, "project_a", createRfiSchema.parse({ subject: "Test lintel over door D12", question: "What lintel is specified over D12?", priority: "HIGH", assignedToMemberId: architect.membershipId, contractorId: S.contractors.apex }));
    expect(created.rfiNumber).toBe("RFI-005");
    let rfi = await getRfi(engineer, created.id);
    expect(rfi.status).toBe("DRAFT");
    await openRfi(engineer, created.id);
    rfi = await getRfi(engineer, created.id);
    expect(rfi.status).toBe("OPEN");
    expect(rfi.dueAt).not.toBeNull();
    await expect(updateRfi(engineer, created.id, updateRfiSchema.parse({ subject: "Changed", question: rfi.question, priority: "HIGH", assignedToMemberId: architect.membershipId, dueAt: rfi.dueAt, contractorId: S.contractors.apex, expectedVersion: rfi.version }))).rejects.toMatchObject(code("RFI_QUESTION_LOCKED"));

    // Only the assignee — or someone who may close RFIs — answers (§88).
    await expect(respondRfi(qaqc, created.id, { text: "Not mine", final: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await respondRfi(architect, created.id, { text: "Precast lintel PL-150.", final: true });
    expect((await getRfi(engineer, created.id)).status).toBe("ANSWERED");
    await expect(closeRfi(viewer, created.id, { note: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await requestClarification(engineer, created.id, { text: "Bearing length?" });
    expect((await getRfi(engineer, created.id)).status).toBe("CLARIFICATION_REQUIRED");
    await expect(closeRfi(engineer, created.id, { note: null })).rejects.toMatchObject(code("RFI_NOT_ANSWERED"));
    await respondRfi(architect, created.id, { text: "150 mm each side.", final: true });
    await closeRfi(engineer, created.id, { note: "Accepted" });
    rfi = await getRfi(engineer, created.id);
    expect(rfi.status).toBe("CLOSED");
    // Every response and the clarification stay, in order (§90).
    expect(rfi.responses.map((response) => [response.clarificationRequest, response.text])).toEqual([
      [false, "Precast lintel PL-150."],
      [true, "Bearing length?"],
      [false, "150 mm each side."],
    ]);
    await expect(respondRfi(architect, created.id, { text: "Late", final: false })).rejects.toMatchObject(code("RFI_CLOSED"));
    const events = await prisma.notificationEventOutbox.findMany({ where: { entityId: created.id }, select: { eventType: true } });
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["RFI_OPENED", "RFI_ASSIGNED", "RFI_ANSWERED", "RFI_CLOSED"]));
  });

  it("voids with a reason, references only records on the same project, and refuses guessed ids (§91, §247, §305, §306)", async () => {
    const created = await createRfi(engineer, "project_a", createRfiSchema.parse({ subject: "Test to void", question: "?", open: true }));
    const elsewhere = await createEngineeringDocument(pm, HARBOUR.project, createEngineeringDocumentSchema.parse({ documentNumber: "HBR-SK-001", title: "Harbour sketch", documentType: "DRAWING", discipline: "STRUCTURAL" }));
    await expect(addRfiReference(engineer, created.id, { referenceType: "ENGINEERING_DOCUMENT", referenceId: elsewhere.id, note: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addRfiReference(pm, created.id, { referenceType: "ENGINEERING_DOCUMENT", referenceId: elsewhere.id, note: null })).rejects.toMatchObject(code("RFI_REFERENCE_PROJECT_MISMATCH"));
    await expect(addRfiReference(engineer, created.id, { referenceType: "DRAWING", referenceId: S.documents.transferSlab, note: null })).rejects.toMatchObject(code("RFI_REFERENCE_INVALID"));
    await addRfiReference(engineer, created.id, { referenceType: "DRAWING", referenceId: S.documents.floorPlan, note: "Grid C" });
    await expect(voidRfi(engineer, created.id, { reason: "Raised twice" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await voidRfi(pm, created.id, { reason: "Raised twice" });
    expect((await getRfi(engineer, created.id)).status).toBe("VOID");

    await expect(getRfi(engineer, HARBOUR.rfi)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getRfi(ownerB, S.rfis.slabEdge)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listRfis(engineer, rfiListSchema.parse({}))).items.map((row) => row.id)).not.toContain(HARBOUR.rfi);
  });

  it("raises a follow-up task through the task service, and finishing it leaves the RFI open (§93, §136, §293)", async () => {
    const task = await createTaskFromRecord(engineer, "rfi", S.rfis.slabEdge, { title: "Check slab edge on site", description: null, assigneeMemberId: engineer.membershipId, dueDate: null, priority: "MEDIUM" });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.taskId }, select: { entityType: true, entityId: true, projectId: true } });
    expect(row).toEqual({ entityType: "rfi", entityId: S.rfis.slabEdge, projectId: "project_a" });
    await prisma.task.update({ where: { id: task.taskId }, data: { status: "COMPLETED", completedAt: new Date() } });
    expect((await getRfi(engineer, S.rfis.slabEdge)).status).toBe("OPEN");
    expect((await getRfi(engineer, S.rfis.slabEdge)).tasks.map((item) => item.id)).toContain(task.taskId);
  });
});

describe("submittals (§98-§117, §291, §310)", () => {
  it("revision required on Rev A, approved with comments on Rev B, and nothing bought or received (§117, §153, §154, §298)", async () => {
    const created = await createSubmittal(engineer, "project_a", createSubmittalSchema.parse({ title: "Test door hardware", submittalType: "MATERIAL_SUBMITTAL", contractorId: S.contractors.apex, assignedReviewerMemberId: architect.membershipId, manufacturer: "dormakaba", supplierId: "supplier_buildpro" }));
    expect(created.submittalNumber).toBe("SUB-005");
    const orders = await prisma.purchaseOrder.count({ where: { companyId: COMPANY_A } });
    const movements = await prisma.stockMovement.count({ where: { companyId: COMPANY_A } });

    const revA = await createRevision(engineer, "submittal", created.id, { revisionCode: "A", documentId: await makeFile("sub_a", "technical_submittal", created.id), notes: null, submit: true });
    await decideRevision(architect, "submittal", revA.id, decision("REVISION_REQUIRED", "Fire rating data missing."));
    await reconcileAttention({ companyId: COMPANY_A });
    expect(await prisma.attentionItem.count({ where: { entityId: created.id, conditionKey: "SUBMITTAL_REVISION_REQUIRED", recipientMemberId: engineer.membershipId, status: "ACTIVE" } })).toBe(1);

    const revB = await createRevision(engineer, "submittal", created.id, { revisionCode: "B", documentId: await makeFile("sub_b", "technical_submittal", created.id), notes: null, submit: true });
    expect(await prisma.attentionItem.count({ where: { entityId: created.id, conditionKey: "SUBMITTAL_REVISION_REQUIRED", status: "ACTIVE" } })).toBe(0);
    await decideRevision(architect, "submittal", revB.id, decision("APPROVED_WITH_COMMENTS", "Use the stainless finish."));
    const detail = await getSubmittal(engineer, created.id);
    expect(detail.status).toBe("APPROVED_WITH_COMMENTS");
    expect(detail.revisions.map((revision) => revision.status)).toEqual(["FINALIZED", "SUPERSEDED"]);
    expect(await prisma.purchaseOrder.count({ where: { companyId: COMPANY_A } })).toBe(orders);
    expect(await prisma.stockMovement.count({ where: { companyId: COMPANY_A } })).toBe(movements);
    await expect(closeSubmittal(engineer, created.id)).resolves.toBeDefined();
    const supplierB = await prisma.supplier.findFirst({ where: { companyId: { not: COMPANY_A } }, select: { id: true } });
    if (supplierB) await expect(createSubmittal(engineer, "project_a", createSubmittalSchema.parse({ title: "Cross company", submittalType: "MATERIAL_SUBMITTAL", supplierId: supplierB.id }))).rejects.toMatchObject(code("SUBMITTAL_SUPPLIER_INVALID"));
  });

  it("links a method statement to an HSE permit without changing the permit, and lets HSE review it (§112, §192, §297)", async () => {
    const permit = await prisma.hseWorkPermit.findUniqueOrThrow({ where: { id: "hse_ptw_002" }, select: { status: true, updatedAt: true } });
    await linkRecord(pm, "technical_submittal", S.submittals.crane, { type: "work_permit", recordId: "hse_ptw_002" });
    expect(await prisma.hseWorkPermit.findUniqueOrThrow({ where: { id: "hse_ptw_002" }, select: { status: true, updatedAt: true } })).toEqual(permit);
    expect((await listLinks(pm, "technical_submittal", S.submittals.crane)).map((link) => link.id)).toEqual(expect.arrayContaining(["hse_ptw_001", "hse_ptw_002"]));
    // Finance has no Engineering at all, so neither the submittal nor its links are theirs to list.
    await expect(listLinks(finance, "technical_submittal", S.submittals.crane)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Procurement reads the submittal but not HSE permits: the permit links are simply not shown (§205).
    const procurement = await loginAs("PROCUREMENT");
    expect((await listLinks(procurement, "technical_submittal", S.submittals.crane)).filter((link) => link.type === "work_permit")).toEqual([]);
    await decideRevision(hse, "submittal", "subrev_002_01", decision("APPROVED"));
    expect((await getSubmittal(pm, S.submittals.crane)).status).toBe("APPROVED");
    await expect(linkRecord(pm, "technical_submittal", S.submittals.curtainWall, { type: "engineering_document", recordId: (await prisma.engineeringDocument.findFirstOrThrow({ where: { projectId: HARBOUR.project } })).id })).rejects.toMatchObject(code("ENGINEERING_LINK_PROJECT_MISMATCH"));
  });
});

describe("transmittals (§118-§124, §292)", () => {
  it("issues a draft once, fixes its contents and files, and voids it with a reason", async () => {
    const base = createTransmittalSchema.parse({ direction: "OUTGOING", purpose: "FOR_REVIEW", contractorId: S.contractors.brightline, items: [{ documentId: "doc_eng_fac_sd_004_p01", engineeringDocumentId: S.documents.curtainWall, engineeringRevisionId: "engrev_fac_sd_004_p01" }] });
    const created = await createTransmittal(pm, "project_a", base);
    expect(created.transmittalNumber).toBe("TRN-003");
    await expect(createTransmittal(pm, "project_a", { ...base, items: [{ documentId: "doc_eng_arc_sd_023_c", engineeringDocumentId: S.documents.curtainWall, engineeringRevisionId: "engrev_fac_sd_004_p01", remarks: null }] })).rejects.toMatchObject(code("TRANSMITTAL_ITEM_REVISION_MISMATCH"));
    await issueTransmittal(pm, created.id, { issuedAt: null });
    expect((await getTransmittal(pm, created.id)).status).toBe("ISSUED");
    await expect(updateTransmittal(pm, created.id, updateTransmittalSchema.parse({ direction: "OUTGOING", purpose: "FOR_CONSTRUCTION", items: [] }))).rejects.toMatchObject(code("TRANSMITTAL_ISSUED_LOCKED"));
    expect(await frozenDocumentReason("doc_eng_fac_sd_004_p01")).not.toBeNull();
    await voidTransmittal(owner, created.id, { reason: "Wrong recipient" });
    expect((await getTransmittal(pm, created.id)).status).toBe("VOID");
    await expect(voidTransmittal(engineer, S.transmittals.draft, { reason: "No" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("integration boundaries (§140-§143, §200-§205, §295, §300-§303)", () => {
  it("records a contractor crew in the daily log only for a contractor and work package of that log's project (§142)", async () => {
    const log = await prisma.dailyLog.findFirstOrThrow({ where: { companyId: COMPANY_A, projectId: "project_a", status: "DRAFT" }, select: { id: true } });
    const value = (extra: Record<string, unknown>) => SECTION_SCHEMAS.workforce.parse({ organizationName: "Test Apex crew", trade: "Concrete", headcount: 12, ...extra });
    await expect(addEntry(pm, log.id, "workforce", value({ contractorId: S.contractors.apex, workPackageId: HARBOUR.workPackage }))).rejects.toMatchObject(code("ENGINEERING_WORK_PACKAGE_PROJECT_MISMATCH"));
    await expect(addEntry(pm, log.id, "workforce", value({ contractorId: S.contractors.northgate }))).rejects.toMatchObject(code("ENGINEERING_CONTRACTOR_NOT_ASSIGNED"));
    const added = await addEntry(pm, log.id, "workforce", value({ workPackageId: S.workPackages.frame }));
    expect(await prisma.dailyLogWorkforceEntry.findUniqueOrThrow({ where: { id: added.id }, select: { contractorId: true, workPackageId: true } })).toEqual({ contractorId: S.contractors.apex, workPackageId: S.workPackages.frame });
    await prisma.dailyLogWorkforceEntry.delete({ where: { id: added.id } });
  });

  it("searches only the records a reader can open (§203-§205, §300)", async () => {
    const search = async (context: UserContext, text: string) => (await globalSearch(context, text, { limitPerProvider: 20 })).results?.map((row: { entityId: string }) => row.entityId) ?? [];
    expect(await search(engineer, "Slab edge")).toContain(S.rfis.slabEdge);
    expect(await search(engineer, "basement wall")).not.toContain(HARBOUR.rfi);
    expect(await search(pm, "basement wall")).toContain(HARBOUR.rfi);
    expect(await search(ownerB, "Apex")).not.toContain(S.contractors.apex);
    expect(await search(engineer, "ARC-SD-023")).toContain(S.documents.floorPlan);
  });

  it("puts only real due dates on the calendar, inside the project door (§200-§202, §301)", async () => {
    const range = { from: new Date(Date.now() - 20 * 86_400_000), to: new Date(Date.now() + 20 * 86_400_000) };
    const events = async (context: UserContext) => (await rfiCalendarProvider.getEvents({ context, range, filters: {}, timezone: "Europe/Tirane" } as never)).map((event) => event.sourceId);
    expect(await events(engineer)).toContain(S.rfis.slabEdge);
    expect(await events(engineer)).not.toContain(HARBOUR.rfi);
    expect(await events(engineer)).not.toContain(S.rfis.fireStopping);
    expect(await events(pm)).toContain(HARBOUR.rfi);
  });

  it("dispatches notifications to people who can open the record, and reconciles overdue attention (§194-§199, §302, §303)", async () => {
    const created = await createRfi(engineer, "project_a", createRfiSchema.parse({ subject: "Test dispatch", question: "?", assignedToMemberId: architect.membershipId, open: true }));
    await dispatchNotifications(500);
    expect(await prisma.notification.count({ where: { entityType: "rfi", entityId: created.id, recipientMemberId: architect.membershipId } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { entityType: "rfi", entityId: created.id, recipientMemberId: engineer.membershipId } })).toBe(0);

    await reconcileAttention({ companyId: COMPANY_A });
    expect(await prisma.attentionItem.count({ where: { entityId: S.rfis.slabEdge, conditionKey: "RFI_OVERDUE", status: "ACTIVE", recipientMemberId: architect.membershipId } })).toBe(1);
    await respondRfi(architect, S.rfis.slabEdge, { text: "Setback 150 mm; edge beam may reduce to 450 mm.", final: true });
    expect(await prisma.attentionItem.count({ where: { entityId: S.rfis.slabEdge, conditionKey: { in: ["RFI_OVERDUE", "RFI_RESPONSE_REQUIRED"] }, status: "ACTIVE" } })).toBe(0);

    // Meridian's Tower RFI falls overdue: reminded once, however often the job runs (§196).
    await prisma.rfi.update({ where: { id: S.rfis.tower }, data: { dueAt: new Date(Date.now() - 3 * 86_400_000) } });
    const first = await runEngineeringReminders(new Date());
    const second = await runEngineeringReminders(new Date());
    expect(first.rfiOverdue).toBeGreaterThanOrEqual(1);
    expect(second).toEqual({ rfiDueSoon: 0, rfiOverdue: 0, submittalDueSoon: 0, submittalOverdue: 0 });
    const reminders = await prisma.notificationEventOutbox.findMany({ where: { entityType: "rfi", entityId: S.rfis.tower, eventType: "RFI_OVERDUE" } });
    expect(reminders).toHaveLength(1);
    expect((reminders[0].payloadJson as { memberIds: string[] }).memberIds).toContain((await loginAsEmail(DEMO_EMAIL.pmB)).membershipId);
  });

  it("summarises the project and my work, and reports without a contractor score (§159, §206-§211, §278)", async () => {
    const overview = await projectEngineeringOverview(pm, "project_a");
    expect(overview.counts.openRfis).toBeGreaterThan(0);
    const work = await myEngineeringWork(architect);
    expect(work.reviews.map((item) => item.id)).toContain(S.documents.curtainWall);
    const report = await engineeringReport(pm, { projectId: "project_a" });
    expect(report.submittals.byType.length).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(/score/i);
  });
});
