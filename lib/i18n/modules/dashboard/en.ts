import { dashboardConfigEn } from "./config-en";

export const dashboardEn = {
  ...dashboardConfigEn,
  title: "Dashboard",
  heading: {
    company: { lead: "Company", accent: "overview" },
    group: { lead: "Group", accent: "overview" },
  },
  across: "Across {name}",
  viewAll: "View all",
  showAllApprovals: "Show all pending approvals",
  loadFailed: "Unable to load this section. Refresh the page to try again.",
  progress: "Progress",
  progressOf: "{name} progress",
  type: "Type",
  group: "Group",
  activeCompanies_one: "{count} active company",
  activeCompanies_other: "{count} active companies",
  suspended: "{count} suspended",
  demoDisclaimer: "Demo environment — public company and project information combined with synthetic operational data.",
  viewByCompany: "View by company",
  partNotLoaded: "Part of this could not be loaded",
  startHere: "Start here",
  hideStartHere: "Hide Start here",
  nothingShared:
    "Nothing has been shared with you here yet. Projects and tasks appear on this dashboard when a colleague adds you to a project or assigns you work.",
};
