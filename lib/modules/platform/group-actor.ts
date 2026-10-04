import type { GroupContext } from "@/lib/context/group-context";
import { canGroup } from "@/lib/context/group-context";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AccessError } from "@/lib/access/guards";

/**
 * Who is acting on a group, as the group services see them (Admin PRD #8 §59,
 * PRD #9 §26, §27, §65).
 *
 * The Platform Admin and the group's own CEO or IT administer the same group
 * through the same services. What differs is only how "may they?" is answered,
 * and that answer is a capability checked against the group in the request —
 * never a role name, and never a group the actor does not belong to.
 */
export type GroupCapabilityKey = "companies.create" | "users.manage" | "users.view" | "ceo.manage";

export type GroupActor = {
  userId: string;
  fullName: string;
  /** For the audit trail only. */
  roleKey: string;
  can(capability: GroupCapabilityKey, groupId: string): boolean;
};

export function platformActor(context: PlatformContext): GroupActor {
  return {
    userId: context.userId,
    fullName: context.fullName,
    roleKey: context.roleKey,
    can: (capability) =>
      capability === "companies.create" ? canPlatform(context, "platform.company.create")
        : capability === "users.view" ? canPlatform(context, "platform.company.view")
        : canPlatform(context, "platform.membership.manage"),
  };
}

export function groupActor(context: GroupContext): GroupActor {
  return {
    userId: context.userId,
    fullName: context.fullName,
    roleKey: context.roleKey,
    // The group in the request must be the group the seat belongs to.
    can: (capability, groupId) => groupId === context.groupId && canGroup(context, `group.${capability}`),
  };
}

export function assertGroupCan(actor: GroupActor, capability: GroupCapabilityKey, groupId: string): void {
  if (!actor.can(capability, groupId)) throw new AccessError("FORBIDDEN");
}
