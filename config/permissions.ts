/**
 * The NESTO permission registry (PRD #5 §8, PRD #9 §16–§19).
 *
 * Permissions are strings in the form `resource.action`, optionally with a
 * qualifier: `finance.invoice.approve`. Application code asks
 * `can(context, "project.create")` — never `if (role === "OWNER")`
 * (PRD #5 §8, PRD #10 §11).
 *
 * The registry is a flat list rather than a per-module structure so that a
 * permission key is unambiguous everywhere: database, seed, UI and tests all
 * refer to the same string.
 *
 * Edge-safe: no database imports.
 */
import type { ModuleKey } from "./modules";

export const PERMISSIONS = [
  /* Dashboard ------------------------------------------------------------ */
  "dashboard.view",

  /* Projects ------------------------------------------------------------- */
  "project.view",
  "project.create",
  "project.update",
  "project.archive",
  "project.restore",
  "project.manage",
  "project.manager.assign",
  "project.member.view",
  "project.member.add",
  "project.member.update",
  "project.member.remove",
  "project.task.view",
  "project.document.view",
  "project.activity.view",

  /* Tasks ---------------------------------------------------------------- */
  "task.view",
  "task.create",
  "task.update",
  "task.assign",
  "task.status.update",
  "task.complete",
  "task.reopen",
  "task.archive",
  "task.restore",
  "task.activity.view",

  /* Clients -------------------------------------------------------------- */
  "client.view",
  "client.create",
  "client.update",
  "client.archive",
  "client.restore",
  "client.project.view",
  "client.document.view",
  "client.activity.view",
  "contact.view",
  "contact.create",
  "contact.update",
  "contact.archive",
  "contact.restore",

  /* Documents ------------------------------------------------------------ */
  "document.view",
  "document.create",
  "document.update",
  "document.download",
  "document.archive",
  "document.restore",
  "document.activity.view",
  // A company-level document has no project or client to narrow it, so it is
  // governed by its own grant (PRD #13 §39, §47).
  "document.company.view",
  "document.company.create",

  /* Finance -------------------------------------------------------------- */
  "finance.view",
  "finance.manage",
  "finance.dashboard.view",
  "finance.report.view",
  "finance.export",
  "finance.company_summary.view",

  "finance.invoice.view",
  "finance.invoice.create",
  "finance.invoice.update",
  "finance.invoice.submit",
  "finance.invoice.approve",
  "finance.invoice.reject",
  "finance.invoice.mark_sent",
  "finance.invoice.cancel",
  "finance.invoice.archive",
  "finance.invoice.restore",

  "finance.payment.view",
  "finance.payment.create",
  "finance.payment.void",

  "finance.expense.view",
  "finance.expense.create",
  "finance.expense.update",
  "finance.expense.submit",
  "finance.expense.approve",
  "finance.expense.reject",
  "finance.expense.cancel",
  "finance.expense.archive",
  "finance.expense.restore",

  "finance.budget.view",
  "finance.budget.create",
  "finance.budget.update",
  "finance.budget.submit",
  "finance.budget.approve",
  "finance.budget.reject",
  "finance.budget.revise",
  "finance.budget.archive",
  "finance.budget.restore",

  "finance.commitment.view",
  "finance.commitment.create",
  "finance.commitment.update",
  "finance.commitment.submit",
  "finance.commitment.approve",
  "finance.commitment.reject",
  "finance.commitment.close",
  "finance.commitment.cancel",
  "finance.commitment.archive",
  "finance.commitment.restore",

  "finance.approval.view",
  "finance.approval.decide",
  /**
   * Permission to approve your own submission. Withheld by default, because
   * "who checked this?" must have an answer other than "the person who wrote
   * it" (PRD #15 §19).
   */
  "finance.approval.self",

  "finance.receivables.view",
  "finance.payables.view",
  "finance.cashflow.view",
  "finance.project_budget.view",
  "finance.project_cost_summary.view",
  "finance.project_cost_detail.view",

  "finance.document.view",
  "finance.document.create",

  "finance.settings.view",
  "finance.settings.manage",
  "finance.activity.view",

  /* HR ------------------------------------------------------------------- */
  "hr.view",
  "hr.manage",
  "hr.dashboard.view",

  "hr.employee.view",
  "hr.employee.update",
  "hr.employee.create_profile",
  "hr.employee.update_profile",
  "hr.employee.status.update",
  "hr.employee.manager.assign",

  "hr.employment.view",
  "hr.employment.update",

  /**
   * Pay is its own permission, never implied by employee access
   * (PRD #16 §15, §17). `hr.employee.view` tells you somebody works here;
   * `hr.compensation.view` tells you what they earn, and those are different
   * decisions.
   */
  "hr.compensation.view",
  "hr.compensation.update",

  "hr.leave.view",
  "hr.leave.create",
  "hr.leave.update",
  "hr.leave.submit",
  "hr.leave.approve",
  "hr.leave.reject",
  "hr.leave.cancel",
  "hr.leave.balance.view",
  "hr.leave.balance.manage",
  /** The reason on a leave request may be medical (PRD #16 §95). */
  "hr.leave.reason.view",

  "hr.attendance.view",
  "hr.attendance.create",
  "hr.attendance.update",
  "hr.attendance.approve",

  "hr.onboarding.view",
  "hr.onboarding.manage",
  "hr.offboarding.view",
  "hr.offboarding.manage",

  "hr.document.view",
  "hr.document.create",

  "hr.report.view",
  "hr.export",
  "hr.activity.view",

  /**
   * Self-service (PRD #16 §16).
   *
   * These are what a role with no HR business access still holds: their own
   * employment record, their own leave, their own attendance, their own files.
   */
  "hr.self.employment",
  "hr.self.leave",
  "hr.self.attendance",
  "hr.self.documents",

  /* Sales ---------------------------------------------------------------- */
  "sales.view",
  "sales.manage",
  "sales.dashboard.view",

  "sales.lead.view",
  "sales.lead.create",
  "sales.lead.update",
  "sales.lead.assign",
  "sales.lead.qualify",
  "sales.lead.disqualify",
  "sales.lead.convert",
  "sales.lead.archive",
  "sales.lead.restore",

  "sales.opportunity.view",
  "sales.opportunity.create",
  "sales.opportunity.update",
  "sales.opportunity.assign",
  "sales.opportunity.stage.update",
  "sales.opportunity.mark_won",
  "sales.opportunity.mark_lost",
  "sales.opportunity.reopen",
  "sales.opportunity.archive",
  "sales.opportunity.restore",

  "sales.proposal.view",
  "sales.proposal.create",
  "sales.proposal.update",
  "sales.proposal.submit",
  "sales.proposal.approve",
  "sales.proposal.reject",
  "sales.proposal.mark_sent",
  "sales.proposal.accept",
  "sales.proposal.decline",
  "sales.proposal.cancel",
  "sales.proposal.archive",
  "sales.proposal.restore",

  "sales.pipeline.view",
  "sales.pipeline.manage",

  "sales.task.view",
  "sales.task.create",

  "sales.document.view",
  "sales.document.create",

  "sales.activity.view",
  "sales.report.view",
  "sales.export",

  /**
   * Conversion (PRD #17 §397).
   *
   * Each of these is only half the decision: turning a lead into a client also
   * needs `client.create`, and winning a deal into a project also needs
   * `project.create`. Sales never grants access to another module's records.
   */
  "sales.client.convert",
  "sales.project.convert",
  "sales.owner.assign",
  /**
   * Permission to approve your own proposal. Withheld by default, for the same
   * reason as in Finance: "who checked the price?" must have an answer other
   * than "the person who quoted it" (PRD #17 §20).
   */
  "sales.approval.self",

  /* Legal / Contracts ---------------------------------------------------- */
  "legal.view",
  "legal.manage",
  "legal.contract.view",
  "legal.contract.create",
  "legal.contract.update",
  "legal.contract.approve",
  "legal.contract.archive",

  /* Procurement ---------------------------------------------------------- */
  "procurement.view",
  "procurement.manage",
  "procurement.request.view",
  "procurement.request.create",
  "procurement.request.update",
  "procurement.request.approve",
  "procurement.order.view",
  "procurement.order.create",
  "procurement.order.update",
  "procurement.order.approve",

  /* Inventory ------------------------------------------------------------ */
  "inventory.view",
  "inventory.manage",
  "inventory.item.view",
  "inventory.item.create",
  "inventory.item.update",
  "inventory.item.archive",
  "inventory.movement.view",
  "inventory.movement.create",

  /* QA / QC -------------------------------------------------------------- */
  "qaqc.view",
  "qaqc.manage",
  "qaqc.record.view",
  "qaqc.record.create",
  "qaqc.record.update",
  "qaqc.record.close",

  /* HSE ------------------------------------------------------------------ */
  "hse.view",
  "hse.manage",
  "hse.record.view",
  "hse.record.create",
  "hse.record.update",
  "hse.record.close",

  /* Team ----------------------------------------------------------------- */
  "team.view",
  "team.manage",
  "team.member.view",
  "team.member.invite",
  "team.member.update",
  "team.member.role.assign",
  "team.member.department.assign",
  "team.member.deactivate",
  "team.member.reactivate",
  "team.member.suspend",
  "team.member.unsuspend",
  // Assigning OWNER is its own grant: Admin is not Owner (PRD #14 §95, §96).
  "team.owner.assign",
  // Last-login is security metadata, not directory data (PRD #14 §49).
  "team.member.security_metadata.view",
  "team.invitation.view",
  "team.invitation.resend",
  "team.invitation.cancel",
  "team.department.view",
  "team.department.create",
  "team.department.update",
  "team.department.archive",
  "team.department.restore",
  "team.activity.view",

  /* Company -------------------------------------------------------------- */
  "company.view",
  "company.manage",

  /* Company configuration (PRD #24 §13) ---------------------------------- */
  "company.settings.view",
  "company.settings.update",
  "company.modules.view",
  "company.modules.manage",
  "company.integrations.view",
  "company.integrations.manage",
  "company.numbering.view",
  "company.numbering.manage",
  "company.localization.view",
  "company.localization.manage",
  "company.finance_settings.view",
  "company.finance_settings.manage",
  "company.security_settings.view",
  "company.security_settings.manage",

  /* Settings ------------------------------------------------------------- */
  "settings.view",
  "settings.manage",

  /* Audit (PRD #28 §221) -------------------------------------------------- */
  "audit.view",
  "audit.export",
  "audit.sensitive.view",

  /* Support -------------------------------------------------------------- */
  "support.view",
  "support.manage",
  "support.request.view",
  "support.request.create",
  "support.request.update",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Which module owns a permission.
 *
 * Permission prefixes are singular (`project.view`) while module keys are
 * plural (`projects`), and Legal lives at the `contracts` route — so the map is
 * explicit rather than inferred from the string.
 */
const PERMISSION_MODULE: Record<string, ModuleKey> = {
  dashboard: "dashboard",
  project: "projects",
  task: "tasks",
  client: "clients",
  contact: "clients",
  document: "documents",
  finance: "finance",
  hr: "hr",
  sales: "sales",
  legal: "contracts",
  procurement: "procurement",
  inventory: "inventory",
  qaqc: "qaqc",
  hse: "hse",
  team: "team",
  company: "company",
  settings: "settings",
  support: "support",
};

export function moduleForPermission(permission: string): ModuleKey | null {
  return PERMISSION_MODULE[permission.split(".")[0]] ?? null;
}

/** Every permission belonging to one module, used by the seed and by tests. */
export function permissionsForModule(moduleKey: ModuleKey): Permission[] {
  return PERMISSIONS.filter((permission) => moduleForPermission(permission) === moduleKey);
}

/**
 * The `action` half stored on the Permission row: the final segment of the key.
 * `finance.invoice.approve` → `approve`.
 */
export function permissionAction(permission: string): string {
  const parts = permission.split(".");
  return parts[parts.length - 1];
}

/**
 * Actions that mutate data. Used to keep read-only roles honest.
 *
 * Every verb a module lifecycle can end in belongs here: if an action changes a
 * business record it must not survive the read-only filter simply because its
 * name is new (PRD #5 §27).
 */
const MUTATING_ACTIONS = new Set([
  "create",
  "update",
  "delete",
  "archive",
  "restore",
  "approve",
  "reject",
  "manage",
  "assign",
  "add",
  "remove",
  "complete",
  "close",
  "reopen",
  "submit",
  "cancel",
  "decide",
  "void",
  "post",
  "reverse",
  "release",
  "revoke",
  "verify",
  "activate",
  "suspend",
  "unsuspend",
  "issue",
  "select",
  "terminate",
  "convert",
  "qualify",
  "disqualify",
  "execute",
  "resend",
  "invite",
  "deactivate",
  "reactivate",
  "start",
  "escalate",
  "sync",
  "expire",
  "fulfill",
  "control",
  "assess",
  "investigate",
]);

export function isMutatingPermission(permission: string): boolean {
  return MUTATING_ACTIONS.has(permissionAction(permission));
}
