import type { GroupContext } from "@/lib/context/group-context";
import { canGroup } from "@/lib/context/group-context";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AccessError } from "@/lib/access/guards";
import { assertMayActOnAccount, mayActOnAccount } from "@/lib/core/security/owner-protection";

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
  /** The platform operator console: outside every tenant, so the group owner's protection does not apply to it. */
  platform?: true;
};

export function platformActor(context: PlatformContext): GroupActor {
  return {
    userId: context.userId,
    fullName: context.fullName,
    roleKey: context.roleKey,
    platform: true,
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

/**
 * A group owner's access is changed only by an Owner of the same group (the
 * user, 2026-11-10: "Group owner is protected."): Group IT, or anyone else the
 * group seats, is refused. The platform operator console keeps its powers.
 */
export async function assertGroupActorMayActOn(actor: GroupActor, targetUserId: string, groupId: string): Promise<void> {
  if (actor.platform) return;
  await assertMayActOnAccount({ actorUserId: actor.userId, targetUserId, parentGroupId: groupId });
}

/**
 * The same question asked before the click: is this person a group owner the
 * actor may not change? The drawers and removal previews read it, so they do
 * not offer what `assertGroupActorMayActOn` would refuse.
 */
export async function groupActorShieldedFrom(actor: GroupActor, targetUserId: string, groupId: string): Promise<boolean> {
  if (actor.platform) return false;
  return !(await mayActOnAccount({ actorUserId: actor.userId, targetUserId, parentGroupId: groupId }));
}
