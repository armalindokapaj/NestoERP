import type { Permission } from "@/config/permissions";
import type { RoleKey } from "@/config/roles";

/** The user context carried in the session token (spec §54, §67). */
export type NestoSessionUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  role: RoleKey;
  companyId: string;
  companyName: string;
  companySlug: string;
  companyLogo: string | null;
  department: string | null;
  jobTitle: string | null;
};

/** Session user plus the permissions resolved from their role. */
export type CurrentUser = NestoSessionUser & {
  permissions: Permission[];
  /** True when the role shown is a development override, not the stored role. */
  roleIsOverridden: boolean;
  /** The role stored against the CompanyMember record. */
  actualRole: RoleKey;
};
