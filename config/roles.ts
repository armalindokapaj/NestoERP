/**
 * The 16 NESTO roles (spec §12).
 *
 * RoleKey is declared here rather than imported from Prisma so that this file
 * stays edge-safe — middleware reads role configuration on every request and
 * must not pull in the database client.
 * The union is kept identical to the `Role` enum in prisma/schema.prisma.
 */
export const ROLE_KEYS = [
  "OWNER",
  "ADMIN",
  "IT",
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
};

export const roles: Record<RoleKey, RoleDefinition> = {
  OWNER: {
    key: "OWNER",
    code: "01",
    label: "Owner",
    department: "Executive",
    description: "Full visibility across every area of the company.",
  },
  ADMIN: {
    key: "ADMIN",
    code: "02",
    label: "Admin",
    department: "Administration",
    description: "Manages users, company configuration and platform setup.",
  },
  IT: {
    key: "IT",
    code: "03",
    label: "Company IT",
    department: "IT",
    description: "Maintains accounts, access, devices and internal support.",
  },
  HR: {
    key: "HR",
    code: "04",
    label: "HR",
    department: "Human Resources",
    description: "Owns people operations, records and recruitment.",
  },
  CEO: {
    key: "CEO",
    code: "05",
    label: "CEO / Director",
    department: "Executive",
    description: "Company performance, approvals and strategic oversight.",
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
    description: "Read-only access to company information.",
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
