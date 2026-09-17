/**
 * The person before the login (E-06 §56-§58, §112, §135).
 *
 * Three people show HR → Group IT → department manager end to end:
 *
 *   - Elira Hoxha, interviewing for Meridian's Architecture branch. A person
 *     and a candidacy, and no account of any kind.
 *   - Adrian Kola, selected for Terra's Finance branch. His employment is
 *     planned, the account request is approved, and there is still no login:
 *     Group IT's "Create User from HR Profile" is one click away (§57), after
 *     which Terra's finance manager puts him on East Gate Logistics Hub (§58).
 *   - Ermira Tafa, Terra's finance officer, who went all the way: the same
 *     person behind the candidacy, the employment and the account.
 *
 * Idempotent: fixed ids, upserted, so re-seeding converges.
 */
import type { PrismaClient } from "@prisma/client";

import { daysFromNow, DEMO_GROUP } from "./constants";

export const RECRUITMENT_SEED = {
  interviewing: { person: "person_elira_hoxha", candidate: "candidate_elira_hoxha" },
  selected: { person: "person_adrian_kola", candidate: "candidate_adrian_kola", employment: "employee_c_adrian_kola", request: "provisioning_adrian_kola" },
  provisioned: { person: "person_finance_c", candidate: "candidate_ermira_tafa", employment: "employee_c_emp_004", request: "provisioning_ermira_tafa", user: "user_finance_c" },
} as const;

async function branch(prisma: PrismaClient, companyId: string, key: string): Promise<string> {
  const department = await prisma.department.findFirst({ where: { companyId, key }, select: { id: true } });
  if (!department) throw new Error(`Seed order: recruitment needs ${companyId}'s ${key} branch.`);
  return department.id;
}

export async function seedRecruitmentRecords(prisma: PrismaClient) {
  const group = DEMO_GROUP.id;
  const meridianArchitecture = await branch(prisma, "company_demo_b", "architecture");
  const terraFinance = await branch(prisma, "company_demo_c", "finance");

  /* ---- Elira Hoxha: interviewing, no account (§56) --------------------- */

  const elira = RECRUITMENT_SEED.interviewing;
  const eliraPerson = {
    parentGroupId: group,
    firstName: "Elira",
    lastName: "Hoxha",
    personalEmail: "elira.hoxha@example.test",
    personalPhone: "+355 69 400 1122",
    city: "Durrës",
    country: "Albania",
    lifecycleStatus: "CANDIDATE" as const,
    createdByUserId: "user_hr",
  };
  await prisma.personProfile.upsert({ where: { id: elira.person }, update: eliraPerson, create: { id: elira.person, ...eliraPerson } });
  const eliraCandidate = {
    parentGroupId: group,
    personProfileId: elira.person,
    targetCompanyId: "company_demo_b",
    targetDepartmentId: meridianArchitecture,
    targetRoleKey: "ARCHITECT",
    targetJobTitle: "Architect",
    hiringManagerUserId: "user_architecture_manager_b",
    status: "INTERVIEWING" as const,
    interviewStage: "Second interview",
    notes: "Strong residential portfolio; references pending.",
    decidedAt: null,
    decidedByUserId: null,
    createdByUserId: "user_hr",
    createdAt: daysFromNow(-12),
  };
  await prisma.candidateProfile.upsert({ where: { id: elira.candidate }, update: eliraCandidate, create: { id: elira.candidate, ...eliraCandidate } });

  /* ---- Adrian Kola: selected, planned, approved, no account (§56, §57) - */

  const adrian = RECRUITMENT_SEED.selected;
  const adrianPerson = {
    parentGroupId: group,
    firstName: "Adrian",
    lastName: "Kola",
    jobTitle: "Finance Officer",
    workEmail: "adrian.kola@nesto.test",
    workPhone: "+355 69 400 3344",
    city: "Tiranë",
    country: "Albania",
    lifecycleStatus: "SELECTED" as const,
    createdByUserId: "user_hr",
  };
  await prisma.personProfile.upsert({ where: { id: adrian.person }, update: adrianPerson, create: { id: adrian.person, ...adrianPerson } });
  const adrianCandidate = {
    parentGroupId: group,
    personProfileId: adrian.person,
    targetCompanyId: "company_demo_c",
    targetDepartmentId: terraFinance,
    targetRoleKey: "FINANCE",
    targetJobTitle: "Finance Officer",
    hiringManagerUserId: "user_finance",
    status: "SELECTED" as const,
    interviewStage: "Offer accepted",
    notes: null,
    decidedAt: daysFromNow(-6),
    decidedByUserId: "user_hr",
    createdByUserId: "user_hr",
    createdAt: daysFromNow(-30),
  };
  await prisma.candidateProfile.upsert({ where: { id: adrian.candidate }, update: adrianCandidate, create: { id: adrian.candidate, ...adrianCandidate } });
  const adrianEmployment = {
    companyId: "company_demo_c",
    personProfileId: adrian.person,
    companyMemberId: null,
    employeeNumber: "EMP-006",
    employmentStatus: "PLANNED" as const,
    employmentType: "FULL_TIME" as const,
    startDate: daysFromNow(7),
    managerMemberId: "member_finance__c",
  };
  await prisma.employeeProfile.upsert({ where: { id: adrian.employment }, update: adrianEmployment, create: { id: adrian.employment, ...adrianEmployment } });
  const adrianRequest = {
    parentGroupId: group,
    personProfileId: adrian.person,
    employeeProfileId: adrian.employment,
    companyId: "company_demo_c",
    companyDepartmentId: terraFinance,
    functionalRoleKey: "FINANCE",
    jobTitle: "Finance Officer",
    managerUserId: "user_finance",
    requestedUsername: null,
    requestedActivationDate: daysFromNow(7),
    notes: "Starts next week on East Gate Logistics Hub.",
    status: "APPROVED" as const,
    requestedByUserId: "user_hr",
    submittedAt: daysFromNow(-5),
    approvedByUserId: "user_owner",
    approvedAt: daysFromNow(-4),
    provisionedUserId: null,
    provisionedByUserId: null,
    provisionedAt: null,
  };
  await prisma.userProvisioningRequest.upsert({ where: { id: adrian.request }, update: adrianRequest, create: { id: adrian.request, ...adrianRequest } });

  /* ---- Ermira Tafa: candidate → employee → user (§56) ----------------- */

  const ermira = RECRUITMENT_SEED.provisioned;
  const ermiraCandidate = {
    parentGroupId: group,
    personProfileId: ermira.person,
    targetCompanyId: "company_demo_c",
    targetDepartmentId: terraFinance,
    targetRoleKey: "FINANCE",
    targetJobTitle: "Finance Officer",
    hiringManagerUserId: "user_finance",
    status: "HIRED" as const,
    interviewStage: "Offer accepted",
    notes: null,
    decidedAt: daysFromNow(-420),
    decidedByUserId: "user_hr",
    createdByUserId: "user_hr",
    createdAt: daysFromNow(-450),
  };
  await prisma.candidateProfile.upsert({ where: { id: ermira.candidate }, update: ermiraCandidate, create: { id: ermira.candidate, ...ermiraCandidate } });
  const ermiraRequest = {
    parentGroupId: group,
    personProfileId: ermira.person,
    employeeProfileId: ermira.employment,
    companyId: "company_demo_c",
    companyDepartmentId: terraFinance,
    functionalRoleKey: "FINANCE",
    jobTitle: "Finance Officer",
    managerUserId: "user_finance",
    requestedUsername: "finance-c",
    requestedActivationDate: daysFromNow(-405),
    notes: null,
    status: "PROVISIONED" as const,
    requestedByUserId: "user_hr",
    submittedAt: daysFromNow(-415),
    approvedByUserId: "user_owner",
    approvedAt: daysFromNow(-414),
    provisionedUserId: ermira.user,
    provisionedByUserId: "user_it",
    provisionedAt: daysFromNow(-410),
  };
  await prisma.userProvisioningRequest.upsert({ where: { id: ermira.request }, update: ermiraRequest, create: { id: ermira.request, ...ermiraRequest } });

  return { candidates: 3, requests: 2 };
}
