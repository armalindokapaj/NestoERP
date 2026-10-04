/**
 * What a person who belongs to a parent group — and to no company — may do in
 * it (Admin PRD #9 §26, §27).
 *
 * A group seat carries one group-level role. The role supplies capabilities and
 * the capability is what every group page, action and API checks; nothing
 * checks the role's name. A company membership is a different relationship
 * with its own role and permissions and is not read here.
 */

export const GROUP_ROLE_KEYS = ["OWNER", "GROUP_IT"] as const;
export type GroupRoleKey = (typeof GROUP_ROLE_KEYS)[number];

export const GROUP_CAPABILITIES = [
  "group.view",
  "group.companies.view",
  "group.companies.create",
  "group.users.view",
  "group.users.manage",
  /** Naming or replacing the Group CEO: the CEO's own call, not IT's. */
  "group.ceo.manage",
  "group.roles.view",
] as const;
export type GroupCapability = (typeof GROUP_CAPABILITIES)[number];

export const groupRoleCapabilities: Record<GroupRoleKey, readonly GroupCapability[]> = {
  OWNER: GROUP_CAPABILITIES,
  // Group IT administers accounts and access (PRD #8 §62); it does not appoint the CEO or found companies.
  GROUP_IT: ["group.view", "group.companies.view", "group.users.view", "group.users.manage", "group.roles.view"],
};

export function isGroupRoleKey(value: string): value is GroupRoleKey {
  return (GROUP_ROLE_KEYS as readonly string[]).includes(value);
}
