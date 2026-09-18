import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { loadRecord } from "@/lib/core/records/record.registry";
import { buildDocumentAccessWhere, findReadableDocument } from "@/lib/modules/documents/document.parent-access";
import { archiveDocument, updateDocument } from "@/lib/modules/documents/document.service";
import {
  archiveEmployeeDocumentSchema,
  fileEmployeeDocumentSchema,
  rejectEmployeeDocumentSchema,
  resubmitEmployeeDocumentSchema,
  supersedeEmployeeDocumentSchema,
  updateEmployeeDocumentSchema,
  verifyEmployeeDocumentSchema,
} from "@/lib/modules/hr/documents/employee-document.schema";
import * as documents from "@/lib/modules/hr/documents/employee-document.service";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * Employee documents (E-02 §7-§13, §33-§67, §171-§199; ADR 0007).
 *
 * One canonical Document per file, filed once on the employment with what it
 * is to HR; readers by category and visibility at the query source; semantic
 * verification that nobody applies to their own file; renewals and amendments
 * that add rather than overwrite. Every file and row a test makes is removed.
 */

const COMPANY_A = "company_demo_a";
const PREFIX = "T02D";
const startedAt = new Date();

let owner: UserContext;
let hr: UserContext;
let ceo: UserContext;
let engineer: UserContext;
let pm: UserContext;
let finance: UserContext;
let it_: UserContext;
let viewer: UserContext;
let tenantOwner: UserContext;
/** The engineer's employment in Aurelia: the file under test. */
let employeeId: string;
let counter = 0;

const withGrant = (context: UserContext, ...grants: string[]) => ({ ...context, permissions: [...context.permissions, ...grants] }) as UserContext;

/** A file uploaded on an employment, as the upload pipeline leaves it once checked. */
async function uploaded(options: { by?: UserContext; employment?: string; storageStatus?: "AVAILABLE" | "PENDING_UPLOAD" } = {}): Promise<string> {
  counter += 1;
  const by = options.by ?? hr;
  const id = `${PREFIX.toLowerCase()}_doc_${counter}_${Date.now()}`;
  const versionId = `${id}_v1`;
  await prisma.document.create({
    data: {
      id,
      companyId: COMPANY_A,
      name: `${PREFIX} file ${counter}.pdf`,
      originalFileName: `${PREFIX}-file-${counter}.pdf`,
      module: "hr",
      entityType: "employee",
      entityId: options.employment ?? employeeId,
      status: "ACTIVE",
      storageStatus: options.storageStatus ?? "AVAILABLE",
      uploadedByMemberId: by.membershipId,
      createdBy: by.userId,
    },
  });
  await prisma.documentVersion.create({ data: { id: versionId, companyId: COMPANY_A, documentId: id, versionNumber: 1, storageKey: `${id}/v1`, uploadedByMemberId: by.membershipId, storageStatus: options.storageStatus ?? "AVAILABLE" } });
  await prisma.document.update({ where: { id }, data: { currentVersionId: versionId, latestVersionNumber: 1 } });
  return id;
}

async function file(context: UserContext, input: Record<string, unknown>, employment = employeeId) {
  return documents.fileEmployeeDocument(context, employment, fileEmployeeDocumentSchema.parse(input));
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "OK",
    (error: { code?: string }) => error.code ?? "ERROR",
  );
}

async function visibleIds(context: UserContext): Promise<string[]> {
  const listed = await documents.listEmployeeDocuments(context, employeeId).catch(() => null);
  return listed?.documents.map((row) => row.id) ?? [];
}

async function removeCreated() {
  const docs = await prisma.document.findMany({ where: { companyId: COMPANY_A, name: { startsWith: PREFIX } }, select: { id: true } });
  const ids = docs.map((row) => row.id);
  const links = await prisma.employeeDocumentLink.findMany({ where: { documentId: { in: ids } }, select: { id: true } });
  const linkIds = links.map((row) => row.id);
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: linkIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...linkIds, ...ids] }, createdAt: { gte: startedAt } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids }, createdAt: { gte: startedAt } } });
  // Replacements point at each other: clear the chain before the rows.
  await prisma.employeeDocumentLink.updateMany({ where: { id: { in: linkIds } }, data: { supersededById: null, amendsId: null } });
  await prisma.employeeDocumentLink.deleteMany({ where: { id: { in: linkIds } } });
  await prisma.document.updateMany({ where: { id: { in: ids } }, data: { currentVersionId: null } });
  await prisma.documentVersion.deleteMany({ where: { documentId: { in: ids } } });
  await prisma.document.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  [owner, hr, ceo, engineer, pm, finance, it_, viewer, tenantOwner] = await Promise.all([
    loginAs("OWNER"),
    loginAs("HR"),
    loginAs("CEO"),
    loginAs("ENGINEER"),
    loginAs("PROJECT_MANAGER"),
    loginAsEmail(DEMO_EMAIL.financeA),
    loginAs("GROUP_IT"),
    loginAs("VIEWER"),
    loginAsEmail(DEMO_EMAIL.tenantOwner),
  ]);
  employeeId = (await prisma.employeeProfile.findUniqueOrThrow({ where: { companyMemberId: engineer.membershipId }, select: { id: true } })).id;
  await removeCreated();
});

afterAll(async () => {
  await removeCreated();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("who opens what (E-02 §7, §38-§46, §105-§111, §178-§186)", () => {
  it("keeps a contract between the employee and HR: not colleagues, not the CEO, not IT, not another company", async () => {
    const contract = await file(hr, { documentId: await uploaded(), category: "EMPLOYMENT_CONTRACT", title: `${PREFIX} Working contract 2026` });
    expect(contract.visibility).toBe("EMPLOYEE_AND_HR");

    expect(await visibleIds(hr)).toContain(contract.id);
    expect(await visibleIds(owner)).toContain(contract.id);
    // The employee reads their own allowed contract (§180).
    expect(await visibleIds(engineer)).toContain(contract.id);
    expect(await findReadableDocument(engineer, contract.file.documentId)).not.toBeNull();
    // Nobody else can list it, detect it or open it (§181, §184, §185).
    for (const reader of [ceo, pm, it_, viewer, finance]) {
      expect(await visibleIds(reader)).not.toContain(contract.id);
      expect(await findReadableDocument(reader, contract.file.documentId)).toBeNull();
      expect(await loadRecord(reader, "employee_document", contract.id)).toBeNull();
    }
    expect(await codeOf(documents.listEmployeeDocuments(tenantOwner, employeeId))).toBe("NOT_FOUND");
    expect(await findReadableDocument(tenantOwner, contract.file.documentId)).toBeNull();
  });

  it("lets the CEO read the professional file, and never the private or the pay classes", async () => {
    const diploma = await file(hr, { documentId: await uploaded(), category: "DIPLOMA", title: `${PREFIX} MSc Civil Engineering` });
    const salary = await file(hr, { documentId: await uploaded(), category: "SALARY_CHANGE_DOCUMENT", title: `${PREFIX} Salary letter` });
    const identity = await file(hr, { documentId: await uploaded(), category: "IDENTITY_DOCUMENT", title: `${PREFIX} ID card` });

    const seenByCeo = await visibleIds(ceo);
    expect(seenByCeo).toContain(diploma.id);
    expect(seenByCeo).not.toContain(salary.id);
    expect(seenByCeo).not.toContain(identity.id);
    // An identity paper is HR-only by default: not even the employee sees it (§42).
    expect(identity.visibility).toBe("HR_ONLY");
    expect(await visibleIds(engineer)).not.toContain(identity.id);
    // Pay evidence reaches the employee and HR by default (§40).
    expect(salary.visibility).toBe("EMPLOYEE_HR_FINANCE");
    expect(await visibleIds(engineer)).toContain(salary.id);
  });

  it("lets Finance read pay evidence only with the explicit grant, and only what HR shared with Finance (§40, §107, §183)", async () => {
    const shared = await file(hr, { documentId: await uploaded(), category: "SALARY_CHANGE_DOCUMENT", title: `${PREFIX} Raise letter`, visibility: "EMPLOYEE_HR_FINANCE" });
    const kept = await file(hr, { documentId: await uploaded(), category: "SALARY_HISTORY_DOCUMENT", title: `${PREFIX} Pay history`, visibility: "HR_ONLY" });

    expect(await findReadableDocument(finance, shared.file.documentId)).toBeNull();
    const granted = withGrant(finance, "hr.document.finance.view");
    expect(await findReadableDocument(granted, shared.file.documentId)).not.toBeNull();
    expect(await findReadableDocument(granted, kept.file.documentId)).toBeNull();
    // And only pay: the grant opens no contract.
    const contract = await file(hr, { documentId: await uploaded(), category: "EMPLOYMENT_CONTRACT", visibility: "EMPLOYEE_AND_HR" });
    expect(await findReadableDocument(granted, contract.file.documentId)).toBeNull();
  });

  it("opens a management-restricted document to explicit holders and HR, never to the employee (§38, §108)", async () => {
    const letter = await file(hr, { documentId: await uploaded(), category: "EMPLOYMENT_LETTER", title: `${PREFIX} Warning letter`, visibility: "RESTRICTED_MANAGEMENT" });
    expect(await visibleIds(engineer)).not.toContain(letter.id);
    expect(await findReadableDocument(ceo, letter.file.documentId)).toBeNull();
    expect(await findReadableDocument(withGrant(ceo, "hr.document.restricted.view"), letter.file.documentId)).not.toBeNull();
    expect(await visibleIds(hr)).toContain(letter.id);
  });

  it("keeps the Documents module's list and search to the same rules — and lists the employee's own files (§138, §176)", async () => {
    const contract = await file(hr, { documentId: await uploaded(), category: "EMPLOYMENT_CONTRACT" });
    const ownList = await prisma.document.findMany({ where: { AND: [await buildDocumentAccessWhere(engineer), { id: contract.file.documentId }] }, select: { id: true } });
    expect(ownList).toHaveLength(1);
    const colleagueList = await prisma.document.findMany({ where: { AND: [await buildDocumentAccessWhere(pm), { id: contract.file.documentId }] }, select: { id: true } });
    expect(colleagueList).toHaveLength(0);
  });

  it("refuses a document id from another employee's file under this one (§186)", async () => {
    const other = await prisma.employeeProfile.findFirstOrThrow({ where: { companyId: COMPANY_A, id: { not: employeeId }, companyMemberId: { not: null } }, select: { id: true } });
    const theirs = await file(hr, { documentId: await uploaded({ employment: other.id }), category: "DIPLOMA" }, other.id);
    expect(await codeOf(documents.getEmployeeDocument(hr, employeeId, theirs.id))).toBe("NOT_FOUND");
    expect(await codeOf(documents.getEmployeeDocument(engineer, other.id, theirs.id))).toBe("NOT_FOUND");
  });
});

describe("adding documents (E-02 §47-§56, §197, §198)", () => {
  it("lets the employee add a diploma of their own, never a contract or pay", async () => {
    const mine = await uploaded({ by: engineer });
    // Before it is filed, it is theirs and HR's — not the CEO's (§54).
    expect(await findReadableDocument(engineer, mine)).not.toBeNull();
    expect(await findReadableDocument(hr, mine)).not.toBeNull();
    expect(await findReadableDocument(ceo, mine)).toBeNull();

    expect(await codeOf(file(engineer, { documentId: mine, category: "EMPLOYMENT_CONTRACT" }))).toBe("FORBIDDEN");
    expect(await codeOf(file(engineer, { documentId: mine, category: "SALARY_CHANGE_DOCUMENT" }))).toBe("FORBIDDEN");
    // Nor keep it from HR by calling it HR-only, or widen it past what a diploma may be (§33).
    expect(await codeOf(file(engineer, { documentId: mine, category: "DIPLOMA", visibility: "RESTRICTED_MANAGEMENT" }))).toBe("VALIDATION_ERROR");

    const diploma = await file(engineer, { documentId: mine, category: "DIPLOMA", title: `${PREFIX} BSc Architecture`, issuer: "Polytechnic University of Tirana", issueDate: "2015-07-01" });
    expect(diploma.verificationStatus).toBe("UNVERIFIED");
    expect(diploma.createdBy).not.toBeNull();
    expect(await codeOf(file(engineer, { documentId: mine, category: "DIPLOMA" }))).toBe("CONFLICT");
  });

  it("files nothing whose upload has not arrived and been checked (§197, §198)", async () => {
    const pending = await uploaded({ storageStatus: "PENDING_UPLOAD" });
    expect(await codeOf(file(hr, { documentId: pending, category: "DIPLOMA" }))).toBe("CONFLICT");
    expect(await prisma.employeeDocumentLink.count({ where: { documentId: pending } })).toBe(0);
  });

  it("refuses dates that end before they start (§133)", () => {
    expect(fileEmployeeDocumentSchema.safeParse({ documentId: "x", category: "DRIVING_LICENSE", issueDate: "2026-05-01", expiryDate: "2026-04-01" }).success).toBe(false);
  });
});

describe("verification (E-02 §29-§31, §72-§79, §191, §192)", () => {
  it("is never the employee's own, and HR's check is recorded with the file version it saw", async () => {
    const licence = await file(engineer, { documentId: await uploaded({ by: engineer }), category: "PROFESSIONAL_LICENSE", title: `${PREFIX} Engineer licence`, expiryDate: "2030-05-14" });
    expect(await codeOf(documents.verifyEmployeeDocument(engineer, employeeId, licence.id, verifyEmployeeDocumentSchema.parse({ expectedVersion: 1 })))).toBe("FORBIDDEN");

    const verified = await documents.verifyEmployeeDocument(hr, employeeId, licence.id, verifyEmployeeDocumentSchema.parse({ expectedVersion: 1, note: "Checked against the register" }));
    expect(verified.verificationStatus).toBe("VERIFIED");
    expect(verified.verifiedBy).not.toBeNull();
    expect(verified.newFileSinceVerification).toBe(false);
    // Checked facts are frozen for the employee (§79); HR may still correct them.
    expect(verified.actions.canEdit).toBe(true);
    expect((await documents.getEmployeeDocument(engineer, employeeId, licence.id)).actions.canEdit).toBe(false);

    // A later file is not what was checked.
    const next = `${licence.file.documentId}_v2`;
    await prisma.documentVersion.create({ data: { id: next, companyId: COMPANY_A, documentId: licence.file.documentId, versionNumber: 2, storageKey: `${licence.file.documentId}/v2`, uploadedByMemberId: hr.membershipId, storageStatus: "AVAILABLE" } });
    await prisma.document.update({ where: { id: licence.file.documentId }, data: { currentVersionId: next, latestVersionNumber: 2 } });
    const reread = await documents.getEmployeeDocument(hr, employeeId, licence.id);
    expect(reread.newFileSinceVerification).toBe(true);
    expect(reread.file.versionNumber).toBe(2);
    // A new version is the same logical document: still one link (§61, §189).
    expect(await prisma.employeeDocumentLink.count({ where: { documentId: licence.file.documentId } })).toBe(1);

    const told = await prisma.notificationEventOutbox.findFirst({ where: { entityId: licence.id, eventType: "EMPLOYEE_DOCUMENT_VERIFIED" }, select: { payloadJson: true } });
    expect(told?.payloadJson).toMatchObject({ memberIds: [engineer.membershipId] });
  });

  it("gives two verifiers acting at once one outcome (§192)", async () => {
    const certificate = await file(hr, { documentId: await uploaded(), category: "SAFETY_CERTIFICATE", title: `${PREFIX} Working at height` });
    const outcomes = await Promise.all([
      codeOf(documents.verifyEmployeeDocument(owner, employeeId, certificate.id, verifyEmployeeDocumentSchema.parse({ expectedVersion: 1 }))),
      codeOf(documents.rejectEmployeeDocument(hr, employeeId, certificate.id, rejectEmployeeDocumentSchema.parse({ expectedVersion: 1, reason: "Illegible" }))),
    ]);
    expect(outcomes.filter((outcome) => outcome === "OK")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "CONFLICT")).toHaveLength(1);
    const row = await prisma.employeeDocumentLink.findUniqueOrThrow({ where: { id: certificate.id }, select: { verificationStatus: true, version: true } });
    expect(["VERIFIED", "REJECTED"]).toContain(row.verificationStatus);
    expect(row.version).toBe(2);
  });

  it("takes a rejection with its reason, and a resubmission back to the verifier (§77-§79)", async () => {
    const cv = await file(engineer, { documentId: await uploaded({ by: engineer }), category: "TRAINING_CERTIFICATE", title: `${PREFIX} Scaffold course` });
    expect(rejectEmployeeDocumentSchema.safeParse({ expectedVersion: 1, reason: "" }).success).toBe(false);
    const rejected = await documents.rejectEmployeeDocument(hr, employeeId, cv.id, rejectEmployeeDocumentSchema.parse({ expectedVersion: 1, reason: "The certificate is not signed" }));
    expect(rejected.verificationStatus).toBe("REJECTED");
    expect(rejected.verificationNote).toBe("The certificate is not signed");
    const back = await documents.resubmitEmployeeDocument(engineer, employeeId, cv.id, resubmitEmployeeDocumentSchema.parse({ expectedVersion: 2 }));
    expect(back.verificationStatus).toBe("UNVERIFIED");
    // HR's own records are not evidence to check.
    const contract = await file(hr, { documentId: await uploaded(), category: "EMPLOYMENT_CONTRACT" });
    expect(await codeOf(documents.verifyEmployeeDocument(hr, employeeId, contract.id, verifyEmployeeDocumentSchema.parse({ expectedVersion: 1 })))).toBe("CONFLICT");
  });
});

describe("history is added to, never overwritten (E-02 §13, §62-§67, §91, §190, §194)", () => {
  it("files an amendment as a document of its own, with the contract still current", async () => {
    const contract = await file(hr, { documentId: await uploaded(), category: "EMPLOYMENT_CONTRACT", title: `${PREFIX} Contract` });
    expect(await codeOf(file(hr, { documentId: await uploaded(), category: "DIPLOMA", amendsId: contract.id }))).toBe("VALIDATION_ERROR");
    const amendment = await file(hr, { documentId: await uploaded(), category: "CONTRACT_AMENDMENT", title: `${PREFIX} Amendment 1`, amendsId: contract.id });
    expect(amendment.file.documentId).not.toBe(contract.file.documentId);
    expect(amendment.amends).toEqual({ id: contract.id, title: `${PREFIX} Contract` });
    expect((await documents.getEmployeeDocument(hr, employeeId, contract.id)).isCurrent).toBe(true);
  });

  it("renews a licence: the new one current, the old one superseded and kept", async () => {
    const old = await file(hr, { documentId: await uploaded(), category: "DRIVING_LICENSE", title: `${PREFIX} Driving licence`, expiryDate: "2026-10-01" });
    await documents.verifyEmployeeDocument(hr, employeeId, old.id, verifyEmployeeDocumentSchema.parse({ expectedVersion: 1 }));
    expect(await codeOf(file(hr, { documentId: await uploaded(), category: "DIPLOMA", replacesId: old.id }))).toBe("VALIDATION_ERROR");

    const renewed = await file(hr, { documentId: await uploaded(), category: "DRIVING_LICENSE", expiryDate: "2036-10-01", replacesId: old.id });
    expect(renewed.isCurrent).toBe(true);
    expect(renewed.verificationStatus).toBe("UNVERIFIED");
    expect(renewed.title).toBe(`${PREFIX} Driving licence`);
    const history = await documents.getEmployeeDocument(hr, employeeId, old.id);
    expect(history).toMatchObject({ isCurrent: false, verificationStatus: "SUPERSEDED", supersededBy: { id: renewed.id } });
    expect(await codeOf(file(hr, { documentId: await uploaded(), category: "DRIVING_LICENSE", replacesId: old.id }))).toBe("CONFLICT");
  });

  it("supersedes and archives with semantic actions, never an edit of the status", async () => {
    const letter = await file(hr, { documentId: await uploaded(), category: "EMPLOYMENT_LETTER" });
    expect(updateEmployeeDocumentSchema.safeParse({ expectedVersion: 1, verificationStatus: "VERIFIED" }).data).not.toHaveProperty("verificationStatus");
    expect(await codeOf(documents.supersedeEmployeeDocument(engineer, employeeId, letter.id, supersedeEmployeeDocumentSchema.parse({ expectedVersion: 1 })))).toBe("FORBIDDEN");
    const superseded = await documents.supersedeEmployeeDocument(hr, employeeId, letter.id, supersedeEmployeeDocumentSchema.parse({ expectedVersion: 1, reason: "Replaced by the new letter" }));
    expect(superseded).toMatchObject({ verificationStatus: "SUPERSEDED", isCurrent: false });

    const certificate = await file(hr, { documentId: await uploaded(), category: "SKILLS_CERTIFICATE" });
    expect(archiveEmployeeDocumentSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    const archived = await documents.archiveEmployeeDocument(hr, employeeId, certificate.id, archiveEmployeeDocumentSchema.parse({ expectedVersion: 1, reason: "Filed on the wrong person" }));
    expect(archived.archived).toBe(true);
    // The employee no longer sees it; HR keeps it among archived documents (§65).
    expect(await visibleIds(engineer)).not.toContain(certificate.id);
    expect(await visibleIds(hr)).toContain(certificate.id);
  });

  it("recategorises a document only within what the editor manages, and records a change of reach", async () => {
    const other = await file(hr, { documentId: await uploaded(), category: "OTHER_HR" });
    const changed = await documents.updateEmployeeDocument(hr, employeeId, other.id, updateEmployeeDocumentSchema.parse({ expectedVersion: 1, category: "EMPLOYMENT_CONTRACT", visibility: "HR_ONLY" }));
    expect(changed).toMatchObject({ category: "EMPLOYMENT_CONTRACT", visibility: "HR_ONLY" });
    expect(await visibleIds(engineer)).not.toContain(other.id);
    expect(await prisma.auditEvent.count({ where: { entityId: other.id, actionKey: "EMPLOYEE_DOCUMENT_VISIBILITY_CHANGED" } })).toBe(1);
    // A stale version is a conflict, not a lost change.
    expect(await codeOf(documents.updateEmployeeDocument(hr, employeeId, other.id, updateEmployeeDocumentSchema.parse({ expectedVersion: 1, title: "Again" })))).toBe("CONFLICT");
  });
});

describe("the Documents module is not a side door (E-02 §63, §67, §200)", () => {
  it("does not let the employee rename or archive the contract HR filed, and lets HR", async () => {
    const contract = await file(hr, { documentId: await uploaded(), category: "EMPLOYMENT_CONTRACT" });
    expect(await codeOf(updateDocument(engineer, contract.file.documentId, { name: "mine now", description: undefined, versionUpdatedAt: undefined }))).toBe("FORBIDDEN");
    expect(await codeOf(archiveDocument(engineer, contract.file.documentId))).toBe("FORBIDDEN");
    expect(await codeOf(updateDocument(hr, contract.file.documentId, { name: `${PREFIX} renamed.pdf`, description: undefined, versionUpdatedAt: undefined }))).toBe("OK");
  });
});

describe("the external provider identity (E-02 §3-§5, §58, §188)", () => {
  it("maps one external item to one canonical Document per company and provider", async () => {
    const first = await uploaded();
    const second = await uploaded();
    const identity = { externalProvider: "onedrive", externalDriveId: `${PREFIX}-drive`, externalItemId: `${PREFIX}-item` };
    await prisma.document.update({ where: { id: first }, data: identity });
    await expect(prisma.document.update({ where: { id: second }, data: identity })).rejects.toMatchObject({ code: "P2002" });
    // A drive without an item names nothing.
    await expect(prisma.document.update({ where: { id: second }, data: { externalProvider: "onedrive" } })).rejects.toThrow();
  });
});
