/**
 * The desktop Create dial's five, by user type (docs/ui/UI-06-create-dial.md).
 *
 * What each role makes most, from what the role exists for (config/roles.ts)
 * and the create grants it holds (config/role-defaults.ts), in the order a
 * person reaches for them — the first sits nearest the + button. Keys are
 * Quick Create actions (config/quick-create.ts): this file decides the order,
 * never the access. The server's eligibility does that (`dialActions`), so a
 * role's choice its company has switched off, or its person may not create, is
 * simply not there. Client-safe.
 */
import type { RoleKey } from "./roles";

/** How many the dial offers. */
export const DIAL_SIZE = 5;

export const CREATE_DIAL: Record<RoleKey, readonly string[]> = {
  // Governs the group: starts projects, signs, delegates, meets, tells everyone.
  OWNER: ["projects.project.create", "contracts.contract.create", "tasks.task.create", "meetings.meeting.create", "announcements.announcement.create"],
  // Runs the company: projects and the business that pays for them.
  CEO: ["projects.project.create", "sales.opportunity.create", "contracts.contract.create", "tasks.task.create", "meetings.meeting.create"],
  // Runs the site: today's diary, the work, the meeting, the materials, the question to the designer.
  PROJECT_MANAGER: ["projects.daily_log.create", "tasks.task.create", "meetings.meeting.create", "procurement.purchase_request.create", "engineering.rfi.create"],
  // Design: drawings, the questions about them, the files and reviews around them.
  ARCHITECT: ["engineering.drawing.create", "engineering.rfi.create", "documents.document.create", "meetings.meeting.create", "tasks.task.create"],
  // Technical delivery on site: the diary, the inspection, the question, the hazard seen.
  ENGINEER: ["projects.daily_log.create", "qaqc.inspection.create", "engineering.rfi.create", "hse.hazard.create", "tasks.task.create"],
  // Money in, money out, money planned.
  FINANCE: ["finance.invoice.create", "finance.expense.create", "finance.payment.create", "finance.budget.create", "tasks.task.create"],
  // Contracts and the paper around them.
  LEGAL: ["contracts.contract.create", "documents.document.create", "meetings.meeting.create", "tasks.task.create"],
  // From first contact to the offer on the table.
  SALES: ["sales.lead.create", "clients.client.create", "sales.opportunity.create", "sales.proposal.create", "meetings.meeting.create"],
  // Asking to buy, asking for prices, finding who sells.
  PROCUREMENT: ["procurement.purchase_request.create", "procurement.rfq.create", "procurement.supplier.create", "documents.document.create", "tasks.task.create"],
  // Stock in, stock out, stock moved, a new item, and asking for more.
  INVENTORY: ["inventory.receipt.create", "inventory.issue.create", "inventory.transfer.create", "inventory.item.create", "procurement.purchase_request.create"],
  // Checking the work and recording what is wrong with it.
  QAQC: ["qaqc.inspection.create", "qaqc.ncr.create", "qaqc.defect.create", "documents.document.create", "tasks.task.create"],
  // Looking, reporting, permitting, briefing.
  HSE: ["hse.inspection.create", "hse.hazard.create", "hse.incident.create", "hse.permit.create", "hse.toolbox_talk.create"],
  // People: hiring, leave, telling everyone.
  HR: ["hr.employee.create", "hr.leave.create", "announcements.announcement.create", "meetings.meeting.create", "tasks.task.create"],
  // Keeps the systems running; makes little in the company itself.
  GROUP_IT: ["tasks.task.create", "meetings.meeting.create", "announcements.announcement.create"],
  // Works outside any company: no dial.
  PLATFORM_ADMIN: [],
  // Reads only: no dial.
  VIEWER: [],
};

/**
 * A person's dial: their role's choices they may create here, in the role's
 * order; short of five, the other actions they may create, in the registry's
 * order, so nobody with something to create gets an empty dial. `eligible` is
 * the server's answer — the keys this person may create in this workspace.
 */
export function dialActions(role: RoleKey, eligible: readonly string[]): string[] {
  const allowed = new Set(eligible);
  const chosen = (CREATE_DIAL[role] ?? []).filter((key) => allowed.has(key));
  for (const key of eligible) {
    if (chosen.length >= DIAL_SIZE) break;
    if (!chosen.includes(key)) chosen.push(key);
  }
  return chosen.slice(0, DIAL_SIZE);
}
