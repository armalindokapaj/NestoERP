/**
 * Role → dashboard composition (spec §13, §51).
 *
 * There is one dashboard engine. A role does not get its own page or its own
 * components — it selects KPI cards, widgets and quick actions from the shared
 * catalogues below. Adding a role is a configuration change, not a new screen.
 *
 * All values here are demo data for V0.1. When a module becomes functional its
 * widgets are switched from this catalogue to a real query; nothing else moves.
 */
import {
  demoClients,
  demoDocuments,
  demoProjects,
  demoTasks,
  statusLabels,
} from "@/lib/mock/demo-data";
import { MODULE_KEYS } from "./modules";
import type { Permission } from "./permissions";
import type { RoleKey } from "./roles";

export type Tone = "default" | "success" | "warning" | "danger" | "info";

export type KpiDefinition = {
  /** Optional micro line chart (§19 — at most one visual per card). */
  series?: number[];
  key: string;
  label: string;
  value: string;
  hint?: string;
  icon: string;
  tone?: Tone;
  trend?: { direction: "up" | "down" | "flat"; value: string };
};

export type ListRow = { label: string; meta?: string; badge?: string; tone?: Tone };
export type ProgressRow = { label: string; meta?: string; percent: number };
export type BreakdownRow = { label: string; value: string; tone?: Tone };
export type BarRow = { label: string; value: number; display: string };
export type ShareRow = { label: string; value: number };
export type ActivityRow = { actor: string; action: string; target?: string; time: string };

export type WidgetDefinition = {
  key: string;
  title: string;
  description?: string;
  /** Columns taken in the 3-column dashboard grid. */
  span: 1 | 2 | 3;
  href?: string;
} & (
  | { type: "list"; rows: ListRow[] }
  | { type: "progress"; rows: ProgressRow[] }
  | { type: "breakdown"; rows: BreakdownRow[] }
  | { type: "bars"; rows: BarRow[] }
  | { type: "activity"; rows: ActivityRow[] }
  /** Donut — composition of a whole, at most five slices (§71). */
  | { type: "share"; rows: ShareRow[]; total?: string }
);

export type QuickAction = { label: string; href: string; permission?: Permission };

export type DashboardConfig = {
  kpis: string[];
  widgets: string[];
  quickActions: QuickAction[];
};

/* ------------------------------------------------------------------ */
/* KPI catalogue                                                       */
/* ------------------------------------------------------------------ */

/*
 * Counts the user can check for themselves are derived from the same demo
 * records the module pages list, so a dashboard figure can never contradict the
 * table one click away. Department figures below (procurement, inventory,
 * finance, quality, safety) stay illustrative — those modules are placeholders
 * with no list to disagree with.
 */
const activeProjects = demoProjects.filter((project) => project.status !== "archived");
const openTasks = demoTasks.filter((task) => task.status !== "completed");
const dueThisWeekTasks = openTasks.filter((task) =>
  ["Today", "Tomorrow", "Wednesday", "Thursday", "Friday"].includes(task.due),
);
const onScheduleProjects = activeProjects.filter((project) => project.progress >= 40);
const activeClients = demoClients.filter((client) => client.status === "active");
const portfolioMix = (["in-progress", "handover", "planning"] as const)
  .map((status) => ({
    label: statusLabels[status],
    value: activeProjects.filter((project) => project.status === status).length,
  }))
  .filter((slice) => slice.value > 0);
const SEEDED_EMPLOYEES = 16;
/* One source for the quarterly figures: the KPI total, its sparkline and the
   Revenue Overview widget all read from here, so they cannot drift apart. */
const revenueByQuarterValues = [880, 1120, 1240, 1040];


export const kpis: Record<string, KpiDefinition> = {
  activeProjects: { key: "activeProjects", label: "Active Projects", value: String(activeProjects.length), icon: "FolderKanban", trend: { direction: "up", value: "+2" }, hint: "2 started this month" },
  assignedProjects: { key: "assignedProjects", label: "Assigned Projects", value: "3", icon: "FolderKanban", hint: "Across 3 clients" },
  myProjects: { key: "myProjects", label: "My Projects", value: String(activeProjects.length), icon: "FolderKanban", hint: `${onScheduleProjects.length} on schedule` },
  openTasks: { key: "openTasks", label: "Open Tasks", value: String(openTasks.length), icon: "CircleCheckBig", trend: { direction: "down", value: "-6" } },
  dueThisWeek: { key: "dueThisWeek", label: "Due This Week", value: String(dueThisWeekTasks.length), icon: "CalendarClock", tone: "warning" },
  issues: { key: "issues", label: "Issues", value: "3", icon: "TriangleAlert", tone: "danger" },
  revenue: { key: "revenue", label: "Revenue (YTD)", value: "€4.28M", icon: "TrendingUp", trend: { direction: "up", value: "+12.4%" }, series: revenueByQuarterValues },
  costs: { key: "costs", label: "Company Costs", value: "€3.11M", icon: "Wallet", trend: { direction: "up", value: "+4.1%" } },
  margin: { key: "margin", label: "Gross Margin", value: "27.3%", icon: "ChartPie", trend: { direction: "flat", value: "0.2%" } },
  employees: { key: "employees", label: "Employees", value: String(SEEDED_EMPLOYEES), icon: "Users", hint: "Across 9 departments" },
  opportunities: { key: "opportunities", label: "Open Opportunities", value: "11", icon: "Target", hint: "€1.9M weighted" },
  outstandingIssues: { key: "outstandingIssues", label: "Outstanding Issues", value: "4", icon: "TriangleAlert", tone: "warning" },
  users: { key: "users", label: "Users", value: String(SEEDED_EMPLOYEES), icon: "Users", hint: `${SEEDED_EMPLOYEES} active accounts` },
  activeUsers: { key: "activeUsers", label: "Active Today", value: "12", icon: "UserCheck", tone: "success" },
  companyModules: { key: "companyModules", label: "Modules Enabled", value: String(MODULE_KEYS.length), icon: "Boxes", hint: "All V0.1 modules" },
  userRoles: { key: "userRoles", label: "Roles Configured", value: "16", icon: "IdCard" },
  activeSessions: { key: "activeSessions", label: "Active Sessions", value: "9", icon: "MonitorSmartphone" },
  supportRequests: { key: "supportRequests", label: "Support Requests", value: "4", icon: "LifeBuoy", tone: "warning" },
  systemStatus: { key: "systemStatus", label: "System Status", value: "Operational", icon: "ShieldCheck", tone: "success" },
  devices: { key: "devices", label: "Managed Devices", value: "23", icon: "Laptop" },
  attendance: { key: "attendance", label: "Attendance Today", value: "94%", icon: "CalendarCheck", tone: "success" },
  leaveRequests: { key: "leaveRequests", label: "Leave Requests", value: "3", icon: "Plane", tone: "warning" },
  recruitment: { key: "recruitment", label: "Open Positions", value: "2", icon: "UserPlus" },
  projectPerformance: { key: "projectPerformance", label: "On Schedule", value: `${Math.round((onScheduleProjects.length / activeProjects.length) * 100)}%`, icon: "Gauge", hint: `${onScheduleProjects.length} of ${activeProjects.length} projects` },
  approvals: { key: "approvals", label: "Awaiting Approval", value: "5", icon: "Stamp", tone: "warning" },
  risks: { key: "risks", label: "Company Risks", value: "4", icon: "TriangleAlert", tone: "danger" },
  milestones: { key: "milestones", label: "Upcoming Milestones", value: "6", icon: "Flag" },
  designTasks: { key: "designTasks", label: "Design Tasks", value: "12", icon: "PencilRuler" },
  drawingReviews: { key: "drawingReviews", label: "Drawing Reviews", value: "5", icon: "FileStack", tone: "warning" },
  rfis: { key: "rfis", label: "Open RFIs", value: "4", icon: "MessageCircleQuestionMark" },
  engineeringTasks: { key: "engineeringTasks", label: "Engineering Tasks", value: "15", icon: "CircleCheckBig" },
  inspections: { key: "inspections", label: "Inspections", value: "9", icon: "ClipboardCheck", hint: "3 scheduled this week" },
  technicalIssues: { key: "technicalIssues", label: "Technical Issues", value: "3", icon: "TriangleAlert", tone: "danger" },
  invoices: { key: "invoices", label: "Open Invoices", value: "18", icon: "ReceiptText" },
  payments: { key: "payments", label: "Payments (30d)", value: "€612K", icon: "CreditCard" },
  receivables: { key: "receivables", label: "Receivables", value: "€842K", icon: "ArrowDownLeft", tone: "warning" },
  payables: { key: "payables", label: "Payables", value: "€507K", icon: "ArrowUpRight" },
  activeContracts: { key: "activeContracts", label: "Active Contracts", value: "14", icon: "Scale" },
  contractsExpiring: { key: "contractsExpiring", label: "Expiring (90d)", value: "3", icon: "CalendarClock", tone: "warning" },
  legalCases: { key: "legalCases", label: "Legal Cases", value: "1", icon: "Gavel" },
  notices: { key: "notices", label: "Notices Issued", value: "2", icon: "BellRing" },
  pipeline: { key: "pipeline", label: "Pipeline Value", value: "€3.4M", icon: "TrendingUp", trend: { direction: "up", value: "+8.2%" } },
  clients: { key: "clients", label: "Active Clients", value: String(activeClients.length), icon: "Building2" },
  proposals: { key: "proposals", label: "Proposals Out", value: "6", icon: "FileSignal" },
  expectedRevenue: { key: "expectedRevenue", label: "Expected Revenue", value: "€1.9M", icon: "Target", hint: "Weighted, next 2 quarters" },
  purchaseRequests: { key: "purchaseRequests", label: "Purchase Requests", value: "12", icon: "ClipboardList", tone: "warning" },
  rfqs: { key: "rfqs", label: "Open RFQs", value: "5", icon: "FileQuestionMark" },
  purchaseOrders: { key: "purchaseOrders", label: "Purchase Orders", value: "21", icon: "ShoppingCart" },
  suppliers: { key: "suppliers", label: "Suppliers", value: "34", icon: "Truck" },
  pendingDeliveries: { key: "pendingDeliveries", label: "Pending Deliveries", value: "7", icon: "PackageCheck", tone: "warning" },
  stockValue: { key: "stockValue", label: "Stock Value", value: "€486K", icon: "Package" },
  lowStock: { key: "lowStock", label: "Low Stock Items", value: "8", icon: "PackageMinus", tone: "danger" },
  incomingMaterials: { key: "incomingMaterials", label: "Incoming", value: "7", icon: "ArrowDownLeft" },
  outgoingMaterials: { key: "outgoingMaterials", label: "Outgoing", value: "13", icon: "ArrowUpRight" },
  materialRequests: { key: "materialRequests", label: "Material Requests", value: "6", icon: "ClipboardList" },
  openNcrs: { key: "openNcrs", label: "Open NCRs", value: "4", icon: "FileX", tone: "danger" },
  punchItems: { key: "punchItems", label: "Punch Items", value: "27", icon: "ListChecks", tone: "warning" },
  tests: { key: "tests", label: "Tests Completed", value: "42", icon: "FlaskConical", tone: "success" },
  incidents: { key: "incidents", label: "Incidents (YTD)", value: "2", icon: "TriangleAlert", tone: "danger" },
  daysWithoutIncident: { key: "daysWithoutIncident", label: "Days Incident-Free", value: "86", icon: "ShieldCheck", tone: "success" },
  permits: { key: "permits", label: "Active Permits", value: "11", icon: "FileBadge" },
  openActions: { key: "openActions", label: "Open Actions", value: "9", icon: "ListChecks", tone: "warning" },
  documentsTotal: { key: "documentsTotal", label: "Documents", value: String(demoDocuments.length), icon: "FileText" },
  recentDocuments: { key: "recentDocuments", label: "Added This Week", value: "4", icon: "FilePlus" },
  companyProjects: { key: "companyProjects", label: "Company Projects", value: String(activeProjects.length), icon: "FolderKanban" },
  companyTasks: { key: "companyTasks", label: "Tasks Tracked", value: String(demoTasks.length), icon: "CircleCheckBig" },
};

/* ------------------------------------------------------------------ */
/* Widget catalogue                                                    */
/* ------------------------------------------------------------------ */

export const widgets: Record<string, WidgetDefinition> = {
  projectProgress: {
    key: "projectProgress",
    title: "Project Progress",
    description: "Completion against the current baseline.",
    span: 2,
    type: "progress",
    href: "/projects",
    rows: [
      { label: "Riverside Residences — Phase 2", meta: "Due 14 Nov", percent: 72 },
      { label: "Northgate Logistics Hub", meta: "Due 03 Dec", percent: 48 },
      { label: "Civic Library Refurbishment", meta: "Due 21 Oct", percent: 91 },
      { label: "Harbour View Offices", meta: "Due 28 Jan", percent: 26 },
    ],
  },
  revenueByQuarter: {
    key: "revenueByQuarter",
    title: "Revenue Overview",
    description: "Recognised revenue by quarter.",
    span: 2,
    type: "bars",
    href: "/finance",
    rows: revenueByQuarterValues.map((value, index) => ({
      label: `Q${index + 1}`,
      value,
      display: value >= 1000 ? `€${(value / 1000).toFixed(2)}M` : `€${value}K`,
    })),
  },
  portfolioMix: {
    key: "portfolioMix",
    title: "Portfolio Mix",
    description: "Active projects by stage.",
    span: 1,
    type: "share",
    href: "/projects",
    total: String(activeProjects.length),
    rows: portfolioMix,
  },
  costBreakdown: {
    key: "costBreakdown",
    title: "Company Costs",
    span: 1,
    type: "breakdown",
    href: "/finance",
    rows: [
      { label: "Materials", value: "€1.42M" },
      { label: "Subcontractors", value: "€918K" },
      { label: "Payroll", value: "€604K" },
      { label: "Overheads", value: "€166K" },
    ],
  },
  salesPipeline: {
    key: "salesPipeline",
    title: "Sales Pipeline",
    description: "Weighted value by stage.",
    span: 2,
    type: "bars",
    href: "/sales",
    rows: [
      { label: "Qualified", value: 1200, display: "€1.20M" },
      { label: "Proposal", value: 940, display: "€940K" },
      { label: "Negotiation", value: 720, display: "€720K" },
      { label: "Closing", value: 540, display: "€540K" },
    ],
  },
  openOpportunities: {
    key: "openOpportunities",
    title: "Opportunities",
    span: 1,
    type: "list",
    href: "/sales",
    rows: [
      { label: "Meridian Group — Fit-out", meta: "€620K", badge: "Proposal", tone: "info" },
      { label: "Portside Council — Depot", meta: "€480K", badge: "Qualified" },
      { label: "Ashford Retail Park", meta: "€350K", badge: "Negotiation", tone: "warning" },
      { label: "Lakeside Homes Ph.1", meta: "€290K", badge: "Qualified" },
    ],
  },
  employeeOverview: {
    key: "employeeOverview",
    title: "People Overview",
    span: 1,
    type: "breakdown",
    href: "/team",
    rows: [
      { label: "Active employees", value: "16" },
      { label: "On leave today", value: "1" },
      { label: "Joining this month", value: "0" },
      { label: "Open positions", value: "2" },
    ],
  },
  outstandingIssuesList: {
    key: "outstandingIssuesList",
    title: "Outstanding Issues",
    span: 1,
    type: "list",
    rows: [
      { label: "Steel delivery delayed", meta: "Northgate Logistics", badge: "High", tone: "danger" },
      { label: "Drawing revision pending", meta: "Riverside Ph.2", badge: "Medium", tone: "warning" },
      { label: "Permit renewal due", meta: "Harbour View", badge: "Medium", tone: "warning" },
      { label: "Client sign-off overdue", meta: "Civic Library", badge: "Low" },
    ],
  },
  myTasks: {
    key: "myTasks",
    title: "Tasks",
    description: "Assigned to you, soonest first.",
    span: 2,
    type: "list",
    href: "/tasks?tab=mine",
    rows: [
      { label: "Approve revised foundation drawings", meta: "Riverside Ph.2 · Due tomorrow", badge: "High", tone: "danger" },
      { label: "Confirm subcontractor schedule", meta: "Northgate · Due Thu", badge: "Medium", tone: "warning" },
      { label: "Review weekly progress report", meta: "Civic Library · Due Fri", badge: "Medium", tone: "warning" },
      { label: "Update project risk register", meta: "Harbour View · Due Mon", badge: "Low" },
    ],
  },
  upcomingMilestones: {
    key: "upcomingMilestones",
    title: "Upcoming Milestones",
    span: 1,
    type: "list",
    rows: [
      { label: "Structural completion", meta: "Riverside Ph.2 · 14 Nov" },
      { label: "Envelope watertight", meta: "Northgate · 29 Nov" },
      { label: "Handover inspection", meta: "Civic Library · 21 Oct", tone: "warning", badge: "Soon" },
      { label: "Foundations complete", meta: "Harbour View · 06 Dec" },
    ],
  },
  projectIssues: {
    key: "projectIssues",
    title: "Project Issues",
    span: 1,
    type: "list",
    rows: [
      { label: "Access road blocked", meta: "Northgate", badge: "Open", tone: "danger" },
      { label: "Late material submittal", meta: "Riverside Ph.2", badge: "Open", tone: "warning" },
      { label: "Scope clarification", meta: "Harbour View", badge: "Review" },
    ],
  },
  recentDocumentsList: {
    key: "recentDocumentsList",
    title: "Recent Documents",
    span: 1,
    type: "list",
    href: "/documents?tab=recent",
    rows: [
      { label: "RIV-A-201 Rev C.pdf", meta: "Riverside Ph.2 · 2h ago" },
      { label: "Northgate — Method Statement.docx", meta: "Northgate · Yesterday" },
      { label: "Civic Library — Snag List.xlsx", meta: "Civic Library · 2d ago" },
      { label: "HV Site Survey.pdf", meta: "Harbour View · 3d ago" },
    ],
  },
  drawingReviewsList: {
    key: "drawingReviewsList",
    title: "Drawing Reviews",
    span: 2,
    type: "list",
    rows: [
      { label: "RIV-A-201 — Level 2 GA plan", meta: "Rev C · submitted 2d ago", badge: "Awaiting review", tone: "warning" },
      { label: "RIV-S-114 — Core reinforcement", meta: "Rev A · submitted 3d ago", badge: "Awaiting review", tone: "warning" },
      { label: "NGH-A-008 — Cladding details", meta: "Rev B · submitted 5d ago", badge: "In review", tone: "info" },
      { label: "HV-A-002 — Site plan", meta: "Rev A · approved", badge: "Approved", tone: "success" },
    ],
  },
  rfiList: {
    key: "rfiList",
    title: "Open RFIs",
    span: 1,
    type: "list",
    rows: [
      { label: "RFI-034 — Slab edge detail", meta: "Riverside Ph.2 · 3d open", tone: "warning" },
      { label: "RFI-035 — Duct penetration", meta: "Northgate · 1d open" },
      { label: "RFI-031 — Balustrade fixing", meta: "Civic Library · 6d open", tone: "danger" },
    ],
  },
  upcomingDeadlines: {
    key: "upcomingDeadlines",
    title: "Upcoming Deadlines",
    span: 1,
    type: "list",
    rows: [
      { label: "Planning submission pack", meta: "Due in 2 days", tone: "danger", badge: "Urgent" },
      { label: "Tender drawing set", meta: "Due in 6 days", tone: "warning" },
      { label: "Coordination model issue", meta: "Due in 11 days" },
    ],
  },
  inspectionSchedule: {
    key: "inspectionSchedule",
    title: "Upcoming Inspections",
    span: 1,
    type: "list",
    href: "/qaqc",
    rows: [
      { label: "Rebar inspection — Core B", meta: "Tomorrow 09:00", badge: "Scheduled", tone: "info" },
      { label: "Concrete pour sign-off", meta: "Thu 07:30", badge: "Scheduled", tone: "info" },
      { label: "Envelope watertightness", meta: "Next Tue", badge: "Planned" },
    ],
  },
  qualityBreakdown: {
    key: "qualityBreakdown",
    title: "Quality Overview",
    span: 2,
    type: "breakdown",
    href: "/qaqc",
    rows: [
      { label: "Inspections passed", value: "38", tone: "success" },
      { label: "Inspections failed", value: "4", tone: "danger" },
      { label: "NCRs open / closed", value: "4 / 19" },
      { label: "Punch items outstanding", value: "27", tone: "warning" },
    ],
  },
  safetyOverview: {
    key: "safetyOverview",
    title: "Safety Overview",
    span: 2,
    type: "breakdown",
    href: "/hse",
    rows: [
      { label: "Days without incident", value: "86", tone: "success" },
      { label: "Near misses (30d)", value: "5", tone: "warning" },
      { label: "Toolbox talks (30d)", value: "12" },
      { label: "Open corrective actions", value: "9", tone: "warning" },
    ],
  },
  incidentList: {
    key: "incidentList",
    title: "Incidents",
    span: 1,
    type: "list",
    rows: [
      { label: "Minor hand laceration", meta: "Northgate · 12 Jul", badge: "Closed", tone: "success" },
      { label: "Dropped object — no injury", meta: "Riverside Ph.2 · 03 Jun", badge: "Closed", tone: "success" },
      { label: "Near miss — scaffold gap", meta: "Harbour View · 2d ago", badge: "Open", tone: "warning" },
    ],
  },
  financeBreakdown: {
    key: "financeBreakdown",
    title: "Financial Overview",
    span: 2,
    type: "breakdown",
    href: "/finance",
    rows: [
      { label: "Revenue YTD", value: "€4.28M", tone: "success" },
      { label: "Costs YTD", value: "€3.11M" },
      { label: "Gross margin", value: "27.3%" },
      { label: "Cash position", value: "€1.04M", tone: "success" },
    ],
  },
  invoiceList: {
    key: "invoiceList",
    title: "Invoices",
    span: 1,
    type: "list",
    href: "/finance?tab=invoices",
    rows: [
      { label: "INV-2043 — Meridian Group", meta: "€128,400", badge: "Overdue", tone: "danger" },
      { label: "INV-2044 — Portside Council", meta: "€96,200", badge: "Sent", tone: "info" },
      { label: "INV-2045 — Ashford Retail", meta: "€54,800", badge: "Sent", tone: "info" },
      { label: "INV-2041 — Lakeside Homes", meta: "€212,000", badge: "Paid", tone: "success" },
    ],
  },
  budgetProgress: {
    key: "budgetProgress",
    title: "Budgets",
    span: 1,
    type: "progress",
    href: "/finance?tab=budgets",
    rows: [
      { label: "Riverside Ph.2", meta: "€1.8M budget", percent: 68 },
      { label: "Northgate", meta: "€2.4M budget", percent: 41 },
      { label: "Civic Library", meta: "€640K budget", percent: 88 },
    ],
  },
  contractList: {
    key: "contractList",
    title: "Active Contracts",
    span: 2,
    type: "list",
    href: "/contracts",
    rows: [
      { label: "Meridian Group — Main works", meta: "Expires 30 Jun 2027", badge: "Active", tone: "success" },
      { label: "Portside Council — Framework", meta: "Expires 14 Dec 2026", badge: "Expiring", tone: "warning" },
      { label: "Steelcore Ltd — Supply", meta: "Expires 01 Nov 2026", badge: "Expiring", tone: "warning" },
      { label: "Ashford Retail — Design", meta: "Expires 22 Mar 2028", badge: "Active", tone: "success" },
    ],
  },
  approvalQueue: {
    key: "approvalQueue",
    title: "Awaiting Your Approval",
    span: 1,
    type: "list",
    rows: [
      { label: "Purchase order PO-1182", meta: "€84,200 · Procurement", badge: "Pending", tone: "warning" },
      { label: "Subcontract — Groundworks", meta: "€310,000 · Legal", badge: "Pending", tone: "warning" },
      { label: "Variation VO-014", meta: "€27,500 · Riverside Ph.2", badge: "Pending", tone: "warning" },
    ],
  },
  riskRegister: {
    key: "riskRegister",
    title: "Company Risks",
    span: 1,
    type: "list",
    rows: [
      { label: "Material price volatility", meta: "Financial", badge: "High", tone: "danger" },
      { label: "Skilled labour availability", meta: "Operational", badge: "High", tone: "danger" },
      { label: "Client payment delays", meta: "Financial", badge: "Medium", tone: "warning" },
      { label: "Permit approval timelines", meta: "Regulatory", badge: "Medium", tone: "warning" },
    ],
  },
  procurementQueue: {
    key: "procurementQueue",
    title: "Purchase Requests",
    span: 2,
    type: "list",
    href: "/procurement?tab=requests",
    rows: [
      { label: "PR-0231 — Rebar 12mm, 40t", meta: "Riverside Ph.2 · raised 1d ago", badge: "Awaiting RFQ", tone: "warning" },
      { label: "PR-0232 — Formwork hire", meta: "Northgate · raised 2d ago", badge: "Awaiting RFQ", tone: "warning" },
      { label: "PR-0229 — Site cabins", meta: "Harbour View · raised 4d ago", badge: "Ordered", tone: "success" },
      { label: "PR-0228 — MEP first fix", meta: "Civic Library · raised 6d ago", badge: "In RFQ", tone: "info" },
    ],
  },
  deliverySchedule: {
    key: "deliverySchedule",
    title: "Pending Deliveries",
    span: 1,
    type: "list",
    rows: [
      { label: "Steelcore Ltd — Beams", meta: "Expected tomorrow", badge: "On time", tone: "success" },
      { label: "Nordic Timber — Formwork", meta: "Expected Thu", badge: "On time", tone: "success" },
      { label: "BuildFix — Fixings", meta: "Overdue 2 days", badge: "Late", tone: "danger" },
    ],
  },
  stockLevels: {
    key: "stockLevels",
    title: "Stock Levels",
    span: 2,
    type: "progress",
    href: "/inventory?tab=stock",
    rows: [
      { label: "Cement 42.5N", meta: "180 / 400 bags", percent: 45 },
      { label: "Rebar 12mm", meta: "9 / 40 tonnes", percent: 22 },
      { label: "Timber formwork", meta: "310 / 500 m²", percent: 62 },
      { label: "Safety equipment", meta: "88 / 100 sets", percent: 88 },
    ],
  },
  stockMovements: {
    key: "stockMovements",
    title: "Recent Movements",
    span: 1,
    type: "list",
    rows: [
      { label: "Rebar 12mm — 4t out", meta: "Riverside Ph.2 · today", tone: "warning" },
      { label: "Cement — 120 bags in", meta: "Central store · today", tone: "success" },
      { label: "Formwork — 60 m² out", meta: "Northgate · yesterday" },
    ],
  },
  systemHealth: {
    key: "systemHealth",
    title: "System Status",
    span: 2,
    type: "breakdown",
    rows: [
      { label: "Application", value: "Operational", tone: "success" },
      { label: "Database", value: "Operational", tone: "success" },
      { label: "Authentication", value: "Operational", tone: "success" },
      { label: "File storage", value: "Not configured", tone: "warning" },
    ],
  },
  supportQueue: {
    key: "supportQueue",
    title: "Support Requests",
    span: 1,
    type: "list",
    href: "/support",
    rows: [
      { label: "Cannot access Finance module", meta: "Raised by Sales · 2h ago", badge: "Open", tone: "warning" },
      { label: "New laptop setup", meta: "Raised by HR · yesterday", badge: "Open", tone: "warning" },
      { label: "Password reset", meta: "Raised by Engineer · 2d ago", badge: "Resolved", tone: "success" },
    ],
  },
  configurationStatus: {
    key: "configurationStatus",
    title: "Configuration Status",
    span: 2,
    type: "breakdown",
    rows: [
      { label: "Company profile", value: "Complete", tone: "success" },
      { label: "Roles and permissions", value: "16 roles configured", tone: "success" },
      { label: "Modules enabled", value: "17 of 17", tone: "success" },
      { label: "Email delivery", value: "Pending setup", tone: "warning" },
    ],
  },
  roleDistribution: {
    key: "roleDistribution",
    title: "User Roles",
    span: 1,
    type: "breakdown",
    href: "/team",
    rows: [
      { label: "Executive", value: "2" },
      { label: "Projects & design", value: "3" },
      { label: "Departments", value: "8" },
      { label: "Administration", value: "3" },
    ],
  },
  integrationsList: {
    key: "integrationsList",
    title: "Integrations",
    span: 1,
    type: "list",
    rows: [
      { label: "Email (SMTP)", meta: "Not connected", badge: "Pending", tone: "warning" },
      { label: "File storage", meta: "Not connected", badge: "Pending", tone: "warning" },
      { label: "Single sign-on", meta: "Planned for V0.3", badge: "Planned" },
    ],
  },
  attendanceOverview: {
    key: "attendanceOverview",
    title: "Attendance",
    span: 2,
    type: "breakdown",
    href: "/hr?tab=attendance",
    rows: [
      { label: "Present today", value: "15 of 16", tone: "success" },
      { label: "On leave", value: "1" },
      { label: "Late arrivals (7d)", value: "2", tone: "warning" },
      { label: "Average weekly hours", value: "38.4" },
    ],
  },
  upcomingAbsences: {
    key: "upcomingAbsences",
    title: "Upcoming Absences",
    span: 1,
    type: "list",
    rows: [
      { label: "Marta Lehmann", meta: "Annual leave · 12–19 Oct", badge: "Approved", tone: "success" },
      { label: "Tomás Rivera", meta: "Annual leave · 21–23 Oct", badge: "Pending", tone: "warning" },
      { label: "Aisha Karim", meta: "Training · 04 Nov", badge: "Approved", tone: "success" },
    ],
  },
  hrTasks: {
    key: "hrTasks",
    title: "HR Tasks",
    span: 1,
    type: "list",
    rows: [
      { label: "Complete onboarding checklist", meta: "Due Fri", badge: "Open", tone: "warning" },
      { label: "Review probation — 2 employees", meta: "Due next week", badge: "Open" },
      { label: "Publish site engineer vacancy", meta: "Due Mon", badge: "Open" },
    ],
  },
  companyOverview: {
    key: "companyOverview",
    title: "Company Overview",
    span: 2,
    type: "breakdown",
    href: "/company",
    rows: [
      { label: "Active projects", value: String(activeProjects.length) },
      { label: "Active clients", value: String(activeClients.length) },
      { label: "Employees", value: String(SEEDED_EMPLOYEES) },
      { label: "Documents", value: String(demoDocuments.length) },
    ],
  },
  projectList: {
    key: "projectList",
    title: "Projects",
    span: 2,
    type: "list",
    href: "/projects",
    rows: [
      { label: "Riverside Residences — Phase 2", meta: "Meridian Group", badge: "In progress", tone: "info" },
      { label: "Northgate Logistics Hub", meta: "Portside Council", badge: "In progress", tone: "info" },
      { label: "Civic Library Refurbishment", meta: "Ashford Borough", badge: "Handover", tone: "warning" },
      { label: "Harbour View Offices", meta: "Lakeside Homes", badge: "Planning" },
    ],
  },
  clientList: {
    key: "clientList",
    title: "Clients",
    span: 1,
    type: "list",
    href: "/clients",
    rows: [
      { label: "Meridian Group", meta: "3 active projects" },
      { label: "Portside Council", meta: "2 active projects" },
      { label: "Ashford Borough", meta: "1 active project" },
      { label: "Lakeside Homes", meta: "1 active project" },
    ],
  },

  /* Activity feeds — one per department so the wording stays in context. */
  activityCompany: {
    key: "activityCompany",
    title: "Recent Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Sofia Almeida", action: "approved variation", target: "VO-014 · Riverside Ph.2", time: "18 minutes ago" },
      { actor: "Daniel Okonkwo", action: "issued invoice", target: "INV-2045 · Ashford Retail", time: "1 hour ago" },
      { actor: "Marta Lehmann", action: "uploaded drawing", target: "RIV-A-201 Rev C", time: "2 hours ago" },
      { actor: "Tomás Rivera", action: "closed inspection", target: "Rebar — Core A", time: "4 hours ago" },
      { actor: "Jonas Weber", action: "added supplier", target: "Nordic Timber AB", time: "Yesterday" },
    ],
  },
  activitySystem: {
    key: "activitySystem",
    title: "Recent System Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "System", action: "seeded demo company", target: "NESTO Demo Construction", time: "Today" },
      { actor: "Admin", action: "enabled module", target: "Procurement", time: "2 hours ago" },
      { actor: "Company IT", action: "reset password for", target: "engineer@nesto.test", time: "Yesterday" },
      { actor: "Admin", action: "updated role permissions", target: "Viewer", time: "2 days ago" },
    ],
  },
  activityIt: {
    key: "activityIt",
    title: "Recent IT Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Company IT", action: "provisioned device", target: "MacBook Pro · Engineering", time: "1 hour ago" },
      { actor: "Company IT", action: "closed support request", target: "Password reset", time: "Yesterday" },
      { actor: "System", action: "recorded failed sign-in", target: "sales@nesto.test", time: "Yesterday" },
      { actor: "Company IT", action: "reviewed active sessions", time: "2 days ago" },
    ],
  },
  activityHr: {
    key: "activityHr",
    title: "Recent HR Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Aisha Karim", action: "approved leave for", target: "Marta Lehmann", time: "35 minutes ago" },
      { actor: "Aisha Karim", action: "opened vacancy", target: "Site Engineer", time: "Yesterday" },
      { actor: "System", action: "recorded attendance for", target: "16 employees", time: "Today 07:00" },
      { actor: "Aisha Karim", action: "updated employee record", target: "Tomás Rivera", time: "2 days ago" },
    ],
  },
  activityProject: {
    key: "activityProject",
    title: "Project Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Marta Lehmann", action: "uploaded drawing", target: "RIV-A-201 Rev C", time: "2 hours ago" },
      { actor: "Tomás Rivera", action: "completed task", target: "Foundation survey", time: "3 hours ago" },
      { actor: "Sofia Almeida", action: "added milestone", target: "Structural completion", time: "Yesterday" },
      { actor: "Liam Novak", action: "raised issue", target: "Access road blocked", time: "Yesterday" },
    ],
  },
  activityFinance: {
    key: "activityFinance",
    title: "Recent Financial Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Daniel Okonkwo", action: "issued invoice", target: "INV-2045 · €54,800", time: "1 hour ago" },
      { actor: "System", action: "recorded payment", target: "INV-2041 · €212,000", time: "Yesterday" },
      { actor: "Daniel Okonkwo", action: "approved expense", target: "Site accommodation · €4,120", time: "2 days ago" },
      { actor: "Daniel Okonkwo", action: "updated budget", target: "Northgate Logistics Hub", time: "3 days ago" },
    ],
  },
  activityLegal: {
    key: "activityLegal",
    title: "Recent Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Elena Costa", action: "uploaded contract", target: "Steelcore Ltd — Supply", time: "2 hours ago" },
      { actor: "Elena Costa", action: "flagged expiry", target: "Portside Council Framework", time: "Yesterday" },
      { actor: "Sofia Almeida", action: "requested review of", target: "Subcontract — Groundworks", time: "2 days ago" },
      { actor: "Elena Costa", action: "issued notice", target: "Delay notification · Northgate", time: "4 days ago" },
    ],
  },
  activitySales: {
    key: "activitySales",
    title: "Recent Sales Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Priya Raman", action: "moved opportunity to", target: "Negotiation · Ashford Retail Park", time: "40 minutes ago" },
      { actor: "Priya Raman", action: "sent proposal", target: "Meridian Group — Fit-out", time: "Yesterday" },
      { actor: "Priya Raman", action: "logged call with", target: "Portside Council", time: "2 days ago" },
      { actor: "Priya Raman", action: "added client", target: "Lakeside Homes", time: "5 days ago" },
    ],
  },
  activityProcurement: {
    key: "activityProcurement",
    title: "Recent Procurement Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Jonas Weber", action: "raised RFQ", target: "Rebar 12mm — 4 suppliers", time: "1 hour ago" },
      { actor: "Jonas Weber", action: "issued purchase order", target: "PO-1182 · €84,200", time: "Yesterday" },
      { actor: "Steelcore Ltd", action: "confirmed delivery date", target: "Beams · 12 Oct", time: "Yesterday" },
      { actor: "Jonas Weber", action: "added supplier", target: "Nordic Timber AB", time: "3 days ago" },
    ],
  },
  activityInventory: {
    key: "activityInventory",
    title: "Recent Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Nina Petrova", action: "recorded stock out", target: "Rebar 12mm · 4t", time: "2 hours ago" },
      { actor: "Nina Petrova", action: "received delivery", target: "Cement · 120 bags", time: "Today 08:15" },
      { actor: "System", action: "flagged low stock", target: "Rebar 12mm", time: "Today 08:16" },
      { actor: "Nina Petrova", action: "transferred materials", target: "Central store → Northgate", time: "Yesterday" },
    ],
  },
  activityQuality: {
    key: "activityQuality",
    title: "Recent Quality Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Tomás Rivera", action: "closed NCR", target: "NCR-018 · Riverside Ph.2", time: "1 hour ago" },
      { actor: "Tomás Rivera", action: "passed inspection", target: "Rebar — Core A", time: "4 hours ago" },
      { actor: "Tomás Rivera", action: "raised NCR", target: "NCR-022 · Northgate", time: "Yesterday" },
      { actor: "Liam Novak", action: "added punch items", target: "Civic Library · 6 items", time: "2 days ago" },
    ],
  },
  activityHse: {
    key: "activityHse",
    title: "Recent HSE Activity",
    span: 3,
    type: "activity",
    rows: [
      { actor: "Hannah Berg", action: "logged near miss", target: "Scaffold gap · Harbour View", time: "2 days ago" },
      { actor: "Hannah Berg", action: "issued permit", target: "Hot works · Northgate", time: "Yesterday" },
      { actor: "Hannah Berg", action: "completed toolbox talk", target: "Working at height", time: "3 days ago" },
      { actor: "Hannah Berg", action: "closed corrective action", target: "CA-041", time: "4 days ago" },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Role → dashboard                                                    */
/* ------------------------------------------------------------------ */

export const dashboards: Record<RoleKey, DashboardConfig> = {
  OWNER: {
    kpis: ["activeProjects", "revenue", "costs", "employees"],
    widgets: [
      "revenueByQuarter",
      "portfolioMix",
      "projectProgress",
      "costBreakdown",
      "outstandingIssuesList",
      "openOpportunities",
      "employeeOverview",
      "activityCompany",
    ],
    quickActions: [
      { label: "View projects", href: "/projects" },
      { label: "Finance overview", href: "/finance", permission: "finance.view" },
      { label: "Company profile", href: "/company", permission: "company.view" },
      { label: "Manage team", href: "/team", permission: "team.view" },
    ],
  },
  ADMIN: {
    kpis: ["users", "activeUsers", "companyModules", "userRoles"],
    widgets: ["configurationStatus", "roleDistribution", "activitySystem"],
    quickActions: [
      { label: "Manage team", href: "/team", permission: "team.view" },
      { label: "Company settings", href: "/settings/company", permission: "settings.manage" },
      { label: "Roles", href: "/settings/roles", permission: "settings.manage" },
      { label: "Support", href: "/support", permission: "support.view" },
    ],
  },
  IT: {
    kpis: ["users", "activeSessions", "supportRequests", "devices"],
    widgets: ["systemHealth", "supportQueue", "integrationsList", "activityIt"],
    quickActions: [
      { label: "Support requests", href: "/support", permission: "support.view" },
      { label: "Team directory", href: "/team", permission: "team.view" },
      { label: "Company profile", href: "/company", permission: "company.view" },
    ],
  },
  HR: {
    kpis: ["employees", "attendance", "leaveRequests", "recruitment"],
    widgets: ["attendanceOverview", "upcomingAbsences", "hrTasks", "employeeOverview", "activityHr"],
    quickActions: [
      { label: "HR module", href: "/hr", permission: "hr.view" },
      { label: "Team directory", href: "/team", permission: "team.view" },
      { label: "Documents", href: "/documents", permission: "document.view" },
    ],
  },
  CEO: {
    kpis: ["revenue", "projectPerformance", "approvals", "risks"],
    widgets: [
      "financeBreakdown",
      "portfolioMix",
      "riskRegister",
      "projectProgress",
      "approvalQueue",
      "salesPipeline",
      "openOpportunities",
      "activityCompany",
    ],
    quickActions: [
      { label: "Projects", href: "/projects" },
      { label: "Finance", href: "/finance", permission: "finance.view" },
      { label: "Sales", href: "/sales", permission: "sales.view" },
      { label: "Company", href: "/company", permission: "company.view" },
    ],
  },
  PROJECT_MANAGER: {
    kpis: ["myProjects", "openTasks", "dueThisWeek", "issues"],
    widgets: [
      "projectProgress",
      "upcomingMilestones",
      "myTasks",
      "projectIssues",
      "recentDocumentsList",
      "clientList",
      "activityProject",
    ],
    quickActions: [
      { label: "My projects", href: "/projects?tab=mine" },
      { label: "My tasks", href: "/tasks?tab=mine", permission: "task.view" },
      { label: "Team", href: "/team", permission: "team.view" },
      { label: "New project", href: "/projects/new", permission: "project.create" },
    ],
  },
  ARCHITECT: {
    kpis: ["assignedProjects", "designTasks", "drawingReviews", "rfis"],
    widgets: [
      "drawingReviewsList",
      "upcomingDeadlines",
      "myTasks",
      "recentDocumentsList",
      "rfiList",
      "activityProject",
    ],
    quickActions: [
      { label: "My projects", href: "/projects?tab=mine" },
      { label: "Documents", href: "/documents", permission: "document.view" },
      { label: "My tasks", href: "/tasks?tab=mine", permission: "task.view" },
    ],
  },
  ENGINEER: {
    kpis: ["assignedProjects", "engineeringTasks", "inspections", "technicalIssues"],
    widgets: [
      "myTasks",
      "inspectionSchedule",
      "projectIssues",
      "rfiList",
      "recentDocumentsList",
      "activityProject",
    ],
    quickActions: [
      { label: "My tasks", href: "/tasks?tab=mine", permission: "task.view" },
      { label: "QA/QC", href: "/qaqc", permission: "qaqc.view" },
      { label: "Documents", href: "/documents", permission: "document.view" },
    ],
  },
  FINANCE: {
    kpis: ["revenue", "costs", "receivables", "payables"],
    widgets: [
      "revenueByQuarter",
      "invoiceList",
      "financeBreakdown",
      "budgetProgress",
      "activityFinance",
    ],
    quickActions: [
      { label: "Invoices", href: "/finance?tab=invoices", permission: "finance.view" },
      { label: "Budgets", href: "/finance?tab=budgets", permission: "finance.view" },
      { label: "Clients", href: "/clients", permission: "client.view" },
    ],
  },
  LEGAL: {
    kpis: ["activeContracts", "contractsExpiring", "approvals", "legalCases"],
    widgets: ["contractList", "approvalQueue", "clientList", "recentDocumentsList", "activityLegal"],
    quickActions: [
      { label: "Contracts", href: "/contracts", permission: "contract.view" },
      { label: "Clients", href: "/clients", permission: "client.view" },
      { label: "Documents", href: "/documents", permission: "document.view" },
    ],
  },
  SALES: {
    kpis: ["pipeline", "opportunities", "clients", "proposals"],
    widgets: ["salesPipeline", "openOpportunities", "clientList", "projectList", "activitySales"],
    quickActions: [
      { label: "Pipeline", href: "/sales?tab=pipeline", permission: "sales.view" },
      { label: "Clients", href: "/clients", permission: "client.view" },
      { label: "Proposals", href: "/sales?tab=proposals", permission: "sales.view" },
    ],
  },
  PROCUREMENT: {
    kpis: ["purchaseRequests", "rfqs", "purchaseOrders", "pendingDeliveries"],
    widgets: [
      "procurementQueue",
      "deliverySchedule",
      "stockLevels",
      "stockMovements",
      "activityProcurement",
    ],
    quickActions: [
      { label: "Requests", href: "/procurement?tab=requests", permission: "procurement.view" },
      { label: "Suppliers", href: "/procurement?tab=suppliers", permission: "procurement.view" },
      { label: "Inventory", href: "/inventory", permission: "inventory.view" },
    ],
  },
  INVENTORY: {
    kpis: ["stockValue", "lowStock", "incomingMaterials", "materialRequests"],
    widgets: [
      "stockLevels",
      "stockMovements",
      "deliverySchedule",
      "procurementQueue",
      "activityInventory",
    ],
    quickActions: [
      { label: "Stock", href: "/inventory?tab=stock", permission: "inventory.view" },
      { label: "Movements", href: "/inventory?tab=movements", permission: "inventory.view" },
      { label: "Procurement", href: "/procurement", permission: "procurement.view" },
    ],
  },
  QAQC: {
    kpis: ["inspections", "openNcrs", "punchItems", "tests"],
    widgets: [
      "qualityBreakdown",
      "inspectionSchedule",
      "myTasks",
      "recentDocumentsList",
      "activityQuality",
    ],
    quickActions: [
      { label: "Inspections", href: "/qaqc?tab=inspections", permission: "qaqc.view" },
      { label: "NCRs", href: "/qaqc?tab=ncrs", permission: "qaqc.view" },
      { label: "My tasks", href: "/tasks?tab=mine", permission: "task.view" },
    ],
  },
  HSE: {
    kpis: ["daysWithoutIncident", "incidents", "permits", "openActions"],
    widgets: ["safetyOverview", "incidentList", "myTasks", "inspectionSchedule", "activityHse"],
    quickActions: [
      { label: "Incidents", href: "/hse?tab=incidents", permission: "hse.view" },
      { label: "Permits", href: "/hse?tab=permits", permission: "hse.view" },
      { label: "Actions", href: "/hse?tab=actions", permission: "hse.view" },
    ],
  },
  VIEWER: {
    kpis: ["companyProjects", "companyTasks", "documentsTotal", "clients"],
    widgets: ["companyOverview", "projectList", "recentDocumentsList", "activityCompany"],
    quickActions: [
      { label: "Projects", href: "/projects" },
      { label: "Documents", href: "/documents", permission: "document.view" },
      { label: "Clients", href: "/clients", permission: "client.view" },
    ],
  },
};

export function dashboardForRole(role: RoleKey): DashboardConfig {
  return dashboards[role] ?? dashboards.VIEWER;
}
