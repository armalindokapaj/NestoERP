/**
 * The record types a person may favorite or return to, and what each is called
 * (PRD #45 §81, §111). Client-safe: the favorites page reads these in the
 * browser, so nothing here may import the registry's server side — its record
 * doors reach Prisma, notifications and Node built-ins.
 */

export const NAVIGABLE_TYPES = ["project", "project_milestone", "task", "meeting", "daily_log", "client", "document", "contract", "purchase_order", "invoice", "project_unit", "purchase_request", "rfq", "quality_inspection", "non_conformance_report", "incident"] as const;
export type NavigableType = (typeof NAVIGABLE_TYPES)[number];

export const NAVIGABLE_LABELS: Record<NavigableType, { singular: string; plural: string }> = {
  project: { singular: "Project", plural: "Projects" },
  project_milestone: { singular: "Milestone", plural: "Milestones" },
  task: { singular: "Task", plural: "Tasks" },
  meeting: { singular: "Meeting", plural: "Meetings" },
  daily_log: { singular: "Daily log", plural: "Daily logs" },
  client: { singular: "Client", plural: "Clients" },
  document: { singular: "Document", plural: "Documents" },
  contract: { singular: "Contract", plural: "Contracts" },
  purchase_order: { singular: "Purchase order", plural: "Purchase orders" },
  invoice: { singular: "Invoice", plural: "Invoices" },
  project_unit: { singular: "Unit", plural: "Units" },
  purchase_request: { singular: "Purchase request", plural: "Purchase requests" },
  rfq: { singular: "RFQ", plural: "RFQs" },
  quality_inspection: { singular: "QA/QC inspection", plural: "QA/QC inspections" },
  non_conformance_report: { singular: "NCR", plural: "NCRs" },
  incident: { singular: "HSE incident", plural: "HSE incidents" },
};

/**
 * Deliberately not navigable in V0.1 (Fast Re-entry §26, §27, §43): a payment
 * and a goods receipt have no detail page of their own — their route is a list
 * or a tab — so there is nowhere to star them and no "opened a record" moment;
 * an employee file is HR-confidential and stays out until a discoverability
 * policy says otherwise.
 */
export const NOT_NAVIGABLE_V01 = ["payment", "goods_receipt", "employee"] as const;

export function isNavigableType(value: string): value is NavigableType {
  return (NAVIGABLE_TYPES as readonly string[]).includes(value);
}
