/**
 * Role → sidebar navigation (spec §14–§29, §50).
 *
 * The Sidebar component renders this configuration; it contains no role logic
 * of its own. Order here is the order shown in the sidebar zone.
 */
import type { ModuleKey } from "./modules";
import type { RoleKey } from "./roles";

export const navigation: Record<RoleKey, ModuleKey[]> = {
  OWNER: [
    "dashboard",
    "projects",
    "clients",
    "finance",
    "sales",
    "hr",
    "procurement",
    "inventory",
    "qaqc",
    "hse",
    "documents",
    "team",
    "company",
    "settings",
  ],
  ADMIN: [
    "dashboard",
    "projects",
    "clients",
    "documents",
    "team",
    "company",
    "settings",
    "support",
  ],
  IT: ["dashboard", "team", "company", "support", "settings"],
  HR: ["dashboard", "hr", "team", "documents", "projects", "settings"],
  CEO: [
    "dashboard",
    "projects",
    "clients",
    "finance",
    "sales",
    "hr",
    "procurement",
    "documents",
    "team",
    "company",
  ],
  PROJECT_MANAGER: ["dashboard", "projects", "tasks", "clients", "documents", "team"],
  ARCHITECT: ["dashboard", "projects", "tasks", "documents", "clients"],
  ENGINEER: ["dashboard", "projects", "tasks", "documents", "qaqc"],
  FINANCE: ["dashboard", "finance", "projects", "clients", "documents", "company"],
  LEGAL: ["dashboard", "contracts", "clients", "projects", "documents", "company"],
  SALES: ["dashboard", "sales", "clients", "projects", "documents"],
  PROCUREMENT: ["dashboard", "procurement", "projects", "inventory", "documents"],
  INVENTORY: ["dashboard", "inventory", "procurement", "projects", "documents"],
  QAQC: ["dashboard", "qaqc", "projects", "tasks", "documents"],
  HSE: ["dashboard", "hse", "projects", "tasks", "documents"],
  VIEWER: ["dashboard", "projects", "tasks", "clients", "documents"],
};

export function navigationForRole(role: RoleKey): ModuleKey[] {
  return navigation[role] ?? ["dashboard"];
}
