import { z } from "zod";

import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import { AccessError } from "@/lib/access/guards";
import { recordAuthEvent } from "@/lib/auth/events";
import { moveSessionToMembership, USABLE_GROUP_STATUSES } from "@/lib/auth/session-store";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * The companies a person can work in, and moving the session between them
 * (E-06 §3.4, §96).
 *
 * A group user holds a membership in every company of the group; the session
 * still works in one company at a time, so every existing company-scoped
 * service keeps its single-company guarantee. Switching moves the session to
 * the membership in the chosen company — that membership's role and position,
 * and nothing carried over from the company left behind.
 */

export type CompanyContextOptionDTO = {
  companyId: string;
  companyName: string;
  logoUrl: string | null;
  parentGroup: { id: string; name: string };
  role: { key: string; label: string };
  isCurrent: boolean;
};

export const switchCompanySchema = z.object({ companyId: z.string().trim().min(1).max(64) });

const USABLE_MEMBERSHIP = {
  status: "ACTIVE",
  user: { status: "ACTIVE" },
  company: { status: "ACTIVE", parentGroup: { status: { in: USABLE_GROUP_STATUSES } } },
} as const;

export async function listCompanyContexts(session: UserContext): Promise<CompanyContextOptionDTO[]> {
  const memberships = await prisma.companyMember.findMany({
    where: { userId: session.userId, ...USABLE_MEMBERSHIP },
    select: {
      id: true,
      companyId: true,
      role: { select: { key: true, name: true } },
      company: {
        select: { name: true, logoUrl: true, parentGroup: { select: { id: true, name: true } } },
      },
    },
  });

  return memberships
    .filter((membership) => isMembershipRoleKey(membership.role.key))
    .map((membership) => ({
      companyId: membership.companyId,
      companyName: membership.company.name,
      logoUrl: membership.company.logoUrl,
      parentGroup: membership.company.parentGroup,
      role: {
        key: membership.role.key,
        label: isMembershipRoleKey(membership.role.key) ? roleLabel(membership.role.key) : membership.role.name,
      },
      isCurrent: membership.id === session.membershipId,
    }))
    .sort(
      (a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) ||
        a.parentGroup.name.localeCompare(b.parentGroup.name) ||
        a.companyName.localeCompare(b.companyName),
    );
}

export type SwitchCompanyResult = {
  company: { id: string; name: string };
  switched: boolean;
};

/**
 * Makes the chosen company the session's company. A company this person holds
 * no usable membership in answers "not found": the response never confirms
 * that a company id exists to somebody who does not belong to it.
 */
export async function switchCompanyContext(
  session: UserContext,
  companyId: string,
  request: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<SwitchCompanyResult> {
  const membership = await prisma.companyMember.findFirst({
    where: { userId: session.userId, companyId, ...USABLE_MEMBERSHIP },
    select: { id: true, companyId: true, role: { select: { key: true } }, company: { select: { name: true } } },
  });
  if (!membership || !isMembershipRoleKey(membership.role.key)) throw new AccessError("NOT_FOUND");

  const company = { id: membership.companyId, name: membership.company.name };
  if (membership.id === session.membershipId) return { company, switched: false };

  const { moved } = await moveSessionToMembership({
    sessionId: session.sessionId,
    userId: session.userId,
    membershipId: membership.id,
  });
  // The membership or the session ended in between: nothing moved.
  if (!moved) throw new AccessError("NOT_FOUND");

  await recordAuthEvent({
    type: "COMPANY_CONTEXT_SWITCHED",
    userId: session.userId,
    companyId: membership.companyId,
    sessionId: session.sessionId,
    ipAddress: request.ipAddress ?? null,
    userAgent: request.userAgent ?? null,
    metadata: { fromCompanyId: session.companyId, toCompanyId: membership.companyId },
  });

  return { company, switched: true };
}
