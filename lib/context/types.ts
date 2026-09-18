import type { AccessLevel, DataScope } from "@/config/access";
import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import type { PositionLevel, RoleKey } from "@/config/roles";
import type { ContextAssignment } from "./organization-access";

/** Resolved access to one module for the current user (PRD #5 §42). */
export type ModuleAccess = {
  module: ModuleKey;
  accessLevel: AccessLevel;
  scope: DataScope;
  permissions: Permission[];
  /** False when the company has switched the module off (PRD #7 §59). */
  enabled: boolean;
};

export type CompanyContext = {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  logoUrl: string | null;
  industry: string | null;
  country: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
};

/** The parent group the company belongs to (E-06 §3.1). */
export type ParentGroupContext = {
  id: string;
  slug: string;
  name: string;
  status: "IMPLEMENTING" | "READY_FOR_VALIDATION" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  /** A demonstration tenant: every page says its operational data is synthetic (D-01 §69). */
  isDemo: boolean;
};

export type DepartmentContext = {
  id: string;
  key: string | null;
  name: string;
};

/**
 * The one resolved user context (PRD #6 §24).
 *
 * Everything downstream — navigation, dashboard, modules, records, APIs —
 * consumes this object. Nothing re-resolves role or company for itself
 * (PRD #6 §72, §88).
 */
export type UserContext = {
  userId: string;
  companyId: string;
  membershipId: string;
  sessionId: string;

  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;

  company: CompanyContext;
  department: DepartmentContext | null;
  /** The group above the company; group-owned records are read inside it. */
  parentGroupId: string;
  parentGroup: ParentGroupContext;

  role: RoleKey;
  roleLabel: string;
  /**
   * How the role is held in this company: as a member, as its department
   * manager, or as the group's department head (E-06 §7). Resolved from live
   * department assignments on every request, like everything else here.
   */
  position: PositionLevel;
  /** Live assignments that concern this company: the group's heads and this company's own. */
  assignments: ContextAssignment[];

  permissions: Permission[];
  moduleAccess: Record<ModuleKey, ModuleAccess>;
  /** Modules switched on for this company, regardless of the user's role. */
  enabledModules: ModuleKey[];

  /** The role stored on the membership, before any development override. */
  actualRole: RoleKey;
  /** True when the role above is a development switcher override. */
  roleIsOverridden: boolean;
};

/**
 * Why a context could not be built. Each maps to a distinct screen, because
 * "not signed in" and "your company is suspended" are different problems for
 * the person reading them (PRD #6 §46–§50).
 */
export type ContextFailure =
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "USER_INACTIVE"
  | "NO_MEMBERSHIP"
  | "MEMBERSHIP_INACTIVE"
  | "COMPANY_UNAVAILABLE"
  | "CONFIGURATION_ERROR"
  /** A Platform Admin's session: valid, but it has no company to act in (E-06 §116). */
  | "PLATFORM_SESSION";

export type ContextResult =
  | { ok: true; context: UserContext }
  | { ok: false; reason: ContextFailure };
