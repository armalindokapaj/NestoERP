/**
 * Accounts, logins, positions and employments for ARMAAR's people (D-01 §11-§14,
 * §41, §64, §65, §86).
 *
 * The same building blocks as the five-company demo: an account is a person
 * and a login (E-06, E-01), a login in a company is a membership with a role,
 * a group head is a GROUP_HEAD position, a company's manager of a branch a
 * COMPANY_MANAGER one (E-13), and everybody employed has an employment in the
 * company that employs them (HR, E-03). No person or user is ever made twice:
 * every id is derived from the username.
 */
import type { PrismaClient } from "@prisma/client";

import { groupDepartmentId, type GroupDepartmentKey } from "../../../config/group-departments";
import { roleIds, upsertAccount, upsertMembership } from "../organization-helpers";
import { companyId, type ArmaarBranches } from "./organization";
import { ARMAAR_PEOPLE, COMPANY_PEOPLE, GROUP_PEOPLE, PLATFORM_ADMIN, emailOf, personOf, phoneOf, userId, type ArmaarPerson } from "./people";
import { COMPANY_FACTS, type CompanyCode } from "./public-facts";
import { ARMAAR_GROUP_ID, demoKey, recordDemo, slugOf } from "./records";

const DAY = 86_400_000;
/** HR dates are business dates held at midday UTC (E-03, `businessTimestamp`). */
const businessDay = (daysAgo: number) => {
  const day = new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
  return new Date(`${day}T12:00:00.000Z`);
};

export const memberId = (username: string, code: CompanyCode) => `member_${userId(username).replace(/^user_/, "")}_${slugOf(code)}`;

/** Group people first sign in where the flagship project is (their oldest login). */
const GROUP_LOGIN_ORDER: CompanyCode[] = [
  "BUILDING_CONSTRUCTION_INVEST",
  ...COMPANY_FACTS.filter((fact) => fact.status === "ACTIVE" && fact.code !== "BUILDING_CONSTRUCTION_INVEST").map((fact) => fact.code),
];
const SUSPENDED: CompanyCode[] = COMPANY_FACTS.filter((fact) => fact.status === "SUSPENDED").map((fact) => fact.code);

/** Every company a person has a login in, in the order the logins were made. */
export function companiesOf(person: ArmaarPerson): CompanyCode[] {
  if (GROUP_PEOPLE.includes(person)) {
    // The Owner and Group IT keep the suspended companies' logins: somebody must be able to reopen them.
    return person.role === "OWNER" || person.role === "GROUP_IT" ? [...GROUP_LOGIN_ORDER, ...SUSPENDED] : GROUP_LOGIN_ORDER;
  }
  return [person.company, ...(person.alsoIn ?? [])];
}

const EMPLOYEE_PREFIX: Record<CompanyCode, string> = {
  BUILDING_CONSTRUCTION_INVEST: "BCI",
  ARLIS_NDERTIM: "ALN",
  ARLIS_ADMINISTRIM: "ALA",
  IDEAL_CONSTRUCTION: "IDC",
  UNICO_CONSTRUCTION: "UNC",
  ARSOL_ENERGY: "ASE",
  SARANDA_MARINA_INVEST: "SMI",
  KLAIS: "KLS",
  KF_POGRADECI: "KFP",
  SUNRAY_ENERGY: "SNR",
  EKSO: "EKS",
  THE_EOTEL: "EOT",
  SKYLINE_TOWERS: "SKT",
};

export async function seedArmaarPeople(prisma: PrismaClient, branches: ArmaarBranches, passwordHash: string, activatedAt: Date) {
  const roleId = await roleIds(prisma);

  /* The Platform Admin, outside the group (§86) ------------------------------ */
  await upsertAccount(prisma, PLATFORM_ADMIN, { passwordHash, parentGroupId: null });
  await prisma.platformAccess.upsert({
    where: { userId: PLATFORM_ADMIN.id },
    update: { roleKey: "PLATFORM_ADMIN", status: "ACTIVE" },
    create: { userId: PLATFORM_ADMIN.id, roleKey: "PLATFORM_ADMIN", status: "ACTIVE" },
  });

  /* Accounts and the people behind them ------------------------------------- */
  for (const [index, person] of ARMAAR_PEOPLE.entries()) {
    const id = userId(person.username);
    const personId = await upsertAccount(
      prisma,
      { id, username: person.username, email: emailOf(person.username), firstName: person.firstName, lastName: person.lastName, phone: phoneOf(index), jobTitle: person.jobTitle },
      { passwordHash, parentGroupId: ARMAAR_GROUP_ID },
    );
    await prisma.personProfile.update({ where: { id: personId! }, data: { officeLocation: person.location, city: person.location.split(" — ")[0], country: "Albania" } });
    await recordDemo(prisma, { key: demoKey("PERSON", person.username), entityType: "User", entityId: id, source: "SYNTHETIC", note: "A demo persona; not a member of ARMAAR's staff." });
  }

  for (const person of GROUP_PEOPLE) {
    await prisma.parentGroupMember.upsert({
      where: { parentGroupId_userId: { parentGroupId: ARMAAR_GROUP_ID, userId: userId(person.username) } },
      update: { status: "ACTIVE" },
      create: { parentGroupId: ARMAAR_GROUP_ID, userId: userId(person.username), status: "ACTIVE", joinedAt: activatedAt },
    });
  }

  /* Logins, company by company ---------------------------------------------- */
  for (const person of ARMAAR_PEOPLE) {
    for (const code of companiesOf(person)) {
      const departments = branches.get(companyId(code))!;
      await upsertMembership(prisma, {
        id: memberId(person.username, code),
        companyId: companyId(code),
        userId: userId(person.username),
        role: person.role,
        roleId,
        departmentId: departments.get(person.department) ?? null,
        jobTitle: person.jobTitle,
      });
      const started = businessDay(person.startedDaysAgo);
      await prisma.companyMember.update({ where: { id: memberId(person.username, code) }, data: { joinedAt: started > activatedAt ? started : activatedAt } });
    }
  }

  /* Positions (§12, §13; E-06, E-13) ----------------------------------------- */
  for (const person of GROUP_PEOPLE) {
    await upsertPosition(prisma, person, null, null, activatedAt);
  }
  // A group head may also manage their function's branch in the company that employs them (E-08 §23, §52).
  for (const person of [...GROUP_PEOPLE, ...COMPANY_PEOPLE].filter((candidate) => candidate.manages)) {
    const branch = branches.get(companyId(person.company))!.get(person.department);
    if (!branch) throw new Error(`ARMAAR seed: ${person.username} manages ${person.department}, which ${person.company} does not run.`);
    await upsertPosition(prisma, person, person.company, branch, activatedAt);
    await prisma.department.update({ where: { id: branch }, data: { managerMemberId: memberId(person.username, person.company) } });
  }

  /* Employments (HR; E-03 gives them their history) ------------------------- */
  const numbers = new Map<CompanyCode, number>();
  for (const person of ARMAAR_PEOPLE) {
    const code = person.company;
    const next = (numbers.get(code) ?? 0) + 1;
    numbers.set(code, next);
    const manager = person.reportsTo ? personOf(person.reportsTo) : undefined;
    if (person.reportsTo && (!manager || !companiesOf(manager).includes(code))) {
      throw new Error(`ARMAAR seed: ${person.username} reports to ${person.reportsTo}, who has no login in ${code}.`);
    }
    const id = `employee_armaar_${userId(person.username).replace(/^user_armaar_/, "")}`;
    const data = {
      employmentStatus: "ACTIVE" as const,
      employmentType: "FULL_TIME" as const,
      startDate: businessDay(person.startedDaysAgo),
      managerMemberId: manager ? memberId(manager.username, code) : null,
      workLocation: person.location,
      workLocationType: person.workLocationType,
      weeklyHours: "40",
      onboardingStatus: "COMPLETED" as const,
      offboardingStatus: "NOT_REQUIRED" as const,
    };
    await prisma.employeeProfile.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(code),
        personProfileId: `person_${userId(person.username).replace(/^user_/, "")}`,
        companyMemberId: memberId(person.username, code),
        employeeNumber: `${EMPLOYEE_PREFIX[code]}-${String(next).padStart(4, "0")}`,
        // Recorded by the Head of Group HR, who has a login in every active company.
        createdByMemberId: memberId("armaar.hr", code),
        ...data,
      },
    });
  }

  return { people: ARMAAR_PEOPLE.length };
}

async function upsertPosition(prisma: PrismaClient, person: ArmaarPerson, code: CompanyCode | null, branch: string | null, activatedAt: Date) {
  const scope = code ? slugOf(code) : "group";
  const id = `armaar_pos_${userId(person.username).replace(/^user_armaar_/, "")}_${person.department}_${scope}`;
  const level = code ? ("COMPANY_MANAGER" as const) : ("GROUP_HEAD" as const);
  const data = {
    parentGroupId: ARMAAR_GROUP_ID,
    userId: userId(person.username),
    groupDepartmentId: groupDepartmentId(ARMAAR_GROUP_ID, person.department as GroupDepartmentKey),
    companyId: code ? companyId(code) : null,
    companyDepartmentId: branch,
    functionalRoleKey: person.role,
    positionLevel: level,
    accessLevel: level === "GROUP_HEAD" ? ("MANAGE" as const) : ("APPROVE" as const),
    status: "ACTIVE" as const,
    startsAt: activatedAt,
  };
  await prisma.departmentAssignment.upsert({ where: { id }, update: data, create: { id, ...data } });
}
