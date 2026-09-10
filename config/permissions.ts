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
  "task.complete",
  "task.archive",
  "task.restore",

  /* Clients -------------------------------------------------------------- */
  "client.view",
  "client.create",
  "client.update",
  "client.archive",
  "client.restore",
  "contact.view",
  "contact.create",
  "contact.update",
  "contact.archive",

  /* Documents ------------------------------------------------------------ */
  "document.view",
  "document.create",
  "document.update",
  "document.archive",
  "document.restore",

  /* Finance -------------------------------------------------------------- */
  "finance.view",
  "finance.manage",
  "finance.company_summary.view",
  "finance.project_budget.view",
  "finance.invoice.view",
  "finance.invoice.create",
  "finance.invoice.update",
  "finance.invoice.approve",
  "finance.invoice.archive",
  "finance.payment.view",
  "finance.budget.view",

  /* HR ------------------------------------------------------------------- */
  "hr.view",
  "hr.manage",
  "hr.profile.view",
  "hr.employee.view",
  "hr.employee.update",
  "hr.leave.view",
  "hr.leave.create",
  "hr.leave.update",
  "hr.leave.approve",

  /* Sales ---------------------------------------------------------------- */
  "sales.view",
  "sales.manage",
  "sales.opportunity.view",
  "sales.opportunity.create",
  "sales.opportunity.update",
  "sales.opportunity.archive",

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

  /* Company -------------------------------------------------------------- */
  "company.view",
  "company.manage",

  /* Settings ------------------------------------------------------------- */
  "settings.view",
  "settings.manage",

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

/** Actions that mutate data. Used to keep read-only roles honest. */
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
]);

export function isMutatingPermission(permission: string): boolean {
  return MUTATING_ACTIONS.has(permissionAction(permission));
}
