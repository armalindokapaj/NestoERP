import type { AuthEventType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordAuditEvent } from "@/lib/core/audit/audit.service";

/**
 * Authentication and security events (PRD #6 §101).
 *
 * Never records a password, a raw reset token or a session token (PRD #6 §102).
 * Business activity belongs in the Activity table, not here (PRD #8 §48).
 *
 * These also feed the compliance audit log (PRD #28 §91), which is a different
 * surface with a different rule: `AuditEvent.companyId` is not nullable, so an
 * event that cannot be attributed to a company — a failed sign-in for an email
 * nobody has ever used — stays here only. That is a real limit of a
 * company-scoped log, not an omission: there is no tenant whose auditor it
 * would belong to. `AuthEvent.companyId` is nullable precisely so those are
 * still recorded somewhere.
 */

/** The audit action an auth event maps to, where one exists (PRD #28 §91). */
const AUDIT_ACTION: Partial<Record<AuthEventType, (typeof AuditAction)[keyof typeof AuditAction]>> = {
  LOGIN_SUCCESS: AuditAction.AUTH_LOGIN_SUCCEEDED,
  LOGIN_FAILED: AuditAction.AUTH_LOGIN_FAILED,
  LOGOUT: AuditAction.AUTH_LOGOUT,
  PASSWORD_RESET_REQUEST: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
  PASSWORD_RESET_SUCCESS: AuditAction.AUTH_PASSWORD_RESET_COMPLETED,
  COMPANY_CONTEXT_SWITCHED: AuditAction.AUTH_COMPANY_CONTEXT_SWITCHED,
};

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

  await mirrorToAuditLog(input);
}

/**
 * Mirrors an auth event into the company audit log.
 *
 * Deliberately best-effort and after the AuthEvent write: none of these
 * policies is `required`, and a compliance log is not allowed to be the reason
 * somebody cannot sign in (PRD #28 §291).
 */
async function mirrorToAuditLog(input: {
  type: AuthEventType;
  userId?: string | null;
  companyId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const actionKey = AUDIT_ACTION[input.type];
  if (!actionKey) return;

  try {
    const companyId = input.companyId ?? (await companyForUser(input.userId));
    if (!companyId) return;

    await recordAuditEvent(
      {
        companyId,
        actor: { type: "USER", userId: input.userId ?? null },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      { actionKey },
    );
  } catch {
    // Same rule as above.
  }
}

/** The company an auth event belongs to, when the caller did not say. */
async function companyForUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;

  const membership = await prisma.companyMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { companyId: true },
    orderBy: { createdAt: "asc" },
  });

  return membership?.companyId ?? null;
}
