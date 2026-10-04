import { cache } from "react";
import { redirect } from "next/navigation";

import { groupRoleCapabilities, isGroupRoleKey, type GroupCapability, type GroupRoleKey } from "@/config/group-access";
import { auth } from "@/lib/auth";
import { expireSession } from "@/lib/auth/session-store";
import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";

/**
 * A person who belongs to a parent group and to no company (Admin PRD #9).
 *
 * Resolved on its own path, like the Platform Admin's: the session points at no
 * membership, so there is no company, role matrix or module access to build.
 * Authentication established who they are; the group seat establishes where they
 * work and what they may do. The seat, its status, its role and the group's own
 * status are re-read on every request, so removing the seat or suspending the
 * group ends the area at once, without waiting for the session to expire.
 */
export type GroupContext = {
  userId: string;
  sessionId: string;
  username: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  groupId: string;
  groupName: string;
  groupSlug: string;
  groupStatus: string;
  roleKey: GroupRoleKey;
  roleName: string;
  capabilities: readonly GroupCapability[];
};

export type GroupContextFailure = "UNAUTHENTICATED" | "SESSION_EXPIRED" | "USER_INACTIVE" | "NOT_GROUP" | "NO_ACCESS";
export type GroupContextResult = { ok: true; context: GroupContext } | { ok: false; reason: GroupContextFailure };

const USABLE = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"];

export async function resolveGroupContextForSession(sessionId: string, options: { expectedUserId?: string } = {}): Promise<GroupContextResult> {
  const record = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      userId: true, expiresAt: true, membershipId: true,
      user: {
        select: {
          id: true, username: true, firstName: true, lastName: true, email: true, status: true,
          platformAccess: { select: { status: true } },
          parentGroupMemberships: {
            where: { status: "ACTIVE", roleId: { not: null }, parentGroup: { kind: "GROUP", status: { in: ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"] }, isTestFixture: false } },
            orderBy: { createdAt: "asc" },
            select: { parentGroup: { select: { id: true, name: true, slug: true, status: true } }, role: { select: { key: true, name: true } } },
          },
        },
      },
    },
  });
  if (!record) return { ok: false, reason: "SESSION_EXPIRED" };
  if (record.expiresAt.getTime() <= Date.now()) {
    await expireSession(sessionId);
    return { ok: false, reason: "SESSION_EXPIRED" };
  }
  if (options.expectedUserId && record.userId !== options.expectedUserId) return { ok: false, reason: "SESSION_EXPIRED" };
  if (record.user.status !== "ACTIVE") return { ok: false, reason: "USER_INACTIVE" };
  // A company session or a platform session is somebody else's area.
  if (record.membershipId || record.user.platformAccess?.status === "ACTIVE") return { ok: false, reason: "NOT_GROUP" };

  const seat = record.user.parentGroupMemberships.find((row) => row.role && isGroupRoleKey(row.role.key) && USABLE.includes(row.parentGroup.status));
  if (!seat || !seat.role || !isGroupRoleKey(seat.role.key)) {
    logger.warn("AUTH_NO_SCOPE", { sessionId, reason: "no usable group seat" });
    return { ok: false, reason: "NO_ACCESS" };
  }
  const { user } = record;
  return {
    ok: true,
    context: {
      userId: user.id, sessionId, username: user.username, firstName: user.firstName, lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`, email: user.email,
      groupId: seat.parentGroup.id, groupName: seat.parentGroup.name, groupSlug: seat.parentGroup.slug, groupStatus: seat.parentGroup.status,
      roleKey: seat.role.key, roleName: seat.role.name, capabilities: groupRoleCapabilities[seat.role.key],
    },
  };
}

export const resolveGroupContext = cache(async (): Promise<GroupContextResult> => {
  const session = await auth();
  const sessionId = session?.user?.sessionId;
  if (!session?.user?.id || !sessionId) return { ok: false, reason: "UNAUTHENTICATED" };
  return resolveGroupContextForSession(sessionId, { expectedUserId: session.user.id });
});

export function canGroup(context: GroupContext, capability: GroupCapability): boolean {
  return context.capabilities.includes(capability);
}

/** Any group page: the context, or somewhere honest to go instead. */
export async function requireGroupContext(): Promise<GroupContext> {
  const result = await resolveGroupContext();
  if (result.ok) return result.context;
  switch (result.reason) {
    case "UNAUTHENTICATED":
      redirect("/login");
    case "SESSION_EXPIRED":
      redirect("/login?reason=session-expired");
    case "USER_INACTIVE":
      redirect("/login?reason=account-unavailable");
    case "NO_ACCESS":
      redirect("/workspace-unavailable");
    case "NOT_GROUP":
      // A company user or the Platform Admin who types the address lands where they belong.
      redirect("/dashboard");
  }
}
