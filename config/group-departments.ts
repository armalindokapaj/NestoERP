import type { RoleKey } from "@/config/roles";

/**
 * The master departments of a parent group (E-06 §11).
 *
 * Every group starts with the same thirteen functions; a company's own
 * departments are branches of them (`Department.groupDepartmentId`). A role
 * belongs to one function, which is what a department assignment is checked
 * against: heading Group Finance is something a Finance user can do.
 *
 * Migration `20260918120000_parent_group_organization_e06` wrote the same
 * thirteen, with the same ids, for the groups it created.
 *
 * Client-safe: no database imports.
 */
export const GROUP_DEPARTMENTS = [
  { key: "executive", name: "Executive", roles: ["OWNER", "CEO"] },
  { key: "it", name: "IT", roles: ["GROUP_IT"] },
  { key: "hr", name: "HR", roles: ["HR"] },
  { key: "projects", name: "Projects", roles: ["PROJECT_MANAGER"] },
  { key: "architecture", name: "Architecture", roles: ["ARCHITECT"] },
  { key: "engineering", name: "Engineering", roles: ["ENGINEER"] },
  { key: "finance", name: "Finance", roles: ["FINANCE"] },
  { key: "legal", name: "Legal", roles: ["LEGAL"] },
  { key: "sales", name: "Sales", roles: ["SALES"] },
  { key: "procurement", name: "Procurement", roles: ["PROCUREMENT"] },
  { key: "inventory", name: "Inventory", roles: ["INVENTORY"] },
  { key: "qaqc", name: "QA/QC", roles: ["QAQC"] },
  { key: "hse", name: "HSE", roles: ["HSE"] },
] as const satisfies ReadonlyArray<{ key: string; name: string; roles: readonly RoleKey[] }>;

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
    name: department.name,
  }));
}
