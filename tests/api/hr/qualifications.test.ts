import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { loadRecord } from "@/lib/core/records/record.registry";
import { findReadableDocument } from "@/lib/modules/documents/document.parent-access";
import {
  archiveQualificationSchema,
  createQualificationSchema,
  rejectQualificationSchema,
  resubmitQualificationSchema,
  updateQualificationSchema,
  verifyQualificationSchema,
} from "@/lib/modules/hr/qualifications/qualification.schema";
import * as qualifications from "@/lib/modules/hr/qualifications/qualification.service";
import { getQualificationsTab } from "@/lib/modules/people/people.service";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * Skills and qualifications (E-02 §14, §15, §32-§37, §69-§79, §91, §100-§105,
 * §178-§195; ADR 0007).
 *
 * The person's, across the group. Colleagues see a verified summary the person
 * shares; the person and HR see the record; nobody checks their own; the
 * supporting file is one canonical Document with its own reach. Everything a
 * test makes is removed.
 */

const COMPANY_A = "company_demo_a";
const PREFIX = "T02Q";
const startedAt = new Date();

let hr: UserContext;
let ceo: UserContext;
let engineer: UserContext;
let pm: UserContext;
let viewer: UserContext;
let tenantOwner: UserContext;
let personId: string;
let employeeId: string;

async function add(context: UserContext, input: Record<string, unknown>, person = personId) {
  return qualifications.createQualification(context, person, createQualificationSchema.parse({ title: `${PREFIX} ${String(input.title ?? input.type)}`, ...input, ...(input.title ? { title: `${PREFIX} ${String(input.title)}` } : {}) }));
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "OK",
    (error: { code?: string }) => error.code ?? "ERROR",
  );
}

async function tab(context: UserContext, person = personId) {
  return getQualificationsTab(context, person);
}

async function removeCreated() {
  const rows = await prisma.personQualification.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  const docs = await prisma.document.findMany({ where: { companyId: COMPANY_A, name: { startsWith: PREFIX } }, select: { id: true } });
  const docIds = docs.map((row) => row.id);
  const links = await prisma.employeeDocumentLink.findMany({ where: { documentId: { in: docIds } }, select: { id: true } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...ids, ...links.map((row) => row.id)] }, createdAt: { gte: startedAt } } });
  await prisma.personQualification.updateMany({ where: { id: { in: ids } }, data: { supersededById: null } });
  await prisma.personQualification.deleteMany({ where: { id: { in: ids } } });
  await prisma.employeeDocumentLink.deleteMany({ where: { id: { in: links.map((row) => row.id) } } });
  await prisma.document.updateMany({ where: { id: { in: docIds } }, data: { currentVersionId: null } });
  await prisma.documentVersion.deleteMany({ where: { documentId: { in: docIds } } });
  await prisma.document.deleteMany({ where: { id: { in: docIds } } });
}

let counter = 0;
async function uploadedBy(context: UserContext): Promise<string> {
  counter += 1;
  const id = `t02q_doc_${counter}_${Date.now()}`;
  await prisma.document.create({
    data: { id, companyId: COMPANY_A, name: `${PREFIX} evidence ${counter}.pdf`, module: "hr", entityType: "employee", entityId: employeeId, status: "ACTIVE", storageStatus: "AVAILABLE", uploadedByMemberId: context.membershipId, createdBy: context.userId },
  });
  await prisma.documentVersion.create({ data: { id: `${id}_v1`, companyId: COMPANY_A, documentId: id, versionNumber: 1, storageKey: `${id}/v1`, uploadedByMemberId: context.membershipId, storageStatus: "AVAILABLE" } });
  await prisma.document.update({ where: { id }, data: { currentVersionId: `${id}_v1`, latestVersionNumber: 1 } });
  return id;
}

beforeAll(async () => {
  [hr, ceo, engineer, pm, viewer, tenantOwner] = await Promise.all([
    loginAs("HR"),
    loginAs("CEO"),
    loginAs("ENGINEER"),
    loginAs("PROJECT_MANAGER"),
    loginAs("VIEWER"),
    loginAsEmail(DEMO_EMAIL.tenantOwner),
  ]);
  const employment = await prisma.employeeProfile.findUniqueOrThrow({ where: { companyMemberId: engineer.membershipId }, select: { id: true, personProfileId: true } });
  personId = employment.personProfileId;
  employeeId = employment.id;
  await removeCreated();
});

afterAll(async () => {
  await removeCreated();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("what colleagues, the person and HR see (E-02 §32-§37, §103, §111, §178)", () => {
  it("shows colleagues a verified summary the person shares, and nothing before it is verified", async () => {
    const skill = await add(engineer, { type: "PROFESSIONAL_LICENSE", title: "Professional Engineer Licence", issuer: "Order of Engineers", documentNumber: "PE-4471", expiryDate: "2028-05-14", visibility: "GROUP_SUMMARY" });
    expect(skill.verificationStatus).toBe("UNVERIFIED");

    const before = await tab(pm);
    expect(before.records).toBeNull();
    expect(before.summaries.map((row) => row.id)).not.toContain(skill.id);

    const verified = await qualifications.verifyQualification(hr, personId, skill.id, verifyQualificationSchema.parse({ expectedVersion: 1 }));
    expect(verified.verificationStatus).toBe("VERIFIED");

    const after = await tab(pm);
    const summary = after.summaries.find((row) => row.id === skill.id);
    expect(summary).toMatchObject({ title: `${PREFIX} Professional Engineer Licence`, issuer: "Order of Engineers", expiryDate: "2028-05-14" });
    // A summary is not the record: no number, no note, no file (§34, §122-§124).
    expect(summary).not.toHaveProperty("documentNumber");
    expect(summary).not.toHaveProperty("verificationNote");
    expect(await loadRecord(pm, "person_qualification", skill.id)).toBeNull();
    expect(await loadRecord(engineer, "person_qualification", skill.id)).not.toBeNull();
  });

  it("keeps a private one from HR, and an HR-only one from the person", async () => {
    const privateOne = await add(engineer, { type: "SKILL", title: "Private skill", visibility: "PRIVATE", proficiency: "ADVANCED" });
    expect(privateOne.proficiency).toBe("ADVANCED");
    const hrOnly = await add(hr, { type: "OTHER", title: "HR note on qualification", visibility: "HR_ONLY" });
    const restricted = await add(hr, { type: "OTHER", title: "Restricted one", visibility: "RESTRICTED" });

    const own = (await tab(engineer)).records!.map((row) => row.id);
    expect(own).toContain(privateOne.id);
    expect(own).not.toContain(hrOnly.id);
    expect(own).not.toContain(restricted.id);

    const asHr = (await tab(hr)).records!.map((row) => row.id);
    expect(asHr).not.toContain(privateOne.id);
    expect(asHr).toContain(hrOnly.id);
    expect(asHr).toContain(restricted.id);

    // The CEO reads HR's professional file but not what HR restricted to private records.
    const asCeo = (await tab(ceo)).records!.map((row) => row.id);
    expect(asCeo).toContain(hrOnly.id);
    expect(asCeo).not.toContain(restricted.id);
    // The person may not pick what is HR's to set.
    expect(await codeOf(add(engineer, { type: "SKILL", title: "Hidden from me", visibility: "HR_ONLY" }))).toBe("VALIDATION_ERROR");
  });

  it("is not found from another group, and an id from another person is not this person's (§9, §171, §186)", async () => {
    const mine = await add(engineer, { type: "SKILL", title: "Rebar detailing" });
    expect(await codeOf(tab(tenantOwner))).toBe("NOT_FOUND");
    expect(await codeOf(qualifications.getQualification(tenantOwner, personId, mine.id))).toBe("NOT_FOUND");
    const other = await prisma.employeeProfile.findFirstOrThrow({ where: { companyId: COMPANY_A, companyMemberId: { not: null }, personProfileId: { not: personId } }, select: { personProfileId: true } });
    expect(await codeOf(qualifications.getQualification(hr, other.personProfileId, mine.id))).toBe("NOT_FOUND");
  });

  it("lets only HR that employs the person add for them, and only the person add their own", async () => {
    expect(await codeOf(add(pm, { type: "SKILL", title: "Added by a colleague" }))).toBe("NOT_FOUND");
    const viewerPerson = await prisma.user.findUniqueOrThrow({ where: { id: viewer.userId }, select: { personProfileId: true } });
    // The Viewer reads; adding is a contribution it does not hold (PRD #5 §27).
    expect(await codeOf(add(viewer, { type: "SKILL", title: "Viewer skill" }, viewerPerson.personProfileId!))).toBe("FORBIDDEN");
    const byHr = await add(hr, { type: "SAFETY_CERTIFICATE", title: "First aid at work", expiryDate: "2027-03-01" });
    expect(byHr.recordedIn.id).toBe(COMPANY_A);
    expect(byHr.actions.canVerify).toBe(true);
  });
});

describe("verification (E-02 §72-§79, §191, §192)", () => {
  it("is never the person's own, and two verifiers at once leave one outcome", async () => {
    const certificate = await add(engineer, { type: "TRAINING_CERTIFICATE", title: "Confined spaces" });
    expect(await codeOf(qualifications.verifyQualification(engineer, personId, certificate.id, verifyQualificationSchema.parse({ expectedVersion: 1 })))).toBe("FORBIDDEN");
    expect((await tab(engineer)).records!.find((row) => row.id === certificate.id)?.actions.canVerify).toBe(false);

    const owner = await loginAs("OWNER");
    const outcomes = await Promise.all([
      codeOf(qualifications.verifyQualification(owner, personId, certificate.id, verifyQualificationSchema.parse({ expectedVersion: 1 }))),
      codeOf(qualifications.rejectQualification(hr, personId, certificate.id, rejectQualificationSchema.parse({ expectedVersion: 1, reason: "Expired certificate" }))),
    ]);
    expect(outcomes.filter((outcome) => outcome === "OK")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "CONFLICT")).toHaveLength(1);
  });

  it("rejects with a reason the person reads, and takes a resubmission with a new file", async () => {
    const diploma = await add(engineer, { type: "DEGREE", title: "BSc Civil Engineering" });
    const rejected = await qualifications.rejectQualification(hr, personId, diploma.id, rejectQualificationSchema.parse({ expectedVersion: 1, reason: "Upload the diploma itself" }));
    expect(rejected).toMatchObject({ verificationStatus: "REJECTED", verificationNote: "Upload the diploma itself" });
    const told = await prisma.notificationEventOutbox.findFirst({ where: { entityId: diploma.id, eventType: "QUALIFICATION_REJECTED" }, select: { payloadJson: true } });
    expect(told?.payloadJson).toMatchObject({ memberIds: [engineer.membershipId] });

    const evidence = await uploadedBy(engineer);
    const back = await qualifications.resubmitQualification(engineer, personId, diploma.id, resubmitQualificationSchema.parse({ expectedVersion: 2, documentId: evidence }));
    expect(back.verificationStatus).toBe("UNVERIFIED");
    expect(back.file?.documentId).toBe(evidence);
    // The rejection is kept in the audit trail (§249).
    expect(await prisma.auditEvent.count({ where: { entityId: diploma.id, actionKey: "EMPLOYEE_QUALIFICATION_REJECTED" } })).toBe(1);
  });
});

describe("the supporting file is one canonical Document (E-02 §2, §35, §59, §104, §179, §187)", () => {
  it("files the evidence once on the employment, referenced by the qualification, and opens it only by its own rules", async () => {
    const evidence = await uploadedBy(engineer);
    const degree = await add(engineer, { type: "DIPLOMA", title: "Master of Architecture", issuer: "University of Tirana", documentId: evidence, visibility: "GROUP_SUMMARY" });
    expect(degree.file).toMatchObject({ documentId: evidence, openable: true });

    const links = await prisma.employeeDocumentLink.findMany({ where: { documentId: evidence }, select: { category: true, visibility: true, employeeProfileId: true } });
    expect(links).toEqual([{ category: "DIPLOMA", visibility: "EMPLOYEE_AND_HR", employeeProfileId: employeeId }]);
    expect(await prisma.document.count({ where: { name: { startsWith: `${PREFIX} evidence` }, id: evidence } })).toBe(1);

    await qualifications.verifyQualification(hr, personId, degree.id, verifyQualificationSchema.parse({ expectedVersion: 1 }));
    // A colleague sees the verified diploma, and cannot open the file (§36, §179).
    expect((await tab(pm)).summaries.map((row) => row.id)).toContain(degree.id);
    expect(await findReadableDocument(pm, evidence)).toBeNull();
    expect(await findReadableDocument(hr, evidence)).not.toBeNull();
  });

  it("refuses somebody else's file as evidence", async () => {
    const other = await prisma.employeeProfile.findFirstOrThrow({ where: { companyId: COMPANY_A, companyMemberId: { not: null }, id: { not: employeeId } }, select: { id: true } });
    const theirs = `t02q_foreign_${Date.now()}`;
    await prisma.document.create({ data: { id: theirs, companyId: COMPANY_A, name: `${PREFIX} foreign.pdf`, module: "hr", entityType: "employee", entityId: other.id, status: "ACTIVE", storageStatus: "AVAILABLE", uploadedByMemberId: hr.membershipId, createdBy: hr.userId } });
    expect(await codeOf(add(hr, { type: "DIPLOMA", title: "Wrong file", documentId: theirs }))).toBe("VALIDATION_ERROR");
  });
});

describe("renewal and history (E-02 §63, §91, §194)", () => {
  it("renews: the new one current and unverified, the old one superseded and kept", async () => {
    const licence = await add(engineer, { type: "EQUIPMENT_LICENSE", title: "Tower crane operator", expiryDate: "2026-10-30" });
    await qualifications.verifyQualification(hr, personId, licence.id, verifyQualificationSchema.parse({ expectedVersion: 1 }));
    expect(await codeOf(add(engineer, { type: "DIPLOMA", title: "Wrong type", renewsId: licence.id }))).toBe("VALIDATION_ERROR");
    const renewed = await add(engineer, { type: "EQUIPMENT_LICENSE", title: "Tower crane operator", expiryDate: "2031-10-30", renewsId: licence.id });
    expect(renewed).toMatchObject({ isCurrent: true, verificationStatus: "UNVERIFIED" });
    const old = await qualifications.getQualification(engineer, personId, licence.id);
    expect(old).toMatchObject({ isCurrent: false, verificationStatus: "SUPERSEDED", supersededBy: { id: renewed.id } });
  });

  it("lets the person correct their own until it is checked, and archive what was never checked", async () => {
    const skill = await add(engineer, { type: "SKILL", title: "BIM coordination", proficiency: "INTERMEDIATE" });
    const edited = await qualifications.updateQualification(engineer, personId, skill.id, updateQualificationSchema.parse({ expectedVersion: 1, proficiency: "ADVANCED" }));
    expect(edited.proficiency).toBe("ADVANCED");
    await qualifications.verifyQualification(hr, personId, skill.id, verifyQualificationSchema.parse({ expectedVersion: 2 }));
    expect(await codeOf(qualifications.updateQualification(engineer, personId, skill.id, updateQualificationSchema.parse({ expectedVersion: 3, proficiency: "EXPERT" })))).toBe("FORBIDDEN");
    expect(await codeOf(qualifications.archiveQualification(engineer, personId, skill.id, archiveQualificationSchema.parse({ expectedVersion: 3, reason: "No longer relevant" })))).toBe("FORBIDDEN");
    const archived = await qualifications.archiveQualification(hr, personId, skill.id, archiveQualificationSchema.parse({ expectedVersion: 3, reason: "Duplicate" }));
    expect(archived.archived).toBe(true);
    expect((await tab(pm)).summaries.map((row) => row.id)).not.toContain(skill.id);
  });
});
