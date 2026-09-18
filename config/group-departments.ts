import type { ModuleKey } from "@/config/modules";
import type { RoleKey } from "@/config/roles";

/**
 * The master departments of a parent group (E-06 §11, E-13 §8-§10).
 *
 * Every group starts with the same thirteen functions and may add its own
 * (E-13 §40); a company's departments are branches of them
 * (`Department.groupDepartmentId`), made by activating a function in the company.
 * A role belongs to one function, which is what a department position is
 * checked against: heading Group Finance is something a Finance user can do.
 * A department the group adds binds no role, so its positions widen nothing
 * (ADR 0003).
 *
 * `code` is the short name a new group's departments start with (E-13 §10).
 *
 * `modules` are the business modules a function owns: what its head may
 * delegate to the function's people through an access grant (E-06 §18, §78).
 * Executive and IT own none — the Owner delegates through their own
 * permission, and IT's authority is technical, never handed on.
 *
 * Migration `20260918120000_parent_group_organization_e06` wrote the same
 * thirteen, with the same ids, for the groups it created.
 *
 * Client-safe: no database imports.
 */
export const GROUP_DEPARTMENTS = [
  { key: "executive", code: "EXEC", name: "Executive", roles: ["OWNER", "CEO"], modules: [] },
  { key: "it", code: "IT", name: "IT", roles: ["GROUP_IT"], modules: [] },
  { key: "hr", code: "HR", name: "HR", roles: ["HR"], modules: ["hr"] },
  { key: "projects", code: "PROJ", name: "Projects", roles: ["PROJECT_MANAGER"], modules: ["projects", "tasks", "dailyLogs"] },
  { key: "architecture", code: "ARCH", name: "Architecture", roles: ["ARCHITECT"], modules: ["engineering"] },
  { key: "engineering", code: "ENG", name: "Engineering", roles: ["ENGINEER"], modules: ["engineering"] },
  { key: "finance", code: "FIN", name: "Finance", roles: ["FINANCE"], modules: ["finance"] },
  { key: "legal", code: "LEGAL", name: "Legal", roles: ["LEGAL"], modules: ["contracts"] },
  { key: "sales", code: "SALES", name: "Sales", roles: ["SALES"], modules: ["sales", "clients"] },
  { key: "procurement", code: "PROC", name: "Procurement", roles: ["PROCUREMENT"], modules: ["procurement", "contractors"] },
  { key: "inventory", code: "INV", name: "Inventory", roles: ["INVENTORY"], modules: ["inventory"] },
  { key: "qaqc", code: "QAQC", name: "QA/QC", roles: ["QAQC"], modules: ["qaqc"] },
  { key: "hse", code: "HSE", name: "HSE", roles: ["HSE"], modules: ["hse"] },
] as const satisfies ReadonlyArray<{ key: string; code: string; name: string; roles: readonly RoleKey[]; modules: readonly ModuleKey[] }>;

export type GroupDepartmentKey = (typeof GROUP_DEPARTMENTS)[number]["key"];

/** A group department's id: stable, so a seed, a migration and a test agree on it. */
export function groupDepartmentId(parentGroupId: string, key: GroupDepartmentKey): string {
  return `${parentGroupId}:${key}`;
}

/** The function a role belongs to, or null for a role that heads nothing (Viewer, Platform Admin). */
export function groupDepartmentForRole(role: RoleKey): GroupDepartmentKey | null {
  return GROUP_DEPARTMENTS.find((department) => (department.roles as readonly RoleKey[]).includes(role))?.key ?? null;
}

/** The rows a new group is created with. */
export function groupDepartmentRows(parentGroupId: string) {
  return GROUP_DEPARTMENTS.map((department) => ({
    id: groupDepartmentId(parentGroupId, department.key),
    parentGroupId,
    key: department.key,
    code: department.code,
    name: department.name,
  }));
}

/** The key of a department the group adds itself: never one of the chart's, so it binds no role (ADR 0003). */
export const CUSTOM_DEPARTMENT_KEY_PREFIX = "custom-";

/** Whether a group department key is one of the chart's functions, with roles bound to it. */
export function isChartFunction(key: string): boolean {
  return GROUP_DEPARTMENTS.some((department) => department.key === key);
}

/**
 * Modules access may be delegated in at all (E-06 §18): the functions' own.
 * Administration (Team, Organization, Company, Settings, Support) and the
 * shell's shared modules are never delegated — they would hand on the
 * authority to hand things on.
 */
export const GRANTABLE_MODULE_KEYS: readonly ModuleKey[] = [...new Set(GROUP_DEPARTMENTS.flatMap((department) => department.modules as readonly ModuleKey[]))];

export function isGrantableModule(moduleKey: string): moduleKey is ModuleKey {
  return (GRANTABLE_MODULE_KEYS as readonly string[]).includes(moduleKey);
}

/** The modules a function owns, by group department key; none for a key the chart does not know. */
export function modulesOfFunction(key: string): readonly ModuleKey[] {
  return GROUP_DEPARTMENTS.find((department) => department.key === key)?.modules ?? [];
}

/** The roles of a function, by group department key. */
export function rolesOfFunction(key: string): readonly RoleKey[] {
  return GROUP_DEPARTMENTS.find((department) => department.key === key)?.roles ?? [];
}
