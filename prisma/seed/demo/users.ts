/**
 * The demo group's people (E-06 §48-§55, §98).
 *
 * Four kinds, kept apart because they are different things:
 *
 *   PLATFORM_USERS   outside every group: the Platform Admin
 *   GROUP_USERS      the Owner, Group IT and the group's department heads —
 *                    one account each, a membership in all five companies
 *   COMPANY_USERS    people who work in one company (one works in two)
 *   POSITIONS        who heads a group department and who manages a
 *                    company's branch of one, including the same account
 *                    doing both
 *
 * User ids from before the group existed are kept wherever the person still
 * exists (E-06 §157): `user_finance` is still Fiona Blake, now heading Group
 * Finance, so every record she touched stays hers.
 *
 * Fictional identities only.
 */
import type { PositionLevel, RoleKey } from "../../../config/roles";
import type { GroupDepartmentKey } from "../../../config/group-departments";
import { COMPANY_A, COMPANY_B, COMPANY_C, COMPANY_D, COMPANY_E, DEMO_COMPANY_CODES, DEMO_COMPANIES, companyCode, type DemoCompanyCode } from "./projects";

export type SeedUser = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: RoleKey;
  department: GroupDepartmentKey | null;
  jobTitle: string;
};

export type CompanyUser = SeedUser & { companies: string[] };

export const PLATFORM_USERS: SeedUser[] = [
  { id: "user_admin", username: "platform-admin", email: "platform-admin@nesto.test", firstName: "Adam", lastName: "Hart", phone: "+355 69 000 0002", role: "PLATFORM_ADMIN", department: null, jobTitle: "Platform Administrator" },
];

/** Every group user is a member of all five companies. */
export const GROUP_USERS: SeedUser[] = [
  { id: "user_owner", username: "owner", email: "owner@nesto.test", firstName: "Olivia", lastName: "Owner", phone: "+355 69 000 0001", role: "OWNER", department: "executive", jobTitle: "Group Owner" },
  { id: "user_it", username: "group-it", email: "it@nesto.test", firstName: "Ian", lastName: "Carter", phone: "+355 69 000 0003", role: "GROUP_IT", department: "it", jobTitle: "Head of Group IT" },
  { id: "user_hr", username: "group-hr", email: "hr@nesto.test", firstName: "Hannah", lastName: "Reed", phone: "+355 69 000 0004", role: "HR", department: "hr", jobTitle: "Head of Group HR" },
  { id: "user_architecture_manager", username: "group-architecture", email: "architecture-manager@nesto.test", firstName: "Marco", lastName: "Bellini", phone: "+355 69 000 0017", role: "ARCHITECT", department: "architecture", jobTitle: "Head of Group Architecture" },
  { id: "user_group_engineering", username: "group-engineering", email: "group-engineering@nesto.test", firstName: "Elton", lastName: "Vata", phone: "+355 69 000 0019", role: "ENGINEER", department: "engineering", jobTitle: "Head of Group Engineering" },
  { id: "user_finance", username: "group-finance", email: "finance@nesto.test", firstName: "Fiona", lastName: "Blake", phone: "+355 69 000 0009", role: "FINANCE", department: "finance", jobTitle: "Head of Group Finance" },
  { id: "user_legal", username: "group-legal", email: "legal@nesto.test", firstName: "Laura", lastName: "Stein", phone: "+355 69 000 0010", role: "LEGAL", department: "legal", jobTitle: "Head of Group Legal" },
  { id: "user_sales_manager", username: "group-sales", email: "sales-manager@nesto.test", firstName: "Nora", lastName: "Hale", phone: "+355 69 000 0018", role: "SALES", department: "sales", jobTitle: "Head of Group Sales" },
  { id: "user_procurement", username: "group-procurement", email: "procurement@nesto.test", firstName: "Peter", lastName: "Nolan", phone: "+355 69 000 0012", role: "PROCUREMENT", department: "procurement", jobTitle: "Head of Group Procurement" },
  { id: "user_inventory", username: "group-inventory", email: "inventory@nesto.test", firstName: "Isaac", lastName: "Turner", phone: "+355 69 000 0013", role: "INVENTORY", department: "inventory", jobTitle: "Head of Group Inventory" },
  { id: "user_qaqc", username: "group-qaqc", email: "qaqc@nesto.test", firstName: "Quinn", lastName: "Foster", phone: "+355 69 000 0014", role: "QAQC", department: "qaqc", jobTitle: "Head of Group QA/QC" },
  { id: "user_hse", username: "group-hse", email: "hse@nesto.test", firstName: "Henry", lastName: "Stone", phone: "+355 69 000 0015", role: "HSE", department: "hse", jobTitle: "Head of Group HSE" },
];

const at = (...companies: string[]) => companies;

export const COMPANY_USERS: CompanyUser[] = [
  /* Aurelia Construction ---------------------------------------------------- */
  { id: "user_ceo", username: "ceo-a", email: "ceo@nesto.test", firstName: "Charles", lastName: "Morgan", phone: "+355 69 000 0005", role: "CEO", department: "executive", jobTitle: "Chief Executive Officer", companies: at(COMPANY_A) },
  { id: "user_pm", username: "pm-a", email: "pm@nesto.test", firstName: "Alex", lastName: "Morgan", phone: "+355 69 000 0006", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Senior Project Manager", companies: at(COMPANY_A) },
  { id: "user_architect", username: "architect-a", email: "architect@nesto.test", firstName: "Anna", lastName: "Rossi", phone: "+355 69 000 0007", role: "ARCHITECT", department: "architecture", jobTitle: "Lead Architect", companies: at(COMPANY_A) },
  { id: "user_engineer", username: "engineer-a", email: "engineer@nesto.test", firstName: "Ethan", lastName: "Cole", phone: "+355 69 000 0008", role: "ENGINEER", department: "engineering", jobTitle: "Structural Engineer", companies: at(COMPANY_A) },
  { id: "user_sales", username: "sales-a", email: "sales@nesto.test", firstName: "Sophie", lastName: "Grant", phone: "+355 69 000 0011", role: "SALES", department: "sales", jobTitle: "Business Development Lead", companies: at(COMPANY_A) },
  { id: "user_finance_a", username: "finance-a", email: "finance-a@nesto.test", firstName: "Arta", lastName: "Deda", phone: "+355 69 000 0020", role: "FINANCE", department: "finance", jobTitle: "Accountant", companies: at(COMPANY_A) },
  { id: "user_viewer", username: "viewer-a", email: "viewer@nesto.test", firstName: "Victor", lastName: "Lane", phone: "+355 69 000 0016", role: "VIEWER", department: "projects", jobTitle: "Observer", companies: at(COMPANY_A) },

  /* Meridian Developments --------------------------------------------------- */
  { id: "user_ceo_b", username: "ceo-b", email: "ceo-b@nesto.test", firstName: "Dritan", lastName: "Lleshi", phone: "+355 69 000 0101", role: "CEO", department: "executive", jobTitle: "Chief Executive Officer", companies: at(COMPANY_B) },
  { id: "user_pm_b", username: "pm-b", email: "pm-b@nesto.test", firstName: "Klea", lastName: "Marku", phone: "+355 69 000 0102", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Manager", companies: at(COMPANY_B) },
  { id: "user_architecture_manager_b", username: "architecture-manager-b", email: "architecture-manager-b@nesto.test", firstName: "Arben", lastName: "Shehu", phone: "+355 69 000 0103", role: "ARCHITECT", department: "architecture", jobTitle: "Architecture Manager", companies: at(COMPANY_B) },
  { id: "user_finance_b", username: "finance-b", email: "finance-b@nesto.test", firstName: "Mirela", lastName: "Dervishi", phone: "+355 69 000 0104", role: "FINANCE", department: "finance", jobTitle: "Accountant", companies: at(COMPANY_B) },
  { id: "user_qaqc_b", username: "qaqc-b", email: "qaqc-b@nesto.test", firstName: "Gentian", lastName: "Bega", phone: "+355 69 000 0105", role: "QAQC", department: "qaqc", jobTitle: "Quality Inspector", companies: at(COMPANY_B) },

  /* Terra Infrastructure ---------------------------------------------------- */
  { id: "user_ceo_c", username: "ceo-c", email: "ceo-c@nesto.test", firstName: "Valbona", lastName: "Kraja", phone: "+355 69 000 0201", role: "CEO", department: "executive", jobTitle: "Chief Executive Officer", companies: at(COMPANY_C) },
  { id: "user_pm_c", username: "pm-c", email: "pm-c@nesto.test", firstName: "Ardit", lastName: "Selimi", phone: "+355 69 000 0202", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Manager", companies: at(COMPANY_C) },
  { id: "user_engineer_c", username: "engineer-c", email: "engineer-c@nesto.test", firstName: "Lorik", lastName: "Basha", phone: "+355 69 000 0203", role: "ENGINEER", department: "engineering", jobTitle: "Civil Engineer", companies: at(COMPANY_C) },
  { id: "user_finance_c", username: "finance-c", email: "finance-c@nesto.test", firstName: "Ermira", lastName: "Tafa", phone: "+355 69 000 0204", role: "FINANCE", department: "finance", jobTitle: "Project Accountant", companies: at(COMPANY_C) },
  { id: "user_hse_c", username: "hse-c", email: "hse-c@nesto.test", firstName: "Florian", lastName: "Gjika", phone: "+355 69 000 0205", role: "HSE", department: "hse", jobTitle: "HSE Officer", companies: at(COMPANY_C) },

  /* Forma Engineering ------------------------------------------------------- */
  { id: "user_ceo_d", username: "ceo-d", email: "ceo-d@nesto.test", firstName: "Edmond", lastName: "Rexha", phone: "+355 69 000 0301", role: "CEO", department: "executive", jobTitle: "Chief Executive Officer", companies: at(COMPANY_D) },
  { id: "user_pm_d", username: "pm-d", email: "pm-d@nesto.test", firstName: "Sabina", lastName: "Lika", phone: "+355 69 000 0302", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Manager", companies: at(COMPANY_D) },
  { id: "user_architect_d", username: "architect-d", email: "architect-d@nesto.test", firstName: "Jonida", lastName: "Pema", phone: "+355 69 000 0303", role: "ARCHITECT", department: "architecture", jobTitle: "Architect", companies: at(COMPANY_D) },
  { id: "user_finance_manager_d", username: "finance-manager-d", email: "finance-manager-d@nesto.test", firstName: "Petrit", lastName: "Luli", phone: "+355 69 000 0304", role: "FINANCE", department: "finance", jobTitle: "Finance Manager", companies: at(COMPANY_D) },
  { id: "user_qaqc_d", username: "qaqc-d", email: "qaqc-d@nesto.test", firstName: "Albana", lastName: "Kryeziu", phone: "+355 69 000 0305", role: "QAQC", department: "qaqc", jobTitle: "Quality Engineer", companies: at(COMPANY_D) },

  /* Nova Hospitality Development -------------------------------------------- */
  { id: "user_ceo_e", username: "ceo-e", email: "ceo-e@nesto.test", firstName: "Teuta", lastName: "Brahimi", phone: "+355 69 000 0401", role: "CEO", department: "executive", jobTitle: "Chief Executive Officer", companies: at(COMPANY_E) },
  { id: "user_pm_e", username: "pm-e", email: "pm-e@nesto.test", firstName: "Endrit", lastName: "Mema", phone: "+355 69 000 0402", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Manager", companies: at(COMPANY_E) },
  { id: "user_legal_manager_e", username: "legal-manager-e", email: "legal-manager-e@nesto.test", firstName: "Rudina", lastName: "Hysa", phone: "+355 69 000 0403", role: "LEGAL", department: "legal", jobTitle: "Legal Manager", companies: at(COMPANY_E) },
  { id: "user_sales_e", username: "sales-e", email: "sales-e@nesto.test", firstName: "Kejsi", lastName: "Zeneli", phone: "+355 69 000 0404", role: "SALES", department: "sales", jobTitle: "Sales Executive", companies: at(COMPANY_E) },
  { id: "user_hse_e", username: "hse-e", email: "hse-e@nesto.test", firstName: "Bledar", lastName: "Muca", phone: "+355 69 000 0405", role: "HSE", department: "hse", jobTitle: "HSE Coordinator", companies: at(COMPANY_E) },

  /* One architect working for two companies (E-06 §55) ---------------------- */
  { id: "user_multicompany", username: "multi-architect", email: "multicompany@nesto.test", firstName: "Mia", lastName: "Vogel", phone: "+355 69 000 0099", role: "ARCHITECT", department: "architecture", jobTitle: "Architect", companies: at(COMPANY_A, COMPANY_D) },
];

export const DEMO_USERS: SeedUser[] = [...PLATFORM_USERS, ...GROUP_USERS, ...COMPANY_USERS];

export type SeedPosition = {
  userId: string;
  department: GroupDepartmentKey;
  role: RoleKey;
  level: Exclude<PositionLevel, "MEMBER">;
  /** Null for a group head. */
  companyId: string | null;
};

/**
 * Heads of the group's departments, and managers of a company's branch — the
 * stacked cases (a head who also manages one company's branch) and the local
 * ones (a manager who heads nothing) side by side (E-06 §51, §52).
 */
export const POSITIONS: SeedPosition[] = [
  ...GROUP_USERS.map((user) => ({ userId: user.id, department: user.department!, role: user.role, level: "GROUP_HEAD" as const, companyId: null })),
  { userId: "user_architecture_manager", department: "architecture", role: "ARCHITECT", level: "COMPANY_MANAGER", companyId: COMPANY_A },
  { userId: "user_finance", department: "finance", role: "FINANCE", level: "COMPANY_MANAGER", companyId: COMPANY_C },
  { userId: "user_sales_manager", department: "sales", role: "SALES", level: "COMPANY_MANAGER", companyId: COMPANY_B },
  { userId: "user_hse", department: "hse", role: "HSE", level: "COMPANY_MANAGER", companyId: COMPANY_E },
  { userId: "user_architecture_manager_b", department: "architecture", role: "ARCHITECT", level: "COMPANY_MANAGER", companyId: COMPANY_B },
  { userId: "user_finance_manager_d", department: "finance", role: "FINANCE", level: "COMPANY_MANAGER", companyId: COMPANY_D },
  { userId: "user_legal_manager_e", department: "legal", role: "LEGAL", level: "COMPANY_MANAGER", companyId: COMPANY_E },
];

/* -------------------------------------------------------------------------- */
/* Membership ids                                                              */
/* -------------------------------------------------------------------------- */

const suffixOf = (userId: string) => userId.replace(/^user_/, "");

/**
 * A membership's deterministic id. Aurelia keeps the ids every earlier seed
 * used (`member_pm`); a group user's membership elsewhere carries the company
 * letter (`member_finance__c`). The multi-company architect keeps the
 * per-company ids tests have always named.
 */
export function memberId(userId: string, companyId: string): string {
  if (userId === "user_multicompany") return `member_multicompany_${companyCode(companyId)}`;
  const home = COMPANY_USERS.find((user) => user.id === userId)?.companies[0];
  if (companyId === COMPANY_A || companyId === home) return `member_${suffixOf(userId)}`;
  return `member_${suffixOf(userId)}__${companyCode(companyId)}`;
}

const GROUP_USER_IDS = new Set(GROUP_USERS.map((user) => user.id));
const COMPANY_USER_BY_ID = new Map(COMPANY_USERS.map((user) => [user.id, user]));

/** Whether this user holds a membership in this demo company. */
export function isMemberOf(userId: string, companyId: string): boolean {
  if (GROUP_USER_IDS.has(userId)) return true;
  return COMPANY_USER_BY_ID.get(userId)?.companies.includes(companyId) ?? false;
}

/**
 * Who plays an Aurelia persona in another company.
 *
 * The module seeds were written for one company, naming "the project manager",
 * "the architect". A record moved to Terra with its project is still raised by
 * the project manager — Terra's. Where a company has no such local person, the
 * group's head of that function stands in, since they are a member everywhere.
 */
const PERSONA_STAND_INS: Record<string, Partial<Record<DemoCompanyCode, string>> & { fallback: string }> = {
  user_ceo: { b: "user_ceo_b", c: "user_ceo_c", d: "user_ceo_d", e: "user_ceo_e", fallback: "user_owner" },
  user_pm: { b: "user_pm_b", c: "user_pm_c", d: "user_pm_d", e: "user_pm_e", fallback: "user_owner" },
  user_architect: { b: "user_architecture_manager_b", d: "user_architect_d", fallback: "user_architecture_manager" },
  user_engineer: { c: "user_engineer_c", fallback: "user_group_engineering" },
  user_sales: { e: "user_sales_e", fallback: "user_sales_manager" },
  user_finance_a: { b: "user_finance_b", c: "user_finance_c", d: "user_finance_manager_d", fallback: "user_finance" },
  user_viewer: { fallback: "user_owner" },
  user_multicompany: { d: "user_multicompany", fallback: "user_architecture_manager" },
};

export function personaIn(companyId: string, persona: string): string {
  if (isMemberOf(persona, companyId)) return persona;
  const standIn = PERSONA_STAND_INS[persona];
  if (!standIn) throw new Error(`Seed: ${persona} has no membership in ${companyId} and no stand-in.`);
  return standIn[companyCode(companyId)] ?? standIn.fallback;
}

/**
 * The membership lookups every seed module uses.
 *
 * `get(userId)` is the person's home membership — Aurelia for group users —
 * which is what every module seed meant before there were five companies.
 * `in(companyId, persona)` is the membership that plays that persona in a
 * given company.
 */
export type SeedMembers = {
  get(userId: string): string | undefined;
  in(companyId: string, persona: string): string;
  /** The user id that plays a persona in a company, for `createdBy` columns. */
  userIn(companyId: string, persona: string): string;
};

export function demoHomeCompany(userId: string): string | null {
  if (GROUP_USER_IDS.has(userId)) return COMPANY_A;
  return COMPANY_USER_BY_ID.get(userId)?.companies[0] ?? null;
}

export { DEMO_COMPANY_CODES, DEMO_COMPANIES };
