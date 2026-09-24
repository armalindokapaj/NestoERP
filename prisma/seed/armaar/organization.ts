/**
 * ARMAAR GROUP, its thirteen companies and its departments (D-01 §4-§10).
 *
 * The group's thirteen functions are the chart's, named the way ARMAAR names
 * them (§9): renaming one is what E-13 lets a group do, and the roles stay bound
 * to them. Each company activates only the departments it works in (§10): a
 * branch exists where it is active, nowhere else (E-13). Suspended companies
 * keep their Administration and nothing new (§5).
 */
import type { PrismaClient } from "@prisma/client";

import { groupDepartmentId, type GroupDepartmentKey } from "../../../config/group-departments";
import { seedCompanyModules, upsertCompany, upsertParentGroup } from "../organization-helpers";
import { COMPANY_FACTS, D01_SOURCE, D03_SOURCE, GROUP_FACTS, type CompanyCode } from "./public-facts";
import { ARMAAR_GROUP_ID, demoKey, recordDemo, slugOf } from "./records";

export const companyId = (code: CompanyCode) => `armaar_co_${slugOf(code)}`;

/** ARMAAR's names for the chart's functions (D-01 §9), in the order it lists them. */
const DEPARTMENT_NAMES: Record<GroupDepartmentKey, { name: string; code: string }> = {
  architecture: { name: "Architecture & Design", code: "ARCH" },
  engineering: { name: "Engineering", code: "ENG" },
  projects: { name: "Project Management", code: "PM" },
  finance: { name: "Finance", code: "FIN" },
  legal: { name: "Legal", code: "LEGAL" },
  procurement: { name: "Procurement", code: "PROC" },
  sales: { name: "Sales", code: "SALES" },
  hr: { name: "HR", code: "HR" },
  hse: { name: "HSE", code: "HSE" },
  qaqc: { name: "QA/QC", code: "QAQC" },
  inventory: { name: "Inventory & Logistics", code: "INV" },
  it: { name: "IT", code: "IT" },
  executive: { name: "Administration", code: "ADM" },
};

export const departmentName = (key: GroupDepartmentKey) => DEPARTMENT_NAMES[key].name;

type CompanyProfile = { industry: string; departments: GroupDepartmentKey[]; place: string };

/**
 * What each company does (D-01 §8) and the departments it runs (§10 gives
 * ARLIS - NDERTIM's and ARSOL ENERGY's). The functional profile is the PRD's
 * design of the demo, not a registry fact: recorded as INFERRED.
 */
export const COMPANY_PROFILES: Record<CompanyCode, CompanyProfile> = {
  // Development and construction (§8): Tirana Lake's site runs its own HSE, QA/QC and store.
  BUILDING_CONSTRUCTION_INVEST: { industry: "Real estate development", place: "Tirana", departments: ["executive", "hr", "projects", "architecture", "engineering", "finance", "legal", "sales", "procurement", "hse", "qaqc", "inventory"] },
  // Square 21 is ARLIS - NDERTIM's, and its last units are still on sale: a sales branch.
  ARLIS_NDERTIM: { industry: "Construction", place: "Tirana", departments: ["executive", "it", "hr", "projects", "engineering", "finance", "legal", "sales", "procurement", "inventory", "qaqc", "hse"] },
  IDEAL_CONSTRUCTION: { industry: "Construction", place: "Tirana", departments: ["executive", "hr", "projects", "engineering", "finance", "procurement", "qaqc", "hse"] },
  UNICO_CONSTRUCTION: { industry: "Architecture and engineering", place: "Tirana", departments: ["executive", "hr", "projects", "architecture", "engineering", "finance"] },
  ARSOL_ENERGY: { industry: "Energy", place: "Tirana", departments: ["executive", "it", "hr", "projects", "engineering", "finance", "legal", "procurement"] },
  SARANDA_MARINA_INVEST: { industry: "Marina and hospitality development", place: "Saranda", departments: ["executive", "projects", "architecture", "finance", "legal", "sales"] },
  // The group's services company: where the heads of the group's functions are employed.
  ARLIS_ADMINISTRIM: { industry: "Group administration", place: "Tirana", departments: ["executive", "it", "hr", "finance", "legal", "procurement", "projects", "architecture", "engineering", "sales", "hse", "qaqc", "inventory"] },
  KLAIS: { industry: "Construction", place: "Tirana", departments: ["executive", "finance"] },
  KF_POGRADECI: { industry: "Real estate development", place: "Pogradec", departments: ["executive", "projects", "finance"] },
  SUNRAY_ENERGY: { industry: "Energy", place: "Tirana", departments: ["executive"] },
  EKSO: { industry: "Construction", place: "Tirana", departments: ["executive"] },
  THE_EOTEL: { industry: "Hospitality", place: "Tirana", departments: ["executive"] },
  SKYLINE_TOWERS: { industry: "Real estate development", place: "Tirana", departments: ["executive"] },
};

/** Company → department key → branch id. */
export type ArmaarBranches = Map<string, Map<GroupDepartmentKey, string>>;

export const branchId = (code: CompanyCode, key: GroupDepartmentKey) => `armaar_dept_${slugOf(code)}_${key}`;

export async function seedArmaarOrganization(prisma: PrismaClient, activatedAt: Date): Promise<ArmaarBranches> {
  await upsertParentGroup(prisma, {
    id: ARMAAR_GROUP_ID,
    slug: "armaar-group",
    name: GROUP_FACTS.name,
    legalName: GROUP_FACTS.legalName,
    country: GROUP_FACTS.country,
    timezone: "Europe/Tirane",
    currency: "EUR",
    status: "ACTIVE",
    activatedAt,
  });
  await prisma.parentGroup.update({ where: { id: ARMAAR_GROUP_ID }, data: { registrationNumber: GROUP_FACTS.registrationNumber, city: GROUP_FACTS.city, isDemo: true } });
  await recordDemo(prisma, {
    key: demoKey("GROUP"),
    entityType: "ParentGroup",
    entityId: ARMAAR_GROUP_ID,
    source: "PUBLIC",
    fields: { name: "PUBLIC", legalName: "PUBLIC", registrationNumber: "PUBLIC", country: "PUBLIC", city: "PUBLIC", status: "PUBLIC", currency: "SYNTHETIC", activatedAt: "SYNTHETIC" },
    note: "Every other record of this group — people, budgets, progress, sales, workflows — is synthetic demo data.",
  });

  for (const [key, names] of Object.entries(DEPARTMENT_NAMES) as Array<[GroupDepartmentKey, { name: string; code: string }]>) {
    const id = groupDepartmentId(ARMAAR_GROUP_ID, key);
    await prisma.groupDepartment.update({ where: { id }, data: { name: names.name, code: names.code } });
    await recordDemo(prisma, { key: demoKey("DEPARTMENT", key.toUpperCase()), entityType: "GroupDepartment", entityId: id, source: "SYNTHETIC", note: "The department list is D-01 §9's design of the demo, not a registry fact." });
  }

  const branches: ArmaarBranches = new Map();
  for (const fact of COMPANY_FACTS) {
    const id = companyId(fact.code);
    const profile = COMPANY_PROFILES[fact.code];
    await upsertCompany(prisma, {
      id,
      parentGroupId: ARMAAR_GROUP_ID,
      slug: `armaar-${slugOf(fact.code).replace(/_/g, "-")}`,
      name: fact.name,
      registrationNumber: fact.registrationNumber,
      industry: profile.industry,
      country: GROUP_FACTS.country,
      address: profile.place,
      status: fact.status,
    });
    await seedCompanyModules(prisma, id);
    await prisma.companyOwner.upsert({
      where: { id: `armaar_owner_${slugOf(fact.code)}` },
      update: {},
      create: {
        id: `armaar_owner_${slugOf(fact.code)}`,
        companyId: id,
        holderParentGroupId: ARMAAR_GROUP_ID,
        holderName: GROUP_FACTS.legalName,
        holderTaxNumber: GROUP_FACTS.registrationNumber,
        sharePercent: 100,
      },
    });
    await recordDemo(prisma, {
      key: demoKey("COMPANY", fact.code),
      entityType: "Company",
      entityId: id,
      source: "PUBLIC",
      fields: { name: "PUBLIC", status: "PUBLIC", ...(fact.registrationNumber ? { registrationNumber: "PUBLIC" as const } : {}), industry: "INFERRED", address: "INFERRED", country: "INFERRED", ownership: "INFERRED", departments: "INFERRED" },
      // Name and status are D-01's; the NIPT is D-03's (§13).
      cites: fact.registrationNumber ? [D01_SOURCE, D03_SOURCE] : [D01_SOURCE],
      note: `${fact.registrationNumber ? "" : "NIPT not in the source set: left empty. "}Ownership: ARMAAR GROUP 100% (D-01 §6), no registry extract per company.`,
    });

    const map = new Map<GroupDepartmentKey, string>();
    for (const key of profile.departments) {
      const branch = branchId(fact.code, key);
      const data = { name: DEPARTMENT_NAMES[key].name, groupDepartmentId: groupDepartmentId(ARMAAR_GROUP_ID, key), status: "ACTIVE" as const };
      await prisma.department.upsert({ where: { id: branch }, update: data, create: { id: branch, companyId: id, key, ...data } });
      map.set(key, branch);
    }
    branches.set(id, map);
  }
  return branches;
}
