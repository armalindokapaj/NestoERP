import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { ALL_COMPANIES, directoryQuerySchema } from "@/lib/modules/people/people.schema";
import { directoryFilterOptions, getAccessSummary, getDocumentsTab, getQualificationsTab, getWorkProfile, listPeople } from "@/lib/modules/people/people.service";
import { readPhoto, removePhoto, setPhoto } from "@/lib/modules/people/person.photo";
import { assignableProjects, assignPersonToProject, removableProjectIds, unassignPersonFromProject } from "@/lib/modules/people/person.projects";
import { personIdFor } from "@/lib/modules/people/person.refs";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * E-08's foundation (ADR 0008): the person behind a record's reference, a
 * former employee who stays linkable without being listed, and the profile
 * photo — the person's own, across the group.
 */

const GROUP = "group_demo_nesto";
const FORMER = { person: "test_e08_person_former", employment: "test_e08_employment_former" };
const PAVILION = { id: "test_e08_project_pavilion", code: "T-E08-PAV", name: "E-08 Pavilion" };
// A 1×1 PNG: an image by its bytes, not by its name.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const startedAt = new Date();

let pm: UserContext;
let hr: UserContext;
let architect: UserContext;
let pmPerson: string;

beforeAll(async () => {
  pm = await loginAs("PROJECT_MANAGER");
  hr = await loginAs("HR");
  architect = await loginAs("ARCHITECT");
  pmPerson = (await prisma.user.findUniqueOrThrow({ where: { id: pm.userId }, select: { personProfileId: true } })).personProfileId!;
  // Somebody who worked in Aurelia and left, without a login.
  await prisma.personProfile.create({ data: { id: FORMER.person, parentGroupId: GROUP, firstName: "Doruntina", lastName: "Former", jobTitle: "Site engineer", workEmail: "doruntina.former@nesto.test", lifecycleStatus: "FORMER_EMPLOYEE" } });
  await prisma.employeeProfile.create({ data: { id: FORMER.employment, companyId: COMPANY.a, personProfileId: FORMER.person, employmentStatus: "ENDED", jobTitle: "Site engineer", startDate: new Date("2023-01-09T12:00:00Z"), endDate: new Date("2025-06-30T12:00:00Z") } });
  // A project in Aurelia nobody is on yet.
  await prisma.project.create({ data: { id: PAVILION.id, companyId: COMPANY.a, code: PAVILION.code, name: PAVILION.name, status: "ACTIVE", createdBy: "test" } });
});

afterAll(async () => {
  await removePhoto(pm, "me").catch(() => undefined);
  await prisma.employeeProfile.deleteMany({ where: { id: FORMER.employment } });
  await prisma.personProfile.deleteMany({ where: { id: FORMER.person } });
  await prisma.auditEvent.deleteMany({ where: { actionKey: "PERSON_PROFILE_PHOTO_UPDATED", occurredAt: { gte: startedAt } } });
  await prisma.auditEvent.deleteMany({ where: { projectId: PAVILION.id } });
  await prisma.activity.deleteMany({ where: { entityType: "Project", entityId: PAVILION.id } });
  await prisma.projectMember.deleteMany({ where: { projectId: PAVILION.id } });
  await prisma.project.deleteMany({ where: { id: PAVILION.id } });
  await cleanupSessions();
});

describe("a former employee (E-08 §54, §55, §118)", () => {
  it("opens for a colleague as who they were, with nothing that reached them at work", async () => {
    const profile = await getWorkProfile(pm, FORMER.person);
    expect(profile).toMatchObject({ former: true, status: "INACTIVE", name: "Doruntina Former", jobTitle: "Site engineer", employingCompany: { id: COMPANY.a } });
    expect(profile).toMatchObject({ workEmail: null, workPhone: null, photoUrl: null, projects: [], activity: [], companies: [], departments: [] });
    await expect(getQualificationsTab(pm, FORMER.person)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDocumentsTab(pm, FORMER.person)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is whole for those who keep person records, and listed only for them", async () => {
    expect(await getWorkProfile(hr, FORMER.person)).toMatchObject({ former: false, workEmail: "doruntina.former@nesto.test" });
    const colleague = await listPeople(pm, directoryQuerySchema.parse({ q: "Doruntina", status: "all" }));
    expect(colleague.data).toEqual([]);
    const keeper = await listPeople(hr, directoryQuerySchema.parse({ q: "Doruntina", status: "all" }));
    expect(keeper.data.map((row) => row.personId)).toEqual([FORMER.person]);
  });

  it("stays hidden from another group, and a selected candidate stays hidden from colleagues (§119)", async () => {
    await expect(getWorkProfile(await loginAsEmail(DEMO_EMAIL.tenantOwner), FORMER.person)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getWorkProfile(pm, "person_adrian_kola")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the person behind a reference (E-08 §69)", () => {
  it("resolves a membership, a login and an employment inside the reader's group, and nothing outside it", async () => {
    expect(await personIdFor(architect, "member", pm.membershipId)).toBe(pmPerson);
    expect(await personIdFor(architect, "user", pm.userId)).toBe(pmPerson);
    expect(await personIdFor(architect, "employee", FORMER.employment)).toBe(FORMER.person);
    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    expect(await personIdFor(architect, "member", tenant.membershipId)).toBeNull();
    expect(await personIdFor(architect, "user", tenant.userId)).toBeNull();
    expect(await personIdFor(tenant, "member", pm.membershipId)).toBeNull();
    expect(await personIdFor(architect, "member", "member_nobody")).toBeNull();
  });
});

describe("the profile photo (E-08 §43, §93)", () => {
  it("is set by the person, read by colleagues across the group, and a new photo is a new URL", async () => {
    const profile = await setPhoto(pm, "me", PNG);
    expect(profile.photoUrl).toMatch(new RegExp(`^/api/people/${pmPerson}/photo\\?v=[0-9a-f]{16}$`));
    const read = await readPhoto(await loginAsEmail(DEMO_EMAIL.ceoB), pmPerson);
    expect(read.contentType).toBe("image/png");
    expect(Buffer.from(read.body).equals(Buffer.from(PNG))).toBe(true);
    expect((await getWorkProfile(architect, pmPerson)).photoUrl).toBe(profile.photoUrl);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { actionKey: "PERSON_PROFILE_PHOTO_UPDATED", entityId: pmPerson, occurredAt: { gte: startedAt } } });
    expect(audit.actorUserId).toBe(pm.userId);
  });

  it("takes only a small image, by its bytes", async () => {
    await expect(setPhoto(pm, "me", Uint8Array.from(Buffer.from("%PDF-1.7 not a photo")))).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "PHOTO_TYPE" } });
    await expect(setPhoto(pm, "me", new Uint8Array(0))).rejects.toMatchObject({ details: { code: "PHOTO_EMPTY" } });
    const large = new Uint8Array(2 * 1024 * 1024 + 1);
    large.set(PNG);
    await expect(setPhoto(pm, "me", large)).rejects.toMatchObject({ details: { code: "PHOTO_TOO_LARGE" } });
  });

  it("is changed for somebody else only by those who keep person records within reach", async () => {
    await expect(setPhoto(architect, pmPerson, PNG)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const managed = await setPhoto(hr, pmPerson, PNG);
    expect(managed.photoUrl).not.toBeNull();
    await expect(setPhoto(await loginAsEmail(DEMO_EMAIL.tenantOwner), pmPerson, PNG)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is not another group's to read, nor a colleague's once they have left", async () => {
    await expect(readPhoto(await loginAsEmail(DEMO_EMAIL.tenantOwner), pmPerson)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.personProfile.update({ where: { id: FORMER.person }, data: { photoStorageKey: `people/${GROUP}/${FORMER.person}/x.png`, photoContentType: "image/png", photoChecksum: "0".repeat(64) } });
    await expect(readPhoto(pm, FORMER.person)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is removed, and the profile shows initials again", async () => {
    expect((await removePhoto(pm, "me")).photoUrl).toBeNull();
    await expect(readPhoto(architect, pmPerson)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the Access section (E-08 §29, §53, §66, §97)", () => {
  it("is the access administrators' — the Owner and Group IT — and nobody else's", async () => {
    const it = await loginAs("GROUP_IT");
    const access = await getAccessSummary(it, pmPerson);
    expect(access.account).toMatchObject({ username: "pm-a", status: "ACTIVE" });
    expect(access.memberships.map((row) => row.company.id)).toContain(COMPANY.a);
    expect(access.completeness.account).toBe(true);
    expect((await getWorkProfile(it, pmPerson)).capabilities.canViewAccess).toBe(true);
    for (const reader of [pm, hr, architect]) {
      await expect(getAccessSummary(reader, pmPerson)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await getWorkProfile(reader, pmPerson)).capabilities.canViewAccess).toBe(false);
    }
  });

  it("opens a selected candidate's profile for Group IT, with the request her account is created from (§46, §117)", async () => {
    const it = await loginAs("GROUP_IT");
    expect((await getWorkProfile(it, "person_adrian_kola")).former).toBe(false);
    expect(await getAccessSummary(it, "person_adrian_kola")).toMatchObject({ account: null, provisioning: { status: "APPROVED", href: "/organization/provisioning/provisioning_adrian_kola" } });
    // Opened, not listed: the directory is still the working people's.
    expect((await listPeople(it, directoryQuerySchema.parse({ q: "Adrian", status: "all" }))).data).toEqual([]);
  });

  it("says when somebody has no account, and shows last sign-in only with the security grant", async () => {
    const owner = await loginAs("OWNER");
    expect((await getAccessSummary(owner, FORMER.person)).account).toBeNull();
    const it = await loginAs("GROUP_IT");
    expect((await getAccessSummary(it, pmPerson)).showsLastLogin).toBe(true);
  });
});

describe("direct reports and the directory's views (E-08 §11, §21, §41)", () => {
  it("shows who reports to somebody, and the directory filters by that manager", async () => {
    const ceo = (await prisma.user.findUniqueOrThrow({ where: { username: "ceo-a" }, select: { personProfileId: true } })).personProfileId!;
    const profile = await getWorkProfile(architect, ceo);
    expect(profile.directReports.length).toBeGreaterThan(0);
    const listed = await listPeople(architect, directoryQuerySchema.parse({ manager: ceo, limit: 50 }));
    expect(listed.data.map((row) => row.personId).sort()).toEqual(profile.directReports.map((row) => row.personId).sort());
  });

  it("narrows by NESTO role, and shows the reader's own company or project colleagues", async () => {
    const options = await directoryFilterOptions(pm);
    expect(options.roles.map((role) => role.key)).toContain("ARCHITECT");
    const architects = await listPeople(pm, directoryQuerySchema.parse({ role: "ARCHITECT", limit: 50 }));
    expect(architects.data.length).toBeGreaterThan(0);
    expect(architects.data.every((row) => row.personId !== pmPerson)).toBe(true);

    const company = await listPeople(pm, directoryQuerySchema.parse({ view: "company", limit: 100 }));
    // A company workspace opens on its own company, so "everyone" is the group
    // only once the filter widens (Workspace Context §85, §86).
    const everyone = await listPeople(pm, directoryQuerySchema.parse({ company: ALL_COMPANIES, limit: 100 }));
    expect(company.pagination.total).toBeLessThan(everyone.pagination.total);
    expect(company.data.map((row) => row.personId)).toContain(pmPerson);

    const projects = await listPeople(pm, directoryQuerySchema.parse({ view: "projects", limit: 100 }));
    expect(projects.data.map((row) => row.personId)).toContain(pmPerson);
    expect(projects.pagination.total).toBeLessThanOrEqual(everyone.pagination.total);
  });
});

describe("putting somebody on a project from their profile (E-08 §49, §50, §64)", () => {
  it("the head of Group Architecture puts an architect on a project of her company, through the project's own door, and takes her off", async () => {
    const head = await loginAsEmail(DEMO_EMAIL.architectureHead);
    const options = (await assignableProjects(head, "person_architect")).map((row) => row.projectId);
    expect(options).toContain(PAVILION.id);
    // Already on it: not offered again.
    expect(options).not.toContain("project_a");

    await assignPersonToProject(head, "person_architect", { projectId: PAVILION.id, projectRole: "Facade architect" });
    const profile = await getWorkProfile(head, "person_architect");
    expect(profile.projects.find((row) => row.code === PAVILION.code)).toMatchObject({ projectRole: "Facade architect", status: "ACTIVE" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { actionKey: "PROJECT_MEMBER_ASSIGNED", projectId: PAVILION.id } });
    expect(audit).toMatchObject({ companyId: COMPANY.a, actorUserId: head.userId, afterJson: { via: "DEPARTMENT", projectRole: "Facade architect" } });

    expect(await removableProjectIds(head, "person_architect")).toContain(PAVILION.id);
    await unassignPersonFromProject(head, "person_architect", PAVILION.id);
    expect(await removableProjectIds(head, "person_architect")).not.toContain(PAVILION.id);
    expect(await prisma.auditEvent.count({ where: { actionKey: "PROJECT_MEMBER_REMOVED", projectId: PAVILION.id } })).toBe(1);
  });

  it("offers nothing outside the manager's function, to a reader with neither door, or for a former employee", async () => {
    const head = await loginAsEmail(DEMO_EMAIL.architectureHead);
    expect(await assignableProjects(head, pmPerson)).toEqual([]);
    await expect(assignPersonToProject(head, pmPerson, { projectId: PAVILION.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await assignableProjects(architect, pmPerson)).toEqual([]);
    expect(await removableProjectIds(architect, pmPerson)).toEqual([]);
    expect(await assignableProjects(hr, FORMER.person)).toEqual([]);
    // No login in the project's company: nothing to put on its team.
    await expect(assignPersonToProject(hr, FORMER.person, { projectId: PAVILION.id })).rejects.toMatchObject({ details: { code: "NO_MEMBERSHIP" } });
  });
});
