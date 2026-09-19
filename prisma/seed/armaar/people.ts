/**
 * ARMAAR's people (D-01 §11-§14, §41, §64, §86, §87).
 *
 * Synthetic people only: realistic Albanian names that belong to nobody on
 * purpose (§76), addresses on the reserved `.test` domain so nothing can ever
 * reach a real mailbox, and phone numbers in an unassigned block. The group's
 * public legal representatives are not people here (§40).
 *
 * Three kinds, as the five-company demo has them (E-06):
 *   the Platform Admin   outside the group (§86)
 *   GROUP_PEOPLE         the Owner, Group IT and the heads of the group's
 *                        functions — employed by the group's services company,
 *                        a login in every active company, a GROUP_HEAD position
 *   COMPANY_PEOPLE       everybody else, employed by one company; managers hold
 *                        their branch's COMPANY_MANAGER position (§13); a few
 *                        also work in a second company — ARLIS - NDERTIM's site
 *                        team builds Tirana Lake for BUILDING CONSTRUCTION
 *                        INVEST, so it has a login there too
 */
import type { RoleKey } from "../../../config/roles";
import type { GroupDepartmentKey } from "../../../config/group-departments";
import type { CompanyCode } from "./public-facts";

export type ArmaarPerson = {
  username: string;
  firstName: string;
  lastName: string;
  role: RoleKey;
  department: GroupDepartmentKey;
  jobTitle: string;
  /** The employing company. */
  company: CompanyCode;
  /** Other companies they work in, with the same role. */
  alsoIn?: CompanyCode[];
  /** Manager of their branch in the employing company. */
  manages?: true;
  /** Username of their manager, in the employing company. */
  reportsTo?: string;
  /** Days since they started. */
  startedDaysAgo: number;
  location: string;
  workLocationType: "OFFICE" | "SITE" | "HYBRID";
};

export const PLATFORM_ADMIN = {
  id: "user_armaar_platform_admin",
  username: "armaar.platform-admin",
  email: "platform-admin@armaar-demo.test",
  firstName: "Klaudia",
  lastName: "Nesti",
  phone: "+355 69 000 1000",
  jobTitle: "Platform Administrator",
};

const HQ = "Tirana — head office";
const LAKE = "Tirana Lake — site office";

/** Employed by ARLIS ADMINISTRIM; a login in every active company; heads of the group's functions (§12). */
export const GROUP_PEOPLE: ArmaarPerson[] = [
  { username: "armaar.owner", firstName: "Ilir", lastName: "Dervishaj", role: "OWNER", department: "executive", jobTitle: "Group Owner", company: "ARLIS_ADMINISTRIM", startedDaysAgo: 4200, location: HQ, workLocationType: "OFFICE" },
  // Head of Group IT, and also the manager of IT in ARLIS ADMINISTRIM, which employs him: a group and a company position (E-08 §52).
  { username: "armaar.it", firstName: "Erion", lastName: "Kasa", role: "GROUP_IT", department: "it", jobTitle: "Group IT Manager", company: "ARLIS_ADMINISTRIM", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 1900, location: HQ, workLocationType: "OFFICE" },
  { username: "armaar.finance", firstName: "Elira", lastName: "Shkurti", role: "FINANCE", department: "finance", jobTitle: "Group Finance Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 3100, location: HQ, workLocationType: "OFFICE" },
  { username: "armaar.legal", firstName: "Anisa", lastName: "Qosja", role: "LEGAL", department: "legal", jobTitle: "Group Legal Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 2600, location: HQ, workLocationType: "OFFICE" },
  { username: "armaar.procurement", firstName: "Gentian", lastName: "Bardhi", role: "PROCUREMENT", department: "procurement", jobTitle: "Group Procurement Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 2300, location: HQ, workLocationType: "OFFICE" },
  { username: "armaar.hr", firstName: "Mirela", lastName: "Kodra", role: "HR", department: "hr", jobTitle: "Group HR Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 2800, location: HQ, workLocationType: "OFFICE" },
  { username: "armaar.engineering", firstName: "Besnik", lastName: "Hasani", role: "ENGINEER", department: "engineering", jobTitle: "Group Engineering Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 3400, location: HQ, workLocationType: "HYBRID" },
  { username: "armaar.architecture", firstName: "Arta", lastName: "Lleshaj", role: "ARCHITECT", department: "architecture", jobTitle: "Group Architecture Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 3000, location: HQ, workLocationType: "HYBRID" },
  { username: "armaar.projects", firstName: "Kreshnik", lastName: "Duka", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Group Project Management Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 2500, location: HQ, workLocationType: "HYBRID" },
  { username: "armaar.sales", firstName: "Jonida", lastName: "Rrapaj", role: "SALES", department: "sales", jobTitle: "Group Sales Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 1700, location: HQ, workLocationType: "OFFICE" },
  { username: "armaar.hse", firstName: "Fatmir", lastName: "Zeqiri", role: "HSE", department: "hse", jobTitle: "Group HSE Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 2100, location: LAKE, workLocationType: "SITE" },
  { username: "armaar.qaqc", firstName: "Valbona", lastName: "Hoxha", role: "QAQC", department: "qaqc", jobTitle: "Group QA/QC Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 1600, location: HQ, workLocationType: "HYBRID" },
  { username: "armaar.inventory", firstName: "Sokol", lastName: "Marku", role: "INVENTORY", department: "inventory", jobTitle: "Group Inventory & Logistics Head", company: "ARLIS_ADMINISTRIM", reportsTo: "armaar.owner", startedDaysAgo: 1400, location: HQ, workLocationType: "OFFICE" },
];

/** Everybody else, by employing company (§13, §14). */
export const COMPANY_PEOPLE: ArmaarPerson[] = [
  /* BUILDING CONSTRUCTION INVEST — the developer, and Tirana Lake's company -- */
  { username: "bci.director", firstName: "Alban", lastName: "Gjoka", role: "CEO", department: "executive", jobTitle: "Company Director", company: "BUILDING_CONSTRUCTION_INVEST", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 3600, location: HQ, workLocationType: "OFFICE" },
  { username: "bci.finance", firstName: "Enkeleda", lastName: "Pasha", role: "FINANCE", department: "finance", jobTitle: "Finance Manager", company: "BUILDING_CONSTRUCTION_INVEST", manages: true, reportsTo: "bci.director", startedDaysAgo: 2400, location: HQ, workLocationType: "OFFICE" },
  { username: "bci.procurement", firstName: "Olsi", lastName: "Brahaj", role: "PROCUREMENT", department: "procurement", jobTitle: "Procurement Manager", company: "BUILDING_CONSTRUCTION_INVEST", manages: true, reportsTo: "bci.director", startedDaysAgo: 1800, location: HQ, workLocationType: "OFFICE" },
  { username: "bci.sales", firstName: "Klodiana", lastName: "Veliu", role: "SALES", department: "sales", jobTitle: "Sales Manager", company: "BUILDING_CONSTRUCTION_INVEST", manages: true, reportsTo: "bci.director", startedDaysAgo: 2000, location: HQ, workLocationType: "OFFICE" },
  { username: "bci.pm-lead", firstName: "Redi", lastName: "Tafaj", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Management Lead", company: "BUILDING_CONSTRUCTION_INVEST", manages: true, reportsTo: "bci.director", startedDaysAgo: 2700, location: HQ, workLocationType: "HYBRID" },
  { username: "bci.engineering", firstName: "Dorian", lastName: "Cela", role: "ENGINEER", department: "engineering", jobTitle: "Engineering Manager", company: "BUILDING_CONSTRUCTION_INVEST", manages: true, reportsTo: "bci.director", startedDaysAgo: 2200, location: LAKE, workLocationType: "SITE" },
  { username: "bci.hr", firstName: "Rezarta", lastName: "Hila", role: "HR", department: "hr", jobTitle: "HR Manager", company: "BUILDING_CONSTRUCTION_INVEST", manages: true, reportsTo: "bci.director", startedDaysAgo: 1500, location: HQ, workLocationType: "OFFICE" },
  { username: "bci.pm", firstName: "Ergys", lastName: "Lamaj", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Manager · Tirana Lake", company: "BUILDING_CONSTRUCTION_INVEST", reportsTo: "bci.pm-lead", startedDaysAgo: 1300, location: LAKE, workLocationType: "SITE" },
  { username: "bci.architect", firstName: "Sidorela", lastName: "Hysaj", role: "ARCHITECT", department: "architecture", jobTitle: "Architect", company: "BUILDING_CONSTRUCTION_INVEST", manages: true, reportsTo: "bci.director", startedDaysAgo: 1100, location: HQ, workLocationType: "HYBRID" },
  { username: "bci.legal", firstName: "Brunilda", lastName: "Xhafa", role: "LEGAL", department: "legal", jobTitle: "Legal Counsel", company: "BUILDING_CONSTRUCTION_INVEST", manages: true, reportsTo: "bci.director", startedDaysAgo: 1900, location: HQ, workLocationType: "OFFICE" },
  { username: "bci.sales-agent", firstName: "Ina", lastName: "Kurti", role: "SALES", department: "sales", jobTitle: "Sales Agent", company: "BUILDING_CONSTRUCTION_INVEST", reportsTo: "bci.sales", startedDaysAgo: 700, location: HQ, workLocationType: "OFFICE" },
  { username: "bci.sales-agent2", firstName: "Eros", lastName: "Shehaj", role: "SALES", department: "sales", jobTitle: "Sales Agent", company: "BUILDING_CONSTRUCTION_INVEST", reportsTo: "bci.sales", startedDaysAgo: 420, location: HQ, workLocationType: "OFFICE" },
  { username: "bci.finance-specialist", firstName: "Megi", lastName: "Allushi", role: "FINANCE", department: "finance", jobTitle: "Finance Specialist", company: "BUILDING_CONSTRUCTION_INVEST", reportsTo: "bci.finance", startedDaysAgo: 900, location: HQ, workLocationType: "OFFICE" },
  { username: "bci.viewer", firstName: "Artan", lastName: "Leka", role: "VIEWER", department: "executive", jobTitle: "Board Observer", company: "BUILDING_CONSTRUCTION_INVEST", reportsTo: "bci.director", startedDaysAgo: 600, location: HQ, workLocationType: "OFFICE" },

  /* ARLIS - NDERTIM — the contractor building Tirana Lake ------------------- */
  { username: "arlis.director", firstName: "Gazmend", lastName: "Ndreu", role: "CEO", department: "executive", jobTitle: "Company Director", company: "ARLIS_NDERTIM", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 4000, location: HQ, workLocationType: "OFFICE" },
  { username: "arlis.finance", firstName: "Lindita", lastName: "Bushati", role: "FINANCE", department: "finance", jobTitle: "Finance Manager", company: "ARLIS_NDERTIM", manages: true, reportsTo: "arlis.director", startedDaysAgo: 2900, location: HQ, workLocationType: "OFFICE" },
  { username: "arlis.procurement", firstName: "Ardian", lastName: "Qama", role: "PROCUREMENT", department: "procurement", jobTitle: "Procurement Manager", company: "ARLIS_NDERTIM", manages: true, reportsTo: "arlis.director", startedDaysAgo: 2100, location: HQ, workLocationType: "OFFICE" },
  { username: "arlis.engineering", firstName: "Edmond", lastName: "Prifti", role: "ENGINEER", department: "engineering", jobTitle: "Engineering Manager", company: "ARLIS_NDERTIM", manages: true, reportsTo: "arlis.director", startedDaysAgo: 3300, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.pm-lead", firstName: "Blerina", lastName: "Kaci", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Management Lead", company: "ARLIS_NDERTIM", manages: true, reportsTo: "arlis.director", startedDaysAgo: 2600, location: HQ, workLocationType: "HYBRID" },
  { username: "arlis.hr", firstName: "Suela", lastName: "Dauti", role: "HR", department: "hr", jobTitle: "HR Manager", company: "ARLIS_NDERTIM", manages: true, reportsTo: "arlis.director", startedDaysAgo: 1700, location: HQ, workLocationType: "OFFICE" },
  { username: "arlis.hse", firstName: "Agron", lastName: "Beqiri", role: "HSE", department: "hse", jobTitle: "HSE Manager", company: "ARLIS_NDERTIM", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], manages: true, reportsTo: "arlis.director", startedDaysAgo: 2000, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.qaqc", firstName: "Dea", lastName: "Luzi", role: "QAQC", department: "qaqc", jobTitle: "QA/QC Manager", company: "ARLIS_NDERTIM", manages: true, reportsTo: "arlis.director", startedDaysAgo: 1600, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.inventory", firstName: "Pellumb", lastName: "Hysi", role: "INVENTORY", department: "inventory", jobTitle: "Warehouse Manager", company: "ARLIS_NDERTIM", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], manages: true, reportsTo: "arlis.director", startedDaysAgo: 1900, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.legal", firstName: "Orjola", lastName: "Bici", role: "LEGAL", department: "legal", jobTitle: "Legal Counsel", company: "ARLIS_NDERTIM", manages: true, reportsTo: "arlis.director", startedDaysAgo: 1400, location: HQ, workLocationType: "OFFICE" },
  { username: "arlis.pm", firstName: "Klevis", lastName: "Doda", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Construction Project Manager · Tirana Lake", company: "ARLIS_NDERTIM", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], reportsTo: "arlis.pm-lead", startedDaysAgo: 1500, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.civil", firstName: "Marsela", lastName: "Toska", role: "ENGINEER", department: "engineering", jobTitle: "Civil Engineer", company: "ARLIS_NDERTIM", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], reportsTo: "arlis.engineering", startedDaysAgo: 1200, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.structural", firstName: "Eduart", lastName: "Vrioni", role: "ENGINEER", department: "engineering", jobTitle: "Structural Engineer", company: "ARLIS_NDERTIM", reportsTo: "arlis.engineering", startedDaysAgo: 1000, location: HQ, workLocationType: "HYBRID" },
  { username: "arlis.mep", firstName: "Aurora", lastName: "Mema", role: "ENGINEER", department: "engineering", jobTitle: "MEP Engineer", company: "ARLIS_NDERTIM", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], reportsTo: "arlis.engineering", startedDaysAgo: 760, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.site-engineer", firstName: "Taulant", lastName: "Ymeri", role: "ENGINEER", department: "engineering", jobTitle: "Site Engineer", company: "ARLIS_NDERTIM", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], reportsTo: "arlis.engineering", startedDaysAgo: 540, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.site-supervisor", firstName: "Ilirjan", lastName: "Shala", role: "ENGINEER", department: "engineering", jobTitle: "Site Supervisor", company: "ARLIS_NDERTIM", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], reportsTo: "arlis.engineering", startedDaysAgo: 2300, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.hse-officer", firstName: "Nertila", lastName: "Gjini", role: "HSE", department: "hse", jobTitle: "HSE Officer", company: "ARLIS_NDERTIM", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], reportsTo: "arlis.hse", startedDaysAgo: 650, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.qaqc-engineer", firstName: "Denis", lastName: "Kote", role: "QAQC", department: "qaqc", jobTitle: "QA/QC Engineer", company: "ARLIS_NDERTIM", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], reportsTo: "arlis.qaqc", startedDaysAgo: 480, location: LAKE, workLocationType: "SITE" },
  { username: "arlis.buyer", firstName: "Xhesika", lastName: "Lala", role: "PROCUREMENT", department: "procurement", jobTitle: "Procurement Specialist", company: "ARLIS_NDERTIM", alsoIn: ["IDEAL_CONSTRUCTION", "BUILDING_CONSTRUCTION_INVEST"], reportsTo: "arlis.procurement", startedDaysAgo: 880, location: HQ, workLocationType: "OFFICE" },
  { username: "arlis.accountant", firstName: "Genta", lastName: "Hoxhaj", role: "FINANCE", department: "finance", jobTitle: "Finance Specialist", company: "ARLIS_NDERTIM", reportsTo: "arlis.finance", startedDaysAgo: 1050, location: HQ, workLocationType: "OFFICE" },

  /* IDEAL Construction ------------------------------------------------------ */
  { username: "ideal.director", firstName: "Florian", lastName: "Kaja", role: "CEO", department: "executive", jobTitle: "Company Director", company: "IDEAL_CONSTRUCTION", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 3200, location: HQ, workLocationType: "OFFICE" },
  { username: "ideal.finance", firstName: "Etleva", lastName: "Dema", role: "FINANCE", department: "finance", jobTitle: "Finance Manager", company: "IDEAL_CONSTRUCTION", manages: true, reportsTo: "ideal.director", startedDaysAgo: 2000, location: HQ, workLocationType: "OFFICE" },
  { username: "ideal.procurement", firstName: "Bledi", lastName: "Sula", role: "PROCUREMENT", department: "procurement", jobTitle: "Procurement Manager", company: "IDEAL_CONSTRUCTION", manages: true, reportsTo: "ideal.director", startedDaysAgo: 1500, location: HQ, workLocationType: "OFFICE" },
  { username: "ideal.engineering", firstName: "Armando", lastName: "Gega", role: "ENGINEER", department: "engineering", jobTitle: "Engineering Manager", company: "IDEAL_CONSTRUCTION", manages: true, reportsTo: "ideal.director", startedDaysAgo: 2500, location: HQ, workLocationType: "HYBRID" },
  { username: "ideal.pm", firstName: "Ornela", lastName: "Caka", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Manager", company: "IDEAL_CONSTRUCTION", manages: true, reportsTo: "ideal.director", startedDaysAgo: 1300, location: HQ, workLocationType: "HYBRID" },
  { username: "ideal.site-engineer", firstName: "Kristi", lastName: "Rexhaj", role: "ENGINEER", department: "engineering", jobTitle: "Site Engineer", company: "IDEAL_CONSTRUCTION", reportsTo: "ideal.engineering", startedDaysAgo: 600, location: "Farka Residence — site office", workLocationType: "SITE" },
  { username: "ideal.hse", firstName: "Luan", lastName: "Tahiri", role: "HSE", department: "hse", jobTitle: "HSE Officer", company: "IDEAL_CONSTRUCTION", manages: true, reportsTo: "ideal.director", startedDaysAgo: 900, location: "Farka Residence — site office", workLocationType: "SITE" },
  { username: "ideal.qaqc", firstName: "Rina", lastName: "Mustafaj", role: "QAQC", department: "qaqc", jobTitle: "QA/QC Engineer", company: "IDEAL_CONSTRUCTION", manages: true, reportsTo: "ideal.director", startedDaysAgo: 700, location: "Farka Residence — site office", workLocationType: "SITE" },

  /* UNICO CONSTRUCTION — architecture, design and technical coordination --- */
  { username: "unico.director", firstName: "Vjollca", lastName: "Shyti", role: "CEO", department: "executive", jobTitle: "Company Director", company: "UNICO_CONSTRUCTION", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 2900, location: HQ, workLocationType: "OFFICE" },
  { username: "unico.architecture", firstName: "Arjan", lastName: "Koci", role: "ARCHITECT", department: "architecture", jobTitle: "Head of Architecture", company: "UNICO_CONSTRUCTION", manages: true, reportsTo: "unico.director", startedDaysAgo: 2600, location: HQ, workLocationType: "HYBRID" },
  { username: "unico.architect", firstName: "Elona", lastName: "Mece", role: "ARCHITECT", department: "architecture", jobTitle: "Architect", company: "UNICO_CONSTRUCTION", alsoIn: ["BUILDING_CONSTRUCTION_INVEST"], reportsTo: "unico.architecture", startedDaysAgo: 1200, location: HQ, workLocationType: "HYBRID" },
  { username: "unico.designer", firstName: "Iris", lastName: "Duro", role: "ARCHITECT", department: "architecture", jobTitle: "Interior Designer", company: "UNICO_CONSTRUCTION", reportsTo: "unico.architecture", startedDaysAgo: 500, location: HQ, workLocationType: "OFFICE" },
  { username: "unico.engineering", firstName: "Genci", lastName: "Kuka", role: "ENGINEER", department: "engineering", jobTitle: "Engineering Manager", company: "UNICO_CONSTRUCTION", manages: true, reportsTo: "unico.director", startedDaysAgo: 2300, location: HQ, workLocationType: "HYBRID" },
  { username: "unico.structural", firstName: "Erjon", lastName: "Bala", role: "ENGINEER", department: "engineering", jobTitle: "Structural Engineer", company: "UNICO_CONSTRUCTION", reportsTo: "unico.engineering", startedDaysAgo: 950, location: HQ, workLocationType: "OFFICE" },
  { username: "unico.coordinator", firstName: "Anxhela", lastName: "Rusi", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Technical Coordinator", company: "UNICO_CONSTRUCTION", manages: true, reportsTo: "unico.director", startedDaysAgo: 820, location: HQ, workLocationType: "HYBRID" },
  { username: "unico.finance", firstName: "Dritan", lastName: "Mullai", role: "FINANCE", department: "finance", jobTitle: "Finance Manager", company: "UNICO_CONSTRUCTION", manages: true, reportsTo: "unico.director", startedDaysAgo: 1700, location: HQ, workLocationType: "OFFICE" },

  /* ARSOL ENERGY ------------------------------------------------------------ */
  { username: "arsol.director", firstName: "Sinan", lastName: "Hajdari", role: "CEO", department: "executive", jobTitle: "Company Director", company: "ARSOL_ENERGY", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 1900, location: HQ, workLocationType: "OFFICE" },
  { username: "arsol.engineering", firstName: "Olta", lastName: "Kraja", role: "ENGINEER", department: "engineering", jobTitle: "Engineering Manager", company: "ARSOL_ENERGY", manages: true, reportsTo: "arsol.director", startedDaysAgo: 1500, location: HQ, workLocationType: "HYBRID" },
  { username: "arsol.electrical", firstName: "Rigers", lastName: "Jaupi", role: "ENGINEER", department: "engineering", jobTitle: "Electrical Engineer", company: "ARSOL_ENERGY", reportsTo: "arsol.engineering", startedDaysAgo: 700, location: HQ, workLocationType: "HYBRID" },
  { username: "arsol.procurement", firstName: "Ledio", lastName: "Zeka", role: "PROCUREMENT", department: "procurement", jobTitle: "Procurement Manager", company: "ARSOL_ENERGY", manages: true, reportsTo: "arsol.director", startedDaysAgo: 1100, location: HQ, workLocationType: "OFFICE" },
  { username: "arsol.finance", firstName: "Mimoza", lastName: "Kondi", role: "FINANCE", department: "finance", jobTitle: "Finance Manager", company: "ARSOL_ENERGY", manages: true, reportsTo: "arsol.director", startedDaysAgo: 1400, location: HQ, workLocationType: "OFFICE" },
  { username: "arsol.legal", firstName: "Paola", lastName: "Gjeta", role: "LEGAL", department: "legal", jobTitle: "Legal Counsel", company: "ARSOL_ENERGY", manages: true, reportsTo: "arsol.director", startedDaysAgo: 1000, location: HQ, workLocationType: "OFFICE" },
  { username: "arsol.pm", firstName: "Aldo", lastName: "Nika", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Manager", company: "ARSOL_ENERGY", manages: true, reportsTo: "arsol.director", startedDaysAgo: 850, location: HQ, workLocationType: "HYBRID" },

  /* Saranda Marina Invest --------------------------------------------------- */
  { username: "smi.director", firstName: "Kujtim", lastName: "Dervishi", role: "CEO", department: "executive", jobTitle: "Company Director", company: "SARANDA_MARINA_INVEST", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 2400, location: "Saranda — office", workLocationType: "OFFICE" },
  { username: "smi.pm", firstName: "Evis", lastName: "Tole", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Manager", company: "SARANDA_MARINA_INVEST", manages: true, reportsTo: "smi.director", startedDaysAgo: 1100, location: "Saranda — office", workLocationType: "SITE" },
  { username: "smi.sales", firstName: "Albana", lastName: "Qerimi", role: "SALES", department: "sales", jobTitle: "Sales Manager", company: "SARANDA_MARINA_INVEST", manages: true, reportsTo: "smi.director", startedDaysAgo: 1300, location: "Saranda — office", workLocationType: "OFFICE" },
  { username: "smi.sales-agent", firstName: "Endri", lastName: "Bejko", role: "SALES", department: "sales", jobTitle: "Sales Agent", company: "SARANDA_MARINA_INVEST", reportsTo: "smi.sales", startedDaysAgo: 380, location: "Saranda — office", workLocationType: "OFFICE" },
  { username: "smi.finance", firstName: "Rovena", lastName: "Hida", role: "FINANCE", department: "finance", jobTitle: "Finance Manager", company: "SARANDA_MARINA_INVEST", manages: true, reportsTo: "smi.director", startedDaysAgo: 1600, location: "Saranda — office", workLocationType: "OFFICE" },
  { username: "smi.architect", firstName: "Tea", lastName: "Kellici", role: "ARCHITECT", department: "architecture", jobTitle: "Architect", company: "SARANDA_MARINA_INVEST", manages: true, reportsTo: "smi.director", startedDaysAgo: 900, location: "Saranda — office", workLocationType: "HYBRID" },

  /* The lighter companies --------------------------------------------------- */
  { username: "arlisadm.director", firstName: "Mentor", lastName: "Bajrami", role: "CEO", department: "executive", jobTitle: "Company Director", company: "ARLIS_ADMINISTRIM", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 3800, location: HQ, workLocationType: "OFFICE" },
  { username: "klais.director", firstName: "Ervin", lastName: "Shehu", role: "CEO", department: "executive", jobTitle: "Company Director", company: "KLAIS", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 2000, location: HQ, workLocationType: "OFFICE" },
  { username: "klais.finance", firstName: "Adela", lastName: "Kapllani", role: "FINANCE", department: "finance", jobTitle: "Accountant", company: "KLAIS", reportsTo: "klais.director", startedDaysAgo: 1200, location: HQ, workLocationType: "OFFICE" },
  { username: "kfp.director", firstName: "Andi", lastName: "Zaimi", role: "CEO", department: "executive", jobTitle: "Company Director", company: "KF_POGRADECI", manages: true, reportsTo: "armaar.owner", startedDaysAgo: 2200, location: "Pogradec — office", workLocationType: "OFFICE" },
  { username: "kfp.pm", firstName: "Lorena", lastName: "Cani", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Project Manager · Pogradec Marina", company: "KF_POGRADECI", manages: true, reportsTo: "kfp.director", startedDaysAgo: 780, location: "Pogradec — office", workLocationType: "SITE" },
];

export const ARMAAR_PEOPLE: ArmaarPerson[] = [...GROUP_PEOPLE, ...COMPANY_PEOPLE];

/** `armaar.owner` → `user_armaar_owner`; `bci.sales-agent2` → `user_armaar_bci_sales_agent2`. */
export function userId(username: string): string {
  const base = username.replace(/^armaar\./, "").replace(/[.-]/g, "_");
  return `user_armaar_${base}`;
}

export const personOf = (username: string) => ARMAAR_PEOPLE.find((person) => person.username === username);

export function emailOf(username: string): string {
  return `${username.replace(/^armaar\./, "")}@armaar-demo.test`;
}

export function phoneOf(index: number): string {
  return `+355 69 000 ${String(1001 + index).padStart(4, "0")}`;
}
