/**
 * The NESTO module registry (spec §30, §31, §48).
 *
 * Every module page, sidebar entry and route permission is derived from this
 * file. Icons are stored as lucide icon *names* rather than components so that
 * this module stays edge-safe for middleware.
 */
import type { Permission } from "./permissions";

export const MODULE_KEYS = [
  "dashboard",
  "projects",
  "tasks",
  "clients",
  "documents",
  "finance",
  "hr",
  "sales",
  "contracts",
  "procurement",
  "inventory",
  "qaqc",
  "hse",
  "team",
  "company",
  "settings",
  "support",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Sidebar zones, in render order (spec §10). */
export const MODULE_ZONES = ["MAIN", "WORK", "DEPARTMENT", "COMPANY"] as const;
export type ModuleZone = (typeof MODULE_ZONES)[number];

export const zoneLabels: Record<ModuleZone, string | null> = {
  MAIN: null,
  WORK: "Work",
  DEPARTMENT: "Department",
  COMPANY: "Company",
};

export type ModuleTab = {
  slug: string;
  label: string;
};

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  href: string;
  /** lucide-react icon name, resolved by components/layout/nav-icon.tsx */
  icon: string;
  zone: ModuleZone;
  /** Shown under the module title on the module landing page. */
  description: string;
  tabs: ModuleTab[];
  /** Permission required to open any route under this module. */
  viewPermission: Permission;
  /** Permission required for /new and /edit routes under this module. */
  writePermission?: Permission;
};

export const modules: Record<ModuleKey, ModuleDefinition> = {
  dashboard: {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "LayoutDashboard",
    zone: "MAIN",
    description: "Your role overview across the company.",
    tabs: [],
    viewPermission: "dashboard.view",
  },
  projects: {
    key: "projects",
    label: "Projects",
    href: "/projects",
    icon: "FolderKanban",
    zone: "WORK",
    description: "Plan, track and deliver company projects.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "all", label: "All Projects" },
      { slug: "mine", label: "My Projects" },
      { slug: "archived", label: "Archived" },
    ],
    viewPermission: "project.view",
    writePermission: "project.create",
  },
  tasks: {
    key: "tasks",
    label: "Tasks",
    href: "/tasks",
    icon: "CircleCheckBig",
    zone: "WORK",
    description: "Work assigned across projects and departments.",
    tabs: [
      { slug: "mine", label: "My Tasks" },
      { slug: "all", label: "All Tasks" },
      { slug: "completed", label: "Completed" },
    ],
    viewPermission: "task.view",
    writePermission: "task.create",
  },
  clients: {
    key: "clients",
    label: "Clients",
    href: "/clients",
    icon: "Building2",
    zone: "WORK",
    description: "Companies and contacts NESTO works with.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "clients", label: "Clients" },
      { slug: "contacts", label: "Contacts" },
    ],
    viewPermission: "client.view",
    writePermission: "client.create",
  },
  documents: {
    key: "documents",
    label: "Documents",
    href: "/documents",
    icon: "FileText",
    zone: "WORK",
    description: "Company and project documentation.",
    tabs: [
      { slug: "all", label: "All Documents" },
      { slug: "recent", label: "Recent" },
      { slug: "shared", label: "Shared" },
    ],
    viewPermission: "document.view",
    writePermission: "document.create",
  },
  finance: {
    key: "finance",
    label: "Finance",
    href: "/finance",
    icon: "Wallet",
    zone: "DEPARTMENT",
    description: "Company revenue, costs and financial control.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "invoices", label: "Invoices" },
      { slug: "payments", label: "Payments" },
      { slug: "expenses", label: "Expenses" },
      { slug: "budgets", label: "Budgets" },
      { slug: "reports", label: "Reports" },
    ],
    viewPermission: "finance.view",
    writePermission: "finance.manage",
  },
  hr: {
    key: "hr",
    label: "HR",
    href: "/hr",
    icon: "Users",
    zone: "DEPARTMENT",
    description: "People operations, records and recruitment.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "employees", label: "Employees" },
      { slug: "attendance", label: "Attendance" },
      { slug: "leave", label: "Leave" },
      { slug: "recruitment", label: "Recruitment" },
      { slug: "performance", label: "Performance" },
    ],
    viewPermission: "hr.view",
    writePermission: "hr.manage",
  },
  sales: {
    key: "sales",
    label: "Sales",
    href: "/sales",
    icon: "TrendingUp",
    zone: "DEPARTMENT",
    description: "Pipeline, opportunities and commercial activity.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "pipeline", label: "Pipeline" },
      { slug: "opportunities", label: "Opportunities" },
      { slug: "proposals", label: "Proposals" },
      { slug: "activities", label: "Activities" },
    ],
    viewPermission: "sales.view",
    writePermission: "sales.manage",
  },
  contracts: {
    key: "contracts",
    label: "Contracts",
    href: "/contracts",
    icon: "Scale",
    zone: "DEPARTMENT",
    description: "Contracts, approvals and legal records.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "contracts", label: "Contracts" },
      { slug: "approvals", label: "Approvals" },
      { slug: "notices", label: "Notices" },
      { slug: "archive", label: "Archive" },
    ],
    viewPermission: "contract.view",
    writePermission: "contract.manage",
  },
  procurement: {
    key: "procurement",
    label: "Procurement",
    href: "/procurement",
    icon: "ShoppingCart",
    zone: "DEPARTMENT",
    description: "Manage company purchasing and supplier operations.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "requests", label: "Requests" },
      { slug: "rfqs", label: "RFQs" },
      { slug: "tenders", label: "Tenders" },
      { slug: "suppliers", label: "Suppliers" },
      { slug: "orders", label: "Purchase Orders" },
      { slug: "deliveries", label: "Deliveries" },
    ],
    viewPermission: "procurement.view",
    writePermission: "procurement.manage",
  },
  inventory: {
    key: "inventory",
    label: "Inventory",
    href: "/inventory",
    icon: "Package",
    zone: "DEPARTMENT",
    description: "Materials, stock levels and movements.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "items", label: "Items" },
      { slug: "stock", label: "Stock" },
      { slug: "movements", label: "Movements" },
      { slug: "requests", label: "Requests" },
      { slug: "locations", label: "Locations" },
    ],
    viewPermission: "inventory.view",
    writePermission: "inventory.manage",
  },
  qaqc: {
    key: "qaqc",
    label: "QA/QC",
    href: "/qaqc",
    icon: "ClipboardCheck",
    zone: "DEPARTMENT",
    description: "Inspections, non-conformances and quality control.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "inspections", label: "Inspections" },
      { slug: "ncrs", label: "NCRs" },
      { slug: "tests", label: "Tests" },
      { slug: "punch-lists", label: "Punch Lists" },
      { slug: "documents", label: "Documents" },
    ],
    viewPermission: "qaqc.view",
    writePermission: "qaqc.manage",
  },
  hse: {
    key: "hse",
    label: "HSE",
    href: "/hse",
    icon: "ShieldCheck",
    zone: "DEPARTMENT",
    description: "Health, safety and environment performance.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "incidents", label: "Incidents" },
      { slug: "inspections", label: "Inspections" },
      { slug: "permits", label: "Permits" },
      { slug: "actions", label: "Actions" },
      { slug: "documents", label: "Documents" },
    ],
    viewPermission: "hse.view",
    writePermission: "hse.manage",
  },
  team: {
    key: "team",
    label: "Team",
    href: "/team",
    icon: "UsersRound",
    zone: "COMPANY",
    description: "Everyone working inside your company workspace.",
    tabs: [
      { slug: "members", label: "Members" },
      { slug: "departments", label: "Departments" },
    ],
    viewPermission: "team.view",
    writePermission: "team.manage",
  },
  company: {
    key: "company",
    label: "Company",
    href: "/company",
    icon: "Landmark",
    zone: "COMPANY",
    description: "Company identity and organisation details.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "details", label: "Details" },
    ],
    viewPermission: "company.view",
    writePermission: "company.manage",
  },
  settings: {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: "Settings",
    zone: "COMPANY",
    description: "Your profile and company configuration.",
    tabs: [],
    viewPermission: "settings.view",
    writePermission: "settings.manage",
  },
  support: {
    key: "support",
    label: "Support",
    href: "/support",
    icon: "LifeBuoy",
    zone: "COMPANY",
    description: "Internal support requests and platform help.",
    tabs: [
      { slug: "overview", label: "Overview" },
      { slug: "requests", label: "Requests" },
      { slug: "knowledge", label: "Knowledge Base" },
    ],
    viewPermission: "support.view",
    writePermission: "support.manage",
  },
};

export const moduleList: ModuleDefinition[] = MODULE_KEYS.map((key) => modules[key]);

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * Company-level module activation (spec §48).
 * V0.1 keeps every module enabled; this becomes company-specific in a later
 * version, at which point it is read from the CompanyModule table instead.
 */
export const defaultCompanyModules: Record<ModuleKey, boolean> = {
  dashboard: true,
  projects: true,
  tasks: true,
  clients: true,
  documents: true,
  finance: true,
  hr: true,
  sales: true,
  contracts: true,
  procurement: true,
  inventory: true,
  qaqc: true,
  hse: true,
  team: true,
  company: true,
  settings: true,
  support: true,
};

/**
 * Whether a module is switched on for the current company.
 *
 * V0.1 answers from the static defaults above. When activation becomes
 * company-specific this reads the CompanyModule rows instead; every caller —
 * sidebar and route guard — already goes through here.
 */
export function isModuleEnabled(key: ModuleKey): boolean {
  return defaultCompanyModules[key] ?? false;
}

/** Resolves a pathname such as /projects/abc/edit to its owning module. */
export function moduleForPath(pathname: string): ModuleDefinition | null {
  const segment = pathname.split("/").filter(Boolean)[0];
  if (!segment) return null;
  return isModuleKey(segment) ? modules[segment] : null;
}
