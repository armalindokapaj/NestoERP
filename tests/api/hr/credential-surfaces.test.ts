import type { CredentialVerificationStatus, EmployeeDocumentCategory, EmployeeDocumentVisibility, QualificationType, QualificationVisibility } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { companyDays } from "@/lib/core/notifications/company-day";
import { globalSearch } from "@/lib/core/search/search.service";
import { findReadableDocument } from "@/lib/modules/documents/document.parent-access";
import { credentialCalendarProvider } from "@/lib/modules/calendar/providers/hr-credentials.provider";
import { findCredentialFindings } from "@/lib/modules/hr/credentials/credential.integrity";
import { employeeDocumentReport, qualificationReport } from "@/lib/modules/hr/credentials/credential.reports";
import { addDays, dbDay } from "@/lib/modules/hr/employment/employment.dates";
import { getWorkProfile } from "@/lib/modules/people/people.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Where employee documents and qualifications surface outside their own
 * screens (E-02 §92, §93, §138-§141, §145, §146, §157-§159, §176, §195).
 *
 * The calendar names what runs out, never its title; global search never finds
 * an employee's file and finds a qualification only as the verified summary the
 * person shares; profile activity says only that a shared qualification was
 * verified; HR's reports count what HR's own lists would show.
 */

const COMPANY_A = "company_demo_a";
const PREFIX = "T02S";

let hr: UserContext;
let engineer: UserContext;
let pm: UserContext;
let today: string;
let engineerEmployment: string;
let engineerPerson: string;
let engineerName: string;
let groupId: string;
let counter = 0;

async function document(options: { category: EmployeeDocumentCategory; visibility?: EmployeeDocumentVisibility; status?: CredentialVerificationStatus; expiresIn?: number }): Promise<{ linkId: string; documentId: string }> {
  counter += 1;
  const documentId = `t02s_doc_${counter}_${Date.now()}`;
  await prisma.document.create({
    data: { id: documentId, companyId: COMPANY_A, name: `${PREFIX} secret file ${counter}`, module: "hr", entityType: "employee", entityId: engineerEmployment, status: "ACTIVE", storageStatus: "AVAILABLE", uploadedByMemberId: hr.membershipId, createdBy: hr.userId },
  });
  const link = await prisma.employeeDocumentLink.create({
    data: {
      companyId: COMPANY_A,
      employeeProfileId: engineerEmployment,
      documentId,
      category: options.category,
      title: `${PREFIX} secret title ${counter}`,
      documentNumber: `${PREFIX}-NUMBER-${counter}`,
      visibility: options.visibility ?? "EMPLOYEE_AND_HR",
      verificationStatus: options.status ?? "UNVERIFIED",
      expiryDate: options.expiresIn === undefined ? null : dbDay(addDays(today, options.expiresIn)),
    },
    select: { id: true },
  });
  return { linkId: link.id, documentId };
}

async function qualification(options: { type: QualificationType; title: string; visibility?: QualificationVisibility; status?: CredentialVerificationStatus; expiresIn?: number }): Promise<string> {
  const row = await prisma.personQualification.create({
    data: {
      parentGroupId: groupId,
      personProfileId: engineerPerson,
      companyId: COMPANY_A,
      type: options.type,
      title: `${PREFIX} ${options.title}`,
      visibility: options.visibility ?? "EMPLOYEE_AND_HR",
      verificationStatus: options.status ?? "UNVERIFIED",
      verifiedAt: options.status === "VERIFIED" ? new Date() : null,
      verifiedByMemberId: options.status === "VERIFIED" ? hr.membershipId : null,
      expiryDate: options.expiresIn === undefined ? null : dbDay(addDays(today, options.expiresIn)),
    },
    select: { id: true },
  });
  return row.id;
}

async function calendarTitles(context: UserContext, filters: { myOnly?: boolean } = {}): Promise<string[]> {
  const events = await credentialCalendarProvider.getEvents({
    context,
    range: { from: new Date(`${addDays(today, -2)}T00:00:00.000Z`), to: new Date(`${addDays(today, 60)}T00:00:00.000Z`) },
    filters,
    timezone: "Europe/Tirane",
  });
  return events.map((event) => event.title);
}

const without = (context: UserContext, ...grants: string[]) => ({ ...context, permissions: context.permissions.filter((permission) => !grants.includes(permission)) }) as UserContext;

async function removeCreated() {
  const docs = await prisma.document.findMany({ where: { companyId: COMPANY_A, name: { startsWith: PREFIX } }, select: { id: true } });
  await prisma.employeeDocumentLink.deleteMany({ where: { documentId: { in: docs.map((row) => row.id) } } });
  await prisma.document.deleteMany({ where: { id: { in: docs.map((row) => row.id) } } });
  await prisma.personQualification.deleteMany({ where: { title: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  [hr, engineer, pm] = await Promise.all([loginAs("HR"), loginAs("ENGINEER"), loginAs("PROJECT_MANAGER")]);
  today = (await companyDays(COMPANY_A))(new Date()).day;
  const employment = await prisma.employeeProfile.findUniqueOrThrow({
    where: { companyMemberId: engineer.membershipId },
    select: { id: true, personProfileId: true, personProfile: { select: { parentGroupId: true, firstName: true, lastName: true } } },
  });
  engineerEmployment = employment.id;
  engineerPerson = employment.personProfileId;
  engineerName = `${employment.personProfile.firstName} ${employment.personProfile.lastName}`;
  groupId = employment.personProfile.parentGroupId;
  await removeCreated();

  await document({ category: "DRIVING_LICENSE", expiresIn: 10 });
  await document({ category: "WORK_PERMIT", visibility: "HR_ONLY", expiresIn: 12 });
  await document({ category: "EMPLOYMENT_CONTRACT", expiresIn: 14 });
  await document({ category: "SALARY_CHANGE_DOCUMENT", visibility: "EMPLOYEE_HR_FINANCE" });
  await qualification({ type: "PROFESSIONAL_LICENSE", title: "Structural licence", expiresIn: 15 });
  await qualification({ type: "SAFETY_CERTIFICATE", title: "Working at height", visibility: "GROUP_SUMMARY", status: "VERIFIED" });
  await qualification({ type: "LANGUAGE_CERTIFICATE", title: "Private English", visibility: "PRIVATE", status: "VERIFIED" });
  await qualification({ type: "SKILL", title: "Unchecked Revit", visibility: "GROUP_SUMMARY" });
});

afterAll(async () => {
  await removeCreated();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("the calendar (§92, §93)", () => {
  it("shows the person their own expiries by kind, never by title, and not what HR keeps from them", async () => {
    const titles = await calendarTitles(engineer);
    expect(titles).toEqual(expect.arrayContaining(["Driving licence expires", "HR document expires", "Professional licence expires"]));
    expect(titles).not.toContain("Work permit expires");
    expect(titles.join(" ")).not.toContain(PREFIX);
  });

  it("shows HR the people it looks after, named, with the kind that runs out — and nobody else sees them", async () => {
    const titles = await calendarTitles(hr);
    expect(titles).toEqual(
      expect.arrayContaining([`${engineerName} — Driving licence expires`, `${engineerName} — Work permit expires`, `${engineerName} — HR document expires`, `${engineerName} — Professional licence expires`]),
    );
    expect(titles.join(" ")).not.toContain(PREFIX);
    // A reader of the professional file only never sees the contract, even unnamed.
    expect(await calendarTitles(without(hr, "hr.document.private.view"))).not.toContain(`${engineerName} — HR document expires`);
    // "Only mine" is only mine; a colleague sees none of it.
    expect((await calendarTitles(hr, { myOnly: true })).some((title) => title.startsWith(engineerName))).toBe(false);
    expect((await calendarTitles(pm)).some((title) => title.includes(engineerName))).toBe(false);
  });
});

describe("search (§138-§141, §176, §195)", () => {
  it("never finds an employee's file in global search, even for a reader who may open it", async () => {
    const contract = await prisma.employeeDocumentLink.findFirstOrThrow({ where: { title: { startsWith: PREFIX }, category: "EMPLOYMENT_CONTRACT" }, select: { documentId: true } });
    expect(await findReadableDocument(hr, contract.documentId)).not.toBeNull();
    for (const reader of [hr, engineer, pm]) {
      const found = await globalSearch(reader, `${PREFIX} secret`);
      expect(found.results.filter((result) => result.entityType === "document")).toEqual([]);
      expect(JSON.stringify(found.results)).not.toContain("NUMBER");
    }
  });

  it("finds who holds a qualification only from what they share once verified", async () => {
    const shared = await globalSearch(pm, "Working at height");
    const hit = shared.results.find((result) => result.entityType === "person_qualification");
    expect(hit).toMatchObject({ moduleKey: "people", title: expect.stringContaining("Cole"), href: `/people/${engineerPerson}?tab=qualifications` });
    expect(hit?.subtitle).toContain("Safety certificate");

    for (const text of ["Private English", "Unchecked Revit", "Structural licence"]) {
      const found = await globalSearch(pm, text);
      expect(found.results.filter((result) => result.entityType === "person_qualification")).toEqual([]);
    }
  });
});

describe("profile activity (§145, §146)", () => {
  it("says a shared qualification was verified, and nothing about private ones or the employee file", async () => {
    const profile = await getWorkProfile(pm, engineerPerson);
    const texts = profile.activity.map((entry) => entry.text);
    expect(texts).toContain(`Safety certificate verified: ${PREFIX} Working at height`);
    expect(texts.join(" ")).not.toContain("Private English");
    expect(texts.join(" ")).not.toContain("Unchecked Revit");
    expect(texts.join(" ")).not.toContain("secret");
  });
});

describe("HR's reports (§157-§159)", () => {
  it("counts qualifications HR may see, never what the person keeps private", async () => {
    const report = await qualificationReport(hr);
    expect(report.people).toBeGreaterThan(0);
    expect(report.titles.map((row) => row.title)).toContain(`${PREFIX} Working at height`);
    expect(report.titles.map((row) => row.title)).not.toContain(`${PREFIX} Private English`);
    const licences = report.coverage.find((row) => row.type === "PROFESSIONAL_LICENSE");
    expect(licences?.unverified).toBeGreaterThanOrEqual(1);
    expect(licences?.expiring).toBeGreaterThanOrEqual(1);
  });

  it("counts the employee file by the categories the reader may open, pay only for pay readers", async () => {
    const categories = (rows: Awaited<ReturnType<typeof employeeDocumentReport>>) => rows.map((row) => row.category);
    expect(categories(await employeeDocumentReport(hr))).toEqual(expect.arrayContaining(["DRIVING_LICENSE", "WORK_PERMIT", "EMPLOYMENT_CONTRACT", "SALARY_CHANGE_DOCUMENT"]));
    expect(categories(await employeeDocumentReport(without(hr, "hr.compensation.view")))).not.toContain("SALARY_CHANGE_DOCUMENT");
    expect(categories(await employeeDocumentReport(without(hr, "hr.document.private.view")))).not.toContain("EMPLOYMENT_CONTRACT");
    // Somebody whose HR scope is only themselves counts nothing of anybody else's.
    expect(await employeeDocumentReport(engineer)).toEqual([]);
    expect((await qualificationReport(engineer)).coverage).toEqual([]);
  });
});

describe("the employee file's integrity (§74, §171-§175)", () => {
  it("names a file filed on somebody else's record, self-checked evidence, an unnamed verification and a superseded row still current", async () => {
    const hrEmployment = (await prisma.employeeProfile.findUniqueOrThrow({ where: { companyMemberId: hr.membershipId }, select: { id: true } })).id;
    const misfiled = await document({ category: "CV" });
    // The file now says it belongs to HR's own employment, the link still says the engineer's.
    await prisma.document.update({ where: { id: misfiled.documentId }, data: { entityId: hrEmployment } });
    const selfChecked = await qualification({ type: "SKILL", title: "Self-checked", status: "VERIFIED" });
    await prisma.personQualification.update({ where: { id: selfChecked }, data: { verifiedByMemberId: engineer.membershipId } });
    const unnamed = await document({ category: "DEGREE", status: "VERIFIED" });
    const stale = await qualification({ type: "SKILL", title: "Stale", status: "SUPERSEDED" });

    const findings = await findCredentialFindings(prisma);
    const codeOf = (id: string) => findings.filter((finding) => finding.id === id).map((finding) => finding.code);
    expect(codeOf(misfiled.linkId)).toContain("FILE_ELSEWHERE");
    expect(codeOf(selfChecked)).toContain("QUALIFICATION_SELF_VERIFIED");
    expect(codeOf(unnamed.linkId)).toContain("FILE_UNCHECKED_VERIFICATION");
    expect(codeOf(stale)).toContain("QUALIFICATION_SUPERSEDED_CURRENT");
  });
});
