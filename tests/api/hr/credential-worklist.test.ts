import type { CredentialVerificationStatus, EmployeeDocumentCategory, EmployeeDocumentVisibility, QualificationType, QualificationVisibility } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { companyDays } from "@/lib/core/notifications/company-day";
import { getCredentialWorklist } from "@/lib/modules/hr/credentials/credential.worklist";
import { addDays, dbDay } from "@/lib/modules/hr/employment/employment.dates";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * HR's credential worklists (E-02 §74, §153, §154, §204).
 *
 * What waits to be verified, what runs out within 30 days and what has run
 * out — read through the HR door only, with the conditions the attention items
 * use: never the reader's own, never another company's, never what the person
 * keeps private, and "To verify" only for somebody who verifies.
 */

const COMPANY_A = "company_demo_a";
const PREFIX = "T02W";

let hr: UserContext;
let engineer: UserContext;
let tenantOwner: UserContext;
let today: string;
let engineerEmployment: string;
let engineerPerson: string;
let hrEmployment: string;
let groupId: string;
let counter = 0;

async function document(options: { employment?: string; category?: EmployeeDocumentCategory; status?: CredentialVerificationStatus; expiresIn?: number | null; visibility?: EmployeeDocumentVisibility }): Promise<string> {
  counter += 1;
  const id = `t02w_doc_${counter}_${Date.now()}`;
  const employment = options.employment ?? engineerEmployment;
  await prisma.document.create({
    data: { id, companyId: COMPANY_A, name: `${PREFIX} file ${counter}.pdf`, module: "hr", entityType: "employee", entityId: employment, status: "ACTIVE", storageStatus: "AVAILABLE", uploadedByMemberId: hr.membershipId, createdBy: hr.userId },
  });
  const link = await prisma.employeeDocumentLink.create({
    data: {
      companyId: COMPANY_A,
      employeeProfileId: employment,
      documentId: id,
      category: options.category ?? "DRIVING_LICENSE",
      title: `${PREFIX} document ${counter}`,
      visibility: options.visibility ?? "EMPLOYEE_AND_HR",
      verificationStatus: options.status ?? "UNVERIFIED",
      expiryDate: options.expiresIn === undefined || options.expiresIn === null ? null : dbDay(addDays(today, options.expiresIn)),
      createdByMemberId: hr.membershipId,
    },
    select: { id: true },
  });
  return link.id;
}

async function qualification(options: { person?: string; type?: QualificationType; status?: CredentialVerificationStatus; expiresIn?: number | null; visibility?: QualificationVisibility }): Promise<string> {
  counter += 1;
  const row = await prisma.personQualification.create({
    data: {
      parentGroupId: groupId,
      personProfileId: options.person ?? engineerPerson,
      companyId: COMPANY_A,
      type: options.type ?? "SAFETY_CERTIFICATE",
      title: `${PREFIX} qualification ${counter}`,
      verificationStatus: options.status ?? "UNVERIFIED",
      visibility: options.visibility ?? "EMPLOYEE_AND_HR",
      expiryDate: options.expiresIn === undefined || options.expiresIn === null ? null : dbDay(addDays(today, options.expiresIn)),
    },
    select: { id: true },
  });
  return row.id;
}

async function listed(context: UserContext, view: string): Promise<string[]> {
  const list = await getCredentialWorklist(context, view);
  return list?.view === view ? list.items.map((item) => item.id) : [];
}

const without = (context: UserContext, ...grants: string[]) => ({ ...context, permissions: context.permissions.filter((permission) => !grants.includes(permission)) }) as UserContext;

async function removeCreated() {
  const docs = await prisma.document.findMany({ where: { companyId: COMPANY_A, name: { startsWith: PREFIX } }, select: { id: true } });
  await prisma.employeeDocumentLink.deleteMany({ where: { documentId: { in: docs.map((row) => row.id) } } });
  await prisma.document.deleteMany({ where: { id: { in: docs.map((row) => row.id) } } });
  await prisma.personQualification.deleteMany({ where: { title: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  [hr, engineer, tenantOwner] = await Promise.all([loginAs("HR"), loginAs("ENGINEER"), loginAsEmail(DEMO_EMAIL.tenantOwner)]);
  today = (await companyDays(COMPANY_A))(new Date()).day;
  const employment = await prisma.employeeProfile.findUniqueOrThrow({ where: { companyMemberId: engineer.membershipId }, select: { id: true, personProfileId: true, personProfile: { select: { parentGroupId: true } } } });
  engineerEmployment = employment.id;
  engineerPerson = employment.personProfileId;
  groupId = employment.personProfile.parentGroupId;
  hrEmployment = (await prisma.employeeProfile.findUniqueOrThrow({ where: { companyMemberId: hr.membershipId }, select: { id: true } })).id;
  await removeCreated();
});

afterAll(async () => {
  await removeCreated();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("HR's worklists (E-02 §153, §154)", () => {
  it("lists what waits to be verified, what runs out within 30 days and what has run out, documents and qualifications together", async () => {
    const waiting = await document({ expiresIn: null });
    const expiring = await document({ status: "VERIFIED", expiresIn: 10 });
    const later = await document({ status: "VERIFIED", expiresIn: 45 });
    const expired = await document({ status: "EXPIRED", expiresIn: -3 });
    const qualificationWaiting = await qualification({});
    const qualificationExpiring = await qualification({ status: "VERIFIED", expiresIn: 5 });

    const verify = await listed(hr, "verify");
    expect(verify).toEqual(expect.arrayContaining([waiting, qualificationWaiting]));
    expect(verify).not.toContain(expiring);

    const soon = await listed(hr, "expiring");
    expect(soon).toEqual(expect.arrayContaining([expiring, qualificationExpiring]));
    expect(soon).not.toContain(later);
    expect(soon).not.toContain(expired);

    expect(await listed(hr, "expired")).toContain(expired);

    const list = await getCredentialWorklist(hr, "expiring");
    expect(list?.counts.expiring).toBe(list?.items.length);
    const row = list?.items.find((item) => item.id === expiring);
    expect(row).toMatchObject({ kind: "employee_document", daysToExpiry: 10, href: `/hr/employees/${engineerEmployment}/documents?document=${expiring}` });
    expect(list?.items.find((item) => item.id === qualificationExpiring)?.href).toBe(`/people/${engineerPerson}?tab=qualifications#qualification-${qualificationExpiring}`);
  });

  it("never lists the reader's own, what the person keeps private, what HR may not read, or anything put away (§74, §105-§111)", async () => {
    const own = await document({ employment: hrEmployment });
    const privateToEmployee = await document({ visibility: "PRIVATE_EMPLOYEE" });
    const identity = await document({ category: "IDENTITY_DOCUMENT" });
    const contract = await document({ category: "EMPLOYMENT_CONTRACT" });
    const privateQualification = await qualification({ visibility: "PRIVATE" });
    const restricted = await qualification({ visibility: "RESTRICTED" });
    const archived = await document({});
    await prisma.employeeDocumentLink.update({ where: { id: archived }, data: { archivedAt: new Date(), archiveReason: "test" } });

    const verify = await listed(hr, "verify");
    expect(verify).not.toContain(own);
    expect(verify).not.toContain(privateToEmployee);
    expect(verify).not.toContain(privateQualification);
    expect(verify).not.toContain(archived);
    // A contract is HR's own word, not evidence: nothing to verify (§72).
    expect(verify).not.toContain(contract);
    // An identity paper is HR-private: listed only for a reader of the private file.
    expect(hr.permissions).toContain("hr.document.private.view");
    expect(verify).toEqual(expect.arrayContaining([identity, restricted]));
    const narrower = await listed(without(hr, "hr.document.private.view"), "verify");
    expect(narrower).not.toContain(identity);
    expect(narrower).not.toContain(restricted);
  });

  it("offers \"To verify\" only to somebody who verifies, and each kind only to its verifier", async () => {
    const waiting = await document({});
    const qualificationWaiting = await qualification({});

    const readerOnly = without(hr, "hr.document.verify", "hr.qualification.verify");
    const list = await getCredentialWorklist(readerOnly, "verify");
    expect(list?.views).toEqual(["expiring", "expired"]);
    expect(list?.view).toBe("expiring");

    expect(await listed(without(hr, "hr.document.verify"), "verify")).toEqual(expect.arrayContaining([qualificationWaiting]));
    expect(await listed(without(hr, "hr.document.verify"), "verify")).not.toContain(waiting);
    expect(await listed(without(hr, "hr.qualification.verify"), "verify")).toContain(waiting);
    expect(await listed(without(hr, "hr.qualification.verify"), "verify")).not.toContain(qualificationWaiting);
  });

  it("gives an employee and another company's owner no worklist over this company's people", async () => {
    await document({});
    expect(await getCredentialWorklist(engineer, "verify")).toBeNull();
    const elsewhere = await getCredentialWorklist(tenantOwner, "verify");
    const ids = elsewhere?.items.map((item) => item.id) ?? [];
    const ours = await prisma.employeeDocumentLink.findMany({ where: { companyId: COMPANY_A, title: { startsWith: PREFIX } }, select: { id: true } });
    for (const row of ours) expect(ids).not.toContain(row.id);
  });
});
