import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { globalSearch } from "@/lib/core/search/search.service";
import { directoryQuerySchema, managedWorkProfileSchema, ownWorkProfileSchema } from "@/lib/modules/people/people.schema";
import { getEmploymentView, getPrivateProfile, getWorkProfile, listPeople, updateManagedWorkProfile, updateOwnWorkProfile } from "@/lib/modules/people/people.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, prisma } from "../../helpers";

/**
 * The people directory and work profiles (E-01, ADR 0002).
 *
 * Everybody who works in the group sees everybody else who does, across its
 * companies, and nobody outside it. A colleague reads the work profile and
 * nothing HR keeps private; the employment view is HR's, judged by HR's rules
 * in the employment's own company; the private view is the person's own and
 * that of those who keep person records within their reach. A person edits
 * their bio, extension, office and preferred name; HR the rest.
 */

const PRIVATE_PHONE = "+355 69 555 0101";
const person: Record<string, string> = {};
let pm: UserContext;
let hr: UserContext;
let tempHrMembership: string | null = null;
let seeded: { personalPhone: string | null; professionalBio: string | null; workPhoneExtension: string | null; officeLocation: string | null };
const startedAt = new Date();

const directory = (context: UserContext, query: Record<string, unknown> = {}) => listPeople(context, directoryQuerySchema.parse(query));
const names = (rows: Array<{ name: string }>) => rows.map((row) => row.name);

beforeAll(async () => {
  pm = await loginAs("PROJECT_MANAGER");
  hr = await loginAs("HR");
  for (const [key, username] of Object.entries({ pmA: "pm-a", ceoB: "ceo-b", ceoC: "ceo-c", architectA: "architect-a", tenantOwner: "tenant-owner", viewerA: "viewer-a" })) {
    const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { personProfileId: true } });
    person[key] = user.personProfileId!;
  }
  person.elira = "person_elira_hoxha";
  person.adrian = "person_adrian_kola";
  seeded = await prisma.personProfile.findUniqueOrThrow({ where: { id: person.pmA }, select: { personalPhone: true, professionalBio: true, workPhoneExtension: true, officeLocation: true } });
  await prisma.personProfile.update({ where: { id: person.pmA }, data: { personalPhone: PRIVATE_PHONE } });
});

afterAll(async () => {
  await prisma.personProfile.update({ where: { id: person.pmA }, data: seeded });
  await prisma.auditEvent.deleteMany({ where: { actionKey: "PERSON_WORK_PROFILE_UPDATED", occurredAt: { gte: startedAt } } });
  if (tempHrMembership) await prisma.companyMember.delete({ where: { id: tempHrMembership } });
  await cleanupSessions();
});

describe("the directory (E-01 §35-§40, §180-§183)", () => {
  it("lists the group's people across its companies, and nobody from another group or still a candidate", async () => {
    const all = await directory(pm, { limit: 50 });
    expect(all.data.map((row) => row.personId)).toEqual(expect.arrayContaining([person.pmA, person.ceoB, person.ceoC]));
    const ids = all.data.map((row) => row.personId);
    expect(ids).not.toContain(person.tenantOwner);
    expect(ids).not.toContain(person.elira);
    expect(ids).not.toContain(person.adrian);
    expect(all.canIncludeInactive).toBe(false);

    const tenant = await directory(await loginAsEmail(DEMO_EMAIL.tenantOwner), { limit: 50 });
    expect(tenant.data.map((row) => row.personId)).not.toContain(person.pmA);
  });

  it("is paginated, searched by every word and filtered by company, department, project and title", async () => {
    const page = await directory(pm, { limit: 5 });
    expect(page.data).toHaveLength(5);
    expect(page.pagination.total).toBeGreaterThan(5);

    const found = await directory(pm, { q: "alex morgan" });
    expect(names(found.data)).toEqual(["Alex Morgan"]);

    const meridian = await directory(pm, { company: COMPANY.b, limit: 50 });
    expect(meridian.data.map((row) => row.personId)).toContain(person.ceoB);
    expect(meridian.data.map((row) => row.personId)).not.toContain(person.pmA);

    const finance = await directory(pm, { department: "finance", limit: 50 });
    expect(finance.data.length).toBeGreaterThan(0);
    // In a branch of Finance, or holding a Finance position: the Owner, who heads Executive, is not here.
    expect(finance.data.every((row) => row.department?.groupDepartmentKey === "finance")).toBe(true);
    expect(names(finance.data)).not.toContain("Olivia Owner");

    const riverside = await directory(pm, { project: "project_a", limit: 50 });
    expect(riverside.data.map((row) => row.personId)).toContain(person.pmA);
    expect(riverside.data.map((row) => row.personId)).not.toContain(person.ceoB);

    // Another group's company narrows to nobody rather than to its people.
    expect((await directory(pm, { company: COMPANY.tenant })).data).toEqual([]);
  });

  it("includes former and planned people only for those who keep person records", async () => {
    const withFormer = await directory(hr, { status: "all", limit: 100 });
    expect(withFormer.canIncludeInactive).toBe(true);
    expect(withFormer.data.map((row) => row.personId)).toContain(person.adrian);
    expect(withFormer.data.map((row) => row.personId)).not.toContain(person.elira);

    const asked = await directory(pm, { status: "all", limit: 100 });
    expect(asked.data.map((row) => row.personId)).not.toContain(person.adrian);
  });

  it("never carries a private field", async () => {
    const all = await directory(pm, { limit: 100 });
    expect(JSON.stringify(all)).not.toContain(PRIVATE_PHONE);
  });
});

describe("the work profile (E-01 §32-§33, §41-§46, §119)", () => {
  it("shows a colleague in another company of the group, with the employing company and the NESTO role apart from the title", async () => {
    const profile = await getWorkProfile(pm, person.ceoB);
    expect(profile.employingCompany?.id).toBe(COMPANY.b);
    expect(profile.role?.key).toBe("CEO");
    expect(profile.companies.map((row) => row.company.id)).toContain(COMPANY.b);
    expect(profile.capabilities).toMatchObject({ isSelf: false, canEditOwn: false, canManage: false, canViewEmployment: false, canViewPrivate: false });
    expect(JSON.stringify(profile)).not.toMatch(/personal|dateOfBirth|salary|baseAmount/i);
  });

  it("is not found across groups, for a candidate, or for a made-up id", async () => {
    await expect(getWorkProfile(pm, person.tenantOwner)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getWorkProfile(await loginAsEmail(DEMO_EMAIL.tenantOwner), person.pmA)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getWorkProfile(pm, person.elira)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getWorkProfile(pm, "person_nobody")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists projects from ProjectMember, linked only where the reader can open them (§44, §45)", async () => {
    const fromAurelia = await getWorkProfile(pm, person.architectA);
    const riverside = fromAurelia.projects.find((row) => row.name === "Riverside Residences");
    expect(riverside?.href).toBe("/projects/project_a");

    const fromMeridian = await getWorkProfile(await loginAsEmail(DEMO_EMAIL.pmB), person.architectA);
    const seenFromMeridian = fromMeridian.projects.find((row) => row.name === "Riverside Residences");
    expect(seenFromMeridian).toMatchObject({ href: null, projectId: null });
  });
});

describe("restricted views keep their owners' rules (ADR 0002 decision 4)", () => {
  it("shows the employment to HR and to the person, and to no colleague, Finance or Group IT (§98, §187, §188)", async () => {
    expect((await getEmploymentView(hr, person.pmA)).map((row) => row.company.id)).toContain(COMPANY.a);
    expect((await getEmploymentView(pm, person.pmA)).length).toBeGreaterThan(0);
    await expect(getEmploymentView(pm, person.ceoB)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getEmploymentView(await loginAs("FINANCE"), person.pmA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getEmploymentView(await loginAs("GROUP_IT"), person.pmA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getWorkProfile(hr, person.pmA)).capabilities.canViewEmployment).toBe(true);
  });

  it("shows private contact to the person and to HR, and to no colleague or Group IT (§34, §108)", async () => {
    expect((await getPrivateProfile(pm, person.pmA)).personalPhone).toBe(PRIVATE_PHONE);
    expect((await getPrivateProfile(hr, person.pmA)).personalPhone).toBe(PRIVATE_PHONE);
    await expect(getPrivateProfile(await loginAs("CEO"), person.pmA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getPrivateProfile(await loginAs("GROUP_IT"), person.pmA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getPrivateProfile(await loginAs("ARCHITECT"), person.pmA)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("limits a company's HR to the people of that company", async () => {
    const viewer = await prisma.user.findUniqueOrThrow({ where: { username: "viewer-a" }, select: { id: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "HR" }, select: { id: true } });
    const membership = await prisma.companyMember.create({ data: { companyId: COMPANY.c, userId: viewer.id, roleId: role.id, status: "ACTIVE", joinedAt: new Date() }, select: { id: true } });
    tempHrMembership = membership.id;
    const terraHr = await loginAsMembership(membership.id);

    expect((await getPrivateProfile(terraHr, person.ceoC)).personalPhone).toBeNull();
    await expect(getPrivateProfile(terraHr, person.pmA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateManagedWorkProfile(terraHr, person.pmA, managedWorkProfileSchema.parse({ jobTitle: "Should not stick" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("changing a work profile (E-01 §53-§54, §116, §142)", () => {
  it("lets a person change their own bio, extension and office, audited, and not a read-only role", async () => {
    const updated = await updateOwnWorkProfile(pm, ownWorkProfileSchema.parse({ professionalBio: "Runs Riverside's handover.", workPhoneExtension: "214", officeLocation: "Tirana HQ, 3rd floor" }));
    expect(updated).toMatchObject({ professionalBio: "Runs Riverside's handover.", workPhoneExtension: "214", officeLocation: "Tirana HQ, 3rd floor" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: person.pmA, actionKey: "PERSON_WORK_PROFILE_UPDATED" }, orderBy: { occurredAt: "desc" } });
    expect(audit.metadataJson).toMatchObject({ via: "SELF" });

    // An absent field is left alone.
    expect((await updateOwnWorkProfile(pm, ownWorkProfileSchema.parse({ workPhoneExtension: "215" }))).officeLocation).toBe("Tirana HQ, 3rd floor");

    await expect(updateOwnWorkProfile(await loginAs("VIEWER"), ownWorkProfileSchema.parse({ professionalBio: "Hello" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets HR correct a work profile, keeps one email per person in the group, and refuses everybody else", async () => {
    const original = await prisma.personProfile.findUniqueOrThrow({ where: { id: person.pmA }, select: { jobTitle: true, workEmail: true } });
    try {
      const updated = await updateManagedWorkProfile(hr, person.pmA, managedWorkProfileSchema.parse({ jobTitle: "Lead Project Manager" }));
      expect(updated.jobTitle).toBe("Lead Project Manager");
      const clash = await prisma.personProfile.findUniqueOrThrow({ where: { id: person.ceoB }, select: { workEmail: true } });
      await expect(updateManagedWorkProfile(hr, person.pmA, managedWorkProfileSchema.parse({ workEmail: clash.workEmail }))).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(updateManagedWorkProfile(pm, person.ceoB, managedWorkProfileSchema.parse({ jobTitle: "Nope" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.personProfile.update({ where: { id: person.pmA }, data: original });
    }
  });
});

describe("search (E-01 §144-§147)", () => {
  it("finds the group's people and not another group's", async () => {
    const result = await globalSearch(pm, "Morgan");
    expect(result.results.some((row) => row.moduleKey === "people" && row.entityId === person.pmA)).toBe(true);
    const tenant = await globalSearch(await loginAsEmail(DEMO_EMAIL.tenantOwner), "Morgan");
    expect(tenant.results.some((row) => row.moduleKey === "people")).toBe(false);
  });
});
