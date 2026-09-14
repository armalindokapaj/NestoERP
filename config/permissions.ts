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

  /* Collaboration --------------------------------------------------------- */
  /**
   * Discussion on business records (PRD #38 §38). Never sufficient alone:
   * every one of these is checked together with read access to the record
   * the thread belongs to, so holding them opens nothing by itself.
   */
  "collaboration.comment.create",
  "collaboration.comment.edit_own",
  "collaboration.comment.archive_own",
  "collaboration.watch",

  /* Calendar ------------------------------------------------------------- */
  /**
   * The shared scheduling layer (PRD #39 §43). These govern Calendar-owned
   * events only. A task due date or a contract expiry on the calendar is seen
   * through its own module's permissions and scope, never through these.
   */
  "calendar.view",
  "calendar.event.create",
  "calendar.event.edit",
  "calendar.event.archive",
  "calendar.company_event.manage",
  "calendar.private_event.manage",
  "calendar.reminder.manage",
  "calendar.availability.view",

  /* Meetings ------------------------------------------------------------- */
  /**
   * Meetings, minutes, decisions and action items (PRD #40 §80). Every one is
   * checked together with the meeting's visibility and the member's role on
   * it: holding `meeting.minutes.edit` does not open anybody's minutes.
   */
  "meeting.view",
  "meeting.create",
  "meeting.edit",
  "meeting.cancel",
  "meeting.manage",
  "meeting.manage_participants",
  "meeting.agenda.manage",
  "meeting.minutes.edit",
  "meeting.minutes.finalize",
  "meeting.minutes.reopen",
  "meeting.decision.create",
  "meeting.action.create",
  "meeting.action.manage",
  "meeting.action.convert_to_task",
  "meeting.document.view",
  "meeting.document.create",

  /* Timesheets ----------------------------------------------------------- */
  /**
   * Work allocation, not attendance, payroll or surveillance (PRD #42 §2,
   * §120, §277). "Own" grants are about a person's own weeks; seeing other
   * people's time is the team and project grants, narrowed by scope; deciding
   * a week also needs to be its designated approver.
   */
  "timesheet.view_own",
  "timesheet.edit_own",
  "timesheet.submit_own",
  "timesheet.team.view",
  "timesheet.project.view",
  "timesheet.approve",
  "timesheet.return",
  "timesheet.reject",
  "timesheet.reopen",
  "timesheet.settings.manage",

  /* Daily logs ----------------------------------------------------------- */
  /**
   * The project's daily site record (PRD #43 §126). A log is reached only
   * through its project; each section is edited under its own grant, so field
   * roles contribute what they own without rewriting the rest. Review, lock,
   * void and corrections are separate steps with separate people.
   */
  "daily_log.view",
  "daily_log.create",
  "daily_log.edit",
  "daily_log.submit",
  "daily_log.review",
  "daily_log.return",
  "daily_log.lock",
  "daily_log.void",
  "daily_log.correct_locked",
  "daily_log.settings.manage",
  "daily_log.workforce.manage",
  "daily_log.activity.manage",
  "daily_log.equipment.manage",
  "daily_log.delivery.manage",
  "daily_log.visitor.manage",
  "daily_log.delay.manage",
  "daily_log.instruction.manage",
  "daily_log.qaqc.manage",
  "daily_log.hse.manage",

  /* Approvals ------------------------------------------------------------ */
  /**
   * The Unified Approvals Center (PRD #41 §133, §134). These open the shared
   * workspace and its history, and let an approver lend their authority for a
   * while. None of them decides anything: approving is always the source
   * module's own permission, checked by the source module.
   */
  "approvals.view",
  "approvals.history.view",
  "approvals.delegation.manage",

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
  /**
   * Document review (PRD #38 §61). Both still require the parent record, and
   * a reviewer is only ever assigned a version they could open.
   */
  "document.review.request",
  "document.review.decide",

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
  "legal.dashboard.view",

  "legal.contract.view",
  "legal.contract.create",
  "legal.contract.update",
  "legal.contract.owner.assign",

  "legal.contract.submit_review",
  "legal.contract.review",
  "legal.contract.submit_approval",
  "legal.contract.approve",
  "legal.contract.reject",

  "legal.contract.mark_sent",
  "legal.contract.mark_signed",
  "legal.contract.activate",
  "legal.contract.expire",
  "legal.contract.terminate",
  "legal.contract.cancel",

  "legal.contract.archive",
  "legal.contract.restore",

  "legal.party.view",
  "legal.party.manage",

  "legal.obligation.view",
  "legal.obligation.create",
  "legal.obligation.update",
  "legal.obligation.complete",
  "legal.obligation.cancel",

  "legal.amendment.view",
  "legal.amendment.create",
  "legal.amendment.update",
  "legal.amendment.submit",
  "legal.amendment.approve",
  "legal.amendment.reject",
  "legal.amendment.mark_sent",
  "legal.amendment.mark_signed",
  "legal.amendment.activate",
  "legal.amendment.cancel",
  "legal.amendment.archive",

  "legal.approval.view",
  "legal.approval.decide",

  "legal.document.view",
  "legal.document.create",

  "legal.task.view",
  "legal.task.create",

  "legal.activity.view",
  "legal.report.view",
  "legal.export",

  /**
   * Two separate curtains over one contract (PRD #18 §19, §22, §23).
   *
   * `legal.contract.view` says a person may know the agreement exists and what
   * state it is in. It does not say they may read the price, and it does not
   * say they may read the legal assessment. A project manager delivering the
   * work needs the first; neither of the others follows from it.
   */
  "legal.commercial.view",
  "legal.confidential_terms.view",

  /**
   * Lineage is shown only to somebody it means something to (PRD #18 §252,
   * §496). Each of these is half a decision: the contract also has to name a
   * record the reader can actually open, or the link renders as plain text.
   */
  "legal.sales_source.view",
  "legal.client_link.view",
  "legal.project_link.view",

  /**
   * Permission to decide an approval you submitted yourself. Withheld by
   * default, as in Finance and Sales: "who approved this contract?" must have
   * an answer other than "the person who drafted it" (PRD #18 §116).
   */
  "legal.approval.self",

  /* Procurement (PRD #19 §18) --------------------------------------------- */
  "procurement.view",
  "procurement.manage",
  "procurement.dashboard.view",

  "procurement.supplier.view",
  "procurement.supplier.create",
  "procurement.supplier.update",
  "procurement.supplier.archive",
  "procurement.supplier.restore",

  "procurement.request.view",
  "procurement.request.create",
  "procurement.request.update",
  "procurement.request.submit",
  "procurement.request.approve",
  "procurement.request.reject",
  "procurement.request.cancel",
  "procurement.request.archive",
  "procurement.request.restore",

  "procurement.rfq.view",
  "procurement.rfq.create",
  "procurement.rfq.update",
  "procurement.rfq.issue",
  "procurement.rfq.close",
  "procurement.rfq.cancel",

  /**
   * A quote is what one supplier answered, and it is commercially confidential
   * to the buying side (PRD #19 §260). Seeing that an RFQ exists is not seeing
   * what anybody bid on it, which is why these are separate from `rfq.view`.
   */
  "procurement.quote.view",
  "procurement.quote.create",
  "procurement.quote.update",
  "procurement.quote.select",
  "procurement.quote.disqualify",

  "procurement.order.view",
  "procurement.order.create",
  "procurement.order.update",
  "procurement.order.submit",
  "procurement.order.approve",
  "procurement.order.reject",
  "procurement.order.issue",
  "procurement.order.cancel",
  "procurement.order.close",
  "procurement.order.archive",
  "procurement.order.restore",

  "procurement.receipt.view",
  "procurement.receipt.create",
  "procurement.receipt.update",
  "procurement.receipt.void",

  "procurement.approval.view",
  "procurement.approval.decide",
  /**
   * The financial step of a purchase order's approval chain (PRD #41 §27,
   * §143). Procurement's own grant — the chain is Procurement's — held by the
   * people who answer "can we afford this?" rather than by the buyers, and not
   * on any ladder, so neither running the buying nor raising invoices brings
   * it along by accident.
   */
  "procurement.order.finance_approve",

  /**
   * Budget headroom and the Finance commitment behind an order are Finance
   * facts shown inside Procurement. Each needs its own grant: running the
   * buying is not being told what the project has left (PRD #19 §123, §259).
   */
  "procurement.budget.view",
  "procurement.commitment.view",
  "procurement.commitment.sync",

  "procurement.document.view",
  "procurement.document.create",

  "procurement.task.view",
  "procurement.task.create",

  "procurement.activity.view",
  "procurement.report.view",
  "procurement.export",

  /**
   * Held by nobody by default (PRD #19 §21). Approving what you submitted is
   * not an operational convenience; the queue and the record both withhold the
   * decision from its own author.
   */
  "procurement.approval.self",

  /* Inventory (PRD #20 §18) ------------------------------------------------ */
  "inventory.view",
  "inventory.manage",
  "inventory.dashboard.view",

  "inventory.item.view",
  "inventory.item.create",
  "inventory.item.update",
  "inventory.item.archive",
  "inventory.item.restore",

  "inventory.warehouse.view",
  "inventory.warehouse.create",
  "inventory.warehouse.update",
  "inventory.warehouse.archive",
  "inventory.warehouse.restore",

  "inventory.location.view",
  "inventory.location.create",
  "inventory.location.update",
  "inventory.location.archive",
  "inventory.location.restore",

  /**
   * Posting is separated from drafting throughout (PRD #20 §281).
   *
   * Writing a document down is not the same act as committing it to the stock
   * ledger, and a storeman who may record a delivery is not thereby entitled to
   * write stock off.
   */
  "inventory.receipt.view",
  "inventory.receipt.create",
  "inventory.receipt.post",
  "inventory.receipt.reverse",

  "inventory.issue.view",
  "inventory.issue.create",
  "inventory.issue.update",
  "inventory.issue.post",
  "inventory.issue.cancel",
  "inventory.issue.reverse",

  "inventory.transfer.view",
  "inventory.transfer.create",
  "inventory.transfer.update",
  "inventory.transfer.post",
  "inventory.transfer.cancel",
  "inventory.transfer.reverse",

  "inventory.return.view",
  "inventory.return.create",
  "inventory.return.post",

  /**
   * An adjustment changes what the company believes it owns without anything
   * physically moving. It is the one action that can make stock appear, so it
   * is granted separately from everything else (PRD #20 §146).
   */
  "inventory.adjustment.view",
  "inventory.adjustment.create",
  "inventory.adjustment.update",
  "inventory.adjustment.post",
  "inventory.adjustment.cancel",
  "inventory.adjustment.reverse",

  "inventory.reservation.view",
  "inventory.reservation.create",
  "inventory.reservation.update",
  "inventory.reservation.release",
  "inventory.reservation.fulfill",
  "inventory.reservation.cancel",

  "inventory.movement.view",
  "inventory.movement.create",
  "inventory.balance.view",
  "inventory.low_stock.view",

  "inventory.document.view",
  "inventory.document.create",

  "inventory.task.view",
  "inventory.task.create",

  "inventory.activity.view",
  "inventory.report.view",
  "inventory.export",

  /* QA / QC (PRD #21 §20) ------------------------------------------------- */
  "qaqc.view",
  "qaqc.manage",
  "qaqc.dashboard.view",

  /*
   * Asking for an inspection is not doing one, and doing one is not approving
   * it. The three acts are separate grants throughout (PRD #21 §3, §73).
   */
  "qaqc.request.view",
  "qaqc.request.create",
  "qaqc.request.update",
  "qaqc.request.assign",
  "qaqc.request.cancel",

  "qaqc.template.view",
  "qaqc.template.create",
  "qaqc.template.update",
  "qaqc.template.archive",
  "qaqc.template.restore",

  "qaqc.inspection.view",
  "qaqc.inspection.create",
  "qaqc.inspection.assign",
  "qaqc.inspection.execute",
  "qaqc.inspection.update_draft",
  "qaqc.inspection.submit",
  "qaqc.inspection.approve",
  "qaqc.inspection.reject",
  "qaqc.inspection.close",
  "qaqc.inspection.cancel",
  "qaqc.inspection.reopen",

  /*
   * Releasing material to stock is the act with consequences outside Quality:
   * it is what lets Inventory book a delivery in, so it is granted separately
   * from inspecting (PRD #21 §98, §102).
   */
  "qaqc.material.view",
  "qaqc.material.inspect",
  "qaqc.material.release",
  "qaqc.material.reject",
  "qaqc.material.conditional_accept",

  "qaqc.defect.view",
  "qaqc.defect.create",
  "qaqc.defect.update",
  "qaqc.defect.assign",
  "qaqc.defect.resolve",
  "qaqc.defect.close",
  "qaqc.defect.reopen",
  "qaqc.defect.cancel",

  "qaqc.ncr.view",
  "qaqc.ncr.create",
  "qaqc.ncr.update",
  "qaqc.ncr.assign",
  "qaqc.ncr.submit",
  "qaqc.ncr.approve",
  "qaqc.ncr.reject",
  "qaqc.ncr.close",
  "qaqc.ncr.reopen",
  "qaqc.ncr.cancel",

  "qaqc.corrective_action.view",
  "qaqc.corrective_action.create",
  "qaqc.corrective_action.update",
  "qaqc.corrective_action.assign",
  "qaqc.corrective_action.complete",
  "qaqc.corrective_action.verify",
  "qaqc.corrective_action.reopen",
  "qaqc.corrective_action.cancel",

  "qaqc.reinspection.view",
  "qaqc.reinspection.create",
  "qaqc.reinspection.execute",

  "qaqc.approval.view",
  "qaqc.approval.decide",
  /*
   * Granted to nobody by default. Approving your own inspection is the one
   * thing a quality system exists to prevent (PRD #21 §165).
   */
  "qaqc.approval.self",

  "qaqc.document.view",
  "qaqc.document.create",

  "qaqc.task.view",
  "qaqc.task.create",

  "qaqc.activity.view",
  "qaqc.report.view",
  "qaqc.export",

  /* HSE (PRD #22 §19) ----------------------------------------------------- */
  "hse.view",
  "hse.manage",
  "hse.dashboard.view",

  "hse.inspection.view",
  "hse.inspection.create",
  "hse.inspection.assign",
  "hse.inspection.execute",
  "hse.inspection.submit",
  "hse.inspection.approve",
  "hse.inspection.reject",
  "hse.inspection.close",
  "hse.inspection.cancel",

  "hse.template.view",
  "hse.template.create",
  "hse.template.update",
  "hse.template.archive",
  "hse.template.restore",

  /*
   * Reporting a hazard is deliberately the widest grant in the module.
   * A hazard nobody may report is a hazard nobody fixes, so anybody who reaches
   * a site can raise one; assessing its risk and closing it are the acts that
   * need the safety function (PRD #22 §27, §66, §70).
   */
  "hse.hazard.view",
  "hse.hazard.create",
  "hse.hazard.update",
  "hse.hazard.assign",
  "hse.hazard.assess",
  "hse.hazard.control",
  "hse.hazard.close",
  "hse.hazard.reopen",
  "hse.hazard.cancel",

  "hse.incident.view",
  "hse.incident.create",
  "hse.incident.update",
  "hse.incident.assign",
  "hse.incident.investigate",
  "hse.incident.submit_close",
  "hse.incident.close",
  "hse.incident.reopen",
  "hse.incident.cancel",

  "hse.risk.view",
  "hse.risk.create",
  "hse.risk.update",
  "hse.risk.submit",
  "hse.risk.approve",
  "hse.risk.archive",

  "hse.action.view",
  "hse.action.create",
  "hse.action.update",
  "hse.action.assign",
  "hse.action.complete",
  "hse.action.verify",
  "hse.action.reopen",
  "hse.action.cancel",

  "hse.toolbox.view",
  "hse.toolbox.create",
  "hse.toolbox.update",
  "hse.toolbox.complete",
  "hse.toolbox.cancel",

  "hse.permit.view",
  "hse.permit.create",
  "hse.permit.update",
  "hse.permit.submit",
  "hse.permit.approve",
  "hse.permit.activate",
  "hse.permit.suspend",
  "hse.permit.close",
  "hse.permit.cancel",

  "hse.ppe.view",
  "hse.ppe.create",
  "hse.ppe.update",

  "hse.environment.view",
  "hse.environment.create",
  "hse.environment.update",
  "hse.environment.close",

  /*
   * Stopping work is separated from releasing it on purpose: the whole point of
   * a stop-work is that whoever called it does not have to argue with the person
   * who wants the job restarted (PRD #22 §173, §174).
   */
  "hse.stop_work.view",
  "hse.stop_work.create",
  "hse.stop_work.release",

  "hse.approval.view",
  "hse.approval.decide",
  /*
   * Granted to nobody by default. Signing off your own permit is how a
   * permit-to-work system stops being one (PRD #22 §182).
   */
  "hse.approval.self",

  "hse.document.view",
  "hse.document.create",

  "hse.task.view",
  "hse.task.create",

  "hse.activity.view",
  "hse.report.view",
  "hse.export",

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
  /**
   * How much file storage the company is using (PRD #29 §244, §245).
   *
   * Reading the number, not configuring the buckets: physical storage is
   * deployment configuration and no company admin edits it (PRD #29 §246).
   */
  "company.storage.view",

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
  // Collaboration is part of the shell every role has, not a switchable module:
  // a company that turns Tasks off still discusses its invoices (PRD #38 §22).
  collaboration: "dashboard",
  calendar: "calendar",
  meeting: "meetings",
  approvals: "approvals",
  timesheet: "timesheets",
  daily_log: "dailyLogs",
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
  // Lifecycle verbs that move a record from one state to the next. They read
  // like nouns but every one of them writes (PRD #17 §120, PRD #18 §191).
  "submit_review",
  "submit_approval",
  "review",
  "mark_sent",
  "mark_signed",
  "accept",
  "decline",
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
  // Collaboration and review verbs: each one writes (PRD #38 §38, §61).
  "edit_own",
  "archive_own",
  "request",
  // Calendar (PRD #39 §43).
  "edit",
  // Meetings (PRD #40 §80).
  "manage_participants",
  "finalize",
  "convert_to_task",
  // Approvals Center (PRD #41 §27).
  "finance_approve",
  // Timesheets (PRD #42 §120).
  "edit_own",
  "submit_own",
  "return",
  // Daily logs (PRD #43 §126).
  "lock",
  "correct_locked",
]);

export function isMutatingPermission(permission: string): boolean {
  return MUTATING_ACTIONS.has(permissionAction(permission));
}
