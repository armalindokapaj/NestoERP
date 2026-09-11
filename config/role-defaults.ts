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
  hr: {
    VIEW: ["hr.view", "hr.profile.view", "hr.employee.view", "hr.leave.view"],
    CONTRIBUTE: ["hr.leave.create", "hr.leave.update"],
    APPROVE: ["hr.leave.approve"],
    MANAGE: ["hr.manage", "hr.employee.update"],
  },
  sales: {
    VIEW: ["sales.view", "sales.opportunity.view"],
    CONTRIBUTE: ["sales.opportunity.create", "sales.opportunity.update"],
    MANAGE: ["sales.manage", "sales.opportunity.archive"],
  },
  contracts: {
    VIEW: ["legal.view", "legal.contract.view"],
    CONTRIBUTE: ["legal.contract.create", "legal.contract.update"],
    APPROVE: ["legal.contract.approve"],
    MANAGE: ["legal.manage", "legal.contract.archive"],
  },
  procurement: {
    VIEW: ["procurement.view", "procurement.request.view", "procurement.order.view"],
    CONTRIBUTE: ["procurement.request.create", "procurement.request.update"],
    APPROVE: ["procurement.request.approve", "procurement.order.approve"],
    MANAGE: ["procurement.manage", "procurement.order.create", "procurement.order.update"],
  },
  inventory: {
    VIEW: ["inventory.view", "inventory.item.view", "inventory.movement.view"],
    CONTRIBUTE: ["inventory.movement.create", "inventory.item.update"],
    MANAGE: ["inventory.manage", "inventory.item.create", "inventory.item.archive"],
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
    VIEW: ["company.view"],
    MANAGE: ["company.manage"],
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
    finance: "V/P", hr: "V/P", contracts: "V/P",
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
    // nobody can ever decide (PRD #15 §19).
    finance: { extra: ["finance.approval.self"] },
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
    sales: { deny: ["sales.opportunity.create", "sales.opportunity.update"] },
    contracts: { deny: ["legal.contract.create", "legal.contract.update"] },
    procurement: { deny: ["procurement.request.create", "procurement.request.update"] },
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
    hr: { deny: ["hr.leave.view"] },
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
  FINANCE: {
    // Commercial context only, not the Sales workspace (PRD #5 §20).
    sales: { deny: [] },
    /**
     * The operational finance workspace — and not the approver (PRD #15 §18,
     * §284).
     *
     * MANAGE is the ladder's top rung, so without this the role that raises
     * every invoice would also sign them off. Separation of duties is the
     * point: approval authority is the CEO's and the Owner's.
     */
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
