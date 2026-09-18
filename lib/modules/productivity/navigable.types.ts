/**
 * The record types a person may favorite or return to, and what each is called
 * (PRD #45 §81, §111). Client-safe: the favorites page reads these in the
 * browser, so nothing here may import the registry's server side — its record
 * doors reach Prisma, notifications and Node built-ins.
 */

export const NAVIGABLE_TYPES = ["project", "project_milestone", "task", "meeting", "daily_log", "client", "document", "contract", "purchase_order", "invoice"] as const;
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
};

export function isNavigableType(value: string): value is NavigableType {
  return (NAVIGABLE_TYPES as readonly string[]).includes(value);
}
