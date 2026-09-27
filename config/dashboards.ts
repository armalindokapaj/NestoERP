/**
 * Role dashboard configuration (PRD #4 §57).
 *
 * A dashboard is a list of KPI keys, widget keys and quick-action keys — never
 * a page. Each entry is still checked against the user's own permissions when
 * it is resolved, so a configuration line can widen nothing (PRD #4 §10, §19).
 *
 * Because widgets are keyed rather than bound to role names, a future custom
 * role composes a dashboard from the same registry (PRD #4 §89).
 */
import { kpis } from "./kpis";
import type { PositionLevel, RoleKey } from "./roles";
import { widgets } from "./widgets";

export type DashboardConfig = {
  /** A short line under the greeting, describing the role's focus. */
  focus: string;
  kpis: string[];
  widgets: string[];
  quickActions: string[];
};

export const dashboards: Record<RoleKey, DashboardConfig> = {
  OWNER: {
    focus: "Performance across every company and department of the group.",
    // The group as a group (D-01 §27): each figure company by company, as the Owner.
    kpis: ["groupCompanyCount", "groupActiveProjects", "groupEmployees", "groupExternalCompanies", "groupPortfolioValue"],
    widgets: [
      "attention",
      "keyProjects",
      "groupCompanies",
      "portfolioStatus",
      "projectTypes",
      "groupDepartments",
      "groupMilestones",
      "groupActivity",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "approvalBottlenecks",
      "activeProjects",
      "criticalMilestones",
      "engineeringBottlenecks",
      "contractorCompliance",
      "financeSummary",
      "salesPipeline",
      "workforce",
      "qualityRecords",
      "hseHazardsByRisk",
    ],
    quickActions: ["newProject", "newClient", "newInvoice", "uploadDocument"],
  },
  // Never shown: the Platform Admin works outside every company (E-06 §128).
  PLATFORM_ADMIN: {
    focus: "Parent groups and their implementation.",
    kpis: [],
    widgets: [],
    quickActions: [],
  },
  GROUP_IT: {
    focus: "Accounts, company configuration and support across the group.",
    kpis: ["teamSize", "openSupportCount", "enabledModuleCount", "openTaskCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "supportRequests",
      "userDirectory",
      "companyModules",
      "recentActivity",
    ],
    quickActions: [],
  },
  HR: {
    focus: "People operations, records and absence.",
    kpis: ["headcount", "pendingLeave", "openTaskCount", "activeProjects"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "leaveRequests",
      "workforce",
      "teamDirectory",
      "recentActivity",
    ],
    quickActions: ["requestLeave", "inviteUser", "uploadDocument"],
  },
  CEO: {
    focus: "Executive overview: performance, exposure and approvals.",
    kpis: ["activeProjects", "invoicedValue", "pipelineValue", "projectsAtRisk"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "approvalBottlenecks",
      "activeProjects",
      "criticalMilestones",
      "engineeringBottlenecks",
      "contractorCompliance",
      "financeSummary",
      "salesPipeline",
      "contracts",
      "hseHazardsByRisk",
      "recentActivity",
    ],
    quickActions: [],
  },
  PROJECT_MANAGER: {
    focus: "Project execution across the work you run.",
    kpis: ["myProjectCount", "openTaskCount", "overdueTaskCount", "projectsAtRisk"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "myMeetingActions",
      "myTimesheet",
      "siteToday",
      "upcomingMilestones",
      "engineeringBottlenecks",
      "contractorCompliance",
      "myProjects",
      "openTasks",
      "upcomingDeadlines",
      "projectBudgets",
      "pendingApprovals",
      "purchaseRequests",
      "recentDocuments",
      "recentActivity",
    ],
    quickActions: ["newProject", "newTask", "newPurchaseRequest", "uploadDocument"],
  },
  ARCHITECT: {
    focus: "Design work on the projects you are assigned to.",
    kpis: ["myProjectCount", "openTaskCount", "overdueTaskCount", "documentCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "myMeetingActions",
      "myTimesheet",
      "siteToday",
      "upcomingMilestones",
      "reviewsAwaitingMe",
      "rfisAssignedToMe",
      "myProjects",
      "openTasks",
      "upcomingDeadlines",
      "recentDocuments",
      "recentActivity",
    ],
    quickActions: ["newTask", "uploadDocument"],
  },
  ENGINEER: {
    focus: "Technical delivery on your assigned projects.",
    kpis: ["myProjectCount", "openTaskCount", "openQualityCount", "openIncidentCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "myMeetingActions",
      "myTimesheet",
      "siteToday",
      "upcomingMilestones",
      "rfisAssignedToMe",
      "reviewsAwaitingMe",
      "myProjects",
      "openTasks",
      "qualityRecords",
      "hseHazardsByRisk",
      "recentDocuments",
      "recentActivity",
    ],
    quickActions: ["newTask", "newQualityRecord", "uploadDocument"],
  },
  FINANCE: {
    focus: "Financial operations: invoicing, receivables and budgets.",
    kpis: ["receivables", "overdueValue", "invoicedValue", "openTaskCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "groupFinance",
      "overdueInvoices",
      "financeSummary",
      "projectBudgets",
      "openTasks",
      "recentActivity",
    ],
    quickActions: ["newInvoice", "uploadDocument"],
  },
  LEGAL: {
    focus: "Contracts, approvals and legal obligations.",
    kpis: ["activeContracts", "expiringContractCount", "openTaskCount", "clientCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "expiringContracts",
      "contractorCompliance",
      "contracts",
      "openTasks",
      "recentActivity",
    ],
    quickActions: ["newContract", "uploadDocument"],
  },
  SALES: {
    focus: "Commercial pipeline and client growth.",
    kpis: ["pipelineValue", "openOpportunityCount", "clientCount", "openTaskCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "salesPipeline",
      "openOpportunities",
      "openTasks",
      "recentActivity",
    ],
    quickActions: ["newLead", "newOpportunity", "newClient"],
  },
  PROCUREMENT: {
    focus: "Purchasing workflow from request to delivery.",
    kpis: ["openRequests", "openOrders", "lowStockCount", "openTaskCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "purchaseRequests",
      "purchaseOrders",
      "lowStock",
      "recentActivity",
    ],
    quickActions: ["newPurchaseRequest", "uploadDocument"],
  },
  INVENTORY: {
    focus: "Material control: stock, movements and replenishment.",
    kpis: ["stockValue", "lowStockCount", "openRequests", "openTaskCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "lowStock",
      "recentMovements",
      "purchaseRequests",
      "recentActivity",
    ],
    quickActions: ["newReceipt", "uploadDocument"],
  },
  QAQC: {
    focus: "Quality control across inspections and non-conformances.",
    kpis: ["openQualityCount", "openNcrCount", "openTaskCount", "myProjectCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "reviewsAwaitingMe",
      "openNcrs",
      "qualityRecords",
      "openTasks",
      "recentDocuments",
      "recentActivity",
    ],
    quickActions: ["newQualityRecord", "newTask", "uploadDocument"],
  },
  HSE: {
    focus: "Safety performance, incidents and permits.",
    kpis: ["openIncidentCount", "openPermitCount", "openTaskCount", "myProjectCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "reviewsAwaitingMe",
      "openIncidents",
      "hseHazardsByRisk",
      "openTasks",
      "recentDocuments",
      "recentActivity",
    ],
    quickActions: ["reportIncident", "newTask", "uploadDocument"],
  },
  VIEWER: {
    focus: "A read-only view of the work you have been given access to.",
    kpis: ["myProjectCount", "openTaskCount", "documentCount", "clientCount"],
    widgets: ["announcements", "favorites", "recentWork", "myProjects", "openTasks", "recentDocuments", "recentActivity"],
    quickActions: [],
  },
};

/**
 * The layout a department manager or group head sees instead of the member's,
 * where the two differ (E-06 §6.3, §6.4): the architect who publishes units and
 * the salesperson who decides proposals both lead with the approvals inbox.
 */
const managerDashboards: Partial<Record<RoleKey, DashboardConfig>> = {
  ARCHITECT: {
    focus: "Design across every project, and the units waiting to be published.",
    kpis: ["myProjectCount", "openTaskCount", "overdueTaskCount", "documentCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "myMeetingActions",
      "myTimesheet",
      "pendingApprovals",
      "upcomingMilestones",
      "reviewsAwaitingMe",
      "rfisAssignedToMe",
      "myProjects",
      "openTasks",
      "upcomingDeadlines",
      "recentDocuments",
      "recentActivity",
    ],
    quickActions: ["newTask", "uploadDocument"],
  },
  SALES: {
    focus: "The sales team's pipeline, and the proposals waiting for your decision.",
    kpis: ["pipelineValue", "openOpportunityCount", "clientCount", "openTaskCount"],
    widgets: [
      "attention",
      "announcements",
      "favorites",
      "recentWork",
      "upcomingMeetings",
      "pendingApprovals",
      "groupPipeline",
      "salesPipeline",
      "openOpportunities",
      "openTasks",
      "recentActivity",
    ],
    quickActions: ["newLead", "newOpportunity", "newClient"],
  },
};

/**
 * The Group workspace's dashboard (Workspace Context §18, §19, §84).
 *
 * One layout for everybody who works in the group, because each entry is
 * asked of every authorised company in turn and a person sees only what at
 * least one of their companies lets them read. An Owner ends up with all of it,
 * a Group Finance head with the finance and portfolio figures and what waits on
 * them. The company dashboards are the role layouts above, unchanged.
 *
 * No quick actions: creating a record needs a company workspace.
 *
 * `groupDashboardFor` puts the reader's own function first (§22): Head of
 * Finance is the Group Finance dashboard in the group and the Company Finance
 * dashboard in a company — same person, same function, different context.
 */
export const groupDashboard: DashboardConfig = {
  focus: "Across the companies of your group, as far as your access reaches.",
  kpis: [
    "groupCompanyCount",
    "groupActiveProjects",
    "groupPendingApprovals",
    "groupOpenTasks",
    "groupOverdueTasks",
    "groupEmployees",
    "groupExternalCompanies",
    "groupPortfolioValue",
  ],
  widgets: [
    "groupAttention",
    "keyProjects",
    "groupApprovals",
    "groupCompanies",
    "portfolioStatus",
    "projectTypes",
    "groupFinance",
    "groupPipeline",
    "groupTasks",
    "groupDepartments",
    "groupMilestones",
    "groupActivity",
  ],
  quickActions: [],
};

/** The Group workspace's dashboard for a role: the role's own group entries first, then the shared layout (§22). */
export function groupDashboardFor(role: RoleKey, position: PositionLevel = "MEMBER"): DashboardConfig {
  const own = dashboardForRole(role, position);
  const first = (ownKeys: string[], groupKeys: string[], declared: Record<string, { supportsGroupContext?: boolean }>) => [
    ...new Set([...ownKeys.filter((key) => declared[key]?.supportsGroupContext), ...groupKeys]),
  ];
  return {
    focus: own.focus,
    kpis: first(own.kpis, groupDashboard.kpis, kpis),
    widgets: first(own.widgets, groupDashboard.widgets, widgets),
    quickActions: [],
  };
}

export function dashboardForRole(role: RoleKey, position: PositionLevel = "MEMBER"): DashboardConfig {
  if (position !== "MEMBER" && managerDashboards[role]) return managerDashboards[role];
  return dashboards[role] ?? dashboards.VIEWER;
}
