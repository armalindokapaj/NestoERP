/**
 * Permission architecture (spec §52).
 *
 * Permissions are strings in the form MODULE.ACTION. Application code must ask
 * `can(user, "team.manage")` rather than testing a role directly, so that role
 * definitions can change without touching feature code.
 */
import { modules, type ModuleKey } from "./modules";
import { navigationForRole } from "./navigation";
import { ROLE_KEYS, roles, type RoleKey } from "./roles";

export const PERMISSIONS = [
  "dashboard.view",

  "project.view",
  "project.create",
  "project.update",
  "project.delete",

  "task.view",
  "task.create",
  "task.update",
  "task.delete",

  "client.view",
  "client.create",
  "client.update",

  "document.view",
  "document.create",
  "document.delete",

  "finance.view",
  "finance.manage",

  "hr.view",
  "hr.manage",

  "sales.view",
  "sales.manage",

  "contract.view",
  "contract.manage",

  "procurement.view",
  "procurement.manage",

  "inventory.view",
  "inventory.manage",

  "qaqc.view",
  "qaqc.manage",

  "hse.view",
  "hse.manage",

  "team.view",
  "team.manage",

  "company.view",
  "company.manage",

  "settings.view",
  "settings.manage",

  "support.view",
  "support.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Held by every authenticated user regardless of role.
 * `settings.view` is universal because the top-bar user menu offers Profile and
 * Settings to everyone (spec §11) — it is reachable from there even when a
 * role's sidebar does not list the Settings module.
 */
const UNIVERSAL_PERMISSIONS: Permission[] = ["dashboard.view", "settings.view"];

/**
 * Permissions granted on top of the view access implied by a role's navigation.
 * Keeping only the *extra* grants here means the sidebar and the access rules
 * can never drift apart.
 */
const ADDITIONAL_PERMISSIONS: Record<RoleKey, Permission[]> = {
  OWNER: [
    "project.create",
    "project.update",
    "project.delete",
    "task.view",
    "task.create",
    "task.update",
    "task.delete",
    "client.create",
    "client.update",
    "document.create",
    "document.delete",
    "finance.manage",
    "hr.manage",
    "sales.manage",
    "contract.view",
    "contract.manage",
    "procurement.manage",
    "inventory.manage",
    "qaqc.manage",
    "hse.manage",
    "team.manage",
    "company.manage",
    "settings.manage",
    "support.view",
    "support.manage",
  ],
  ADMIN: [
    "project.create",
    "project.update",
    "task.view",
    "client.create",
    "client.update",
    "document.create",
    "document.delete",
    "team.manage",
    "company.manage",
    "settings.manage",
    "support.manage",
  ],
  IT: ["team.manage", "support.manage", "settings.manage"],
  HR: ["hr.manage", "team.manage", "document.create"],
  CEO: ["task.view", "project.update", "document.create", "contract.view"],
  PROJECT_MANAGER: [
    "project.create",
    "project.update",
    "task.create",
    "task.update",
    "task.delete",
    "client.update",
    "document.create",
  ],
  ARCHITECT: ["project.update", "task.create", "task.update", "document.create"],
  ENGINEER: ["task.create", "task.update", "document.create", "qaqc.view"],
  FINANCE: ["finance.manage", "document.create"],
  LEGAL: ["contract.manage", "document.create"],
  SALES: ["sales.manage", "client.create", "client.update", "document.create"],
  PROCUREMENT: ["procurement.manage", "document.create", "inventory.view"],
  INVENTORY: ["inventory.manage", "document.create"],
  QAQC: ["qaqc.manage", "task.create", "task.update", "document.create"],
  HSE: ["hse.manage", "task.create", "task.update", "document.create"],
  VIEWER: [],
};

/**
 * Which module each permission belongs to. Permission prefixes are singular
 * ("project.view") while module keys are plural ("projects"), so the mapping is
 * explicit rather than inferred.
 */
const PERMISSION_MODULE: Record<string, ModuleKey> = {
  dashboard: "dashboard",
  project: "projects",
  task: "tasks",
  client: "clients",
  document: "documents",
  finance: "finance",
  hr: "hr",
  sales: "sales",
  contract: "contracts",
  procurement: "procurement",
  inventory: "inventory",
  qaqc: "qaqc",
  hse: "hse",
  team: "team",
  company: "company",
  settings: "settings",
  support: "support",
};

export function moduleForPermission(permission: Permission): ModuleKey | null {
  return PERMISSION_MODULE[permission.split(".")[0]] ?? null;
}

function buildRolePermissions(): Record<RoleKey, Permission[]> {
  const result = {} as Record<RoleKey, Permission[]>;

  for (const roleKey of ROLE_KEYS) {
    const granted = new Set<Permission>(UNIVERSAL_PERMISSIONS);

    // Anything in the role's sidebar must be viewable.
    for (const moduleKey of navigationForRole(roleKey)) {
      granted.add(modules[moduleKey].viewPermission);
    }

    const inNavigation = new Set<ModuleKey>(navigationForRole(roleKey));

    for (const permission of ADDITIONAL_PERMISSIONS[roleKey]) {
      // A grant for a module the role cannot see would be an invisible route:
      // reachable by URL but absent from the sidebar. Navigation is the single
      // source of truth, so such a grant is dropped rather than honoured.
      const owningModule = moduleForPermission(permission);
      if (owningModule && !inNavigation.has(owningModule)) continue;
      granted.add(permission);
    }

    // Read-only roles never keep a write grant, whatever the table above says.
    const list = [...granted].filter((permission) =>
      roles[roleKey].readOnly ? permission.endsWith(".view") : true,
    );

    result[roleKey] = list.sort();
  }

  return result;
}

export const rolePermissions: Record<RoleKey, Permission[]> = buildRolePermissions();

export function permissionsForRole(role: RoleKey): Permission[] {
  return rolePermissions[role] ?? [...UNIVERSAL_PERMISSIONS];
}

type PermissionHolder = { role: RoleKey } | { permissions: Permission[] } | null | undefined;

/**
 * The single entry point for access checks.
 * `can(user, "team.manage")` — never `if (role === "ADMIN")`.
 */
export function can(holder: PermissionHolder, permission: Permission): boolean {
  if (!holder) return false;
  const list = "permissions" in holder ? holder.permissions : permissionsForRole(holder.role);
  return list.includes(permission);
}

export function canAny(holder: PermissionHolder, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(holder, permission));
}

/** Modules a role may open, used to filter the sidebar and to guard routes. */
export function accessibleModules(role: RoleKey): ModuleKey[] {
  return navigationForRole(role);
}
