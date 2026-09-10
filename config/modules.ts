/**
 * The NESTO module registry (PRD #7 §9, PRD #3 §44–§45, PRD #5 §51).
 *
 * Every sidebar entry, route guard, module header and set of module tabs is
 * derived from this file. There is one registry, consumed identically by the
 * desktop sidebar, the mobile drawer, middleware and the module shell
 * (PRD #3 §99).
 *
 * Icons are stored as lucide icon *names* rather than components so the file
 * stays edge-safe and serialisable across the server/client boundary.
 */
import type { AccessLevel } from "./access";
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

/** Sidebar groups, in render order (PRD #3 §8). */
export const MODULE_GROUPS = ["primary", "work", "department", "company"] as const;
export type ModuleGroup = (typeof MODULE_GROUPS)[number];

/** `null` means the group renders without a label (PRD #3 §84). */
export const groupLabels: Record<ModuleGroup, string | null> = {
  primary: null,
  work: "Work",
  department: "Department",
  company: "Company",
};

/**
 * A module section — the second level of NESTO navigation (PRD #3 §31).
 *
 * Sections are routes, not client state (PRD #7 §14): `/projects/all` rather
 * than `/projects?tab=all`, so refresh, deep links and back/forward all work.
 * The section whose `key` matches `defaultSection` renders at the module root.
 */
export type ModuleSectionConfig = {
  key: string;
  label: string;
  /** Extra permission beyond the module's own view permission. */
  permission?: Permission;
  /** Minimum module access level required for the section to render. */
  accessLevel?: AccessLevel;
};

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  description: string;
  route: string;
  /** lucide-react icon name, resolved by components/layout/nav-icon.tsx */
  icon: string;
  group: ModuleGroup;
  /** Permission required to open any route under this module. */
  permission: Permission;
  /** Permission required by /new and /edit routes under this module. */
  writePermission?: Permission;
  sections: ModuleSectionConfig[];
  /** Section rendered at the module root. */
  defaultSection?: string;
};

export const modules: Record<ModuleKey, ModuleDefinition> = {
  dashboard: {
    key: "dashboard",
    label: "Dashboard",
    description: "Your role overview across the company.",
    route: "/dashboard",
    icon: "LayoutDashboard",
    group: "primary",
    permission: "dashboard.view",
    sections: [],
  },
  projects: {
    key: "projects",
    label: "Projects",
    description: "Manage company projects and project activity.",
    route: "/projects",
    icon: "FolderKanban",
    group: "work",
    permission: "project.view",
    writePermission: "project.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "all", label: "All Projects" },
      { key: "my-projects", label: "My Projects" },
      { key: "archived", label: "Archived" },
    ],
  },
  tasks: {
    key: "tasks",
    label: "Tasks",
    description: "Work assigned across projects and departments.",
    route: "/tasks",
    icon: "SquareCheckBig",
    group: "work",
    permission: "task.view",
    writePermission: "task.create",
    defaultSection: "my-tasks",
    sections: [
      { key: "my-tasks", label: "My Tasks" },
      { key: "all", label: "All Tasks" },
      { key: "completed", label: "Completed" },
      { key: "archived", label: "Archived" },
    ],
  },
  clients: {
    key: "clients",
    label: "Clients",
    description: "Companies and people your company works with.",
    route: "/clients",
    icon: "Users",
    group: "work",
    permission: "client.view",
    writePermission: "client.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "all", label: "Clients" },
      { key: "contacts", label: "Contacts", permission: "contact.view" },
      { key: "archived", label: "Archived" },
    ],
  },
  documents: {
    key: "documents",
    label: "Documents",
    description: "Company, project and client documentation.",
    route: "/documents",
    icon: "Files",
    group: "work",
    permission: "document.view",
    writePermission: "document.create",
    defaultSection: "all",
    sections: [
      { key: "all", label: "All Documents" },
      { key: "recent", label: "Recent" },
      { key: "archived", label: "Archived" },
    ],
  },
  finance: {
    key: "finance",
    label: "Finance",
    description: "Company revenue, costs and financial control.",
    route: "/finance",
    icon: "ChartNoAxesCombined",
    group: "department",
    permission: "finance.view",
    writePermission: "finance.invoice.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "invoices", label: "Invoices", permission: "finance.invoice.view" },
      { key: "payments", label: "Payments", permission: "finance.payment.view" },
      { key: "budgets", label: "Budgets", permission: "finance.budget.view" },
      {
        key: "project-budgets",
        label: "Project Budgets",
        permission: "finance.project_budget.view",
      },
      { key: "reports", label: "Reports", permission: "finance.company_summary.view" },
    ],
  },
  hr: {
    key: "hr",
    label: "HR",
    description: "People operations, records and recruitment.",
    route: "/hr",
    icon: "UserRoundCog",
    group: "department",
    permission: "hr.view",
    writePermission: "hr.leave.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "employees", label: "Employees", permission: "hr.employee.view" },
      { key: "leave", label: "Leave", permission: "hr.leave.view" },
      { key: "my-profile", label: "My Profile", permission: "hr.profile.view" },
    ],
  },
  sales: {
    key: "sales",
    label: "Sales",
    description: "Pipeline, opportunities and commercial activity.",
    route: "/sales",
    icon: "Handshake",
    group: "department",
    permission: "sales.view",
    writePermission: "sales.opportunity.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "pipeline", label: "Pipeline", permission: "sales.opportunity.view" },
      { key: "opportunities", label: "Opportunities", permission: "sales.opportunity.view" },
    ],
  },
  contracts: {
    key: "contracts",
    label: "Legal",
    description: "Contracts, approvals and legal records.",
    route: "/contracts",
    icon: "Scale",
    group: "department",
    permission: "legal.view",
    writePermission: "legal.contract.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "contracts", label: "Contracts", permission: "legal.contract.view" },
      { key: "approvals", label: "Approvals", permission: "legal.contract.approve" },
      { key: "archived", label: "Archive", permission: "legal.contract.view" },
    ],
  },
  procurement: {
    key: "procurement",
    label: "Procurement",
    description: "Purchasing, suppliers and order management.",
    route: "/procurement",
    icon: "ShoppingCart",
    group: "department",
    permission: "procurement.view",
    writePermission: "procurement.request.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "requests", label: "Requests", permission: "procurement.request.view" },
      { key: "orders", label: "Purchase Orders", permission: "procurement.order.view" },
      {
        key: "approvals",
        label: "Approvals",
        permission: "procurement.request.approve",
      },
    ],
  },
  inventory: {
    key: "inventory",
    label: "Inventory",
    description: "Materials, stock levels and movements.",
    route: "/inventory",
    icon: "Package",
    group: "department",
    permission: "inventory.view",
    writePermission: "inventory.item.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "items", label: "Items", permission: "inventory.item.view" },
      { key: "movements", label: "Movements", permission: "inventory.movement.view" },
      { key: "low-stock", label: "Low Stock", permission: "inventory.item.view" },
    ],
  },
  qaqc: {
    key: "qaqc",
    label: "QA/QC",
    description: "Inspections, non-conformances and quality control.",
    route: "/qaqc",
    icon: "ShieldCheck",
    group: "department",
    permission: "qaqc.view",
    writePermission: "qaqc.record.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "inspections", label: "Inspections", permission: "qaqc.record.view" },
      { key: "ncrs", label: "NCRs", permission: "qaqc.record.view" },
      { key: "punch-lists", label: "Punch Lists", permission: "qaqc.record.view" },
      { key: "tests", label: "Tests", permission: "qaqc.record.view" },
    ],
  },
  hse: {
    key: "hse",
    label: "HSE",
    description: "Health, safety and environment performance.",
    route: "/hse",
    icon: "HardHat",
    group: "department",
    permission: "hse.view",
    writePermission: "hse.record.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "incidents", label: "Incidents", permission: "hse.record.view" },
      { key: "inspections", label: "Inspections", permission: "hse.record.view" },
      { key: "permits", label: "Permits", permission: "hse.record.view" },
      { key: "actions", label: "Actions", permission: "hse.record.view" },
    ],
  },
  team: {
    key: "team",
    label: "Team",
    description: "Everyone working inside your company workspace.",
    route: "/team",
    icon: "UsersRound",
    group: "company",
    permission: "team.view",
    writePermission: "team.manage",
    defaultSection: "people",
    sections: [
      { key: "people", label: "People" },
      { key: "departments", label: "Departments" },
    ],
  },
  company: {
    key: "company",
    label: "Company",
    description: "Company identity and organisation details.",
    route: "/company",
    icon: "Building2",
    group: "company",
    permission: "company.view",
    writePermission: "company.manage",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "details", label: "Company Details" },
      { key: "modules", label: "Modules", permission: "company.manage" },
    ],
  },
  settings: {
    key: "settings",
    label: "Settings",
    description: "Your profile and company configuration.",
    route: "/settings",
    icon: "Settings",
    group: "company",
    permission: "settings.view",
    writePermission: "settings.manage",
    sections: [],
  },
  support: {
    key: "support",
    label: "Support",
    description: "Internal support requests and platform help.",
    route: "/support",
    icon: "CircleHelp",
    group: "company",
    permission: "support.view",
    writePermission: "support.request.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "requests", label: "Requests", permission: "support.request.view" },
      { key: "help", label: "Help" },
    ],
  },
};

export const moduleList: ModuleDefinition[] = MODULE_KEYS.map((key) => modules[key]);

/** Modules that appear in the sidebar. Settings/Dashboard included; all listed. */
export const navigableModules: ModuleDefinition[] = moduleList;

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** Resolves a pathname such as /projects/abc/edit to its owning module. */
export function moduleForPath(pathname: string): ModuleDefinition | null {
  const segment = pathname.split("/").filter(Boolean)[0];
  if (!segment) return null;
  return isModuleKey(segment) ? modules[segment] : null;
}

/** The route for a module section: `/projects/all`. */
export function sectionRoute(moduleKey: ModuleKey, sectionKey: string): string {
  const definition = modules[moduleKey];
  if (sectionKey === definition.defaultSection) return definition.route;
  return `${definition.route}/${sectionKey}`;
}

export function findSection(
  moduleKey: ModuleKey,
  sectionKey: string,
): ModuleSectionConfig | undefined {
  return modules[moduleKey].sections.find((section) => section.key === sectionKey);
}
