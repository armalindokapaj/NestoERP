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
  "approvals",
  "announcements",
  "projects",
  "tasks",
  "meetings",
  "timesheets",
  "dailyLogs",
  "contractors",
  "engineering",
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
  "people",
  "team",
  "organization",
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
export const CORE_MODULE_KEYS = ["dashboard", "calendar", "approvals", "announcements", "people", "team", "organization", "company", "settings", "support"] as const satisfies readonly ModuleKey[];

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
 * Sections are routes, not client state (PRD #7 §14): `/projects/archived`
 * rather than `/projects?tab=archived`, so refresh, deep links and back/forward all work.
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
  /**
   * One place for every decision (PRD #41 §6, §7). Its tabs are URL state on
   * the one route rather than sections, so a filtered queue and an open review
   * are a link somebody can share (§197).
   */
  approvals: {
    key: "approvals",
    label: "Approvals",
    description: "Every decision waiting on you, from every module, in one place.",
    route: "/approvals",
    icon: "Stamp",
    group: "primary",
    permission: "approvals.view",
    sections: [],
  },
  /**
   * Intentional internal communication (PRD #45 §6, §58). Its tabs — For Me,
   * Pinned, Unread, To Acknowledge, History and Manage — are URL state on the
   * one route, like Approvals.
   */
  announcements: {
    key: "announcements",
    label: "Announcements",
    description: "Company, department and project notices, with acknowledgment where it matters.",
    route: "/announcements",
    icon: "Megaphone",
    group: "primary",
    permission: "announcement.view",
    writePermission: "announcement.create",
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
    defaultSection: "portfolio",
    sections: [
      // Every project the person may open, across their companies (E-05A §4).
      // It replaced Overview, All Projects and My Projects: one collection with
      // filters rather than three lists.
      { key: "portfolio", label: "Projects" },
      // Milestones across projects: delays, variance and the portfolio (PRD #44 §171-§175).
      { key: "milestones", label: "Milestones", permission: "project_planning.view" },
      { key: "archived", label: "Archived" },
      // The company's own list of project types (E-05A §62).
      { key: "types", label: "Project types", permission: "project.type.manage" },
      // The company's own list of unit types (E-05B §20, §21).
      { key: "unit-types", label: "Unit types", permission: "project.unit_type.manage" },
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
  /** Weekly timesheets and work logs (PRD #42 §5-§7). */
  timesheets: {
    key: "timesheets",
    label: "Timesheets",
    description: "How working time is spent across projects, tasks and internal work.",
    route: "/timesheets",
    icon: "Clock",
    group: "work",
    permission: "timesheet.view_own",
    writePermission: "timesheet.edit_own",
    defaultSection: "me",
    sections: [
      { key: "me", label: "My Timesheet" },
      { key: "team", label: "Team", permission: "timesheet.team.view" },
      { key: "projects", label: "Projects", permission: "timesheet.project.view" },
      { key: "settings", label: "Settings", permission: "timesheet.settings.manage" },
    ],
  },
  /** The project's daily site record (PRD #43 §5, §6). Also a tab on every project. */
  dailyLogs: {
    key: "dailyLogs",
    label: "Daily Logs",
    description: "What happened on site each day: people, work, deliveries, delays and evidence.",
    route: "/daily-logs",
    icon: "NotebookPen",
    group: "work",
    permission: "daily_log.view",
    writePermission: "daily_log.create",
    defaultSection: "all",
    sections: [
      { key: "all", label: "All Logs" },
      { key: "review", label: "To Review", permission: "daily_log.review" },
      { key: "reports", label: "Reports", permission: "daily_log.review" },
      { key: "settings", label: "Settings", permission: "daily_log.settings.manage" },
    ],
  },
  /** External contractor organisations, their projects, work packages and compliance (PRD #46 §7, §8). */
  contractors: {
    key: "contractors",
    label: "Contractors",
    description: "The organisations building with you: assignments, work packages, compliance and contracts.",
    route: "/contractors",
    icon: "HardHat",
    group: "work",
    permission: "contractor.view",
    writePermission: "contractor.create",
    defaultSection: "all",
    sections: [
      { key: "all", label: "Contractors" },
      { key: "work-packages", label: "Work Packages", permission: "work_package.view" },
      { key: "compliance", label: "Compliance", permission: "contractor_compliance.view" },
    ],
  },
  /** Drawings, engineering documents, RFIs, submittals and transmittals across projects (PRD #46 §10, §278). */
  engineering: {
    key: "engineering",
    label: "Engineering",
    description: "Drawings, revisions, RFIs, submittals and transmittals — the technical record of every project.",
    route: "/engineering",
    icon: "DraftingCompass",
    group: "work",
    permission: "rfi.view",
    writePermission: "rfi.create",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "My Work" },
      { key: "rfis", label: "RFIs" },
      { key: "submittals", label: "Submittals", permission: "submittal.view" },
      { key: "drawings", label: "Drawings", permission: "engineering_document.view" },
      { key: "transmittals", label: "Transmittals", permission: "transmittal.view" },
      { key: "reports", label: "Reports", permission: "engineering_document.view" },
      { key: "settings", label: "Settings", permission: "engineering.settings.manage" },
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
      // The person before the login: candidates, hires and their account requests (E-06 §62).
      { key: "recruitment", label: "Recruitment", permission: "candidate.view" },
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
      // Sales asking for a unit's contract (E-05F §12): Legal's queue.
      { key: "requests", label: "Unit requests", permission: "project.unit.contract.create" },
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
  /**
   * The group's people as colleagues know them (E-01, ADR 0002): who they are,
   * where they work, how to reach them and what they work on. Every internal
   * role opens it; nothing HR keeps private is in it.
   */
  people: {
    key: "people",
    label: "People",
    description: "Everyone in your group: who they are, where they work and how to reach them.",
    route: "/people",
    icon: "IdCard",
    group: "company",
    permission: "people.directory.view",
    sections: [],
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
  /**
   * The parent group above the company (E-06 §127): its companies, group
   * departments, people and the account requests that connect HR to Group IT.
   * Part of the product rather than switchable — a company cannot opt out of
   * belonging to its group.
   */
  organization: {
    key: "organization",
    label: "Organization",
    description: "Your parent group, its companies, departments and people.",
    route: "/organization",
    icon: "Network",
    group: "company",
    permission: "organization.view",
    writePermission: "organization.department.manage",
    defaultSection: "overview",
    sections: [
      { key: "overview", label: "Overview" },
      // The group's companies and the departments each runs (E-13 §7, §39).
      { key: "companies", label: "Companies", permission: "organization.department.view" },
      // Group departments, their company branches and the people and projects in them (E-06 §65-§68, §127; E-13).
      { key: "departments", label: "Departments", permission: "organization.department.view" },
      // Account requests between HR and Group IT (E-06 §61, §64, §127).
      { key: "provisioning", label: "User provisioning", permission: "organization.provisioning_request.view" },
      // Role catalog, delegated access and the access check (E-06 §18, §73, §127). A group
      // head reaches only the delegated access of their own function.
      { key: "access", label: "Access & roles", permission: "organization.access.view", selfPermission: "department.team.access.delegate", selfLabel: "Delegated access" },
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

/** The route for a module section: `/projects/archived`. */
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
