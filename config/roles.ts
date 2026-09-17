/**
 * The 16 canonical NESTO roles (E-06 §5).
 *
 * A role is a function, never a rank. Management is a *position* held with a
 * role — Head of Group Finance is FINANCE held as GROUP_HEAD, Company C's Finance
 * Manager is FINANCE held as COMPANY_MANAGER — so there is no manager role per
 * department (E-06 §6.5, §7). The two department-manager roles E-05D and E-05E
 * introduced were folded into Architect and Sales on that principle.
 *
 * PLATFORM_ADMIN is in the catalogue but is never a company membership: it is
 * held through `PlatformAccess`, outside every parent group (E-06 §6.1, §19).
 *
 * RoleKey is declared here rather than imported from Prisma so that this file
 * stays edge-safe — middleware reads role configuration on every request and
 * must not pull in the database client. Roles are rows of the `Role` table,
 * synced from this list; there is no enum to keep in step.
 */
export const ROLE_KEYS = [
  "OWNER",
  "PLATFORM_ADMIN",
  "GROUP_IT",
  "HR",
  "CEO",
  "PROJECT_MANAGER",
  "ARCHITECT",
  "ENGINEER",
  "FINANCE",
  "LEGAL",
  "SALES",
  "PROCUREMENT",
  "INVENTORY",
  "QAQC",
  "HSE",
  "VIEWER",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export type RoleDefinition = {
  key: RoleKey;
  /** Number used in the spec, kept for ordering and for the dev tooling. */
  code: string;
  label: string;
  department: string;
  description: string;
  /** Read-only roles never receive create/update/delete permissions. */
  readOnly?: boolean;
  /**
   * Held outside every company: never offered when assigning a membership role
   * and never stored on one (E-06 §6.1).
   */
  platformOnly?: boolean;
};

export const roles: Record<RoleKey, RoleDefinition> = {
  OWNER: {
    key: "OWNER",
    code: "01",
    label: "Group Owner",
    department: "Executive",
    description: "Owns and governs the parent group and every company in it.",
  },
  PLATFORM_ADMIN: {
    key: "PLATFORM_ADMIN",
    code: "02",
    label: "Platform Admin",
    department: "Platform",
    description: "Creates and implements parent groups on the NESTO platform, outside any company.",
    platformOnly: true,
  },
  GROUP_IT: {
    key: "GROUP_IT",
    code: "03",
    label: "Group IT",
    department: "IT",
    description:
      "Technical administrator for the parent group. Provisions users, configures companies and modules, and supports NESTO according to approved business and HR requirements.",
  },
  HR: {
    key: "HR",
    code: "04",
    label: "HR",
    department: "Human Resources",
    description: "Owns people operations, recruitment and the employment record.",
  },
  CEO: {
    key: "CEO",
    code: "05",
    label: "CEO / Director",
    department: "Executive",
    description: "Company performance, approvals, project setup and strategic oversight.",
  },
  PROJECT_MANAGER: {
    key: "PROJECT_MANAGER",
    code: "06",
    label: "Project Manager",
    department: "Projects",
    description: "Runs projects, tasks, teams and client delivery.",
  },
  ARCHITECT: {
    key: "ARCHITECT",
    code: "07",
    label: "Architect",
    department: "Design",
    description: "Design work, drawings, reviews and project documentation.",
  },
  ENGINEER: {
    key: "ENGINEER",
    code: "08",
    label: "Engineer",
    department: "Engineering",
    description: "Technical delivery, inspections and engineering tasks.",
  },
  FINANCE: {
    key: "FINANCE",
    code: "09",
    label: "Finance",
    department: "Finance",
    description: "Revenue, costs, invoicing and financial control.",
  },
  LEGAL: {
    key: "LEGAL",
    code: "10",
    label: "Legal",
    department: "Legal",
    description: "Contracts, approvals, notices and legal records.",
  },
  SALES: {
    key: "SALES",
    code: "11",
    label: "Sales",
    department: "Sales",
    description: "Pipeline, opportunities, proposals and client growth.",
  },
  PROCUREMENT: {
    key: "PROCUREMENT",
    code: "12",
    label: "Procurement",
    department: "Procurement",
    description: "Purchasing, suppliers, RFQs and orders.",
  },
  INVENTORY: {
    key: "INVENTORY",
    code: "13",
    label: "Stock / Inventory",
    department: "Operations",
    description: "Materials, stock levels and movements.",
  },
  QAQC: {
    key: "QAQC",
    code: "14",
    label: "QA/QC",
    department: "Quality",
    description: "Inspections, non-conformances and quality control.",
  },
  HSE: {
    key: "HSE",
    code: "15",
    label: "HSE",
    department: "Health & Safety",
    description: "Safety performance, incidents, permits and actions.",
  },
  VIEWER: {
    key: "VIEWER",
    code: "16",
    label: "Viewer",
    department: "General",
    description: "Read-only access to the company and projects they are assigned to.",
    readOnly: true,
  },
};

export const roleList: RoleDefinition[] = ROLE_KEYS.map((key) => roles[key]);

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

export function roleLabel(key: RoleKey): string {
  return roles[key]?.label ?? key;
}

/** Roles a company membership may hold: every role but the platform's own. */
export const MEMBERSHIP_ROLE_KEYS: RoleKey[] = ROLE_KEYS.filter((key) => !roles[key].platformOnly);

export function isMembershipRoleKey(value: string): value is RoleKey {
  return isRoleKey(value) && !roles[value].platformOnly;
}

/**
 * Where a person sits in a department (E-06 §7). MEMBER is everyone's default;
 * the other two are held through a department assignment.
 */
export const POSITION_LEVELS = ["MEMBER", "COMPANY_MANAGER", "GROUP_HEAD"] as const;
export type PositionLevel = (typeof POSITION_LEVELS)[number];

export const positionLabels: Record<PositionLevel, string> = {
  MEMBER: "Member",
  COMPANY_MANAGER: "Company Department Manager",
  GROUP_HEAD: "Group Department Head",
};
