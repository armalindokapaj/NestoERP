/**
 * KPI registry (PRD #4 §16).
 *
 * A KPI is a label, a value and a trend, each gated on the permission that
 * makes it meaningful. Desktop shows at most 4–6; mobile 2–4 (PRD #4 §16, §71).
 */
import type { ModuleKey } from "./modules";
import type { Permission } from "./permissions";

export type KpiDefinition = {
  key: string;
  module: ModuleKey;
  permission: Permission;
  label: string;
  /** lucide icon name. */
  icon: string;
  /** Where clicking the card leads (PRD #4 §21). */
  href?: string;
  /** Rendered as currency rather than a plain count. */
  currency?: boolean;
};

export const kpis: Record<string, KpiDefinition> = {
  activeProjects: {
    key: "activeProjects",
    module: "projects",
    permission: "project.view",
    label: "Active Projects",
    icon: "FolderKanban",
    href: "/projects?status=ACTIVE",
  },
  myProjectCount: {
    key: "myProjectCount",
    module: "projects",
    permission: "project.view",
    label: "My Projects",
    icon: "FolderKanban",
    href: "/projects?role=%40assigned",
  },
  projectsAtRisk: {
    key: "projectsAtRisk",
    module: "projects",
    permission: "project.view",
    label: "At Risk",
    icon: "TriangleAlert",
    href: "/projects",
  },
  openTaskCount: {
    key: "openTaskCount",
    module: "tasks",
    permission: "task.view",
    label: "Open Tasks",
    icon: "ListChecks",
    href: "/tasks",
  },
  overdueTaskCount: {
    key: "overdueTaskCount",
    module: "tasks",
    permission: "task.view",
    label: "Overdue Tasks",
    icon: "CalendarClock",
    // Drills into the section that shows exactly this number (PRD #11 §92).
    href: "/tasks/overdue",
  },
  approvalCount: {
    key: "approvalCount",
    module: "dashboard",
    permission: "dashboard.view",
    label: "Pending Approvals",
    icon: "Stamp",
  },
  clientCount: {
    key: "clientCount",
    module: "clients",
    permission: "client.view",
    label: "Clients",
    icon: "Users",
    href: "/clients/all",
  },
  documentCount: {
    key: "documentCount",
    module: "documents",
    permission: "document.view",
    label: "Documents",
    icon: "FileStack",
    href: "/documents",
  },
  receivables: {
    key: "receivables",
    module: "finance",
    permission: "finance.invoice.view",
    label: "Receivables",
    icon: "ReceiptText",
    href: "/finance/invoices",
    currency: true,
  },
  overdueValue: {
    key: "overdueValue",
    module: "finance",
    permission: "finance.invoice.view",
    label: "Overdue Value",
    icon: "TriangleAlert",
    href: "/finance/invoices?status=OVERDUE",
    currency: true,
  },
  invoicedValue: {
    key: "invoicedValue",
    module: "finance",
    permission: "finance.company_summary.view",
    label: "Invoiced Value",
    icon: "ChartPie",
    href: "/finance/reports",
    currency: true,
  },
  projectInvoiced: {
    key: "projectInvoiced",
    module: "finance",
    permission: "finance.project_budget.view",
    label: "Project Invoiced",
    icon: "Wallet",
    href: "/finance/project-budgets",
    currency: true,
  },
  headcount: {
    key: "headcount",
    module: "hr",
    permission: "hr.employee.view",
    label: "Employees",
    icon: "UsersRound",
    href: "/hr/employees",
  },
  pendingLeave: {
    key: "pendingLeave",
    module: "hr",
    permission: "hr.leave.view",
    label: "Pending Leave",
    icon: "Plane",
    href: "/hr/leave",
  },
  pipelineValue: {
    key: "pipelineValue",
    module: "sales",
    permission: "sales.opportunity.view",
    label: "Pipeline Value",
    icon: "TrendingUp",
    href: "/sales/pipeline",
    currency: true,
  },
  openOpportunityCount: {
    key: "openOpportunityCount",
    module: "sales",
    permission: "sales.opportunity.view",
    label: "Open Opportunities",
    icon: "Target",
    href: "/sales/opportunities",
  },
  activeContracts: {
    key: "activeContracts",
    module: "contracts",
    permission: "legal.contract.view",
    label: "Active Contracts",
    icon: "Scale",
    href: "/contracts/contracts?status=ACTIVE",
  },
  expiringContractCount: {
    key: "expiringContractCount",
    module: "contracts",
    permission: "legal.contract.view",
    label: "Expiring Soon",
    icon: "CalendarClock",
    href: "/contracts/contracts?status=EXPIRING",
  },
  openRequests: {
    key: "openRequests",
    module: "procurement",
    permission: "procurement.request.view",
    label: "Open Requests",
    icon: "ClipboardList",
    href: "/procurement/requests",
  },
  openOrders: {
    key: "openOrders",
    module: "procurement",
    permission: "procurement.order.view",
    label: "Open Orders",
    icon: "Truck",
    href: "/procurement/orders",
  },
  stockValue: {
    key: "stockValue",
    module: "inventory",
    permission: "inventory.item.view",
    label: "Stock Value",
    icon: "Boxes",
    href: "/inventory/items",
    currency: true,
  },
  lowStockCount: {
    key: "lowStockCount",
    module: "inventory",
    permission: "inventory.item.view",
    label: "Low Stock",
    icon: "PackageMinus",
    href: "/inventory/low-stock",
  },
  openQualityCount: {
    key: "openQualityCount",
    module: "qaqc",
    permission: "qaqc.inspection.view",
    label: "Open Quality Items",
    icon: "ClipboardCheck",
    href: "/qaqc/inspections",
  },
  openNcrCount: {
    key: "openNcrCount",
    module: "qaqc",
    permission: "qaqc.ncr.view",
    label: "Open NCRs",
    icon: "FileX",
    href: "/qaqc/ncrs",
  },
  openIncidentCount: {
    key: "openIncidentCount",
    module: "hse",
    permission: "hse.incident.view",
    label: "Open Incidents",
    icon: "TriangleAlert",
    href: "/hse/incidents",
  },
  openPermitCount: {
    key: "openPermitCount",
    module: "hse",
    permission: "hse.permit.view",
    label: "Active Permits",
    icon: "FileBadge",
    href: "/hse/permits",
  },
  openHazardCount: {
    key: "openHazardCount",
    module: "hse",
    permission: "hse.hazard.view",
    label: "Open Hazards",
    icon: "TriangleAlert",
    href: "/hse/hazards",
  },
  teamSize: {
    key: "teamSize",
    module: "team",
    permission: "team.view",
    label: "Team Members",
    icon: "UsersRound",
    href: "/team",
  },
  enabledModuleCount: {
    key: "enabledModuleCount",
    module: "company",
    permission: "company.view",
    label: "Enabled Modules",
    icon: "ToggleRight",
    href: "/company/modules",
  },
  openSupportCount: {
    key: "openSupportCount",
    module: "support",
    permission: "support.request.view",
    label: "Open Support",
    icon: "LifeBuoy",
    href: "/support/requests",
  },
};

export const kpiList: KpiDefinition[] = Object.values(kpis);
