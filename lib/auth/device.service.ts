import { z } from "zod";

import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";

/**
 * Push device registrations (MOB-08 §34-§36). A person's own affairs: every
 * operation is keyed by the caller's user id, so nobody can register, read or
 * remove another person's device. A token that moves to a different person
 * (shared tablet, demo switch) is re-parented, not duplicated.
 */
export const registerDeviceSchema = z.object({
  platform: z.enum(["ios", "android"]),
  pushToken: z.string().trim().min(16).max(4096),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  appBuild: z.string().regex(/^\d{1,9}$/).optional(),
});

export const unregisterDeviceSchema = z.object({ pushToken: z.string().trim().min(16).max(4096) });

export async function registerDevice(context: UserContext, input: z.infer<typeof registerDeviceSchema>): Promise<{ id: string }> {
  const data = {
    userId: context.userId,
    sessionId: context.sessionId ?? null,
    platform: input.platform === "ios" ? ("IOS" as const) : ("ANDROID" as const),
    appVersion: input.appVersion,
    appBuild: input.appBuild ?? null,
    enabled: true,
    lastSeenAt: new Date(),
  };
  const row = await prisma.deviceRegistration.upsert({
    where: { pushToken: input.pushToken },
    create: { ...data, pushToken: input.pushToken },
    update: data,
    select: { id: true },
  });
  return row;
}

/** Removes the caller's registration for this token. Not finding it is success: logout must be idempotent. */
export async function unregisterDevice(context: UserContext, pushToken: string): Promise<void> {
  await prisma.deviceRegistration.deleteMany({ where: { pushToken, userId: context.userId } });
}

/**
 * The devices a notification may be pushed to: enabled, and registered by a
 * session that is still live — so a revoked or expired session stops receiving
 * pushes without anything having to remember to disable it.
 */
export async function pushableDevices(userIds: string[]): Promise<Array<{ id: string; userId: string; platform: "IOS" | "ANDROID"; pushToken: string }>> {
  if (userIds.length === 0) return [];
  return prisma.deviceRegistration.findMany({
    where: { userId: { in: userIds }, enabled: true, session: { is: { expiresAt: { gt: new Date() } } } },
    select: { id: true, userId: true, platform: true, pushToken: true },
  });
}
