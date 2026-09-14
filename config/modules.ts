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
  "calendar",
  "projects",
  "tasks",
  "meetings",
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

/**
 * Modules that are part of the product rather than switchable: a company cannot
 * turn them off, and every company has them from the moment it exists — the
 * access sync creates the switch for companies that predate a new one.
 */
export const CORE_MODULE_KEYS = ["dashboard", "calendar", "team", "company", "settings", "support"] as const satisfies readonly ModuleKey[];

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
  /**
   * A second door into the section, for somebody who reaches only their own
   * records (PRD #16 §11). Holding this without `permission` still renders the
   * tab — under `selfLabel`, because "My leave" and "Leave" are not the same
   * promise.
   */
  selfPermission?: Permission;
  selfLabel?: string;
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
  calendar: {
    key: "calendar",
    label: "Calendar",
    description: "Deadlines, events and schedules across the company.",
    route: "/calendar",
    icon: "CalendarDays",
    group: "primary",
    permission: "calendar.view",
    writePermission: "calendar.event.create",
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
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "my-tasks", label: "My Tasks" },
      { key: "all", label: "All Tasks" },
      { key: "overdue", label: "Overdue" },
      { key: "completed", label: "Completed" },
      { key: "archived", label: "Archived" },
    ],
  },
  meetings: {
    key: "meetings",
    label: "Meetings",
    description: "Agendas, minutes, decisions and the actions that follow.",
    route: "/meetings",
    icon: "Presentation",
    group: "work",
    permission: "meeting.view",
    writePermission: "meeting.create",
    defaultSection: "upcoming",
    sections: [
      { key: "upcoming", label: "Upcoming" },
      { key: "mine", label: "My Meetings" },
      { key: "past", label: "Past" },
      { key: "actions", label: "Actions" },
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
      { key: "all", label: "All Clients" },
      { key: "active", label: "Active" },
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
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
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
    // Sections adapt to the reader: an Architect with only the project-budget
    // grant sees Overview alone rather than five tabs that refuse them
    // (PRD #15 §11).
    sections: [
      { key: "overview", label: "Overview" },
      { key: "invoices", label: "Invoices", permission: "finance.invoice.view" },
      { key: "payments", label: "Payments", permission: "finance.payment.view" },
      { key: "expenses", label: "Expenses", permission: "finance.expense.view" },
      { key: "budgets", label: "Budgets", permission: "finance.budget.view" },
      { key: "commitments", label: "Commitments", permission: "finance.commitment.view" },
      { key: "approvals", label: "Approvals", permission: "finance.approval.view" },
      { key: "reports", label: "Reports", permission: "finance.report.view" },
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
    // Sections adapt to the reader (PRD #16 §10, §11). An HR manager sees the
    // whole module; somebody with self-service alone sees their own employment,
    // leave, attendance and documents, named as theirs.
    sections: [
      { key: "overview", label: "Overview" },
      {
        key: "employees",
        label: "Employees",
        permission: "hr.employee.view",
        selfPermission: "hr.self.employment",
        selfLabel: "My employment",
      },
      {
        key: "leave",
        label: "Leave",
        permission: "hr.leave.view",
        selfPermission: "hr.self.leave",
        selfLabel: "My leave",
      },
      {
        key: "attendance",
        label: "Attendance",
        permission: "hr.attendance.view",
        selfPermission: "hr.self.attendance",
        selfLabel: "My attendance",
      },
      { key: "onboarding", label: "Onboarding", permission: "hr.onboarding.view" },
      { key: "offboarding", label: "Offboarding", permission: "hr.offboarding.view" },
      {
        key: "documents",
        label: "Documents",
        permission: "hr.document.view",
        selfPermission: "hr.self.documents",
        selfLabel: "My documents",
      },
      { key: "reports", label: "Reports", permission: "hr.report.view" },
    ],
  },
  /**
   * Sales (PRD #17 §12, §13).
   *
   * Seven sections, each behind its own grant, so the same route serves the
   * sales desk, the CEO approving a proposal, Finance reading a won value and
   * the project manager who received the work — and each of them sees only the
   * tabs their access actually reaches (PRD #17 §13).
   */
  sales: {
    key: "sales",
    label: "Sales",
    description: "Leads, pipeline, proposals and commercial activity.",
    route: "/sales",
    icon: "Handshake",
    group: "department",
    permission: "sales.view",
    writePermission: "sales.opportunity.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "leads", label: "Leads", permission: "sales.lead.view" },
      { key: "opportunities", label: "Opportunities", permission: "sales.opportunity.view" },
      { key: "pipeline", label: "Pipeline", permission: "sales.pipeline.view" },
      { key: "proposals", label: "Proposals", permission: "sales.proposal.view" },
      { key: "tasks", label: "Tasks", permission: "sales.task.view" },
      { key: "reports", label: "Reports", permission: "sales.report.view" },
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
      { key: "all", label: "All contracts", permission: "legal.contract.view" },
      { key: "drafts", label: "Drafts", permission: "legal.contract.update" },
      { key: "review", label: "Review", permission: "legal.contract.view" },
      { key: "active", label: "Active", permission: "legal.contract.view" },
      { key: "expiring", label: "Expiring", permission: "legal.contract.view" },
      { key: "approvals", label: "Approvals", permission: "legal.approval.view" },
      { key: "reports", label: "Reports", permission: "legal.report.view" },
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
      { key: "rfqs", label: "Enquiries", permission: "procurement.rfq.view" },
      { key: "orders", label: "Orders", permission: "procurement.order.view" },
      { key: "suppliers", label: "Suppliers", permission: "procurement.supplier.view" },
      { key: "approvals", label: "Approvals", permission: "procurement.approval.view" },
      { key: "reports", label: "Reports", permission: "procurement.report.view" },
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
      { key: "warehouses", label: "Warehouses", permission: "inventory.warehouse.view" },
      { key: "receipts", label: "Receipts", permission: "inventory.receipt.view" },
      { key: "issues", label: "Issues", permission: "inventory.issue.view" },
      { key: "returns", label: "Returns", permission: "inventory.return.view" },
      { key: "transfers", label: "Transfers", permission: "inventory.transfer.view" },
      { key: "adjustments", label: "Adjustments", permission: "inventory.adjustment.view" },
      { key: "reservations", label: "Reservations", permission: "inventory.reservation.view" },
      { key: "movements", label: "Movements", permission: "inventory.movement.view" },
      { key: "low-stock", label: "Low stock", permission: "inventory.low_stock.view" },
      { key: "reports", label: "Reports", permission: "inventory.report.view" },
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
    writePermission: "qaqc.inspection.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "requests", label: "Requests", permission: "qaqc.request.view" },
      { key: "inspections", label: "Inspections", permission: "qaqc.inspection.view" },
      { key: "templates", label: "Templates", permission: "qaqc.template.view" },
      { key: "materials", label: "Materials", permission: "qaqc.material.view" },
      { key: "work", label: "Work", permission: "qaqc.inspection.view" },
      { key: "defects", label: "Defects", permission: "qaqc.defect.view" },
      { key: "ncrs", label: "NCRs", permission: "qaqc.ncr.view" },
      {
        key: "corrective-actions",
        label: "Corrective actions",
        permission: "qaqc.corrective_action.view",
      },
      { key: "reinspections", label: "Reinspections", permission: "qaqc.reinspection.view" },
      { key: "approvals", label: "Approvals", permission: "qaqc.approval.view" },
      { key: "reports", label: "Reports", permission: "qaqc.report.view" },
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
    writePermission: "hse.hazard.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "inspections", label: "Inspections", permission: "hse.inspection.view" },
      { key: "templates", label: "Templates", permission: "hse.template.view" },
      { key: "hazards", label: "Hazards", permission: "hse.hazard.view" },
      { key: "incidents", label: "Incidents", permission: "hse.incident.view" },
      { key: "risk-assessments", label: "Risk assessments", permission: "hse.risk.view" },
      { key: "actions", label: "Actions", permission: "hse.action.view" },
      { key: "toolbox-talks", label: "Toolbox talks", permission: "hse.toolbox.view" },
      { key: "permits", label: "Permits", permission: "hse.permit.view" },
      { key: "ppe", label: "PPE", permission: "hse.ppe.view" },
      { key: "environment", label: "Environment", permission: "hse.environment.view" },
      { key: "stop-work", label: "Stop work", permission: "hse.stop_work.view" },
      { key: "approvals", label: "Approvals", permission: "hse.approval.view" },
      { key: "reports", label: "Reports", permission: "hse.report.view" },
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
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "people", label: "People" },
      { key: "departments", label: "Departments", permission: "team.department.view" },
      { key: "invitations", label: "Invitations", permission: "team.invitation.view" },
      { key: "inactive", label: "Inactive", permission: "team.member.view" },
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
