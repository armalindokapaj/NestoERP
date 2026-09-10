import type { AuthEventType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";

/**
 * Authentication and security events (PRD #6 §101).
 *
 * Never records a password, a raw reset token or a session token (PRD #6 §102).
 * Business activity belongs in the Activity table, not here (PRD #8 §48).
 */
export async function recordAuthEvent(input: {
  type: AuthEventType;
  userId?: string | null;
  companyId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.authEvent.create({
      data: {
        type: input.type,
        userId: input.userId ?? null,
        companyId: input.companyId ?? null,
        sessionId: input.sessionId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata,
      },
    });
  } catch {
    // Audit logging must never be the reason a sign-in fails.
  }
}
