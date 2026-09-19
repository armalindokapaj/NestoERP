/**
 * A person's life in the group, before and after a login (E-08 §45-§47, §53,
 * §54, §99, §118, §119).
 *
 * Two people the rest of ARMAAR did not have, so a presenter can show both
 * ends of E-06's lifecycle through E-08's profile:
 *
 *   Kejsi Braho    selected as a Sales Agent for BUILDING CONSTRUCTION INVEST.
 *                  Her employment starts in ten days and HR's account request
 *                  is approved: Group IT creates her login from her profile,
 *                  with nothing typed again. Colleagues do not see her yet.
 *   Bujar Kelmendi a concrete finisher who left Tirana Lake two months ago. His
 *                  employment has ended and his place in the concrete crew with
 *                  it; the crew's history still names him, and his name still
 *                  leads to his profile — "Former employee", nothing more.
 *
 * In two steps, like the workforce: the people and their employments before
 * the employment history is written (E-03), the crew place once the crew
 * exists. Synthetic people. Stable ids; a rerun adds nothing.
 */
import type { PrismaClient } from "@prisma/client";

import { addDays, businessTimestamp, todayDay } from "../../../lib/modules/hr/employment/employment.dates";
import { memberId } from "./access";
import { branchId, companyId } from "./organization";
import { userId } from "./people";
import { ARMAAR_GROUP_ID, demoKey, recordDemo } from "./records";
import { crewId, tradeId } from "./workforce";

const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;

export const LIFECYCLE = {
  selected: { person: "person_armaar_selected_kejsi", candidate: "candidate_armaar_kejsi", employment: "employee_armaar_selected_kejsi", request: "provisioning_armaar_kejsi" },
  former: { person: "person_armaar_former_bujar", employment: "employee_armaar_former_bujar", crewPlace: "armaar_crewm_former_bujar" },
} as const;

/** The people and their employments: before the shared employment-history step. */
export async function seedArmaarLifecycle(prisma: PrismaClient) {
  const today = todayDay();
  const day = (offset: number) => businessTimestamp(addDays(today, offset));
  const hr = userId("armaar.hr");

  /* Kejsi Braho: selected, planned, account approved, no login yet (§46, §47) --- */
  const selected = LIFECYCLE.selected;
  await prisma.personProfile.upsert({
    where: { id: selected.person },
    update: {},
    create: { id: selected.person, parentGroupId: ARMAAR_GROUP_ID, firstName: "Kejsi", lastName: "Braho", jobTitle: "Sales Agent", workEmail: "kejsi.braho@armaar-demo.test", personalEmail: "kejsi.braho@example.test", city: "Tirana", country: "Albania", lifecycleStatus: "SELECTED", createdByUserId: hr },
  });
  await prisma.candidateProfile.upsert({
    where: { id: selected.candidate },
    update: {},
    create: { id: selected.candidate, parentGroupId: ARMAAR_GROUP_ID, personProfileId: selected.person, targetCompanyId: companyId(BCI), targetDepartmentId: branchId(BCI, "sales"), targetRoleKey: "SALES", targetJobTitle: "Sales Agent", hiringManagerUserId: userId("bci.sales"), status: "SELECTED", interviewStage: "Offer accepted", decidedAt: day(-6), decidedByUserId: hr, createdByUserId: hr, createdAt: day(-28) },
  });
  await prisma.employeeProfile.upsert({
    where: { id: selected.employment },
    update: {},
    create: { id: selected.employment, companyId: companyId(BCI), personProfileId: selected.person, employeeNumber: "BCI-0950", employmentStatus: "PLANNED", employmentType: "FULL_TIME", startDate: day(10), departmentId: branchId(BCI, "sales"), jobTitle: "Sales Agent", managerMemberId: memberId("bci.sales", BCI), workLocationType: "OFFICE", workLocation: "Tirana — head office", createdByMemberId: memberId("armaar.hr", BCI) },
  });
  await prisma.userProvisioningRequest.upsert({
    where: { id: selected.request },
    update: {},
    create: {
      id: selected.request,
      parentGroupId: ARMAAR_GROUP_ID,
      personProfileId: selected.person,
      employeeProfileId: selected.employment,
      companyId: companyId(BCI),
      companyDepartmentId: branchId(BCI, "sales"),
      functionalRoleKey: "SALES",
      jobTitle: "Sales Agent",
      managerUserId: userId("bci.sales"),
      requestedActivationDate: day(10),
      notes: "Starts on the phase 1 sales team.",
      status: "APPROVED",
      requestedByUserId: hr,
      submittedAt: day(-5),
      approvedByUserId: userId("armaar.owner"),
      approvedAt: day(-4),
    },
  });
  await recordDemo(prisma, { key: demoKey("PERSON", "selected", "kejsi"), entityType: "PersonProfile", entityId: selected.person, source: "SYNTHETIC", note: "A selected candidate waiting for her account (E-08 §46)." });

  /* Bujar Kelmendi: worked on Tirana Lake, left two months ago (§54, §118) ------- */
  const former = LIFECYCLE.former;
  await prisma.personProfile.upsert({
    where: { id: former.person },
    update: {},
    create: { id: former.person, parentGroupId: ARMAAR_GROUP_ID, firstName: "Bujar", lastName: "Kelmendi", jobTitle: "Concrete finisher", city: "Tirana", country: "Albania", lifecycleStatus: "FORMER_EMPLOYEE", createdByUserId: userId("bci.hr") },
  });
  await prisma.employeeProfile.upsert({
    where: { id: former.employment },
    update: {},
    create: {
      id: former.employment,
      companyId: companyId(BCI),
      personProfileId: former.person,
      employeeNumber: "BCI-1090",
      employmentStatus: "ENDED",
      employmentType: "FULL_TIME",
      startDate: day(-480),
      endDate: day(-60),
      departmentId: branchId(BCI, "projects"),
      jobTitle: "Concrete finisher",
      tradeId: tradeId(BCI, "concrete"),
      managerMemberId: memberId("bci.pm", BCI),
      workLocationType: "SITE",
      workLocation: "Tirana Lake",
      createdByMemberId: memberId("bci.hr", BCI),
    },
  });
  await recordDemo(prisma, { key: demoKey("PERSON", "former", "bujar"), entityType: "PersonProfile", entityId: former.person, source: "SYNTHETIC", note: "A former site worker whose records still lead to his profile (E-08 §118)." });
  return { people: 2 };
}

/** His place in the concrete crew, which ended with his employment: after the workforce seed. */
export async function seedArmaarLifecycleWorkforce(prisma: PrismaClient) {
  const today = todayDay();
  const day = (offset: number) => businessTimestamp(addDays(today, offset));
  await prisma.workforceCrewMember.upsert({
    where: { id: LIFECYCLE.former.crewPlace },
    update: {},
    create: { id: LIFECYCLE.former.crewPlace, companyId: companyId(BCI), crewId: crewId("tl_concrete"), employeeProfileId: LIFECYCLE.former.employment, startDate: day(-420), endDate: day(-60), endReason: "Left the company.", createdByUserId: userId("bci.hr"), endedByUserId: userId("bci.hr") },
  });
}
