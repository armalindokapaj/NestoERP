import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { authenticateCredentials } from "@/lib/auth/credentials";
import type { UserContext } from "@/lib/context/types";
import { createCandidateSchema, hireCandidateSchema } from "@/lib/modules/hr/recruitment/candidate.schema";
import * as recruitment from "@/lib/modules/hr/recruitment/candidate.service";
import { createProvisioningRequestSchema, provisioningListQuerySchema } from "@/lib/modules/organization/provisioning/provisioning.schema";
import * as provisioning from "@/lib/modules/organization/provisioning/provisioning.service";
import { RECRUITMENT_SEED, seedRecruitmentRecords } from "../../../prisma/seed/recruitment";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * Account provisioning against the real database (E-06 §27-§29, §93, §119, §140, §148).
 *
 * HR asks, the Head of Group HR or the Owner approves — never the person who
 * asked — and Group IT creates the account from the HR truth, in one
 * transaction, attributed to the company the person joins. HR never creates a
 * credential. A person who already has a login gains a membership, not a second
 * identity. Every account a test creates is removed, and the seeded lifecycle is
 * written back as the seed leaves it.
 */

const PREFIX = "T06P";
const listAll = provisioningListQuerySchema.parse({});
const createdUsers: string[] = [];
const createdEmployments: string[] = [];

let groupHr: UserContext;
let groupIt: UserContext;
let owner: UserContext;

async function branch(companyId: string, key: string): Promise<string> {
  return (await prisma.department.findFirstOrThrow({ where: { companyId, key }, select: { id: true } })).id;
}

const startedAt = new Date();

async function removeCreated(): Promise<void> {
  const people = await prisma.personProfile.findMany({ where: { lastName: { startsWith: PREFIX } }, select: { id: true } });
  const personIds = people.map((row) => row.id);
  const users = await prisma.user.findMany({
    where: { OR: [{ id: { in: createdUsers.filter((id) => id !== "user_finance_c") } }, { personProfileId: { in: personIds } }, { username: { startsWith: "adrian.kola" } }] },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);
  // Memberships and positions provisioning made: the new accounts', and Ermira's second company.
  const madeHere = { OR: [{ userId: { in: userIds } }, { userId: "user_finance_c", companyId: COMPANY.d }] };

  // The seeded rows first: they point at what the tests created.
  await seedRecruitmentRecords(prisma);
  const requests = await prisma.userProvisioningRequest.findMany({ where: { OR: [{ personProfileId: { in: personIds } }, { employeeProfileId: { in: createdEmployments } }] }, select: { id: true } });
  const assignments = await prisma.departmentAssignment.findMany({ where: madeHere, select: { id: true } });
  const members = await prisma.companyMember.findMany({ where: madeHere, select: { id: true } });
  const trail = [...requests.map((row) => row.id), RECRUITMENT_SEED.selected.request, ...assignments.map((row) => row.id), ...personIds];
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: trail }, createdAt: { gte: startedAt } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: trail }, createdAt: { gte: startedAt } } });
  await prisma.userProvisioningRequest.deleteMany({ where: { id: { in: requests.map((row) => row.id) } } });

  await prisma.employeeProfile.updateMany({ where: { companyMemberId: { in: members.map((row) => row.id) } }, data: { companyMemberId: null } });
  await prisma.departmentAssignment.deleteMany({ where: { id: { in: assignments.map((row) => row.id) } } });
  await prisma.session.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { membershipId: { in: members.map((row) => row.id) } }] } });
  await prisma.companyMember.deleteMany({ where: { id: { in: members.map((row) => row.id) } } });

  const candidates = await prisma.candidateProfile.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: candidates.map((row) => row.id) } } });
  await prisma.candidateProfile.deleteMany({ where: { personProfileId: { in: personIds } } });
  await prisma.employeeProfile.deleteMany({ where: { OR: [{ personProfileId: { in: personIds } }, { id: { in: createdEmployments } }] } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.personProfile.deleteMany({ where: { id: { in: personIds } } });
  createdUsers.length = 0;
  createdEmployments.length = 0;
}



beforeAll(async () => {
  groupHr = await loginAs("HR");
  groupIt = await loginAs("GROUP_IT");
  owner = await loginAs("OWNER");
});

afterEach(async () => {
  await removeCreated();
});

afterAll(async () => {
  await removeCreated();
  await cleanupSessions();
});

/** A candidate hired into Forma's Finance branch, ready for an account request. */
async function hiredIntoForma(): Promise<{ candidateId: string; employeeProfileId: string; personId: string }> {
  const candidate = await recruitment.createCandidate(
    groupHr,
    createCandidateSchema.parse({
      firstName: "Besa",
      lastName: `${PREFIX} Dervishi`,
      workEmail: `besa.dervishi.${Date.now()}@nesto.test`,
      workPhone: "+355 69 555 0101",
      targetCompanyId: COMPANY.d,
      targetDepartmentId: await branch(COMPANY.d, "finance"),
      targetRoleKey: "FINANCE",
      targetJobTitle: "Accountant",
      hiringManagerUserId: "user_finance_manager_d",
    }),
  );
  await recruitment.selectCandidate(groupHr, candidate.id);
  const hired = await recruitment.hireCandidate(groupHr, candidate.id, hireCandidateSchema.parse({}));
  return { candidateId: candidate.id, employeeProfileId: hired.employment!.id, personId: candidate.personId };
}

describe("HR → approval → Group IT (§28, §93)", () => {
  it("creates the account from the HR truth, once, in the company the person joins", async () => {
    const hire = await hiredIntoForma();
    const people = await prisma.personProfile.count();

    const requested = await provisioning.createProvisioningRequest(groupHr, createProvisioningRequestSchema.parse({ employeeProfileId: hire.employeeProfileId, submit: true }));
    expect(requested).toMatchObject({ status: "SUBMITTED", company: { id: COMPANY.d }, role: { key: "FINANCE" }, jobTitle: "Accountant" });
    expect(requested.hrTruth.manager?.userId).toBe("user_finance_manager_d");

    // Separation of duties: not the requester, and not IT (§119).
    await expect(provisioning.approveProvisioningRequest(groupHr, requested.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(provisioning.approveProvisioningRequest(groupIt, requested.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const approved = await provisioning.approveProvisioningRequest(owner, requested.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy?.userId).toBe(owner.userId);

    // HR cannot issue credentials (§140).
    await expect(provisioning.provisionAccount(groupHr, requested.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });

    const result = await provisioning.provisionAccount(groupIt, requested.id, {});
    createdUsers.push(result.userId);
    expect(result.newAccount).toBe(true);
    expect(result.username).toMatch(/^besa\.t06p/);
    expect(result.temporaryPassword).toBe("nesto1234");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user).toMatchObject({ personProfileId: hire.personId, mustChangePassword: true, firstName: "Besa", phone: "+355 69 555 0101", status: "ACTIVE" });
    expect(user.temporaryPasswordExpiresAt).toBeNull();
    // The same person, not a copy (§148).
    expect(await prisma.personProfile.count()).toBe(people);

    const member = await prisma.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId: COMPANY.d, userId: result.userId } }, include: { role: true } });
    expect(member).toMatchObject({ status: "ACTIVE", departmentId: await branch(COMPANY.d, "finance"), jobTitle: "Accountant" });
    expect(member.role.key).toBe("FINANCE");
    const assignment = await prisma.departmentAssignment.findFirstOrThrow({ where: { userId: result.userId } });
    expect(assignment).toMatchObject({ companyId: COMPANY.d, positionLevel: "MEMBER", functionalRoleKey: "FINANCE", status: "ACTIVE" });
    const employment = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: hire.employeeProfileId } });
    expect(employment.companyMemberId).toBe(member.id);

    const done = await provisioning.getProvisioningRequest(groupIt, requested.id);
    expect(done).toMatchObject({ status: "PROVISIONED", provisionedUser: { id: result.userId }, provisionedBy: { userId: groupIt.userId } });
    expect(done.actions).toMatchObject({ canProvision: false, canReturn: false, canCancel: false });

    // Attributed to Forma, with every party named (§115, §161).
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: requested.id, actionKey: "ORGANIZATION_USER_PROVISIONED" } });
    expect(audit.companyId).toBe(COMPANY.d);
    expect(audit.afterJson).toMatchObject({ requestedByUserId: groupHr.userId, approvedByUserId: owner.userId, provisionedByUserId: groupIt.userId, personProfileId: hire.personId, userId: result.userId, functionalRoleKey: "FINANCE", managerUserId: "user_finance_manager_d" });

    // The temporary password signs in, and the account is held to changing it (§125).
    const signedIn = await authenticateCredentials({ username: result.username, password: result.temporaryPassword }, new Headers());
    expect(signedIn?.mustChangePassword).toBe(true);

    await expect(provisioning.provisionAccount(groupIt, requested.id, {})).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("provisions the seeded approved request without anyone retyping it (§57)", async () => {
    const result = await provisioning.provisionAccount(groupIt, RECRUITMENT_SEED.selected.request, {});
    createdUsers.push(result.userId);
    expect(result.username).toBe("adrian.kola");
    const candidate = await prisma.candidateProfile.findUniqueOrThrow({ where: { id: RECRUITMENT_SEED.selected.candidate } });
    expect(candidate.status).toBe("HIRED");
    const person = await prisma.personProfile.findUniqueOrThrow({ where: { id: RECRUITMENT_SEED.selected.person } });
    expect(person.lifecycleStatus).toBe("EMPLOYEE");
    const employment = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: RECRUITMENT_SEED.selected.employment }, include: { companyMember: true } });
    expect(employment.companyMember?.userId).toBe(result.userId);
  });

  it("writes nothing when the account cannot be created", async () => {
    const users = await prisma.user.count();
    await expect(provisioning.provisionAccount(groupIt, RECRUITMENT_SEED.selected.request, { username: "finance-c" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.companyMember.count({ where: { companyId: COMPANY.c, user: { personProfileId: RECRUITMENT_SEED.selected.person } } })).toBe(0);
    expect((await prisma.userProvisioningRequest.findUniqueOrThrow({ where: { id: RECRUITMENT_SEED.selected.request } })).status).toBe("APPROVED");
  });
});

describe("returning, rejecting and cancelling (§29, §64)", () => {
  it("goes back to HR with a reason, loses its approval, and comes back for a new one", async () => {
    await expect(provisioning.returnProvisioningRequest(groupIt, RECRUITMENT_SEED.selected.request, "   ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const returned = await provisioning.returnProvisioningRequest(groupIt, RECRUITMENT_SEED.selected.request, "The work phone is missing a digit.");
    expect(returned).toMatchObject({ status: "DRAFT", returnReason: "The work phone is missing a digit.", approvedBy: null });
    await expect(provisioning.provisionAccount(groupIt, RECRUITMENT_SEED.selected.request, {})).rejects.toMatchObject({ code: "CONFLICT" });

    const resubmitted = await provisioning.submitProvisioningRequest(groupHr, RECRUITMENT_SEED.selected.request);
    expect(resubmitted.status).toBe("SUBMITTED");
    const rejected = await provisioning.rejectProvisioningRequest(owner, RECRUITMENT_SEED.selected.request, "The start date moved to next quarter.");
    expect(rejected).toMatchObject({ status: "REJECTED", rejectionReason: "The start date moved to next quarter." });
  });

  it("lets IT cancel, and refuses a second open request for the same person", async () => {
    await expect(
      provisioning.createProvisioningRequest(groupHr, createProvisioningRequestSchema.parse({ employeeProfileId: RECRUITMENT_SEED.selected.employment })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const cancelled = await provisioning.cancelProvisioningRequest(groupIt, RECRUITMENT_SEED.selected.request);
    expect(cancelled.status).toBe("CANCELLED");
  });
});

describe("one person, one login (§83)", () => {
  it("adds a company to a person who already has a login, with no new credentials", async () => {
    const employment = await prisma.employeeProfile.create({
      data: { companyId: COMPANY.d, personProfileId: "person_finance_c", employmentStatus: "PLANNED", employmentType: "PART_TIME" },
      select: { id: true },
    });
    createdEmployments.push(employment.id);
    const users = await prisma.user.count();

    const request = await provisioning.createProvisioningRequest(
      groupHr,
      createProvisioningRequestSchema.parse({ employeeProfileId: employment.id, companyDepartmentId: await branch(COMPANY.d, "finance"), functionalRoleKey: "FINANCE", jobTitle: "Accountant", submit: true }),
    );
    expect(request.existingAccount?.username).toBe("finance-c");
    await provisioning.approveProvisioningRequest(owner, request.id);
    const result = await provisioning.provisionAccount(groupIt, request.id, {});

    expect(result).toMatchObject({ userId: "user_finance_c", newAccount: false, temporaryPassword: null });
    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.companyMember.count({ where: { userId: "user_finance_c", companyId: COMPANY.d, status: "ACTIVE" } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: "user_finance_c" } })).mustChangePassword).toBe(false);
  });
});

describe("who sees which requests (§113, §117)", () => {
  it("shows Group IT and the Owner every company's requests", async () => {
    for (const reader of [groupIt, owner]) {
      const ids = (await provisioning.listProvisioningRequests(reader, listAll)).data.map((row) => row.id);
      expect(ids).toEqual(expect.arrayContaining([RECRUITMENT_SEED.selected.request, RECRUITMENT_SEED.provisioned.request]));
    }
  });

  it("gives roles without account work, and another group, nothing", async () => {
    await expect(provisioning.listProvisioningRequests(await loginAs("ARCHITECT"), listAll)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(provisioning.provisionAccount(await loginAs("FINANCE"), RECRUITMENT_SEED.selected.request, {})).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    await expect(provisioning.getProvisioningRequest(tenant, RECRUITMENT_SEED.selected.request)).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
  });
});
