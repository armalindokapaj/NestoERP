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
  /**
   * Every role holds the dashboard, and collaboration rides on it (PRD #38 §38).
   * The Viewer keeps `collaboration.watch` — following a record changes nobody's
   * data — and the read-only filter removes the three that write comments
   * (PRD #38 §127).
   */
  dashboard: {
    VIEW: [
      "dashboard.view",
      "collaboration.comment.create",
      "collaboration.comment.edit_own",
      "collaboration.comment.archive_own",
      "collaboration.watch",
    ],
  },
  /**
   * Calendar (PRD #39 §43, §129-§144).
   *
   * Contributors keep their own events, invite colleagues and set reminders;
   * managers publish company-wide events and holidays. Nothing here reveals a
   * module's dates — each source provider asks its own module (PRD #39 §45).
   */
  calendar: {
    VIEW: ["calendar.view"],
    CONTRIBUTE: [
      "calendar.event.create",
      "calendar.event.edit",
      "calendar.event.archive",
      "calendar.private_event.manage",
      "calendar.reminder.manage",
      "calendar.availability.view",
    ],
    MANAGE: ["calendar.company_event.manage"],
  },
  /**
   * The Approvals Center (PRD #41 §133-§150). Seeing the workspace is VIEW —
   * anyone who submits things can follow them. History across the company and
   * lending authority belong to the people who decide. Deciding itself is not
   * on this ladder at all: it is each source module's own permission.
   */
  approvals: {
    VIEW: ["approvals.view"],
    APPROVE: ["approvals.history.view", "approvals.delegation.manage"],
  },
  /**
   * Announcements (PRD #45 §229-§246). Everyone reads and acknowledges what is
   * addressed to them; CONTRIBUTE writes drafts; APPROVE publishes, pins and
   * archives; MANAGE speaks to the company, departments and named people. A
   * project audience is granted on its own — to the people who run projects.
   */
  announcements: {
    VIEW: ["announcement.view", "announcement.acknowledge"],
    CONTRIBUTE: ["announcement.create", "announcement.edit"],
    APPROVE: ["announcement.publish", "announcement.pin", "announcement.archive"],
    MANAGE: ["announcement.manage_company", "announcement.manage_department", "announcement.manage_selected_members"],
  },
  /**
   * Timesheets (PRD #42 §120, §128-§143). Everyone who works logs their own
   * week; APPROVE is the reviewing manager's rung — other people's weeks,
   * project time, and the decision (as the week's designated approver); MANAGE
   * adds reopening an approved week and the company's rules.
   */
  /**
   * Daily logs (PRD #43 §126-§144). Field authors write the day; the project
   * manager reviews and locks it; MANAGE adds voiding and the controlled
   * correction of a locked record. Company rules are the Owner's alone — a
   * project manager keeps their own project's rules through the project.
   */
  dailyLogs: {
    VIEW: ["daily_log.view"],
    CONTRIBUTE: [
      "daily_log.create",
      "daily_log.edit",
      "daily_log.submit",
      "daily_log.workforce.manage",
      "daily_log.activity.manage",
      "daily_log.equipment.manage",
      "daily_log.delivery.manage",
      "daily_log.visitor.manage",
      "daily_log.delay.manage",
      "daily_log.instruction.manage",
      "daily_log.qaqc.manage",
      "daily_log.hse.manage",
    ],
    APPROVE: ["daily_log.review", "daily_log.return", "daily_log.lock"],
    MANAGE: ["daily_log.void", "daily_log.correct_locked"],
  },
  /**
   * Contractors (PRD #46 §175, §178-§193). VIEW reads the directory, contacts,
   * assignments, work packages and compliance; CONTRIBUTE keeps contractor
   * records and work packages; APPROVE puts a contractor on a project, completes
   * work packages and maintains compliance; MANAGE archives and restores
   * contractors and waives a compliance requirement.
   */
  contractors: {
    VIEW: ["contractor.view", "contractor_contact.view", "project_contractor.view", "work_package.view", "contractor_compliance.view"],
    CONTRIBUTE: ["contractor.create", "contractor.edit", "contractor_contact.manage", "work_package.create", "work_package.edit"],
    APPROVE: ["project_contractor.manage", "work_package.complete", "contractor_compliance.manage"],
    MANAGE: ["contractor.archive", "contractor_compliance.waive"],
  },
  /**
   * Engineering (PRD #46 §175, §183-§193). CONTRIBUTE registers documents,
   * raises and answers RFIs, prepares submittals and transmittals; APPROVE is
   * the reviewer's rung — review decisions, approvals, closing RFIs and issuing
   * transmittals; MANAGE voids and sets the company's defaults.
   */
  engineering: {
    VIEW: ["engineering_document.view", "rfi.view", "submittal.view", "transmittal.view"],
    CONTRIBUTE: [
      "engineering_document.create",
      "engineering_document.edit",
      "engineering_document.submit",
      "rfi.create",
      "rfi.edit",
      "rfi.open",
      "rfi.respond",
      "submittal.create",
      "submittal.edit",
      "submittal.submit",
      "transmittal.create",
    ],
    APPROVE: ["engineering_document.review", "engineering_document.approve", "submittal.review", "submittal.approve", "rfi.close", "transmittal.issue"],
    MANAGE: ["rfi.void", "transmittal.void", "engineering.settings.manage"],
  },
  timesheets: {
    VIEW: ["timesheet.view_own"],
    CONTRIBUTE: ["timesheet.edit_own", "timesheet.submit_own"],
    APPROVE: ["timesheet.team.view", "timesheet.project.view", "timesheet.approve", "timesheet.return", "timesheet.reject"],
    MANAGE: ["timesheet.reopen", "timesheet.settings.manage"],
  },
  /**
   * Meetings (PRD #40 §80, §138-§154).
   *
   * Contributors run their own meetings; what they may do on a given meeting
   * still depends on their part in it (organizer, secretary, owner of an
   * action). MANAGE is the explicit exception: editing any meeting the member
   * can see, and reopening final minutes.
   */
  meetings: {
    VIEW: ["meeting.view", "meeting.document.view"],
    CONTRIBUTE: [
      "meeting.create",
      "meeting.edit",
      "meeting.cancel",
      "meeting.manage_participants",
      "meeting.agenda.manage",
      "meeting.minutes.edit",
      "meeting.minutes.finalize",
      "meeting.decision.create",
      "meeting.action.create",
      "meeting.action.manage",
      "meeting.action.convert_to_task",
      "meeting.document.create",
    ],
    MANAGE: ["meeting.manage", "meeting.minutes.reopen"],
  },
  projects: {
    VIEW: [
      "project.view",
      "project.member.view",
      "project.task.view",
      "project.document.view",
      "project.activity.view",
      // The plan is read by everybody who can open the project (PRD #44 §80-§95).
      "project_planning.view",
      // So are its buildings, floors and units: Sales and Finance read the same units (E-05B §59, §80).
      "project.structure.view",
    ],
    CONTRIBUTE: ["project.update"],
    MANAGE: [
      "project.create",
      "project.status.manage",
      "project.archive",
      "project.restore",
      "project.manage",
      "project.manager.assign",
      "project.member.add",
      "project.member.update",
      "project.member.remove",
      /*
       * Keeping the plan is the project manager's job (PRD #44 §85): phases,
       * milestones and their dates, dependencies, blockers, completion and
       * reopening, and the baseline. Contributors read it; a company that wants
       * its engineers to update field milestones grants it to their role.
       */
      "project_planning.manage",
      "project_planning.phase.create",
      "project_planning.phase.edit",
      "project_planning.phase.archive",
      "project_planning.milestone.create",
      "project_planning.milestone.edit",
      "project_planning.milestone.complete",
      "project_planning.milestone.reopen",
      "project_planning.baseline.manage",
      "project_planning.dependencies.manage",
      "project_planning.blockers.manage",
      /*
       * Setting up the physical project — buildings, floors, units, their order
       * and moves (E-05B §59, §60). Engineers read it; an Architect holds it as
       * an override, on the projects they are assigned to.
       */
      "project.structure.manage",
      "project.building.create",
      "project.building.update",
      "project.building.delete",
      "project.floor.create",
      "project.floor.update",
      "project.floor.delete",
      "project.unit.create",
      "project.unit.update",
      "project.unit.delete",
      "project.unit.move",
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
    // Review is a contributor's job, not a manager's: the Legal, QA/QC and HSE
    // people who review files in their own domain hold CONTRIBUTE here, and
    // what narrows them is the parent record (PRD #38 §61, §62).
    CONTRIBUTE: ["document.create", "document.update", "document.review.request", "document.review.decide"],
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
  /*
   * QA/QC (PRD #21 §17, §19).
   *
   * The ladder carries the module's central separation: looking, deciding and
   * approving are three different acts. Executing an inspection is a
   * contribution; approving one is not, and neither is releasing material to
   * stock — that is the act with consequences outside Quality (PRD #21 §73,
   * §98, §165).
   */
  qaqc: {
    VIEW: [
      "qaqc.view",
      "qaqc.dashboard.view",
      "qaqc.request.view",
      "qaqc.template.view",
      "qaqc.inspection.view",
      "qaqc.material.view",
      "qaqc.defect.view",
      "qaqc.ncr.view",
      "qaqc.corrective_action.view",
      "qaqc.reinspection.view",
      "qaqc.approval.view",
      "qaqc.document.view",
      "qaqc.task.view",
      "qaqc.activity.view",
      "qaqc.report.view",
    ],
    CONTRIBUTE: [
      "qaqc.export",
      "qaqc.request.create",
      "qaqc.request.update",
      "qaqc.inspection.create",
      "qaqc.inspection.execute",
      "qaqc.inspection.update_draft",
      "qaqc.inspection.submit",
      "qaqc.material.inspect",
      "qaqc.defect.create",
      "qaqc.defect.update",
      "qaqc.defect.resolve",
      "qaqc.ncr.create",
      "qaqc.ncr.update",
      "qaqc.ncr.submit",
      "qaqc.corrective_action.create",
      "qaqc.corrective_action.update",
      "qaqc.corrective_action.complete",
      "qaqc.reinspection.create",
      "qaqc.reinspection.execute",
      "qaqc.document.create",
      "qaqc.task.create",
    ],
    /*
     * Deciding is where quality stops being a record and starts being a
     * commitment: an approved inspection releases material, and a closed NCR
     * states the problem is genuinely fixed (PRD #21 §80, §136).
     */
    APPROVE: [
      "qaqc.request.assign",
      "qaqc.inspection.assign",
      "qaqc.inspection.approve",
      "qaqc.inspection.reject",
      "qaqc.inspection.close",
      "qaqc.material.release",
      "qaqc.material.reject",
      "qaqc.material.conditional_accept",
      "qaqc.defect.assign",
      "qaqc.defect.close",
      "qaqc.defect.reopen",
      "qaqc.ncr.assign",
      "qaqc.ncr.approve",
      "qaqc.ncr.reject",
      "qaqc.ncr.close",
      "qaqc.ncr.reopen",
      "qaqc.corrective_action.assign",
      "qaqc.corrective_action.verify",
      "qaqc.corrective_action.reopen",
      "qaqc.approval.decide",
    ],
    MANAGE: [
      "qaqc.manage",
      "qaqc.template.create",
      "qaqc.template.update",
      "qaqc.template.archive",
      "qaqc.template.restore",
      "qaqc.request.cancel",
      "qaqc.inspection.cancel",
      "qaqc.inspection.reopen",
      "qaqc.defect.cancel",
      "qaqc.ncr.cancel",
      "qaqc.corrective_action.cancel",
    ],
  },
  /**
   * Safety access widens downwards, not upwards (PRD #22 §19, §27, §28).
   *
   * Reporting sits in CONTRIBUTE and nowhere higher: an engineer who finds a
   * blocked fire exit must be able to raise it, and a hazard that only the
   * safety officer may report is a hazard that waits for the safety officer to
   * walk past it. Judging the risk, signing off a permit and agreeing a control
   * actually worked are the acts that need the safety function.
   */
  hse: {
    VIEW: [
      "hse.view",
      "hse.dashboard.view",
      "hse.inspection.view",
      "hse.template.view",
      "hse.hazard.view",
      "hse.incident.view",
      "hse.risk.view",
      "hse.action.view",
      "hse.toolbox.view",
      "hse.permit.view",
      "hse.ppe.view",
      "hse.environment.view",
      "hse.stop_work.view",
      "hse.approval.view",
      "hse.document.view",
      "hse.task.view",
      "hse.activity.view",
      "hse.report.view",
    ],
    CONTRIBUTE: [
      "hse.export",
      "hse.inspection.create",
      "hse.inspection.execute",
      "hse.inspection.submit",
      "hse.hazard.create",
      "hse.hazard.update",
      "hse.hazard.control",
      "hse.incident.create",
      "hse.incident.update",
      "hse.risk.create",
      "hse.risk.update",
      "hse.risk.submit",
      "hse.action.create",
      "hse.action.update",
      "hse.action.complete",
      "hse.toolbox.create",
      "hse.toolbox.update",
      "hse.toolbox.complete",
      "hse.permit.create",
      "hse.permit.update",
      "hse.permit.submit",
      "hse.ppe.create",
      "hse.ppe.update",
      "hse.environment.create",
      "hse.environment.update",
      /*
       * Calling a stop-work is a contributor act deliberately: anybody who can
       * see the work going wrong can halt it. Letting it restart is not
       * (PRD #22 §173, §174).
       */
      "hse.stop_work.create",
      "hse.document.create",
      "hse.task.create",
    ],
    /*
     * Deciding is where a safety record stops describing and starts
     * authorising: an approved permit lets hot work begin, a verified action
     * says the control is genuinely in, and a released stop-work sends people
     * back to the job (PRD #22 §122, §149, §174).
     */
    APPROVE: [
      "hse.inspection.assign",
      "hse.inspection.approve",
      "hse.inspection.reject",
      "hse.inspection.close",
      "hse.hazard.assign",
      "hse.hazard.assess",
      "hse.hazard.close",
      "hse.hazard.reopen",
      "hse.incident.assign",
      "hse.incident.investigate",
      "hse.incident.submit_close",
      "hse.incident.close",
      "hse.incident.reopen",
      "hse.risk.approve",
      "hse.action.assign",
      "hse.action.verify",
      "hse.action.reopen",
      "hse.permit.approve",
      "hse.permit.activate",
      "hse.permit.suspend",
      "hse.permit.close",
      "hse.environment.close",
      "hse.stop_work.release",
      "hse.approval.decide",
    ],
    MANAGE: [
      "hse.manage",
      "hse.template.create",
      "hse.template.update",
      "hse.template.archive",
      "hse.template.restore",
      "hse.risk.archive",
      "hse.inspection.cancel",
      "hse.hazard.cancel",
      "hse.incident.cancel",
      "hse.action.cancel",
      "hse.toolbox.cancel",
      "hse.permit.cancel",
    ],
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
      "team.member.password.reset",
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
      /*
       * Storage usage sits with company administration, not with company
       * VIEW. PRD #29 §244 calls it "Admin Storage Visibility", and it lives
       * behind a Settings section — so it follows the same floor every other
       * company section does.
       */
      "company.storage.view",
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
    calendar: "M/C", approvals: "M/C", announcements: "M/C", meetings: "M/C", timesheets: "M/C", dailyLogs: "M/C", contractors: "M/C", engineering: "M/C", projects: "M/C", tasks: "M/C", clients: "M/C", documents: "M/C",
    finance: "M/C", hr: "M/C", sales: "M/C", contracts: "M/C",
    procurement: "M/C", inventory: "M/C", qaqc: "M/C", hse: "M/C",
    team: "M/C", company: "M/C", settings: "M/C", support: "V/C",
  },
  ADMIN: {
    calendar: "M/C", approvals: "V/C", announcements: "M/C", meetings: "M/C", timesheets: "C/S", contractors: "V/C", projects: "V/C", tasks: "V/C", clients: "V/C", documents: "M/C",
    hr: "V/C",
    team: "M/C", company: "M/C", settings: "M/SYS", support: "M/SYS",
  },
  COMPANY_IT: {
    calendar: "C/C", approvals: "V/C", announcements: "A/C", meetings: "C/C", timesheets: "C/S", tasks: "C/S", documents: "V/C", hr: "V/S",
    team: "V/C", company: "V/C", settings: "M/SYS", support: "M/SYS",
  },
  HR: {
    calendar: "M/C", approvals: "A/C", announcements: "M/C", meetings: "C/C", timesheets: "M/C", projects: "V/C", tasks: "C/S", documents: "C/D", hr: "M/C",
    team: "M/C", company: "V/C", settings: "V/S", support: "V/C",
  },
  CEO: {
    calendar: "C/C", approvals: "A/C", announcements: "M/C", meetings: "M/C", timesheets: "C/C", dailyLogs: "V/C", contractors: "V/C", engineering: "V/C", projects: "V/C", tasks: "V/C", clients: "V/C", documents: "V/C",
    finance: "A/C", hr: "V/C", sales: "A/C", contracts: "A/C",
    procurement: "A/C", inventory: "V/C", qaqc: "V/C", hse: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  PROJECT_MANAGER: {
    calendar: "C/C", approvals: "A/P", announcements: "A/P", meetings: "C/C", timesheets: "A/P", dailyLogs: "M/P", contractors: "M/P", engineering: "A/P", projects: "M/P", tasks: "M/P", clients: "C/P", documents: "C/P",
    finance: "V/P", hr: "V/P", sales: "V/P", contracts: "V/P",
    procurement: "C/P", inventory: "V/P", qaqc: "C/P", hse: "C/P",
    team: "V/P", company: "V/C", support: "V/C",
  },
  ARCHITECT: {
    calendar: "C/C", approvals: "V/P", announcements: "V/C", meetings: "C/C", timesheets: "C/S", dailyLogs: "V/AS", contractors: "V/P", engineering: "A/P", projects: "C/AS", tasks: "C/AS", clients: "V/P", documents: "C/P",
    finance: "V/P", hr: "V/S", qaqc: "V/P", hse: "V/P",
    team: "V/P", support: "V/C",
  },
  ENGINEER: {
    calendar: "C/C", approvals: "V/P", announcements: "V/C", meetings: "C/C", timesheets: "C/S", dailyLogs: "C/AS", contractors: "V/P", engineering: "A/P", projects: "C/AS", tasks: "C/AS", clients: "V/P", documents: "C/P",
    finance: "V/P", hr: "V/S",
    procurement: "V/P", inventory: "V/P", qaqc: "C/P", hse: "C/P",
    team: "V/P", support: "V/C",
  },
  FINANCE: {
    calendar: "C/C", approvals: "A/C", announcements: "V/C", meetings: "C/C", timesheets: "C/S", contractors: "V/C", projects: "V/C", tasks: "C/S", clients: "V/C", documents: "C/C",
    finance: "M/C", hr: "V/S", sales: "V/C", contracts: "V/C",
    procurement: "V/C", inventory: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  LEGAL: {
    calendar: "C/C", approvals: "A/C", announcements: "V/C", meetings: "C/C", timesheets: "C/S", contractors: "V/C", projects: "V/C", tasks: "C/S", clients: "V/C", documents: "C/C",
    finance: "V/C", sales: "V/C", contracts: "M/C", procurement: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  SALES: {
    calendar: "C/C", approvals: "A/C", announcements: "V/C", meetings: "C/C", timesheets: "C/S", projects: "V/C", tasks: "C/S", clients: "M/C", documents: "C/C",
    finance: "V/C", sales: "M/C", contracts: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  PROCUREMENT: {
    calendar: "C/C", approvals: "A/C", announcements: "V/C", meetings: "C/C", timesheets: "C/S", dailyLogs: "V/C", contractors: "V/C", engineering: "V/C", projects: "V/C", tasks: "C/S", documents: "C/C",
    finance: "V/C", contracts: "V/C", procurement: "M/C", inventory: "V/C",
    qaqc: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  INVENTORY: {
    calendar: "C/C", approvals: "V/C", announcements: "V/C", meetings: "C/C", timesheets: "C/S", dailyLogs: "V/C", engineering: "V/C", projects: "V/P", tasks: "C/S", documents: "C/C",
    finance: "V/P", procurement: "C/C", inventory: "M/C", qaqc: "V/C",
    team: "V/C", company: "V/C", support: "V/C",
  },
  QAQC: {
    calendar: "C/C", approvals: "A/C", announcements: "V/C", meetings: "C/C", timesheets: "C/S", dailyLogs: "V/P", contractors: "V/C", engineering: "V/P", projects: "V/P", tasks: "C/P", documents: "C/P", hr: "V/S",
    qaqc: "M/C", hse: "V/P",
    team: "V/P", company: "V/C", support: "V/C",
  },
  HSE: {
    calendar: "C/C", approvals: "A/C", announcements: "V/C", meetings: "C/C", timesheets: "C/S", dailyLogs: "V/P", contractors: "V/C", engineering: "V/P", projects: "V/P", tasks: "C/P", documents: "C/P", hr: "V/S",
    qaqc: "V/P", hse: "M/C",
    team: "V/P", company: "V/C", support: "V/C",
  },
  VIEWER: {
    calendar: "V/C", announcements: "V/C", meetings: "V/C", dailyLogs: "V/AS", contractors: "V/AS", engineering: "V/AS", projects: "V/AS", tasks: "V/AS", clients: "V/AS", documents: "V/AS",
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
    // Every audience, projects included (PRD #45 §229).
    announcements: { extra: ["announcement.manage_project"] },
    // Company daily log rules are not a project manager's to change (PRD #43 §129, §248).
    dailyLogs: { extra: ["daily_log.settings.manage"] },
    // The company's planning rules, and moving a locked baseline (PRD #44 §76, §309).
    // The company's list of project types (E-05A §62).
    // The company's list of unit types (E-05B §20, §21).
    projects: { extra: ["project_planning.settings.manage", "project.type.manage", "project.unit_type.manage"] },
    // Promoting somebody to Owner is the one company action an Admin must not
    // be able to take on their own (PRD #14 §95, §96).
    team: { extra: ["team.owner.assign"] },
    // The Owner is the one role that may approve their own submission: in a
    // company where they are the only approver, the alternative is a record
    // nobody can ever decide (PRD #15 §19, PRD #17 §20).
    finance: { extra: ["finance.approval.self"] },
    procurement: { extra: ["procurement.order.finance_approve"] },
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
    /**
     * Administering the platform is not reading the construction plan (PRD #44 §81).
     *
     * It is setting projects up, though: a Company Admin creates projects, keeps
     * their details right and moves them between Pending, Active and Finished
     * inside their company (E-05A §29, §60), and keeps the company's list of
     * project types (§62). Archiving stays with whoever holds the module outright.
     * Setting up a project includes its buildings, floors and units, and the
     * company's unit types (E-05B §59).
     */
    projects: {
      deny: ["project_planning.view"],
      extra: [
        "project.create",
        "project.update",
        "project.status.manage",
        "project.type.manage",
        "project.structure.manage",
        "project.building.create",
        "project.building.update",
        "project.building.delete",
        "project.floor.create",
        "project.floor.update",
        "project.floor.delete",
        "project.unit.create",
        "project.unit.update",
        "project.unit.delete",
        "project.unit.move",
        "project.unit_type.manage",
      ],
    },
  },
  CEO: {
    /**
     * Time summaries by project, and the decision on the weeks they are the
     * designated approver of — without everybody's entry text (PRD #42 §132).
     */
    timesheets: { extra: ["timesheet.project.view", "timesheet.approve", "timesheet.return", "timesheet.reject"] },
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
    // People operations see the project list, not its milestone plan (PRD #44 §83).
    projects: { deny: ["project_planning.view"] },
  },
  PROJECT_MANAGER: {
    /**
     * Running projects, not opening new ones (E-05A §29, §60). A project manager
     * keeps the status and the details of the projects they manage; which
     * projects the company takes on is the Owner's or an Admin's call.
     */
    projects: { deny: ["project.create"] },
    // Void a mistaken RFI or transmittal on their own projects; company defaults stay the Owner's (PRD #46 §183).
    engineering: { extra: ["rfi.void", "transmittal.void"], deny: ["engineering.settings.manage"] },
    // Notices to the projects they run and the people on them — not the whole company (PRD #45 §234).
    announcements: { extra: ["announcement.manage_project", "announcement.manage_selected_members"] },
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
     * The physical project on the projects they are assigned to (E-05B §59, §60):
     * buildings, floors and the technical data of every unit. The ladder's
     * CONTRIBUTE rung stops short of it, which is where Engineers stay.
     */
    projects: {
      extra: [
        "project.structure.manage",
        "project.building.create",
        "project.building.update",
        "project.building.delete",
        "project.floor.create",
        "project.floor.update",
        "project.floor.delete",
        "project.unit.create",
        "project.unit.update",
        "project.unit.delete",
        "project.unit.move",
      ],
    },
    // Design-related work and instructions on their projects' logs (PRD #43 §135).
    dailyLogs: { extra: ["daily_log.edit", "daily_log.activity.manage", "daily_log.instruction.manage"] },
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
    /**
     * The project's safety position, not the company's safety apparatus
     * (PRD #22 §18, §19 — the `*` on the access matrix).
     *
     * An architect on a site needs to know what has gone wrong there and what
     * is being done about it: hazards, incidents, inspections and the permits
     * governing work near their design. The checklists the company inspects
     * against, the approval queue, the risk register, stop-work authority and
     * the company reports belong to the safety function.
     */
    hse: {
      deny: [
        "hse.template.view",
        "hse.risk.view",
        "hse.toolbox.view",
        "hse.ppe.view",
        "hse.environment.view",
        "hse.stop_work.view",
        "hse.approval.view",
        "hse.report.view",
        "hse.export",
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
    // Technical and system notices to the company (PRD #45 §228, §231).
    announcements: { extra: ["announcement.manage_company"] },
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
     * The financial step on large purchase orders (PRD #41 §143): Finance says
     * whether the money is there, without becoming a buyer or an approver of
     * its own invoices.
     */
    procurement: { extra: ["procurement.order.finance_approve"] },
    /** Approved project hours for reporting, not who wrote what (PRD #42 §126, §136). */
    timesheets: { extra: ["timesheet.project.view"] },
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
    // Insurance, guarantees and licences are Legal's to keep and, with a reason, to waive (PRD #46 §187).
    contractors: { extra: ["contractor_compliance.manage", "contractor_compliance.waive"] },
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
    // Delivery notes on the logs of the sites they buy for (PRD #43 §140).
    dailyLogs: { extra: ["daily_log.edit", "daily_log.delivery.manage"] },
    /*
     * The quality outcome on its own deliveries, and nothing else
     * (PRD #21 §28).
     *
     * A buyer needs to know whether the material they accepted passed. They do
     * not approve inspections, and they do not see the quality on site work.
     */
    qaqc: {
      deny: [
        "qaqc.request.view",
        "qaqc.template.view",
        "qaqc.defect.view",
        "qaqc.ncr.view",
        "qaqc.corrective_action.view",
        "qaqc.reinspection.view",
        "qaqc.approval.view",
        "qaqc.document.view",
        "qaqc.task.view",
        "qaqc.activity.view",
        "qaqc.report.view",
        "qaqc.dashboard.view",
      ],
    },
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
    /*
     * Enough quality to book a delivery in, and nothing more (PRD #21 §29).
     *
     * A storeman needs to know how much was released, how much was rejected
     * and whether the inspection is settled. They do not need the inspector's
     * checklist, the defects it raised, or the non-conformances behind them —
     * quality evidence is often the record of somebody's mistake.
     */
    qaqc: {
      deny: [
        "qaqc.request.view",
        "qaqc.template.view",
        "qaqc.defect.view",
        "qaqc.ncr.view",
        "qaqc.corrective_action.view",
        "qaqc.reinspection.view",
        "qaqc.approval.view",
        "qaqc.document.view",
        "qaqc.task.view",
        "qaqc.activity.view",
        "qaqc.report.view",
        "qaqc.dashboard.view",
      ],
    },
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
  QAQC: {
    // Quality reviews submittals, method statements and technical documents it is assigned (PRD #46 §191).
    engineering: { extra: ["submittal.review", "submittal.approve", "engineering_document.review"] },
    // The QA/QC-linked part of a log, never its workforce or delays (PRD #43 §142).
    dailyLogs: { extra: ["daily_log.edit", "daily_log.qaqc.manage"] },
    /*
     * The project HSE summary, and nothing that lets quality edit safety
     * (PRD #22 §29 — the `*` on the access matrix).
     *
     * Quality and safety look at the same site and answer different questions.
     * A quality engineer needs to know a hazard exists near their work; the
     * safety function's checklists, register, approval queue and stop-work
     * authority are not theirs.
     */
    hse: {
      deny: [
        "hse.template.view",
        "hse.risk.view",
        "hse.toolbox.view",
        "hse.ppe.view",
        "hse.environment.view",
        "hse.stop_work.view",
        "hse.approval.view",
        "hse.report.view",
        "hse.export",
      ],
    },
  },
  HSE: {
    // Safety reviews method statements and the submittals it is assigned (PRD #46 §192).
    engineering: { extra: ["submittal.review", "submittal.approve"] },
    // The HSE-linked part of a log (PRD #43 §143).
    dailyLogs: { extra: ["daily_log.edit", "daily_log.hse.manage"] },
    /*
     * The quality position on a job, and nothing that lets safety edit it
     * (PRD #21 §29, reciprocal to the block above).
     *
     * A failed safety inspection and a failed quality inspection are different
     * facts about the same site; each function reads the other's headline and
     * writes neither.
     */
    qaqc: {
      deny: [
        "qaqc.template.view",
        "qaqc.material.view",
        "qaqc.approval.view",
        "qaqc.report.view",
        "qaqc.export",
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
