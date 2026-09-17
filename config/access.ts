/**
 * Access levels and data scopes (PRD #5 §6, §7).
 *
 * These two axes describe every NESTO access decision:
 *
 *   AccessLevel — what a user may do inside a module
 *   DataScope   — which records the module is allowed to show them
 *
 * Declared as plain unions rather than imported from Prisma so that the file
 * stays edge-safe: middleware resolves access on every request and must never
 * pull in the database client.
 */

export const ACCESS_LEVELS = ["NONE", "VIEW", "CONTRIBUTE", "APPROVE", "MANAGE"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const DATA_SCOPES = [
  "SELF",
  "ASSIGNED",
  "PROJECT",
  "DEPARTMENT",
  "COMPANY",
  "GROUP",
  "SYSTEM",
] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

/**
 * Access levels are cumulative for *reading*: APPROVE and MANAGE both imply the
 * ability to open a module. They are deliberately NOT cumulative for actions —
 * a granular `resource.action` permission remains the authority there
 * (PRD #5 §86, PRD #7 §53).
 */
const ACCESS_RANK: Record<AccessLevel, number> = {
  NONE: 0,
  VIEW: 1,
  CONTRIBUTE: 2,
  APPROVE: 3,
  MANAGE: 4,
};

export function accessAtLeast(level: AccessLevel, minimum: AccessLevel): boolean {
  return ACCESS_RANK[level] >= ACCESS_RANK[minimum];
}

export function isReadOnlyAccess(level: AccessLevel): boolean {
  return level === "VIEW";
}

export function hasModuleAccess(level: AccessLevel): boolean {
  return level !== "NONE";
}

/**
 * Scope breadth, used when two scopes must be reconciled (for example a module
 * default against a permission-level override). Wider never wins by accident:
 * callers ask for the narrower of the two.
 */
const SCOPE_RANK: Record<DataScope, number> = {
  SELF: 0,
  ASSIGNED: 1,
  PROJECT: 2,
  DEPARTMENT: 3,
  COMPANY: 4,
  GROUP: 5,
  SYSTEM: 6,
};

export function narrowestScope(a: DataScope, b: DataScope): DataScope {
  return SCOPE_RANK[a] <= SCOPE_RANK[b] ? a : b;
}

export function scopeAtLeast(scope: DataScope, minimum: DataScope): boolean {
  return SCOPE_RANK[scope] >= SCOPE_RANK[minimum];
}

export function widestScope(a: DataScope, b: DataScope): DataScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/**
 * Scopes that reach every record of the company a request is in.
 *
 * GROUP is one of them and never more than that for a company-owned record:
 * the company filter is not removed by group authority, it is applied in each
 * company the person is authorised in (E-06 §118, §161). Only group-owned
 * records — people, candidates, the organization — are read across the group.
 */
export function isCompanyWideScope(scope: DataScope): boolean {
  return scope === "COMPANY" || scope === "GROUP" || scope === "SYSTEM";
}

export const accessLevelLabels: Record<AccessLevel, string> = {
  NONE: "No access",
  VIEW: "View",
  CONTRIBUTE: "Contribute",
  APPROVE: "Approve",
  MANAGE: "Manage",
};

export const dataScopeLabels: Record<DataScope, string> = {
  SELF: "Own records",
  ASSIGNED: "Assigned records",
  PROJECT: "Project records",
  DEPARTMENT: "Department records",
  COMPANY: "Company-wide",
  GROUP: "Group-wide",
  SYSTEM: "System",
};
