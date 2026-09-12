/**
 * Role × Module access matrix (PRD #5 §10, §54).
 *
 * This file is the single source of truth for what a role may do. Navigation,
 * dashboards, module tabs, route guards, the API layer and the database seed
 * all resolve from here — there is no second interpretation anywhere in the
 * codebase (PRD #5 §131, PRD #3 §99).
 *
 * The matrix is written in the same shorthand the PRD table uses so the two can
 * be compared line by line:
 *
 *   ACCESS/SCOPE   M = Manage   A = Approve   C = Contribute   V = View
 *                  —  = no access
 *
 *                  S = Self   AS = Assigned   P = Project
 *                  D = Department   C = Company   SYS = System
 *
 * Granular permissions are derived from the access level through the module
 * ladders below, then adjusted by the `extra` / `deny` overrides that encode the
 * PRD's `*` ("restricted sub-permissions only") cells. Nothing here hardcodes a
 * role name into feature code — feature code only ever asks `can(...)`.
 *
 * Edge-safe: no database imports.
 */
import type { AccessLevel, DataScope } from "./access";
import { MODULE_KEYS, type ModuleKey } from "./modules";
import { isMutatingPermission, type Permission } from "./permissions";
import { ROLE_KEYS, roles, type RoleKey } from "./roles";

/* -------------------------------------------------------------------------- */
/* Permission ladders                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What each access level grants inside a module. Levels are cumulative for
 * reading: MANAGE includes APPROVE includes CONTRIBUTE includes VIEW
 * (PRD #5 §6).
 */
type ModuleLadder = Partial<Record<Exclude<AccessLevel, "NONE">, Permission[]>>;

const LADDERS: Record<ModuleKey, ModuleLadder> = {
  dashboard: {
    VIEW: ["dashboard.view"],
  },
  projects: {
    VIEW: [
      "project.view",
      "project.member.view",
      "project.task.view",
      "project.document.view",
      "project.activity.view",
    ],
    CONTRIBUTE: ["project.update"],
    MANAGE: [
      "project.create",
      "project.archive",
      "project.restore",
      "project.manage",
      "project.manager.assign",
      "project.member.add",
      "project.member.update",
      "project.member.remove",
    ],
  },
  tasks: {
    VIEW: ["task.view", "task.activity.view"],
    CONTRIBUTE: ["task.create", "task.update", "task.status.update", "task.complete"],
    // Assigning someone else's work, reopening a closed task and archiving are
    // management actions: a contributor may run their own task but not
    // redirect another person's (PRD #11 §51, §122).
    MANAGE: ["task.assign", "task.reopen", "task.archive", "task.restore"],
  },
  clients: {
    VIEW: [
      "client.view",
      "contact.view",
      "client.project.view",
      "client.document.view",
      "client.activity.view",
    ],
    CONTRIBUTE: ["client.create", "client.update", "contact.create", "contact.update"],
    MANAGE: ["client.archive", "client.restore", "contact.archive", "contact.restore"],
  },
  documents: {
    VIEW: ["document.view", "document.download", "document.activity.view"],
    CONTRIBUTE: ["document.create", "document.update"],
    MANAGE: ["document.archive", "document.restore"],
  },
  /**
   * Finance (PRD #15 §16, §18).
   *
   * APPROVE is a rung of its own rather than something MANAGE implies for free:
   * operational management and approval authority are different jobs, and a
   * role that holds both holds it because the matrix says so, not by accident
   * (PRD #15 §18). `finance.approval.self` is never on the ladder at all — it
   * is an explicit grant, because "who checked this?" must have an answer other
   * than "the person who wrote it" (PRD #15 §19).
   */
  finance: {
    VIEW: [
      "finance.view",
      "finance.dashboard.view",
      "finance.report.view",
      "finance.activity.view",
      "finance.invoice.view",
      "finance.payment.view",
      "finance.expense.view",
      "finance.budget.view",
      "finance.commitment.view",
      "finance.approval.view",
      "finance.receivables.view",
      "finance.payables.view",
      "finance.cashflow.view",
      "finance.project_budget.view",
      "finance.project_cost_summary.view",
      "finance.document.view",
      "finance.settings.view",
    ],
    CONTRIBUTE: [
      "finance.export",
      "finance.document.create",
      "finance.invoice.create",
      "finance.invoice.update",
      "finance.invoice.submit",
      "finance.payment.create",
      "finance.expense.create",
      "finance.expense.update",
      "finance.expense.submit",
      "finance.budget.create",
      "finance.budget.update",
      "finance.budget.submit",
      "finance.commitment.create",
      "finance.commitment.update",
      "finance.commitment.submit",
    ],
    APPROVE: [
      "finance.approval.decide",
      "finance.invoice.approve",
      "finance.invoice.reject",
      "finance.expense.approve",
      "finance.expense.reject",
      "finance.budget.approve",
      "finance.budget.reject",
      "finance.commitment.approve",
      "finance.commitment.reject",
    ],
    MANAGE: [
      "finance.manage",
      "finance.company_summary.view",
      "finance.project_cost_detail.view",
      "finance.invoice.mark_sent",
      "finance.invoice.cancel",
      "finance.invoice.archive",
      "finance.invoice.restore",
      "finance.payment.void",
      "finance.expense.cancel",
      "finance.expense.archive",
      "finance.expense.restore",
      "finance.budget.revise",
      "finance.budget.archive",
      "finance.budget.restore",
      "finance.commitment.close",
      "finance.commitment.cancel",
      "finance.commitment.archive",
      "finance.commitment.restore",
      "finance.settings.manage",
    ],
  },
  /**
   * HR (PRD #16 §16, §17).
   *
   * `hr.compensation.view` is deliberately absent from every rung. Pay is not
   * something a role acquires by being given "HR access" — it is an explicit
   * grant, held by the Owner and the HR role and nobody else by default
   * (PRD #16 §15, §17, §67).
   *
   * The four `hr.self.*` grants sit at VIEW, which is what makes self-service
   * work for a role scoped to itself: an Engineer with SELF scope can file
   * their own leave without holding `hr.leave.create` over anybody else
   * (PRD #16 §74).
   */
  hr: {
    VIEW: [
      "hr.view",
      "hr.dashboard.view",
      "hr.employee.view",
      "hr.employment.view",
      "hr.leave.view",
      "hr.leave.balance.view",
      "hr.attendance.view",
      "hr.onboarding.view",
      "hr.offboarding.view",
      "hr.document.view",
      "hr.report.view",
      "hr.activity.view",
      "hr.self.employment",
      "hr.self.leave",
      "hr.self.attendance",
      "hr.self.documents",
    ],
    CONTRIBUTE: [
      "hr.export",
      "hr.document.create",
      "hr.leave.create",
      "hr.leave.update",
      "hr.leave.submit",
      "hr.attendance.create",
      "hr.attendance.update",
    ],
    APPROVE: [
      "hr.leave.approve",
      "hr.leave.reject",
      "hr.leave.cancel",
      "hr.attendance.approve",
    ],
    MANAGE: [
      "hr.manage",
      "hr.employee.update",
      "hr.employee.create_profile",
      "hr.employee.update_profile",
      "hr.employee.status.update",
      "hr.employee.manager.assign",
      "hr.employment.update",
      "hr.leave.balance.manage",
      "hr.leave.reason.view",
      "hr.onboarding.manage",
      "hr.offboarding.manage",
    ],
  },
  /**
   * Sales (PRD #17 §14, §19, §20).
   *
   * APPROVE is its own rung, as in Finance: running the pipeline and signing
   * off the price a client is quoted are different jobs (PRD #17 §19). The
   * conversion grants sit at MANAGE because each of them reaches into another
   * module's records, and `sales.approval.self` is on no rung at all — it is an
   * explicit grant, so "who checked the price?" has an answer other than "the
   * person who quoted it" (PRD #17 §20).
   */
  sales: {
    VIEW: [
      "sales.view",
      "sales.dashboard.view",
      "sales.lead.view",
      "sales.opportunity.view",
      "sales.proposal.view",
      "sales.pipeline.view",
      "sales.task.view",
      "sales.document.view",
      "sales.activity.view",
      "sales.report.view",
    ],
    CONTRIBUTE: [
      "sales.export",
      "sales.task.create",
      "sales.document.create",
      "sales.lead.create",
      "sales.lead.update",
      "sales.lead.qualify",
      "sales.lead.disqualify",
      "sales.opportunity.create",
      "sales.opportunity.update",
      "sales.opportunity.stage.update",
      "sales.proposal.create",
      "sales.proposal.update",
      "sales.proposal.submit",
    ],
    APPROVE: ["sales.proposal.approve", "sales.proposal.reject"],
    MANAGE: [
      "sales.manage",
      "sales.pipeline.manage",
      "sales.owner.assign",
      "sales.lead.assign",
      "sales.lead.convert",
      "sales.lead.archive",
      "sales.lead.restore",
      "sales.opportunity.assign",
      "sales.opportunity.mark_won",
      "sales.opportunity.mark_lost",
      "sales.opportunity.reopen",
      "sales.opportunity.archive",
      "sales.opportunity.restore",
      "sales.proposal.mark_sent",
      "sales.proposal.accept",
      "sales.proposal.decline",
      "sales.proposal.cancel",
      "sales.proposal.archive",
      "sales.proposal.restore",
      "sales.client.convert",
      "sales.project.convert",
    ],
  },
  /**
   * Legal / Contracts (PRD #18 §16, §19, §22, §27).
   *
   * APPROVE is its own rung, as in Finance and Sales. Reading the commercial
   * value is on VIEW because most people who may see a contract at all need to
   * know what it is worth — but it is a separate grant precisely so a role can
   * be given the agreement without the price (PRD #18 §22).
   *
   * `legal.confidential_terms.view` and `legal.approval.self` are on no rung.
   * Legal notes are an assessment written for the company's lawyers, and
   * deciding your own submission is not something a promotion should confer
   * (PRD #18 §23, §116).
   */
  contracts: {
    VIEW: [
      "legal.view",
      "legal.dashboard.view",
      "legal.contract.view",
      "legal.commercial.view",
      "legal.party.view",
      "legal.obligation.view",
      "legal.amendment.view",
      "legal.approval.view",
      "legal.document.view",
      "legal.task.view",
      "legal.activity.view",
      "legal.report.view",
      "legal.sales_source.view",
      "legal.client_link.view",
      "legal.project_link.view",
    ],
    CONTRIBUTE: [
      "legal.export",
      "legal.contract.create",
      "legal.contract.update",
      "legal.contract.submit_review",
      "legal.party.manage",
      "legal.obligation.create",
      "legal.obligation.update",
      "legal.amendment.create",
      "legal.amendment.update",
      "legal.amendment.submit",
      "legal.document.create",
      "legal.task.create",
    ],
    APPROVE: [
      "legal.approval.decide",
      "legal.contract.approve",
      "legal.contract.reject",
      "legal.amendment.approve",
      "legal.amendment.reject",
    ],
    MANAGE: [
      "legal.manage",
      "legal.contract.owner.assign",
      "legal.contract.review",
      "legal.contract.submit_approval",
      "legal.contract.mark_sent",
      "legal.contract.mark_signed",
      "legal.contract.activate",
      "legal.contract.expire",
      "legal.contract.terminate",
      "legal.contract.cancel",
      "legal.contract.archive",
      "legal.contract.restore",
      "legal.obligation.complete",
      "legal.obligation.cancel",
      "legal.amendment.mark_sent",
      "legal.amendment.mark_signed",
      "legal.amendment.activate",
      "legal.amendment.cancel",
      "legal.amendment.archive",
    ],
  },
  procurement: {
    VIEW: [
      "procurement.view",
      "procurement.dashboard.view",
      "procurement.supplier.view",
      "procurement.request.view",
      "procurement.rfq.view",
      "procurement.quote.view",
      "procurement.order.view",
      "procurement.receipt.view",
      "procurement.approval.view",
      "procurement.document.view",
      "procurement.task.view",
      "procurement.activity.view",
      "procurement.report.view",
      "procurement.commitment.view",
    ],
    CONTRIBUTE: [
      "procurement.export",
      "procurement.supplier.create",
      "procurement.supplier.update",
      "procurement.request.create",
      "procurement.request.update",
      "procurement.request.submit",
      "procurement.rfq.create",
      "procurement.rfq.update",
      "procurement.quote.create",
      "procurement.quote.update",
      "procurement.order.create",
      "procurement.order.update",
      "procurement.order.submit",
      "procurement.receipt.create",
      "procurement.document.create",
      "procurement.task.create",
    ],
    APPROVE: [
      "procurement.approval.decide",
      "procurement.request.approve",
      "procurement.request.reject",
      "procurement.order.approve",
      "procurement.order.reject",
      "procurement.budget.view",
    ],
    MANAGE: [
      "procurement.manage",
      "procurement.supplier.archive",
      "procurement.supplier.restore",
      "procurement.request.cancel",
      "procurement.request.archive",
      "procurement.request.restore",
      "procurement.rfq.issue",
      "procurement.rfq.close",
      "procurement.rfq.cancel",
      "procurement.quote.select",
      "procurement.quote.disqualify",
      "procurement.order.issue",
      "procurement.order.cancel",
      "procurement.order.close",
      "procurement.order.archive",
      "procurement.order.restore",
      "procurement.receipt.update",
      "procurement.receipt.void",
      "procurement.budget.view",
      "procurement.commitment.sync",
    ],
  },
  inventory: {
    VIEW: [
      "inventory.view",
      "inventory.dashboard.view",
      "inventory.item.view",
      "inventory.warehouse.view",
      "inventory.location.view",
      "inventory.movement.view",
      "inventory.balance.view",
      "inventory.low_stock.view",
      "inventory.receipt.view",
      "inventory.issue.view",
      "inventory.transfer.view",
      "inventory.return.view",
      "inventory.adjustment.view",
      "inventory.reservation.view",
      "inventory.document.view",
      "inventory.task.view",
      "inventory.activity.view",
      "inventory.report.view",
    ],
    CONTRIBUTE: [
      "inventory.export",
      "inventory.item.update",
      "inventory.movement.create",
      "inventory.receipt.create",
      "inventory.issue.create",
      "inventory.issue.update",
      "inventory.transfer.create",
      "inventory.transfer.update",
      "inventory.return.create",
      "inventory.reservation.create",
      "inventory.reservation.update",
      "inventory.document.create",
      "inventory.task.create",
    ],
    /*
     * Posting is an APPROVE-level act, not a contribution (PRD #20 §281).
     * Writing a delivery note down and committing it to the stock ledger are
     * different decisions, and the ladder says so.
     */
    APPROVE: [
      "inventory.receipt.post",
      "inventory.issue.post",
      "inventory.transfer.post",
      "inventory.return.post",
      "inventory.reservation.release",
      "inventory.reservation.fulfill",
    ],
    MANAGE: [
      "inventory.manage",
      "inventory.item.create",
      "inventory.item.archive",
      "inventory.item.restore",
      "inventory.warehouse.create",
      "inventory.warehouse.update",
      "inventory.warehouse.archive",
      "inventory.warehouse.restore",
      "inventory.location.create",
      "inventory.location.update",
      "inventory.location.archive",
      "inventory.location.restore",
      "inventory.receipt.reverse",
      "inventory.issue.cancel",
      "inventory.issue.reverse",
      "inventory.transfer.cancel",
      "inventory.transfer.reverse",
      "inventory.adjustment.create",
      "inventory.adjustment.update",
      "inventory.adjustment.post",
      "inventory.adjustment.cancel",
      "inventory.adjustment.reverse",
      "inventory.reservation.cancel",
    ],
  },
  qaqc: {
    VIEW: ["qaqc.view", "qaqc.record.view"],
    CONTRIBUTE: ["qaqc.record.create", "qaqc.record.update"],
    APPROVE: ["qaqc.record.close"],
    MANAGE: ["qaqc.manage"],
  },
  hse: {
    VIEW: ["hse.view", "hse.record.view"],
    CONTRIBUTE: ["hse.record.create", "hse.record.update"],
    APPROVE: ["hse.record.close"],
    MANAGE: ["hse.manage"],
  },
  team: {
    VIEW: ["team.view", "team.member.view", "team.department.view", "team.activity.view"],
    // Editing a colleague's membership is management, not contribution: there
    // is nothing a contributor should be changing about somebody else
    // (PRD #14 §18, §85).
    MANAGE: [
      "team.manage",
      "team.member.invite",
      "team.member.update",
      "team.member.role.assign",
      "team.member.department.assign",
      "team.member.deactivate",
      "team.member.reactivate",
      "team.member.suspend",
      "team.member.unsuspend",
      "team.member.security_metadata.view",
      "team.invitation.view",
      "team.invitation.resend",
      "team.invitation.cancel",
      "team.department.create",
      "team.department.update",
      "team.department.archive",
      "team.department.restore",
    ],
  },
  company: {
    VIEW: [
      "company.view",
      "company.settings.view",
      "company.modules.view",
      "company.integrations.view",
      "company.numbering.view",
      "company.localization.view",
    ],
    MANAGE: [
      "company.manage",
      "company.settings.update",
      "company.modules.manage",
      "company.integrations.manage",
      "company.numbering.manage",
      "company.localization.manage",
      "company.finance_settings.view",
      "company.finance_settings.manage",
      "company.security_settings.view",
      "company.security_settings.manage",
    ],
  },
  settings: {
    VIEW: ["settings.view"],
    MANAGE: ["settings.manage"],
  },
  support: {
    VIEW: ["support.view", "support.request.view"],
    CONTRIBUTE: ["support.request.create", "support.request.update"],
    MANAGE: ["support.manage"],
  },
};

const LEVEL_ORDER: Exclude<AccessLevel, "NONE">[] = ["VIEW", "CONTRIBUTE", "APPROVE", "MANAGE"];

function ladderPermissions(moduleKey: ModuleKey, level: AccessLevel): Permission[] {
  if (level === "NONE") return [];
  const ladder = LADDERS[moduleKey];
  const upTo = LEVEL_ORDER.indexOf(level);
  return LEVEL_ORDER.slice(0, upTo + 1).flatMap((step) => ladder[step] ?? []);
}

/* -------------------------------------------------------------------------- */
/* The matrix                                                                  */
/* -------------------------------------------------------------------------- */

const ACCESS_CODES: Record<string, AccessLevel> = {
  M: "MANAGE",
  A: "APPROVE",
  C: "CONTRIBUTE",
  V: "VIEW",
};

const SCOPE_CODES: Record<string, DataScope> = {
  S: "SELF",
  AS: "ASSIGNED",
  P: "PROJECT",
  D: "DEPARTMENT",
  C: "COMPANY",
  SYS: "SYSTEM",
};

/** `"M/C"` → MANAGE over COMPANY. `"—"` → no access. */
type MatrixCell = string;

type RoleMatrixRow = Partial<Record<ModuleKey, MatrixCell>>;

/**
 * PRD #5 §10, transcribed. A module missing from a row means no access.
 * Dashboard is granted to every authenticated role and is therefore implicit.
 */
const MATRIX: Record<RoleKey, RoleMatrixRow> = {
  OWNER: {
    projects: "M/C", tasks: "M/C", clients: "M/C", documents: "M/C",
    finance: "M/C", hr: "M/C", sales: "M/C", contracts: "M/C",
    procurement: "M/C", inventory: "M/C", qaqc: "M/C", hse: "M/C",
    team: "M/C", company: "M/C", settings: "M/C", support: "V/C",
  },
  ADMIN: {
    projects: "V/C", tasks: "V/C", clients: "V/C", documents: "M/C",
    hr: "V/C",
    team: "M/C", company: "M/C", settings: "M/SYS", support: "M/SYS",
  },
  COMPANY_IT: {
    tasks: "C/S", documents: "V/C", hr: "V/S",
    team: "V/C", company: "V/C", settings: "M/SYS", support: "M/SYS",
  },
  HR: {
    projects: "V/C", tasks: "C/S", documents: "C/D", hr: "M/C",
    team: "M/C", company: "V/C", settings: "V/S", support: "V/C",
  },
  CEO: {
    projects: "V/C", tasks: "V/C", clients: "V/C", documents: "V/C",
    finance: "A/C", hr: "V/C", sales: "A/C", contracts: "A/C",
    procurement: "A/C", inventory: "V/C", qaqc: "V/C", hse: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  PROJECT_MANAGER: {
    projects: "M/P", tasks: "M/P", clients: "C/P", documents: "C/P",
    finance: "V/P", hr: "V/P", sales: "V/P", contracts: "V/P",
    procurement: "C/P", inventory: "V/P", qaqc: "C/P", hse: "C/P",
    team: "V/P", company: "V/C", support: "V/C",
  },
  ARCHITECT: {
    projects: "C/AS", tasks: "C/AS", clients: "V/P", documents: "C/P",
    finance: "V/P", hr: "V/S", qaqc: "V/P", hse: "V/P",
    team: "V/P", support: "V/C",
  },
  ENGINEER: {
    projects: "C/AS", tasks: "C/AS", clients: "V/P", documents: "C/P",
    finance: "V/P", hr: "V/S",
    procurement: "V/P", inventory: "V/P", qaqc: "C/P", hse: "C/P",
    team: "V/P", support: "V/C",
  },
  FINANCE: {
    projects: "V/C", tasks: "C/S", clients: "V/C", documents: "C/C",
    finance: "M/C", hr: "V/S", sales: "V/C", contracts: "V/C",
    procurement: "V/C", inventory: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  LEGAL: {
    projects: "V/C", tasks: "C/S", clients: "V/C", documents: "C/C",
    finance: "V/C", sales: "V/C", contracts: "M/C", procurement: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  SALES: {
    projects: "V/C", tasks: "C/S", clients: "M/C", documents: "C/C",
    finance: "V/C", sales: "M/C", contracts: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  PROCUREMENT: {
    projects: "V/C", tasks: "C/S", documents: "C/C",
    finance: "V/C", contracts: "V/C", procurement: "M/C", inventory: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  INVENTORY: {
    projects: "V/P", tasks: "C/S", documents: "C/C",
    finance: "V/P", procurement: "C/C", inventory: "M/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  QAQC: {
    projects: "V/P", tasks: "C/P", documents: "C/P", hr: "V/S",
    qaqc: "M/C", hse: "V/P",
    team: "V/P", company: "V/C", support: "V/C",
  },
  HSE: {
    projects: "V/P", tasks: "C/P", documents: "C/P", hr: "V/S",
    qaqc: "V/P", hse: "M/C",
    team: "V/P", company: "V/C", support: "V/C",
  },
  VIEWER: {
    projects: "V/AS", tasks: "V/AS", clients: "V/AS", documents: "V/AS",
    team: "V/AS", company: "V/C", support: "V/C",
  },
};

/**
 * The PRD's `*` cells — "restricted sub-permissions only".
 *
 * `deny` removes permissions the ladder would otherwise grant, `extra` adds
 * ones a level below MANAGE would not reach. Both are per role × module so the
 * restriction is visible next to the cell it qualifies.
 */
type Override = { extra?: Permission[]; deny?: Permission[] };

const OVERRIDES: Partial<Record<RoleKey, Partial<Record<ModuleKey, Override>>>> = {
  OWNER: {
    // Promoting somebody to Owner is the one company action an Admin must not
    // be able to take on their own (PRD #14 §95, §96).
    team: { extra: ["team.owner.assign"] },
    // The Owner is the one role that may approve their own submission: in a
    // company where they are the only approver, the alternative is a record
    // nobody can ever decide (PRD #15 §19, PRD #17 §20).
    finance: { extra: ["finance.approval.self"] },
    sales: { extra: ["sales.approval.self"] },
    contracts: { extra: ["legal.approval.self", "legal.confidential_terms.view"] },
    // Pay is never on the ladder; the Owner holds it explicitly (PRD #16 §17).
    hr: { extra: ["hr.compensation.view", "hr.compensation.update"] },
    /**
     * Audit is evidence about everyone, including administrators, so it is not
     * on any ladder. Only the Owner holds it by default — an Admin is not
     * automatically an audit superuser (PRD #28 §222-§225, PRD #35 §123).
     */
    settings: { extra: ["audit.view", "audit.export", "audit.sensitive.view"] },
  },
  ADMIN: {
    /**
     * Administering the platform is not seeing the HR file (PRD #16 §18).
     *
     * An Admin manages team configuration and company settings, and reads the
     * employment directory. They do not automatically get the employment file:
     * contracts, identification and sick notes are documents somebody filed in
     * confidence. Pay never reaches them either — `hr.compensation.view` is
     * absent from every rung of the ladder — and the leave reason sits at
     * MANAGE, above their level.
     */
    hr: { deny: ["hr.document.view"] },
    /**
     * Company settings are not the finance ledger's defaults (PRD #24 §15,
     * §17). An Admin configures the company, its modules and its localisation;
     * base currency, tax and payment terms stay with whoever holds Finance.
     */
    company: { deny: ["company.finance_settings.view", "company.finance_settings.manage"] },
  },
  CEO: {
    // Executive visibility without the bookkeeping surface (PRD #5 §16,
    // PRD #15 §285): overview, approvals, reports and read access, with no
    // operational create/edit controls and no self-approval.
    finance: {
      extra: ["finance.company_summary.view"],
      deny: [
        "finance.invoice.create",
        "finance.invoice.update",
        "finance.invoice.submit",
        "finance.invoice.mark_sent",
        "finance.payment.create",
        "finance.expense.create",
        "finance.expense.update",
        "finance.expense.submit",
        "finance.budget.create",
        "finance.budget.update",
        "finance.budget.submit",
        "finance.commitment.create",
        "finance.commitment.update",
        "finance.commitment.submit",
        "finance.export",
        "finance.document.create",
      ],
    },
    /**
     * Commercial approval without the sales desk (PRD #17 §13, §23, §351).
     *
     * The CEO reads the pipeline, decides proposals and runs the reports. They
     * do not work leads or edit opportunities: APPROVE sits above CONTRIBUTE on
     * the ladder, so without this the approver would also be an operator.
     */
    sales: {
      deny: [
        "sales.lead.create",
        "sales.lead.update",
        "sales.lead.qualify",
        "sales.lead.disqualify",
        "sales.opportunity.create",
        "sales.opportunity.update",
        "sales.opportunity.stage.update",
        "sales.proposal.create",
        "sales.proposal.update",
        "sales.proposal.submit",
        "sales.task.create",
        "sales.document.create",
        "sales.export",
      ],
    },
    /**
     * The approver, not the legal desk (PRD #18 §26, §398).
     *
     * The CEO reads the portfolio, decides contracts and amendments, and runs
     * the reports. They do not draft agreements, edit parties or record
     * obligations: APPROVE sits above CONTRIBUTE on the ladder, so without this
     * the person signing contracts off would also be writing them.
     */
    contracts: {
      deny: [
        "legal.contract.create",
        "legal.contract.update",
        "legal.contract.submit_review",
        "legal.party.manage",
        "legal.obligation.create",
        "legal.obligation.update",
        "legal.amendment.create",
        "legal.amendment.update",
        "legal.amendment.submit",
        "legal.document.create",
        "legal.task.create",
      ],
    },
    procurement: { deny: ["procurement.request.create", "procurement.request.update"] },
  },
  HR: {
    // The role the module exists for: everything on the ladder, plus pay
    // (PRD #16 §17).
    hr: { extra: ["hr.compensation.view", "hr.compensation.update"] },
  },
  PROJECT_MANAGER: {
    /**
     * Project finance only (PRD #5 §17, PRD #15 §183).
     *
     * Budget, commitments and the cost summary for their own projects. Not
     * invoices, not payments, and no company cash position: a project manager
     * who can open the receivables ledger has company-wide finance access by
     * another name.
     */
    finance: {
      deny: [
        "finance.invoice.view",
        "finance.payment.view",
        "finance.expense.view",
        "finance.receivables.view",
        "finance.payables.view",
        "finance.cashflow.view",
        "finance.approval.view",
        "finance.settings.view",
      ],
    },
    /**
     * No HR confidential surface through project scope (PRD #16 §168).
     *
     * A project manager needs to know who is on their project, which is Team's
     * job. HR documents, leave detail and reports are not a consequence of
     * running a project.
     */
    hr: {
      deny: [
        "hr.leave.view",
        "hr.document.view",
        "hr.document.create",
        "hr.leave.reason.view",
        "hr.report.view",
        "hr.export",
        "hr.attendance.view",
      ],
    },
    /**
     * The deal that became their project, and nothing else (PRD #17 §16, §195,
     * §354).
     *
     * A project manager receives a won opportunity because they are delivering
     * it. That is not a reason to hand them the open pipeline, the leads behind
     * it, or the prices in anybody's proposals — which is what the scope
     * clause and these denials say together.
     */
    sales: {
      deny: [
        "sales.lead.view",
        "sales.proposal.view",
        "sales.pipeline.view",
        "sales.report.view",
        "sales.task.view",
        "sales.document.view",
        "sales.activity.view",
      ],
    },
    /**
     * The agreement behind the job, not the commercial file (PRD #18 §28,
     * §399, §441, §445).
     *
     * A project manager needs to know a contract governs their project, when it
     * expires and what it obliges somebody to deliver. The price the company
     * agreed is a different question, and so is the approval queue — which is
     * why `legal.commercial.view` is a separate grant rather than part of
     * `legal.contract.view`.
     */
    contracts: {
      deny: ["legal.commercial.view", "legal.approval.view", "legal.sales_source.view"],
    },
  },
  ARCHITECT: {
    /**
     * Project budget summary only (PRD #5 §18, PRD #15 §184).
     *
     * Budget amount, actual summary, commitment summary and remaining budget —
     * never a payee, an invoice, a payment reference, company receivables or
     * company cashflow.
     */
    finance: {
      deny: [
        "finance.invoice.view",
        "finance.payment.view",
        "finance.expense.view",
        "finance.budget.view",
        "finance.commitment.view",
        "finance.receivables.view",
        "finance.payables.view",
        "finance.cashflow.view",
        "finance.approval.view",
        "finance.report.view",
        "finance.activity.view",
        "finance.settings.view",
      ],
    },
  },
  ENGINEER: {
    finance: {
      deny: [
        "finance.invoice.view",
        "finance.payment.view",
        "finance.expense.view",
        "finance.budget.view",
        "finance.commitment.view",
        "finance.receivables.view",
        "finance.payables.view",
        "finance.cashflow.view",
        "finance.approval.view",
        "finance.report.view",
        "finance.activity.view",
        "finance.settings.view",
      ],
    },
    procurement: { deny: ["procurement.order.view"] },
    inventory: { deny: ["inventory.movement.view"] },
  },
  COMPANY_IT: {
    /**
     * Platform and system access is not HR access (PRD #16 §19).
     *
     * What is left is genuine self-service: their own employment record, their
     * own leave and attendance, their own files.
     */
    hr: {
      deny: [
        "hr.employee.view",
        "hr.employment.view",
        "hr.document.view",
        "hr.onboarding.view",
        "hr.offboarding.view",
        "hr.report.view",
        "hr.activity.view",
        "hr.export",
      ],
    },
    /**
     * IT keeps the system running without acquiring the business (PRD #24 §16,
     * PRD #35 §124). Security and localisation are theirs to manage; Finance
     * defaults, numbering and integration behaviour are not.
     */
    company: {
      extra: [
        "company.security_settings.view",
        "company.security_settings.manage",
        "company.localization.manage",
        "company.settings.update",
      ],
    },
  },
  FINANCE: {
    /**
     * Commercial context only, not the Sales workspace (PRD #5 §20,
     * PRD #17 §24, §152, §352).
     *
     * Won opportunity value and accepted proposal totals are what Finance needs
     * to raise the invoice. Leads, the pipeline and the follow-up work are the
     * sales desk's, and `sales.lead.view` is exactly the grant that says so
     * (PRD #17 §17).
     */
    sales: {
      deny: ["sales.lead.view", "sales.pipeline.view", "sales.task.view"],
    },
    /**
     * The operational finance workspace — and not the approver (PRD #15 §18,
     * §284).
     *
     * MANAGE is the ladder's top rung, so without this the role that raises
     * every invoice would also sign them off. Separation of duties is the
     * point: approval authority is the CEO's and the Owner's.
     */
    /**
     * Contract value as invoicing context, not the legal file (PRD #18 §30,
     * §401).
     *
     * Value, currency, dates, client and project are what Finance needs to
     * raise against an agreement. The parties' tax identifiers, the obligation
     * register and the approval queue belong to the legal desk.
     */
    contracts: {
      deny: [
        "legal.party.view",
        "legal.obligation.view",
        "legal.approval.view",
        "legal.task.view",
      ],
    },
    finance: {
      deny: [
        "finance.approval.decide",
        "finance.invoice.approve",
        "finance.invoice.reject",
        "finance.expense.approve",
        "finance.expense.reject",
        "finance.budget.approve",
        "finance.budget.reject",
        "finance.commitment.approve",
        "finance.commitment.reject",
      ],
    },
  },
  LEGAL: {
    /**
     * The role the module exists for (PRD #18 §27, §397).
     *
     * Legal reads the confidential terms because Legal writes them. Approval
     * authority stays on the ladder — a second lawyer may sign off a
     * colleague's contract — but `legal.approval.self` is not granted, so the
     * person who drafted an agreement is never the person who approves it
     * (PRD #18 §116).
     */
    contracts: { extra: ["legal.confidential_terms.view"] },
    /**
     * The commercial record a contract is drawn from (PRD #17 §269, §353).
     *
     * A won opportunity and the proposal the client accepted are what Legal
     * needs in front of them. Working the leads that got there is not part of
     * drafting the contract.
     */
    sales: {
      deny: ["sales.lead.view", "sales.pipeline.view", "sales.task.view"],
    },
    // Contract-related financial data only (PRD #5 §21, PRD #15 §290):
    // invoice and commitment summaries, never general cashflow.
    finance: {
      deny: [
        "finance.payment.view",
        "finance.expense.view",
        "finance.budget.view",
        "finance.project_budget.view",
        "finance.project_cost_summary.view",
        "finance.receivables.view",
        "finance.payables.view",
        "finance.cashflow.view",
        "finance.approval.view",
        "finance.settings.view",
      ],
    },
  },
  SALES: {
    /**
     * The workspace this module exists for — and not the approver
     * (PRD #17 §19, §20).
     *
     * MANAGE is the ladder's top rung, so without this the role that quotes
     * every price would also sign it off. Commercial approval is the CEO's and
     * the Owner's.
     */
    sales: {
      deny: ["sales.proposal.approve", "sales.proposal.reject"],
    },
    /**
     * The contract their deal became (PRD #18 §29, §400).
     *
     * Sales follows an accepted proposal through to a signed agreement: status,
     * dates, value, and the lineage back to the opportunity. The obligation
     * register, the parties' legal identifiers and the approval queue are the
     * legal desk's work, not the account manager's.
     */
    contracts: {
      deny: [
        "legal.party.view",
        "legal.obligation.view",
        "legal.approval.view",
        "legal.task.view",
      ],
    },
    // Customer invoices, outstanding receivables and client payment status —
    // never corporate cashflow, expenses or budgets (PRD #5 §22, PRD #15 §289).
    finance: {
      deny: [
        "finance.payment.view",
        "finance.expense.view",
        "finance.budget.view",
        "finance.commitment.view",
        "finance.project_budget.view",
        "finance.project_cost_summary.view",
        "finance.payables.view",
        "finance.cashflow.view",
        "finance.approval.view",
        "finance.settings.view",
      ],
    },
  },
  PROCUREMENT: {
    /**
     * Supplier-side agreements as purchasing context (PRD #18 §31, §402).
     *
     * Procurement needs to know which contract a commitment sits under and what
     * it is worth. The sales lineage behind a client agreement, the legal
     * obligation register and the approval queue are not part of raising a
     * purchase order.
     */
    contracts: {
      deny: [
        "legal.party.view",
        "legal.obligation.view",
        "legal.approval.view",
        "legal.task.view",
        "legal.sales_source.view",
        "legal.report.view",
      ],
    },
    // Project budget availability and commitments; no customer invoices or
    // payments (PRD #5 §23, PRD #15 §291).
    finance: {
      deny: [
        "finance.invoice.view",
        "finance.payment.view",
        "finance.expense.view",
        "finance.receivables.view",
        "finance.payables.view",
        "finance.cashflow.view",
        "finance.approval.view",
        "finance.settings.view",
      ],
    },
  },
  INVENTORY: {
    // Project-scoped cost and commitment summary only (PRD #5 §24,
    // PRD #15 §292).
    finance: {
      deny: [
        "finance.invoice.view",
        "finance.payment.view",
        "finance.expense.view",
        "finance.budget.view",
        "finance.receivables.view",
        "finance.payables.view",
        "finance.cashflow.view",
        "finance.approval.view",
        "finance.report.view",
        "finance.activity.view",
        "finance.settings.view",
      ],
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

export type ModuleAccessDefault = {
  module: ModuleKey;
  accessLevel: AccessLevel;
  scope: DataScope;
  permissions: Permission[];
};

function parseCell(cell: MatrixCell): { accessLevel: AccessLevel; scope: DataScope } {
  const [accessCode, scopeCode] = cell.split("/");
  const accessLevel = ACCESS_CODES[accessCode];
  const scope = SCOPE_CODES[scopeCode];
  if (!accessLevel || !scope) {
    throw new Error(`Unreadable access matrix cell: "${cell}"`);
  }
  return { accessLevel, scope };
}

/**
 * Grants that depend on the *scope* of a cell, not only its access level.
 *
 * A company-level document has no project or client to narrow it, so reaching
 * one requires company-level Documents access rather than any Documents access
 * at all. Deriving that from the matrix keeps it true for every role at once,
 * instead of nine override blocks that can drift apart (PRD #13 §39, §46,
 * §283).
 */
function scopedGrants(
  moduleKey: ModuleKey,
  accessLevel: AccessLevel,
  scope: DataScope,
): Permission[] {
  if (moduleKey !== "documents") return [];
  if (accessLevel === "NONE") return [];
  if (scope !== "COMPANY" && scope !== "SYSTEM") return [];

  const grants: Permission[] = ["document.company.view"];
  if (accessLevel !== "VIEW") grants.push("document.company.create");
  return grants;
}

function buildRoleAccess(role: RoleKey): Record<ModuleKey, ModuleAccessDefault> {
  const row = MATRIX[role];
  const overrides = OVERRIDES[role] ?? {};
  const readOnly = Boolean(roles[role].readOnly);

  const result = {} as Record<ModuleKey, ModuleAccessDefault>;

  for (const moduleKey of MODULE_KEYS) {
    // Every authenticated role reaches their own dashboard (PRD #4 §4).
    const cell = moduleKey === "dashboard" ? "V/S" : row[moduleKey];

    if (!cell) {
      result[moduleKey] = {
        module: moduleKey,
        accessLevel: "NONE",
        scope: "SELF",
        permissions: [],
      };
      continue;
    }

    const { accessLevel, scope } = parseCell(cell);
    const override = overrides[moduleKey] ?? {};

    const granted = new Set<Permission>(ladderPermissions(moduleKey, accessLevel));
    for (const permission of scopedGrants(moduleKey, accessLevel, scope)) granted.add(permission);
    for (const permission of override.extra ?? []) granted.add(permission);
    for (const permission of override.deny ?? []) granted.delete(permission);

    // A read-only role never keeps a mutating grant, whatever the ladder says
    // (PRD #5 §27, §66).
    const permissions = [...granted]
      .filter((permission) => !readOnly || !isMutatingPermission(permission))
      .sort();

    result[moduleKey] = {
      module: moduleKey,
      accessLevel: readOnly && accessLevel !== "NONE" ? "VIEW" : accessLevel,
      scope,
      permissions,
    };
  }

  return result;
}

/** Role → module → { accessLevel, scope, permissions }. */
export const roleModuleAccess: Record<RoleKey, Record<ModuleKey, ModuleAccessDefault>> =
  Object.fromEntries(ROLE_KEYS.map((role) => [role, buildRoleAccess(role)])) as Record<
    RoleKey,
    Record<ModuleKey, ModuleAccessDefault>
  >;

/** The flat permission list a role holds across every module. */
export const rolePermissions: Record<RoleKey, Permission[]> = Object.fromEntries(
  ROLE_KEYS.map((role) => [
    role,
    [
      ...new Set(
        MODULE_KEYS.flatMap((moduleKey) => roleModuleAccess[role][moduleKey].permissions),
      ),
    ].sort(),
  ]),
) as Record<RoleKey, Permission[]>;

/** The scope a role has in each module, used by the data-scope resolvers. */
export const roleScopes: Record<RoleKey, Record<ModuleKey, DataScope>> = Object.fromEntries(
  ROLE_KEYS.map((role) => [
    role,
    Object.fromEntries(
      MODULE_KEYS.map((moduleKey) => [moduleKey, roleModuleAccess[role][moduleKey].scope]),
    ),
  ]),
) as Record<RoleKey, Record<ModuleKey, DataScope>>;

export function defaultAccessFor(role: RoleKey, moduleKey: ModuleKey): ModuleAccessDefault {
  return roleModuleAccess[role][moduleKey];
}

export function permissionsForRole(role: RoleKey): Permission[] {
  return rolePermissions[role] ?? [];
}

/** Modules a role may open at all — the raw input to the navigation resolver. */
export function accessibleModules(role: RoleKey): ModuleKey[] {
  return MODULE_KEYS.filter((key) => roleModuleAccess[role][key].accessLevel !== "NONE");
}
