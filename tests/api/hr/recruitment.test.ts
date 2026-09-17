import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { candidateListQuerySchema, createCandidateSchema, hireCandidateSchema } from "@/lib/modules/hr/recruitment/candidate.schema";
import * as recruitment from "@/lib/modules/hr/recruitment/candidate.service";
import { RECRUITMENT_SEED, seedRecruitmentRecords } from "../../../prisma/seed/recruitment";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, prisma } from "../../helpers";

/**
 * Recruitment against the real database (E-06 §22-§25, §83, §91, §147).
 *
 * A candidate is a person with no login; selecting keeps the same person;
 * hiring records a planned employment in the target company without a
 * membership. Group HR recruits across the group, HR in one company into that
 * company, and nobody outside HR's grants reaches a candidate at all. Every
 * person a test creates is removed after it; the seeded lifecycle is written
 * back as the seed leaves it.
 */

const PREFIX = "T06R";
const listAll = candidateListQuerySchema.parse({});
const LOCAL_HR = { user: "user_t06r_hr_b", member: "member_t06r_hr_b" };

let groupHr: UserContext;
let owner: UserContext;

async function financeBranch(companyId: string): Promise<string> {
  return (await prisma.department.findFirstOrThrow({ where: { companyId, key: "finance" }, select: { id: true } })).id;
}

async function removeCreated(): Promise<void> {
  const people = await prisma.personProfile.findMany({ where: { lastName: { startsWith: PREFIX } }, select: { id: true } });
  const personIds = people.map((row) => row.id);
  if (personIds.length === 0) return;
  const candidates = await prisma.candidateProfile.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } });
  const employments = await prisma.employeeProfile.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } });
  const ids = [...personIds, ...candidates.map((row) => row.id), ...employments.map((row) => row.id)];
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.userProvisioningRequest.deleteMany({ where: { personProfileId: { in: personIds } } });
  await prisma.candidateProfile.deleteMany({ where: { personProfileId: { in: personIds } } });
  await prisma.employeeProfile.deleteMany({ where: { personProfileId: { in: personIds } } });
  await prisma.personProfile.deleteMany({ where: { id: { in: personIds } } });
}

function candidateInput(overrides: Record<string, unknown> = {}) {
  return createCandidateSchema.parse({
    firstName: "Dea",
    lastName: `${PREFIX} Leka`,
    workEmail: `dea.leka.${Date.now()}@nesto.test`,
    targetCompanyId: COMPANY.c,
    targetRoleKey: "FINANCE",
    targetJobTitle: "Accountant",
    interviewStage: "First interview",
    ...overrides,
  });
}

beforeAll(async () => {
  groupHr = await loginAs("HR");
  owner = await loginAs("OWNER");

  // HR who works in Meridian only: no group position, so company reach.
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "HR" }, select: { id: true } });
  await prisma.user.upsert({
    where: { id: LOCAL_HR.user },
    update: {},
    create: { id: LOCAL_HR.user, username: "t06r-hr-b", firstName: "Local", lastName: "Recruiter", passwordHash: "not-a-hash", status: "ACTIVE" },
  });
  await prisma.companyMember.upsert({
    where: { id: LOCAL_HR.member },
    update: {},
    create: { id: LOCAL_HR.member, companyId: COMPANY.b, userId: LOCAL_HR.user, roleId: role.id, status: "ACTIVE" },
  });
});

afterEach(async () => {
  await removeCreated();
});

afterAll(async () => {
  await removeCreated();
  await seedRecruitmentRecords(prisma);
  await cleanupSessions();
  await prisma.session.deleteMany({ where: { userId: LOCAL_HR.user } });
  await prisma.companyMember.deleteMany({ where: { id: LOCAL_HR.member } });
  await prisma.user.deleteMany({ where: { id: LOCAL_HR.user } });
});

describe("a candidate before any login (§22, §23, §147)", () => {
  it("creates the person and the candidacy, with no user, and audits both", async () => {
    const users = await prisma.user.count();
    const candidate = await recruitment.createCandidate(groupHr, candidateInput());

    expect(candidate.status).toBe("INTERVIEWING");
    expect(candidate.targetCompany?.id).toBe(COMPANY.c);
    expect(candidate.person.lifecycleStatus).toBe("CANDIDATE");
    expect(candidate.person.hasAccount).toBe(false);
    expect(await prisma.user.count()).toBe(users);

    const person = await prisma.personProfile.findUniqueOrThrow({ where: { id: candidate.personId } });
    expect(person.parentGroupId).toBe(groupHr.parentGroupId);
    const actions = (await prisma.auditEvent.findMany({ where: { entityId: { in: [candidate.id, candidate.personId] } }, select: { actionKey: true } })).map((row) => row.actionKey);
    expect(actions.sort()).toEqual(["HR_CANDIDATE_CREATED", "HR_PERSON_PROFILE_CREATED"]);
  });

  it("is edited while no user exists", async () => {
    const candidate = await recruitment.createCandidate(groupHr, candidateInput());
    const updated = await recruitment.updateCandidate(groupHr, candidate.id, { ...candidateInput({ workEmail: candidate.person.workEmail }), interviewStage: "Second interview", city: "Vlorë" });
    expect(updated.interviewStage).toBe("Second interview");
    expect(updated.person.city).toBe("Vlorë");
    expect(updated.person.hasAccount).toBe(false);
  });

  it("refuses a second person with an address already in the group (§83)", async () => {
    await expect(recruitment.createCandidate(groupHr, candidateInput({ workEmail: "finance-c@nesto.test" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a department of another company and a manager who does not work there", async () => {
    const meridianFinance = await financeBranch(COMPANY.b);
    await expect(recruitment.createCandidate(groupHr, candidateInput({ targetDepartmentId: meridianFinance }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(recruitment.createCandidate(groupHr, candidateInput({ hiringManagerUserId: "user_pm" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("selecting and hiring keep the same person (§24, §25)", () => {
  it("selects, then hires into a planned employment with no membership", async () => {
    const created = await recruitment.createCandidate(groupHr, candidateInput({ targetDepartmentId: await financeBranch(COMPANY.c), hiringManagerUserId: "user_finance" }));

    const selected = await recruitment.selectCandidate(groupHr, created.id);
    expect(selected.status).toBe("SELECTED");
    expect(selected.person.id).toBe(created.person.id);
    expect(selected.person.lifecycleStatus).toBe("SELECTED");

    const hired = await recruitment.hireCandidate(groupHr, created.id, hireCandidateSchema.parse({ employeeNumber: `${PREFIX}-1` }));
    expect(hired.status).toBe("HIRED");
    expect(hired.person.id).toBe(created.person.id);
    expect(hired.person.lifecycleStatus).toBe("EMPLOYEE");
    expect(hired.employment).toMatchObject({ status: "PLANNED", hasLogin: false });
    expect(hired.actions.canRequestAccess).toBe(true);

    const employment = await prisma.employeeProfile.findFirstOrThrow({ where: { personProfileId: created.person.id } });
    expect(employment).toMatchObject({ companyId: COMPANY.c, companyMemberId: null, managerMemberId: "member_finance__c" });
    expect(await prisma.personProfile.count({ where: { lastName: created.person.lastName } })).toBe(1);

    await expect(recruitment.hireCandidate(groupHr, created.id, hireCandidateSchema.parse({}))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("will not hire before the company, department, role and job title are confirmed", async () => {
    const created = await recruitment.createCandidate(groupHr, candidateInput());
    await recruitment.selectCandidate(groupHr, created.id);
    await expect(recruitment.hireCandidate(groupHr, created.id, hireCandidateSchema.parse({}))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("hires the seeded selected candidate into the employment already planned for him", async () => {
    const before = await prisma.employeeProfile.count({ where: { personProfileId: RECRUITMENT_SEED.selected.person } });
    const hired = await recruitment.hireCandidate(groupHr, RECRUITMENT_SEED.selected.candidate, hireCandidateSchema.parse({}));
    expect(hired.employment?.id).toBe(RECRUITMENT_SEED.selected.employment);
    expect(await prisma.employeeProfile.count({ where: { personProfileId: RECRUITMENT_SEED.selected.person } })).toBe(before);
    await seedRecruitmentRecords(prisma);
  });

  it("closes a candidacy as rejected, and a decided candidate cannot be edited", async () => {
    const created = await recruitment.createCandidate(groupHr, candidateInput());
    const rejected = await recruitment.rejectCandidate(groupHr, created.id);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.actions).toMatchObject({ canEdit: false, canSelect: false, canHire: false });
    await expect(recruitment.updateCandidate(groupHr, created.id, candidateInput())).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("who recruits where (§76, §112)", () => {
  it("lets the Head of Group HR see every company's candidates", async () => {
    const list = await recruitment.listCandidates(groupHr, listAll);
    const ids = list.data.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([RECRUITMENT_SEED.interviewing.candidate, RECRUITMENT_SEED.selected.candidate]));
  });

  it("keeps HR in one company to that company's candidates", async () => {
    const localHr = await loginAsMembership(LOCAL_HR.member);
    const list = await recruitment.listCandidates(localHr, listAll);
    expect(list.data.map((row) => row.id)).toContain(RECRUITMENT_SEED.interviewing.candidate);
    expect(list.data.every((row) => row.targetCompany?.id === COMPANY.b)).toBe(true);
    await expect(recruitment.getCandidate(localHr, RECRUITMENT_SEED.selected.candidate)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recruitment.createCandidate(localHr, candidateInput({ targetCompanyId: COMPANY.c }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("shows the Owner candidates without HR's private notes or its decisions", async () => {
    const candidate = await recruitment.getCandidate(owner, RECRUITMENT_SEED.interviewing.candidate);
    expect(candidate.notes).toBeNull();
    expect(candidate.actions).toMatchObject({ canEdit: false, canSelect: false });
    await expect(recruitment.selectCandidate(owner, RECRUITMENT_SEED.interviewing.candidate)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("gives an Architect, Group IT and another group nothing", async () => {
    await expect(recruitment.listCandidates(await loginAs("ARCHITECT"), listAll)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recruitment.createCandidate(await loginAs("GROUP_IT"), candidateInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    await expect(recruitment.getCandidate(tenant, RECRUITMENT_SEED.interviewing.candidate)).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
  });
});
