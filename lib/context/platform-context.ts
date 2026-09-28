import { cache } from "react";
import { redirect } from "next/navigation";

import { isPlatformRoleKey, platformRolePermissions, type PlatformPermission, type PlatformRoleKey } from "@/config/platform";
import { expireSession } from "@/lib/auth/session-store";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/database/prisma";

/**
 * The Platform Admin's context (E-06 §19, §116).
 *
 * Resolved on its own path, never through the business context: a platform
 * session points at no membership, so there is no company, role matrix or
 * module access to build, and nothing here can be mistaken for one. Platform
 * access is re-read on every request, so revoking it ends the area at once.
 */
export type PlatformContext = {
  userId: string;
  sessionId: string;
  username: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  roleKey: PlatformRoleKey;
  permissions: readonly PlatformPermission[];
};

export type PlatformContextFailure =
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "USER_INACTIVE"
  /** Signed in, into a company: this area is not theirs. */
  | "NOT_PLATFORM";

export type PlatformContextResult =
  | { ok: true; context: PlatformContext }
  | { ok: false; reason: PlatformContextFailure };

export async function resolvePlatformContextForSession(
  sessionId: string,
  options: { expectedUserId?: string } = {},
): Promise<PlatformContextResult> {
  const record = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      userId: true,
      expiresAt: true,
      membershipId: true,
      user: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          platformAccess: { select: { roleKey: true, status: true } },
        },
      },
    },
  });

  if (!record) return { ok: false, reason: "SESSION_EXPIRED" };
  if (record.expiresAt.getTime() <= Date.now()) {
    await expireSession(sessionId);
    return { ok: false, reason: "SESSION_EXPIRED" };
  }
  if (options.expectedUserId && record.userId !== options.expectedUserId) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }
  if (record.user.status !== "ACTIVE") return { ok: false, reason: "USER_INACTIVE" };

  // A company session is never a platform session, whoever holds it: platform
  // work happens in a session that carries no company at all (E-06 §116).
  if (record.membershipId) return { ok: false, reason: "NOT_PLATFORM" };
  // A session with no company whose platform access has since ended is over;
  // there is nowhere else for it to go.
  const access = record.user.platformAccess;
  if (access?.status !== "ACTIVE" || !isPlatformRoleKey(access.roleKey)) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }

  const { user } = record;
  return {
    ok: true,
    context: {
      userId: user.id,
      sessionId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`,
      email: user.email,
      roleKey: access.roleKey,
      permissions: platformRolePermissions[access.roleKey],
    },
  };
}

export const resolvePlatformContext = cache(async (): Promise<PlatformContextResult> => {
  const session = await auth();
  const sessionId = session?.user?.sessionId;
  if (!session?.user?.id || !sessionId) return { ok: false, reason: "UNAUTHENTICATED" };
  return resolvePlatformContextForSession(sessionId, { expectedUserId: session.user.id });
});

export function canPlatform(context: PlatformContext, permission: PlatformPermission): boolean {
  return context.permissions.includes(permission);
}

/** Any platform page: the context, or somewhere honest to go instead. */
export async function requirePlatformContext(): Promise<PlatformContext> {
  const result = await resolvePlatformContext();
  if (result.ok) return result.context;
  switch (result.reason) {
    case "UNAUTHENTICATED":
      redirect("/login");
    case "SESSION_EXPIRED":
      redirect("/login?reason=session-expired");
    case "USER_INACTIVE":
      redirect("/login?reason=account-unavailable");
    case "NOT_PLATFORM":
      // A company user who types the address lands where they belong.
      redirect("/dashboard");
  }
}
